#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from '@xenova/transformers';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration types
interface VaultConfig {
  path: string;
  name: string;
  readonly: boolean;
}

interface ServerConfig {
  primaryVault: VaultConfig;
  secondaryVaults: VaultConfig[];
}

// Load configuration
function loadConfig(): ServerConfig {
  // Try to load from config file in MCP server directory
  const configPath = path.join(path.dirname(new URL(import.meta.url).pathname), '.obsidian-mcp.json');
  try {
    const configData = fssync.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);

    // Validate config structure
    if (!config.primaryVault || !config.primaryVault.path) {
      throw new Error('Invalid config: primaryVault.path is required');
    }

    return {
      primaryVault: {
        path: config.primaryVault.path,
        name: config.primaryVault.name || 'Primary Vault',
        readonly: false,
      },
      secondaryVaults: (config.secondaryVaults || []).map((v: any) => ({
        path: v.path,
        name: v.name || path.basename(v.path),
        readonly: true,
      })),
    };
  } catch (error) {
    // Fall back to environment variables
    const primaryPath = process.env.OBSIDIAN_VAULT_PATH || path.join(process.env.HOME || '', 'obsidian-vault');

    // Parse secondary vaults from env (comma-separated paths)
    const secondaryPaths = process.env.OBSIDIAN_SECONDARY_VAULTS
      ? process.env.OBSIDIAN_SECONDARY_VAULTS.split(',').map(p => p.trim()).filter(p => p)
      : [];

    return {
      primaryVault: {
        path: primaryPath,
        name: process.env.OBSIDIAN_VAULT_NAME || 'Primary Vault',
        readonly: false,
      },
      secondaryVaults: secondaryPaths.map((p, idx) => ({
        path: p,
        name: `Secondary Vault ${idx + 1}`,
        readonly: true,
      })),
    };
  }
}

const CONFIG = loadConfig();
const VAULT_PATH = CONFIG.primaryVault.path; // Keep for backward compatibility

interface SessionMetadata {
  date: string;
  session_id: string;
  topics: string[];
  decisions: string[];
  status: 'ongoing' | 'completed';
  repository?: {
    path: string;
    name: string;
    commits: string[];
  };
  files_accessed?: Array<{
    path: string;
    action: 'read' | 'edit' | 'create';
    timestamp: string;
  }>;
}

interface TopicMetadata {
  title: string;
  created: string;
  last_reviewed?: string;
  review_count?: number;
  tags: string[];
  review_history?: Array<{
    date: string;
    action: 'created' | 'updated' | 'reviewed' | 'archived';
    notes: string;
  }>;
}

interface ReviewAnalysis {
  is_outdated: boolean;
  concerns: string[];
  suggested_updates: string;
  confidence: 'high' | 'medium' | 'low';
}

interface PendingReview {
  review_id: string;
  topic: string;
  slug: string;
  current_content: string;
  analysis: ReviewAnalysis;
  timestamp: number;
}

interface RepoCandidate {
  path: string;
  name: string;
  score: number;
  reasons: string[];
  branch?: string;
  remote?: string;
}

interface EmbeddingCacheEntry {
  file: string;
  embedding: number[];
  timestamp: number;
  vaultPath?: string; // Track which vault this file came from
}

interface EmbeddingConfig {
  enabled: boolean;
  modelName: string;
  cacheDirs: Map<string, string>; // Map of vaultPath -> cacheDir
  semanticWeight: number; // 0-1, how much weight semantic search gets (rest goes to keyword)
}

interface EmbeddingToggleConfig {
  enabled: boolean;
  lastModified: string;
}

class ObsidianMCPServer {
  private server: Server;
  private config: ServerConfig;
  private currentSessionId: string | null = null;
  private currentSessionFile: string | null = null;
  private pendingReviews: Map<string, PendingReview> = new Map();
  private filesAccessed: Array<{
    path: string;
    action: 'read' | 'edit' | 'create';
    timestamp: string;
  }> = [];
  // Track content created during conversation (for lazy session creation)
  private topicsCreated: Array<{ slug: string; title: string; file: string }> = [];
  private decisionsCreated: Array<{ slug: string; title: string; file: string }> = [];
  private projectsCreated: Array<{ slug: string; name: string; file: string }> = [];
  private embeddingConfig: EmbeddingConfig;
  private embeddingCache: Map<string, EmbeddingCacheEntry> = new Map();
  private extractor: any = null;
  private embeddingInitPromise: Promise<void> | null = null;
  private embeddingToggleFile: string = '';

  constructor() {
    this.config = CONFIG;
    this.server = new Server(
      {
        name: 'obsidian-context-manager',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize embedding config with per-vault cache directories
    const cacheDirs = new Map<string, string>();
    // Primary vault cache
    cacheDirs.set(this.config.primaryVault.path, path.join(this.config.primaryVault.path, '.embedding-cache'));
    // Secondary vaults cache
    for (const vault of this.config.secondaryVaults) {
      cacheDirs.set(vault.path, path.join(vault.path, '.embedding-cache'));
    }

    this.embeddingToggleFile = path.join(
      this.config.primaryVault.path,
      '.embedding-toggle.json'
    );

    // Try to load embedding state from toggle file, fallback to env var
    this.embeddingConfig = {
      enabled: this.loadEmbeddingToggleState(),
      modelName: 'Xenova/all-MiniLM-L6-v2',
      cacheDirs: cacheDirs,
      semanticWeight: 0.6, // 60% semantic, 40% keyword
    };

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      // With lazy session creation, we don't need to close sessions on SIGINT
      // Sessions are only created when user explicitly runs /close
      await this.server.close();
      process.exit(0);
    });
  }

  // Helper methods for vault management
  private getAllVaults(): VaultConfig[] {
    return [this.config.primaryVault, ...this.config.secondaryVaults];
  }

  private getPrimaryVaultPath(): string {
    return this.config.primaryVault.path;
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_vault':
            return await this.searchVault(args as {
              query: string;
              directories?: string[];
              max_results?: number;
              date_range?: { start?: string; end?: string };
              snippets_only?: boolean;
            });
          
          case 'create_topic_page':
            return await this.createTopicPage(args as { topic: string; content: string });
          
          case 'create_decision':
            return await this.createDecision(args as { title: string; content: string; context?: string; force?: boolean });
          
          case 'update_topic_page':
            return await this.updateTopicPage(args as { topic: string; content: string; append?: boolean });

          case 'get_session_context':
            return await this.getSessionContext(args as { session_id?: string });

          case 'get_topic_context':
            return await this.getTopicContext(args as { topic: string });

          case 'link_to_topic':
            return await this.linkToTopic(args as { topic: string });
          
          case 'close_session':
            return await this.closeSession(args as { summary: string; topic?: string; _invoked_by_slash_command?: boolean });

          case 'find_stale_topics':
            return await this.findStaleTopics(args as { age_threshold_days?: number; include_never_reviewed?: boolean });

          case 'review_topic':
            return await this.reviewTopic(args as { topic: string; analysis_prompt?: string });

          case 'approve_topic_update':
            return await this.approveTopicUpdate(args as { review_id: string; action: string; modified_content?: string });

          case 'archive_topic':
            return await this.archiveTopic(args as { topic: string; reason?: string });

          case 'list_recent_sessions':
            return await this.listRecentSessions(args as { limit?: number; _invoked_by_slash_command?: boolean });

          case 'list_recent_projects':
            return await this.listRecentProjects(args as { limit?: number; _invoked_by_slash_command?: boolean });

          case 'track_file_access':
            return await this.trackFileAccess(args as { path: string; action: 'read' | 'edit' | 'create' });

          case 'detect_session_repositories':
            return await this.detectSessionRepositories();

          case 'link_session_to_repository':
            return await this.linkSessionToRepository(args as { repo_path: string });

          case 'create_project_page':
            return await this.createProjectPage(args as { repo_path: string });

          case 'record_commit':
            return await this.recordCommit(args as { repo_path: string; commit_hash: string });

          case 'toggle_embeddings':
            return await this.toggleEmbeddings(args as { enabled?: boolean });

          case 'vault_custodian':
            return await this.vaultCustodian();

          case 'analyze_topic_content':
            return await this.analyzeTopicContent(args as {
              content: string;
              topic_name?: string;
              context?: string;
            });

          case 'extract_decisions_from_session':
            return await this.extractDecisionsFromSession(args as {
              session_id?: string;
              content?: string;
            });

          case 'enhanced_search':
            return await this.enhancedSearch(args as {
              query: string;
              context?: string;
              current_session_id?: string;
              max_results_per_query?: number;
            });

          case 'analyze_commit_impact':
            return await this.analyzeCommitImpact(args as {
              repo_path: string;
              commit_hash: string;
              include_diff?: boolean;
            });

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  // ==================== Embedding Methods ====================

  private getVaultForFile(filePath: string): VaultConfig | null {
    // Determine which vault a file belongs to based on its absolute path
    for (const vault of [this.config.primaryVault, ...this.config.secondaryVaults]) {
      if (filePath.startsWith(vault.path)) {
        return vault;
      }
    }
    return null;
  }

  private getCacheDirForVault(vaultPath: string): string {
    return this.embeddingConfig.cacheDirs.get(vaultPath) || '';
  }

  private async ensureExtractorInitialized(): Promise<void> {
    if (this.embeddingInitPromise) {
      return this.embeddingInitPromise;
    }

    if (this.extractor) {
      return;
    }

    if (!this.embeddingConfig.enabled) {
      return;
    }

    this.embeddingInitPromise = (async () => {
      try {
        this.extractor = await pipeline('feature-extraction', this.embeddingConfig.modelName);
      } catch (error) {
        console.error('[Embedding] Failed to initialize extractor:', error);
        this.embeddingConfig.enabled = false;
      }
    })();

    await this.embeddingInitPromise;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    await this.ensureExtractorInitialized();

    if (!this.extractor) {
      throw new Error('Embedding extractor not initialized');
    }

    try {
      // Generate embedding for the text
      const result = await this.extractor(text, { pooling: 'mean', normalize: true });

      // Convert to array if needed
      let embedding: number[];
      if (result.data) {
        embedding = Array.from(result.data as any) as number[];
      } else if (Array.isArray(result)) {
        embedding = (result as unknown[])[0] ? Array.from((result as unknown[])[0] as any) as number[] : Array.from(result as any) as number[];
      } else {
        embedding = Array.from(result as any) as number[];
      }
      return embedding;
    } catch (error) {
      console.error('[Embedding] Failed to generate embedding:', error);
      throw error;
    }
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    const len = Math.min(vecA.length, vecB.length);
    for (let i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  private async loadEmbeddingCache(): Promise<void> {
    if (!this.embeddingConfig.enabled) {
      return;
    }

    // Load cache from all vault directories
    for (const [vaultPath, cacheDir] of this.embeddingConfig.cacheDirs) {
      try {
        const cacheFile = path.join(cacheDir, 'embeddings.json');
        const data = await fs.readFile(cacheFile, 'utf-8');
        const entries = JSON.parse(data) as EmbeddingCacheEntry[];

        for (const entry of entries) {
          // Reconstruct absolute file path for cache key
          const absolutePath = path.join(vaultPath, entry.file);
          const cacheEntry: EmbeddingCacheEntry = {
            ...entry,
            vaultPath: vaultPath,
            file: absolutePath, // Store absolute path as cache key
          };
          this.embeddingCache.set(absolutePath, cacheEntry);
        }
      } catch (error) {
        // Cache file doesn't exist for this vault yet, which is fine
      }
    }
  }

  private async saveEmbeddingCache(): Promise<void> {
    if (!this.embeddingConfig.enabled) {
      return;
    }

    // Group cache entries by vault
    const entriesByVault = new Map<string, EmbeddingCacheEntry[]>();

    for (const [absolutePath, entry] of this.embeddingCache) {
      const vault = this.getVaultForFile(absolutePath);
      if (!vault) continue;

      if (!entriesByVault.has(vault.path)) {
        entriesByVault.set(vault.path, []);
      }

      // Convert absolute path back to relative path for storage
      const relativePath = path.relative(vault.path, absolutePath);
      const storeEntry: EmbeddingCacheEntry = {
        ...entry,
        file: relativePath,
        vaultPath: vault.path,
      };

      entriesByVault.get(vault.path)!.push(storeEntry);
    }

    // Save each vault's cache to its directory
    for (const [vaultPath, entries] of entriesByVault) {
      try {
        const cacheDir = this.getCacheDirForVault(vaultPath);
        await fs.mkdir(cacheDir, { recursive: true });
        const cacheFile = path.join(cacheDir, 'embeddings.json');
        await fs.writeFile(cacheFile, JSON.stringify(entries, null, 2));
      } catch (error) {
        console.error(`[Embedding] Failed to save cache for vault ${vaultPath}:`, error);
      }
    }
  }

  private async getCachedEmbedding(file: string, fileStats: any): Promise<number[] | null> {
    if (!this.embeddingConfig.enabled) {
      return null;
    }

    const cached = this.embeddingCache.get(file);
    if (cached) {
      // Check if file has been modified since cache
      const fileMtime = Math.floor(fileStats.mtime.getTime() / 1000);
      if (cached.timestamp >= fileMtime) {
        return cached.embedding;
      }
    }

    return null;
  }

  private async getOrCreateEmbedding(file: string, content: string, fileStats: any): Promise<number[]> {
    // Try to get from cache
    const cached = await this.getCachedEmbedding(file, fileStats);
    if (cached) {
      return cached;
    }

    // Generate new embedding
    const embedding = await this.generateEmbedding(content);

    // Cache it with vault information
    const vault = this.getVaultForFile(file);
    this.embeddingCache.set(file, {
      file,
      embedding,
      timestamp: Math.floor(fileStats.mtime.getTime() / 1000),
      vaultPath: vault?.path,
    });

    return embedding;
  }

  private loadEmbeddingToggleState(): boolean {
    // Try to load from toggle file first
    try {
      if (require('fs').existsSync(this.embeddingToggleFile)) {
        const data = require('fs').readFileSync(this.embeddingToggleFile, 'utf-8');
        const config: EmbeddingToggleConfig = JSON.parse(data);
        return config.enabled;
      }
    } catch (error) {
      // Fall through to env var
    }

    // Fall back to environment variable (default: enabled)
    return process.env.ENABLE_EMBEDDINGS !== 'false';
  }

  private async saveEmbeddingToggleState(enabled: boolean): Promise<void> {
    const config: EmbeddingToggleConfig = {
      enabled,
      lastModified: new Date().toISOString(),
    };

    try {
      await fs.writeFile(this.embeddingToggleFile, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('[Embedding] Failed to save toggle state:', error);
      throw new Error(`Failed to save embedding toggle state: ${error}`);
    }
  }

  private async toggleEmbeddings(args: { enabled?: boolean }): Promise<any> {
    // If no explicit state provided, toggle current state
    const newState = args.enabled !== undefined ? args.enabled : !this.embeddingConfig.enabled;

    // Update in-memory config
    this.embeddingConfig.enabled = newState;

    // Save to file
    await this.saveEmbeddingToggleState(newState);

    // If disabling, reset the extractor
    if (!newState) {
      this.extractor = null;
      this.embeddingInitPromise = null;
      // Clear cache to prevent stale embeddings
      this.embeddingCache.clear();
    }

    const status = newState ? 'enabled' : 'disabled';
    const action = newState ? 'enabled (will generate on next search)' : 'disabled (using keyword search only)';

    return {
      content: [
        {
          type: 'text',
          text: `Embeddings ${action}\n\nConfiguration saved to: ${this.embeddingToggleFile}\n\nCurrent state: ${status}`,
        },
      ],
    };
  }

  // ==================== End Embedding Methods ====================

  private getTools(): Tool[] {
    return [
      {
        name: 'search_vault',
        description: 'Search the Obsidian vault for relevant notes and context. Returns ranked results with snippets. Use get_session_context to read full files.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (keywords or phrases)',
            },
            directories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: specific directories to search (sessions, topics, decisions)',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
              default: 10,
            },
            date_range: {
              type: 'object',
              properties: {
                start: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
                end: { type: 'string', description: 'End date (YYYY-MM-DD)' },
              },
              description: 'Optional: filter by date range',
            },
            snippets_only: {
              type: 'boolean',
              description: 'If true, return condensed snippets instead of full matches (default: true)',
              default: true,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'create_topic_page',
        description: `Create a technical reference page in topics/ directory.

USE FOR:
- Technical implementation details, architecture explanations, algorithms
- How-to guides, troubleshooting procedures, setup instructions
- System behavior documentation and API references
- Bug fix summaries, lessons learned, and design patterns

DO NOT USE FOR:
- Strategic or organizational decisions (use create_decision instead)
- Git repository tracking (use create_project_page instead)
- Conversation logs (use save_session_note instead)`,
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name (will be slugified for filename)',
            },
            content: {
              type: 'string',
              description: 'Content for the topic page',
            },
          },
          required: ['topic', 'content'],
        },
      },
      {
        name: 'create_decision',
        description: `Create an architectural decision record (ADR) in decisions/ directory.

USE FOR:
- Strategic architectural choices between alternatives (flat vs hierarchical)
- Technology selection decisions (which library, framework, or approach)
- Organizational decisions with tradeoffs (process changes, standards)
- Major design decisions that affect system structure or behavior

DO NOT USE FOR:
- Bug fixes or implementation details (use create_topic_page instead)
- General technical documentation (use create_topic_page instead)
- How-to guides or troubleshooting (use create_topic_page instead)

A decision should have: context, multiple alternatives considered, rationale for choice, and consequences.

NOTE: If your title contains implementation keywords (fix, bug, implement, etc.), the tool will suggest using create_topic_page instead. Use force: true if the decision is genuinely strategic despite the keywords (e.g., decision to fix architecture that also includes implementation guide).`,
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Decision title',
            },
            content: {
              type: 'string',
              description: 'Decision content (rationale, alternatives, consequences)',
            },
            context: {
              type: 'string',
              description: 'Optional context for the decision',
            },
            force: {
              type: 'boolean',
              description: 'Set to true to bypass keyword detection warnings. Use when title contains implementation keywords but the decision is genuinely strategic (e.g., "Implement Feature X: considered approach A vs B, chose B")',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'update_topic_page',
        description: 'Update an existing topic page with new information.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name',
            },
            content: {
              type: 'string',
              description: 'Content to add or replace',
            },
            append: {
              type: 'boolean',
              description: 'If true, append to existing content; if false, replace',
              default: true,
            },
          },
          required: ['topic', 'content'],
        },
      },
      {
        name: 'get_session_context',
        description: 'Retrieve the full context from a session file.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Optional session ID; if not provided, returns current session',
            },
          },
        },
      },
      {
        name: 'get_topic_context',
        description: 'Load full topic content when you need complete, authoritative information. Topics are living documents that represent the gold standard for their subject matter.\n\n**When to use:**\n- You need detailed, comprehensive understanding of a concept\n- Search snippets are insufficient or incomplete\n- User asks for in-depth explanation\n- Multiple follow-up questions are expected\n\n**When NOT to use:**\n- Quick factual lookup (use search snippets instead)\n- Topic would be very large but you only need a small detail\n- One-off questions where snippets suffice\n\n**Best practice:** Search first to identify relevant topics, then load the full topic for authoritative reference.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name or slug to retrieve',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'link_to_topic',
        description: 'Get the Obsidian link format for a topic, creating the page if it doesn\'t exist.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name to link to',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'close_session',
        description: 'Create a session retroactively to capture the work done in this conversation. ONLY callable via the /close slash command. Call this at the end of a conversation to persist the session to the vault.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'A summary of what was accomplished in this conversation. This will be the main content of the session file.',
            },
            topic: {
              type: 'string',
              description: 'Optional topic or title for this session (will be slugified for the filename)',
            },
            _invoked_by_slash_command: {
              type: 'boolean',
              description: 'Internal parameter - must be true to invoke this tool. Only set by slash commands.',
              default: false,
            },
          },
          required: ['summary'],
        },
      },
      {
        name: 'find_stale_topics',
        description: 'Find topics that haven\'t been reviewed in a specified time period. Returns list of topics that may need review.',
        inputSchema: {
          type: 'object',
          properties: {
            age_threshold_days: {
              type: 'number',
              description: 'Number of days since creation or last review to consider a topic stale (default: 365)',
              default: 365,
            },
            include_never_reviewed: {
              type: 'boolean',
              description: 'Include topics that have never been reviewed (default: true)',
              default: true,
            },
          },
        },
      },
      {
        name: 'review_topic',
        description: 'Analyze a topic for outdated content and suggest updates. Returns current content and AI analysis with suggested changes.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name or slug to review',
            },
            analysis_prompt: {
              type: 'string',
              description: 'Optional custom instructions for the review analysis',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'approve_topic_update',
        description: 'Apply or dismiss a pending topic review. Updates the topic with new content and review history.',
        inputSchema: {
          type: 'object',
          properties: {
            review_id: {
              type: 'string',
              description: 'Review ID from review_topic call',
            },
            action: {
              type: 'string',
              enum: ['update', 'archive', 'keep', 'dismiss'],
              description: 'Action to take: update (apply changes), archive (move to archive), keep (mark reviewed, no changes), dismiss (cancel review)',
            },
            modified_content: {
              type: 'string',
              description: 'Optional: edited content if you want to modify the AI suggestion before applying',
            },
          },
          required: ['review_id', 'action'],
        },
      },
      {
        name: 'archive_topic',
        description: 'Move a topic to the archive directory. Preserves all metadata and content.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name or slug to archive',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for archiving',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'list_recent_sessions',
        description: 'List the most recent conversation sessions. Returns session metadata including ID, topic, date, and status.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of sessions to return (default: 5)',
              default: 5,
            },
            _invoked_by_slash_command: {
              type: 'boolean',
              description: 'Internal parameter - must be true to invoke this tool. Only set by slash commands.',
              default: false,
            },
          },
        },
      },
      {
        name: 'list_recent_projects',
        description: 'List the most recent projects. Returns project metadata including name, repository path, creation date, and activity.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of projects to return (default: 5)',
              default: 5,
            },
            _invoked_by_slash_command: {
              type: 'boolean',
              description: 'Internal parameter - must be true to invoke this tool. Only set by slash commands.',
              default: false,
            },
          },
        },
      },
      {
        name: 'track_file_access',
        description: 'Track a file that was accessed during the session. Used to help detect relevant Git repositories.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to the file',
            },
            action: {
              type: 'string',
              enum: ['read', 'edit', 'create'],
              description: 'Type of access: read, edit, or create',
            },
          },
          required: ['path', 'action'],
        },
      },
      {
        name: 'detect_session_repositories',
        description: 'Analyze the current session to detect relevant Git repositories based on files accessed and session context.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'link_session_to_repository',
        description: 'Link the current session to a specific Git repository.',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Absolute path to the Git repository',
            },
          },
          required: ['repo_path'],
        },
      },
      {
        name: 'create_project_page',
        description: 'Create or update a project page in the Obsidian vault for tracking a Git repository.',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Absolute path to the Git repository',
            },
          },
          required: ['repo_path'],
        },
      },
      {
        name: 'record_commit',
        description: 'Record a Git commit in the Obsidian vault, creating a commit page with diff and session links.',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Absolute path to the Git repository',
            },
            commit_hash: {
              type: 'string',
              description: 'Git commit hash',
            },
          },
          required: ['repo_path', 'commit_hash'],
        },
      },
      {
        name: 'toggle_embeddings',
        description: 'Toggle the embedding cache on or off. Embeddings are used for semantic search in search_vault. Easily toggle without restarting the server.',
        inputSchema: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              description: 'Optional: true to enable, false to disable. If not provided, toggles current state.',
            },
          },
        },
      },
      {
        name: 'vault_custodian',
        description: 'Verify vault integrity by checking file organization, validating links, and reorganizing/relinking files as necessary. Ensures all files are in logical locations and properly connected.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'analyze_topic_content',
        description: 'Analyze topic content using AI to generate tags, summary, find related topics, and detect duplicates. Returns structured analysis that can be used to enhance topic creation.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The topic content to analyze',
            },
            topic_name: {
              type: 'string',
              description: 'Optional topic name for better context',
            },
            context: {
              type: 'string',
              description: 'Optional additional context about the topic',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'extract_decisions_from_session',
        description: 'Extract architectural decisions from a session and generate ADR-formatted decision records. Analyzes session content to identify strategic choices, alternatives considered, and consequences.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Optional session ID to analyze. If not provided, uses current session.',
            },
            content: {
              type: 'string',
              description: 'Optional content to analyze instead of reading from session file',
            },
          },
        },
      },
      {
        name: 'enhanced_search',
        description: 'Enhanced semantic search with query understanding, expansion, and contextual refinement. Uses sub-agent to transform queries into multiple search variations and synthesize results.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to understand and expand',
            },
            context: {
              type: 'string',
              description: 'Optional additional context to refine the search (e.g., current work, specific domain)',
            },
            current_session_id: {
              type: 'string',
              description: 'Optional session ID to use for contextual search',
            },
            max_results_per_query: {
              type: 'number',
              description: 'Maximum results per query variation (default: 5)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'analyze_commit_impact',
        description: 'Analyze a Git commit to understand what changed, generate human-readable summaries, and identify related topics/decisions. Provides impact analysis for documentation updates.',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Absolute path to the Git repository',
            },
            commit_hash: {
              type: 'string',
              description: 'Git commit hash to analyze',
            },
            include_diff: {
              type: 'boolean',
              description: 'Include full diff in analysis (default: false, uses stat summary)',
            },
          },
          required: ['repo_path', 'commit_hash'],
        },
      },
    ];
  }

  private async ensureVaultStructure(): Promise<void> {
    // Only ensure structure for primary vault (write operations)
    const primaryPath = this.getPrimaryVaultPath();
    const dirs = ['sessions', 'topics', 'decisions', 'archive/topics', 'projects'];

    for (const dir of dirs) {
      const dirPath = path.join(primaryPath, dir);
      await fs.mkdir(dirPath, { recursive: true });
    }

    // Create index.md if it doesn't exist
    const indexPath = path.join(primaryPath, 'index.md');
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, `# Obsidian Vault Index

This vault contains context from Claude Code conversations.

## Structure
- **sessions/**: Individual conversation sessions
- **topics/**: Technical topics and concepts
- **decisions/**: Architectural decision records

## Recent Sessions
Check the sessions/ directory for recent conversations.
`);
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  private async searchVault(args: {
    query: string;
    directories?: string[];
    max_results?: number;
    date_range?: { start?: string; end?: string };
    snippets_only?: boolean;
  }) {
    await this.ensureVaultStructure();
    await this.loadEmbeddingCache(); // Load embedding cache at start of search

    const searchDirs = args.directories || ['sessions', 'topics', 'decisions'];
    const maxResults = args.max_results || 10;
    const snippetsOnly = args.snippets_only !== false; // Default true
    const results: {
      file: string;
      matches: string[];
      date?: string;
      score: number;
      semanticScore?: number;
      vault?: string;
    }[] = [];
    const queryLower = args.query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    // Generate query embedding if enabled
    let queryEmbedding: number[] | null = null;
    if (this.embeddingConfig.enabled) {
      try {
        queryEmbedding = await this.generateEmbedding(args.query);
      } catch (error) {
        console.error('[Search] Failed to generate query embedding, falling back to keyword search:', error);
      }
    }

    // Recursive function to search directories
    const searchDirectory = async (dirPath: string, relativePath: string = '', vaultName: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

          if (entry.isDirectory()) {
            // Skip common ignored directories
            if (['.git', 'node_modules', '.DS_Store', '.obsidian'].includes(entry.name)) {
              continue;
            }
            // Handle month subdirectories for sessions (YYYY-MM format)
            if (/^\d{4}-\d{2}$/.test(entry.name)) {
              const monthFiles = await fs.readdir(fullPath);
              for (const file of monthFiles) {
                if (!file.endsWith('.md')) continue;
                const filePath = path.join(fullPath, file);
                const fileStats = await fs.stat(filePath);
                const content = await fs.readFile(filePath, 'utf-8');

                const searchResult = await this.scoreSearchResult(
                  'sessions',
                  path.join(relativeFilePath, file),
                  file,
                  content,
                  fileStats,
                  queryLower,
                  queryTerms,
                  queryEmbedding,
                  args.date_range,
                  filePath // Pass absolute path for embedding cache key
                );
                if (searchResult) {
                  results.push({ ...searchResult, vault: vaultName });
                }
              }
            } else {
              // Recursively search subdirectories
              await searchDirectory(fullPath, relativeFilePath, vaultName);
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            // Process markdown file
            const fileStats = await fs.stat(fullPath);
            const content = await fs.readFile(fullPath, 'utf-8');

            // Determine category based on path
            let category = 'document';
            if (relativeFilePath.includes('sessions')) category = 'sessions';
            else if (relativeFilePath.includes('topics')) category = 'topics';
            else if (relativeFilePath.includes('decisions')) category = 'decisions';

            const searchResult = await this.scoreSearchResult(
              category,
              relativeFilePath,
              entry.name,
              content,
              fileStats,
              queryLower,
              queryTerms,
              queryEmbedding,
              args.date_range,
              fullPath // Pass absolute path for embedding cache key
            );
            if (searchResult) {
              results.push({ ...searchResult, vault: vaultName });
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist or can't be accessed
      }
    };

    // Search across all configured vaults
    const vaults = this.getAllVaults();

    for (const vault of vaults) {
      // For primary vault, search only in standard directories
      const isPrimaryVault = vault.path === this.config.primaryVault.path;

      if (isPrimaryVault) {
        for (const dir of searchDirs) {
          const dirPath = path.join(vault.path, dir);
          await searchDirectory(dirPath, dir, vault.name);
        }
      } else {
        // For secondary vaults, search everything recursively
        await searchDirectory(vault.path, '', vault.name);
      }
    }

    // Save embedding cache after search
    await this.saveEmbeddingCache();

    // Sort by relevance score (descending) and limit results
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, maxResults);

    if (topResults.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No results found for "${args.query}".`,
          },
        ],
      };
    }

    // Generate response based on snippets_only flag
    let resultText: string;

    if (snippetsOnly) {
      // Return condensed results with option to read full files
      resultText = `Found ${results.length} matches. Top ${topResults.length} results:\n\n`;

      topResults.forEach((r, idx) => {
        const semanticIndicator = r.semanticScore !== undefined ? ` [semantic: ${(r.semanticScore * 100).toFixed(0)}%]` : '';
        const vaultIndicator = r.vault && r.vault !== this.config.primaryVault.name ? ` [${r.vault}]` : '';
        resultText += `${idx + 1}. **${r.file}** ${r.date ? `(${r.date})` : ''}${semanticIndicator}${vaultIndicator}\n`;
        if (r.matches.length > 0) {
          resultText += r.matches
            .map(m => `   ${m.trim().substring(0, 100)}${m.length > 100 ? '...' : ''}`)
            .join('\n') + '\n';
        }
        resultText += '\n';
      });

      if (results.length > maxResults) {
        resultText += `\n_Showing top ${maxResults} of ${results.length} results. Refine your query or increase max_results for more._`;
      }

      resultText += `\n\n💡 Use get_session_context with a specific session_id to read full files.`;
      if (this.embeddingConfig.enabled && queryEmbedding) {
        resultText += `\n✨ Results include semantic search (${(this.embeddingConfig.semanticWeight * 100).toFixed(0)}% weight)`;
      }
      if (this.config.secondaryVaults.length > 0) {
        resultText += `\n📚 Searched ${1 + this.config.secondaryVaults.length} vault(s)`;
      }
    } else {
      // Return full matching content (old behavior, for backwards compatibility)
      resultText = topResults
        .map(r => `**${r.file}** ${r.date ? `(${r.date})` : ''}:\n${r.matches.map(m => `  - ${m.trim()}`).join('\n')}`)
        .join('\n\n');
    }

    return {
      content: [
        {
          type: 'text',
          text: `Search results for "${args.query}":\n\n${resultText}`,
        },
      ],
    };
  }

  private async scoreSearchResult(
    dir: string,
    relPath: string,
    fileName: string,
    content: string,
    fileStats: any,
    queryLower: string,
    queryTerms: string[],
    queryEmbedding: number[] | null,
    dateRange?: { start?: string; end?: string },
    absolutePath?: string // Absolute file path for embedding cache key
  ) {
    const contentLower = content.toLowerCase();

    // Extract date from filename or frontmatter
    const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
    const fileDate = dateMatch ? dateMatch[1] : undefined;

    // Date filtering
    if (dateRange) {
      if (dateRange.start && fileDate && fileDate < dateRange.start) return null;
      if (dateRange.end && fileDate && fileDate > dateRange.end) return null;
    }

    // Calculate keyword score
    let keywordScore = 0;
    let hasMatch = false;

    // Parse document structure
    const lines = content.split('\n');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
    const frontmatterEnd = frontmatterMatch ? frontmatterMatch[0].split('\n').length : 0;

    // Find first paragraph
    let firstParagraphStart = frontmatterEnd;
    let firstParagraphEnd = frontmatterEnd;
    for (let i = frontmatterEnd; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#')) {
        firstParagraphStart = i;
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          if (!lines[j].trim() || lines[j].trim().startsWith('#')) {
            firstParagraphEnd = j;
            break;
          }
          firstParagraphEnd = j;
        }
        break;
      }
    }
    const firstParagraph = lines.slice(firstParagraphStart, firstParagraphEnd + 1).join('\n').toLowerCase();

    // Exact phrase match
    if (queryTerms.length > 1 && contentLower.includes(queryLower)) {
      keywordScore += 15;
      hasMatch = true;
    }

    // Term matching
    for (const term of queryTerms) {
      const termRegex = new RegExp(term, 'g');
      const matches = contentLower.match(termRegex) || [];
      const termCount = matches.length;

      // Check if term matches filename first
      const matchesFilename = fileName.toLowerCase().includes(term);

      if (termCount > 0) {
        hasMatch = true;

        // Frequency scoring
        const frequencyScore = Math.log(termCount + 1) * 3;
        keywordScore += frequencyScore;

        // Position-based scoring
        for (const line of lines) {
          if (line.trim().startsWith('#') && line.toLowerCase().includes(term)) {
            keywordScore += 10;
            break;
          }
        }

        // Tag matching
        if (frontmatter.toLowerCase().includes(`tags:`) && frontmatter.toLowerCase().includes(term)) {
          keywordScore += 7;
        }

        // First paragraph matching
        if (firstParagraph.includes(term)) {
          keywordScore += 3;
        }

        // Recency
        if (fileDate) {
          const age = this.getFileAgeDays(fileDate);
          if (age < 7) keywordScore += 3;
          else if (age < 30) keywordScore += 2;
          else if (age < 90) keywordScore += 1;
        }
      }

      // Filename matching - contributes to hasMatch even if content doesn't match
      if (matchesFilename) {
        hasMatch = true;
        keywordScore += 5;
      }
    }

    // Topic review scoring
    if (dir === 'topics' && hasMatch) {
      if (frontmatterMatch) {
        const lastReviewedMatch = frontmatter.match(/last_reviewed:\s*(.+)/);
        const createdMatch = frontmatter.match(/created:\s*(.+)/);

        if (lastReviewedMatch) {
          const lastReviewed = lastReviewedMatch[1].trim();
          const reviewAge = this.getFileAgeDays(lastReviewed);
          if (reviewAge < 365) {
            keywordScore += 2;
          }
        } else if (createdMatch) {
          const created = createdMatch[1].trim();
          const creationAge = this.getFileAgeDays(created);
          if (creationAge > 365) {
            keywordScore -= 2;
          }
        }
      }
    }

    // Calculate semantic score if embeddings enabled
    let semanticScore = 0;
    if (queryEmbedding && hasMatch) {
      try {
        // Use absolute path if available for proper cache key, otherwise use relative path
        const cacheKey = absolutePath || relPath;
        const docEmbedding = await this.getOrCreateEmbedding(cacheKey, content, fileStats);
        semanticScore = this.cosineSimilarity(queryEmbedding, docEmbedding);
      } catch (error) {
        console.error(`[Search] Failed to get embedding for ${relPath}:`, error);
      }
    }

    // Combine keyword and semantic scores
    let finalScore: number;
    if (queryEmbedding && semanticScore > 0) {
      const keywordWeight = 1 - this.embeddingConfig.semanticWeight;
      // Normalize keyword score to 0-1 range (rough approximation)
      const normalizedKeywordScore = Math.min(keywordScore / 30, 1);
      finalScore = (normalizedKeywordScore * keywordWeight) + (semanticScore * this.embeddingConfig.semanticWeight);
    } else {
      finalScore = keywordScore;
    }

    if (hasMatch || (queryEmbedding && semanticScore > 0.3)) {
      const matchingLines = lines
        .filter(line => {
          const lineLower = line.toLowerCase();
          return queryTerms.some(term => lineLower.includes(term));
        })
        .slice(0, 3);

      return {
        file: absolutePath || path.join(dir, relPath), // Use absolute path when available
        matches: matchingLines,
        date: fileDate,
        score: finalScore,
        semanticScore: queryEmbedding ? semanticScore : undefined,
      };
    }

    return null;
  }

  private async createTopicPage(args: { topic: string; content: string }) {
    // Validate that this is appropriate for a topic (not session-specific content)
    const investigationKeywords = [
      'investigation', 'investigating', 'bug fix', 'fixing', 'debugg',
      'found issue', 'found problem', 'discovered', 'troubleshooting session',
      'worked on', 'fixed issue', 'resolved bug'
    ];

    const titleLower = args.topic.toLowerCase();
    const matchedKeyword = investigationKeywords.find(keyword => titleLower.includes(keyword));

    if (matchedKeyword) {
      throw new Error(
        `❌ Topic title contains "${matchedKeyword}" - this appears to be investigation/debugging details, not a topic.\n\n` +
        `Topics should be persistent, reusable knowledge:\n` +
        `  ✅ How-to guides\n` +
        `  ✅ Architecture explanations\n` +
        `  ✅ Troubleshooting procedures (generic)\n` +
        `  ✅ Implementation patterns\n\n` +
        `Investigation details belong in session notes instead.\n\n` +
        `If this is genuinely reusable knowledge, rephrase the title to focus on the solution/pattern, not the investigation.\n` +
        `Example: Instead of "Fixing search bug", use "Search Algorithm Implementation" or "Common Search Issues"`
      );
    }

    await this.ensureVaultStructure();

    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);
    const today = new Date().toISOString().split('T')[0];

    const content = `---
title: ${args.topic}
created: ${today}
last_reviewed: ${today}
review_count: 0
tags: [topic]
review_history:
  - date: ${today}
    action: created
    notes: "Topic created"
---

# ${args.topic}

${args.content}

## Related Sessions

## Related Projects

## Related Decisions

`;

    await fs.writeFile(topicFile, content);

    // Track topic creation for lazy session creation
    this.topicsCreated.push({ slug, title: args.topic, file: topicFile });

    return {
      content: [
        {
          type: 'text',
          text: `Topic page created: ${topicFile}\nObsidian link: [[topics/${slug}|${args.topic}]]`,
        },
      ],
    };
  }

  private async createDecision(args: { title: string; content: string; context?: string; force?: boolean }) {
    await this.ensureVaultStructure();

    const titleLower = args.title.toLowerCase();
    const contentLower = args.content.toLowerCase();

    // Validation 1: Check if title suggests this should be a topic instead
    const topicKeywords = ['fix', 'bug', 'issue', 'implement', 'how', 'guide', 'setup', 'error', 'crash', 'problem'];
    const matchedTopicKeywords = topicKeywords.filter(kw => titleLower.includes(kw));

    if (matchedTopicKeywords.length > 0 && !args.force) {
      return {
        content: [
          {
            type: 'text',
            text: `⚠️  This title suggests it might be better suited as a topic page, not a decision.

Title contains keywords typical of topics: ${matchedTopicKeywords.join(', ')}

DECISIONS are for strategic choices with alternatives considered (e.g., "Flat vs Hierarchical Organization").
TOPICS are for implementation details, bug fixes, and how-to guides (e.g., "Fix search algorithm bug").

If you still want to create this as a decision, provide context that explains the strategic choice and alternatives.
Otherwise, use create_topic_page instead.

To proceed anyway, call create_decision again with force: true.`,
          },
        ],
      };
    }

    // Validation 2: Check if decision indicates alternatives were considered
    const decisionIndicators = ['vs', 'versus', 'between', 'alternative', 'option', 'approach', 'choice'];
    const hasDecisionIndicator = decisionIndicators.some(indicator =>
      titleLower.includes(indicator) || contentLower.includes(indicator)
    );

    if (!hasDecisionIndicator && !args.force) {
      return {
        content: [
          {
            type: 'text',
            text: `⚠️  This doesn't appear to be a strategic decision with alternatives.

Decisions should document:
  ✅ Multiple alternatives that were considered
  ✅ Why one was chosen over others
  ✅ Trade-offs and consequences

Your title/content doesn't mention alternatives (no "vs", "between", "alternative", "option", etc.)

Examples of proper decisions:
  ✅ "Use Obsidian vs Notion for Context Management"
  ✅ "Flat vs Hierarchical Topic Organization"
  ✅ "CSS-in-JS vs CSS Custom Properties for Theming"

If this documents a single solution/implementation without comparing alternatives, use create_topic_page instead.

To proceed anyway, call create_decision again with force: true.`,
          },
        ],
      };
    }

    const decisionsDir = path.join(VAULT_PATH, 'decisions');
    const files = await fs.readdir(decisionsDir);
    const decisionNumbers = files
      .filter(f => f.match(/^\d{3}-/))
      .map(f => parseInt(f.split('-')[0]))
      .filter(n => !isNaN(n));
    
    const nextNumber = decisionNumbers.length > 0 ? Math.max(...decisionNumbers) + 1 : 1;
    const numberStr = String(nextNumber).padStart(3, '0');
    const slug = this.slugify(args.title);
    const decisionFile = path.join(decisionsDir, `${numberStr}-${slug}.md`);

    const content = `---
number: ${numberStr}
title: ${args.title}
date: ${new Date().toISOString().split('T')[0]}
status: accepted
---

# Decision ${numberStr}: ${args.title}

## Context
${args.context || 'Decision made during development.'}

## Decision
${args.content}

## Consequences

## Related
${this.currentSessionId ? `- Session: [[${this.currentSessionId}]]` : ''}

`;

    await fs.writeFile(decisionFile, content);

    // Track decision creation for lazy session creation
    this.decisionsCreated.push({
      slug: `${numberStr}-${slug}`,
      title: args.title,
      file: decisionFile
    });

    return {
      content: [
        {
          type: 'text',
          text: `Decision record created: ${decisionFile}\nDecision number: ${numberStr}`,
        },
      ],
    };
  }

  private async updateTopicPage(args: { topic: string; content: string; append?: boolean }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      // Topic doesn't exist, create it
      return await this.createTopicPage({ topic: args.topic, content: args.content });
    }

    const append = args.append !== false;

    if (append) {
      const existing = await fs.readFile(topicFile, 'utf-8');

      // Extract frontmatter and body from existing content
      const frontmatterMatch = existing.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
      const existingBody = frontmatterMatch ? frontmatterMatch[2] : existing;

      // Strip frontmatter from new content if present
      const newBodyMatch = args.content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/) || args.content.match(/^([\s\S]*)$/);
      const newBody = newBodyMatch ? newBodyMatch[1] : args.content;

      // Reconstruct file with preserved frontmatter + appended body
      const newContent = `---\n${frontmatter}\n---\n${existingBody}\n${newBody}`;
      await fs.writeFile(topicFile, newContent);
    } else {
      await fs.writeFile(topicFile, args.content);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Topic page updated: ${topicFile}`,
        },
      ],
    };
  }

  private async getSessionContext(args: { session_id?: string }) {
    const sessionId = args.session_id || this.currentSessionId;

    if (!sessionId) {
      throw new Error('No session ID provided and no active session.');
    }

    let sessionFile: string;

    if (this.currentSessionFile && !args.session_id) {
      // Use current session file if available
      sessionFile = this.currentSessionFile;
    } else if (args.session_id) {
      // Try to find the session file in monthly directories or root
      // First, extract the date from session_id (format: YYYY-MM-DD_HH-mm-ss...)
      const dateMatch = args.session_id.match(/^(\d{4}-\d{2}-\d{2})/);

      if (dateMatch) {
        const dateStr = dateMatch[1];
        const monthStr = dateStr.substring(0, 7); // YYYY-MM
        const monthDir = path.join(VAULT_PATH, 'sessions', monthStr);
        const monthFile = path.join(monthDir, `${sessionId}.md`);

        try {
          await fs.access(monthFile);
          sessionFile = monthFile;
        } catch {
          // Fall back to root if not in month directory
          sessionFile = path.join(VAULT_PATH, 'sessions', `${sessionId}.md`);
        }
      } else {
        // No date in session_id, try root directory
        sessionFile = path.join(VAULT_PATH, 'sessions', `${sessionId}.md`);
      }
    } else {
      throw new Error('Cannot determine session file path.');
    }

    const content = await fs.readFile(sessionFile, 'utf-8');

    return {
      content: [
        {
          type: 'text',
          text: `Session context for ${sessionId}:\n\n${content}`,
        },
      ],
    };
  }

  private async getTopicContext(args: { topic: string }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      throw new Error(`Topic not found: ${args.topic}. Use search_vault to find available topics, or create_topic_page to create a new one.`);
    }

    const content = await fs.readFile(topicFile, 'utf-8');

    // Parse frontmatter to extract title
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let title = args.topic;

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const titleMatch = frontmatter.match(/title:\s*(.+)/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Topic context for "${title}" (topics/${slug}.md):\n\n${content}`,
        },
      ],
    };
  }

  private async linkToTopic(args: { topic: string }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      // Create minimal topic page if it doesn't exist
      await this.createTopicPage({
        topic: args.topic,
        content: 'Topic created automatically via link.',
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: `[[topics/${slug}|${args.topic}]]`,
        },
      ],
    };
  }

  private async closeSession(args: { summary: string; topic?: string; _invoked_by_slash_command?: boolean }) {
    // Enforce that this tool can only be called via the /close slash command
    if (args._invoked_by_slash_command !== true) {
      throw new Error('❌ The close_session tool can ONLY be called via the /close slash command. Please ask the user to run the /close command to close this session.');
    }

    await this.ensureVaultStructure();

    // Generate session ID from current timestamp and optional topic
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const topicSlug = args.topic ? `_${this.slugify(args.topic)}` : '';
    const sessionId = `${dateStr}_${timeStr}${topicSlug}`;

    // Organize sessions by month
    const monthStr = dateStr.substring(0, 7); // YYYY-MM
    const monthDir = path.join(VAULT_PATH, 'sessions', monthStr);
    await fs.mkdir(monthDir, { recursive: true });
    const sessionFile = path.join(monthDir, `${sessionId}.md`);

    // Auto-detect Git repositories BEFORE building session content
    // This allows the project to be included in the session's Projects section
    let detectedRepoInfo: { path: string; name: string; branch?: string; remote?: string } | null = null;
    if (this.filesAccessed.length > 0) {
      try {
        const cwd = process.env.PWD || process.cwd();
        const repoPaths = await this.findGitRepos(cwd);

        if (repoPaths.length > 0) {
          const candidates: RepoCandidate[] = [];

          for (const repoPath of repoPaths) {
            let score = 0;
            const reasons: string[] = [];

            const filesInRepo = this.filesAccessed.filter(f => f.path.startsWith(repoPath));
            const editedFiles = filesInRepo.filter(f => f.action === 'edit' || f.action === 'create');
            const readFiles = filesInRepo.filter(f => f.action === 'read');

            if (editedFiles.length > 0) {
              score += editedFiles.length * 10;
              reasons.push(`${editedFiles.length} file(s) modified`);
            }

            if (readFiles.length > 0) {
              score += readFiles.length * 5;
              reasons.push(`${readFiles.length} file(s) read`);
            }

            if (sessionId) {
              const repoName = path.basename(repoPath);
              if (sessionId.toLowerCase().includes(repoName.toLowerCase())) {
                score += 20;
                reasons.push('Session topic matches repo name');
              }
            }

            if (repoPath === cwd) {
              score += 15;
              reasons.push('Repo is current working directory');
            } else if (cwd.startsWith(repoPath)) {
              score += 8;
              reasons.push('CWD is within this repo');
            } else if (repoPath.startsWith(cwd)) {
              score += 5;
              reasons.push('Repo is subdirectory of CWD');
            }

            if (score > 0 || repoPaths.length === 1) {
              const info = await this.getRepoInfo(repoPath);
              candidates.push({
                path: repoPath,
                name: info.name,
                score,
                reasons,
                branch: info.branch,
                remote: info.remote,
              });
            }
          }

          candidates.sort((a, b) => b.score - a.score);

          if (candidates.length > 0) {
            const topCandidate = candidates[0];

            // High confidence - automatically create project page
            if (candidates.length === 1 || topCandidate.score > (candidates[1]?.score || 0) * 2) {
              try {
                detectedRepoInfo = topCandidate;
                await this.createProjectPage({ repo_path: topCandidate.path });
              } catch (error) {
                // If project creation fails, continue anyway
              }
            }
          }
        }
      } catch (error) {
        // Silently fail - repo detection is optional
      }
    }

    // Build topics list from created content
    const topicsList = this.topicsCreated.map(t => t.title);
    const decisionsList = this.decisionsCreated.map(d => d.title);

    // Build session content
    let sessionContent = `---
date: ${dateStr}
session_id: ${sessionId}
topics: ${JSON.stringify(args.topic ? [args.topic, ...topicsList] : topicsList)}
decisions: ${JSON.stringify(decisionsList)}
status: completed
---

# Session: ${args.topic || 'Work session'}

## Summary

${args.summary}

## Files Accessed

${this.filesAccessed.length > 0 ? this.filesAccessed.map(f => `- [\`${f.action}\`] ${f.path}`).join('\n') : '_No files tracked_'}

## Topics Created

${this.topicsCreated.length > 0 ? this.topicsCreated.map(t => `- [[topics/${t.slug}|${t.title}]]`).join('\n') : '_No topics created_'}

## Decisions Made

${this.decisionsCreated.length > 0 ? this.decisionsCreated.map(d => `- [[decisions/${d.slug}|${d.title}]]`).join('\n') : '_No decisions made_'}

## Projects

${this.projectsCreated.length > 0 ? this.projectsCreated.map(p => `- [[projects/${p.slug}/project|${p.name}]]`).join('\n') : '_No projects created_'}
`;

    // Write session file
    await fs.writeFile(sessionFile, sessionContent);

    // Set current session for back-linking
    this.currentSessionId = sessionId;
    this.currentSessionFile = sessionFile;

    // Back-link topics to this session
    for (const topic of this.topicsCreated) {
      try {
        const content = await fs.readFile(topic.file, 'utf-8');
        const sessionLink = `- [[${sessionId}]]`;
        if (!content.includes(sessionLink)) {
          const updatedContent = content.replace(
            /## Related Sessions\n/,
            `## Related Sessions\n${sessionLink}\n`
          );
          await fs.writeFile(topic.file, updatedContent);
        }
      } catch (error) {
        // Continue on error
      }
    }

    // Back-link topics to projects (if any projects were created/accessed in this session)
    if (this.topicsCreated.length > 0 && this.projectsCreated.length > 0) {
      for (const topic of this.topicsCreated) {
        try {
          let content = await fs.readFile(topic.file, 'utf-8');
          for (const project of this.projectsCreated) {
            const projectLink = `- [[projects/${project.slug}/project|${project.name}]]`;
            if (!content.includes(projectLink)) {
              content = content.replace(
                /## Related Projects\n/,
                `## Related Projects\n${projectLink}\n`
              );
            }
          }
          await fs.writeFile(topic.file, content);
        } catch (error) {
          // Continue on error
        }
      }
    }

    // Back-link decisions to this session
    for (const decision of this.decisionsCreated) {
      try {
        const content = await fs.readFile(decision.file, 'utf-8');
        const sessionLink = `- Session: [[${sessionId}]]`;
        const updatedContent = content.replace(
          /## Related\n.*\n/,
          `## Related\n${sessionLink}\n`
        );
        await fs.writeFile(decision.file, updatedContent);
      } catch (error) {
        // Continue on error
      }
    }

    // Back-link projects to this session
    for (const project of this.projectsCreated) {
      try {
        const content = await fs.readFile(project.file, 'utf-8');
        const sessionLink = `- [[${sessionId}]]`;
        if (!content.includes(sessionLink)) {
          const updatedContent = content.replace(
            /## Related Sessions\n/,
            `## Related Sessions\n${sessionLink}\n`
          );
          await fs.writeFile(project.file, updatedContent);
        }
      } catch (error) {
        // Continue on error
      }
    }

    // Back-link projects to topics (if any topics were created in this session)
    if (this.projectsCreated.length > 0 && this.topicsCreated.length > 0) {
      for (const project of this.projectsCreated) {
        try {
          let content = await fs.readFile(project.file, 'utf-8');
          for (const topic of this.topicsCreated) {
            const topicLink = `- [[topics/${topic.slug}|${topic.title}]]`;
            if (!content.includes(topicLink)) {
              content = content.replace(
                /## Topics\n/,
                `## Topics\n${topicLink}\n`
              );
            }
          }
          await fs.writeFile(project.file, content);
        } catch (error) {
          // Continue on error
        }
      }
    }

    // Build repository detection message
    let repoDetectionMessage = '';
    if (detectedRepoInfo) {
      repoDetectionMessage = `\n\n📦 Git Repository Auto-Linked:\n`;
      repoDetectionMessage += `   ${detectedRepoInfo.name}\n`;
      repoDetectionMessage += `   Path: ${detectedRepoInfo.path}\n`;
      if (detectedRepoInfo.branch) repoDetectionMessage += `   Branch: ${detectedRepoInfo.branch}\n`;
      repoDetectionMessage += `   ✅ Project page created/updated\n`;
      if (this.topicsCreated.length > 0) {
        repoDetectionMessage += `   ✅ ${this.topicsCreated.length} topic(s) linked to project\n`;
      }
      repoDetectionMessage += `\n💡 Next step: Create and record your git commit`;
    }

    // Build summary message
    let summary = `✅ Session created: ${sessionId}\n`;
    summary += `📄 Session file: ${sessionFile}\n\n`;

    if (this.topicsCreated.length > 0) {
      summary += `📚 Topics linked (${this.topicsCreated.length}):\n`;
      summary += this.topicsCreated.map(t => `   - ${t.title}`).join('\n') + '\n\n';
    }

    if (this.decisionsCreated.length > 0) {
      summary += `🎯 Decisions linked (${this.decisionsCreated.length}):\n`;
      summary += this.decisionsCreated.map(d => `   - ${d.title}`).join('\n') + '\n\n';
    }

    if (this.projectsCreated.length > 0) {
      summary += `📦 Projects linked (${this.projectsCreated.length}):\n`;
      summary += this.projectsCreated.map(p => `   - ${p.name}`).join('\n') + '\n\n';
    }

    if (this.filesAccessed.length > 0) {
      summary += `📁 Files accessed: ${this.filesAccessed.length}\n`;
    }

    // Clear state for next conversation
    this.topicsCreated = [];
    this.decisionsCreated = [];
    this.projectsCreated = [];
    this.filesAccessed = [];
    // Keep currentSessionId and currentSessionFile set for potential follow-up operations

    return {
      content: [
        {
          type: 'text',
          text: summary + repoDetectionMessage,
        },
      ],
    };
  }

  private getFileAgeDays(dateString: string): number {
    const fileDate = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - fileDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private async findStaleTopics(args: { age_threshold_days?: number; include_never_reviewed?: boolean }) {
    await this.ensureVaultStructure();

    const thresholdDays = args.age_threshold_days || 365;
    const includeNeverReviewed = args.include_never_reviewed !== false;
    const topicsDir = path.join(VAULT_PATH, 'topics');
    const staleTopics: Array<{
      title: string;
      slug: string;
      created_date: string;
      last_reviewed?: string;
      age_days: number;
      review_count: number;
      file_path: string;
    }> = [];

    try {
      const files = await fs.readdir(topicsDir);

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(topicsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) continue;

        const frontmatter = frontmatterMatch[1];
        const createdMatch = frontmatter.match(/created:\s*(.+)/);
        const lastReviewedMatch = frontmatter.match(/last_reviewed:\s*(.+)/);
        const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
        const titleMatch = frontmatter.match(/title:\s*(.+)/);

        if (!createdMatch) continue;

        const created = createdMatch[1].trim();
        const lastReviewed = lastReviewedMatch ? lastReviewedMatch[1].trim() : undefined;
        const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;
        const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');

        // Determine if stale
        const referenceDate = lastReviewed || created;
        const ageDays = this.getFileAgeDays(referenceDate);

        const isStale = ageDays > thresholdDays;
        const neverReviewed = !lastReviewed || lastReviewed === created;

        if (isStale && (includeNeverReviewed || !neverReviewed)) {
          staleTopics.push({
            title,
            slug: file.replace('.md', ''),
            created_date: created,
            last_reviewed: lastReviewed !== created ? lastReviewed : undefined,
            age_days: ageDays,
            review_count: reviewCount,
            file_path: `topics/${file}`,
          });
        }
      }
    } catch (error) {
      throw new Error(`Failed to scan topics: ${error}`);
    }

    // Sort by age (oldest first)
    staleTopics.sort((a, b) => b.age_days - a.age_days);

    if (staleTopics.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No stale topics found. All topics have been reviewed within the last ${thresholdDays} days.`,
          },
        ],
      };
    }

    let resultText = `Found ${staleTopics.length} stale topic(s) older than ${thresholdDays} days:\n\n`;

    staleTopics.forEach((topic, idx) => {
      resultText += `${idx + 1}. **${topic.title}** (${topic.slug})\n`;
      resultText += `   - Created: ${topic.created_date}\n`;
      resultText += `   - Last reviewed: ${topic.last_reviewed || 'Never'}\n`;
      resultText += `   - Age: ${topic.age_days} days\n`;
      resultText += `   - Reviews: ${topic.review_count}\n\n`;
    });

    resultText += `\nUse review_topic to analyze any of these topics.`;

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
    };
  }

  private async reviewTopic(args: { topic: string; analysis_prompt?: string }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      throw new Error(`Topic not found: ${args.topic}`);
    }

    const content = await fs.readFile(topicFile, 'utf-8');

    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new Error('Invalid topic file format (missing frontmatter)');
    }

    const frontmatter = frontmatterMatch[1];
    const titleMatch = frontmatter.match(/title:\s*(.+)/);
    const title = titleMatch ? titleMatch[1].trim() : args.topic;

    // Extract main content (without frontmatter)
    const mainContent = content.substring(frontmatterMatch[0].length).trim();

    // Generate review analysis
    const defaultPrompt = `Analyze this topic for outdated or inaccurate information. Consider:
1. Are there any deprecated technologies or approaches mentioned?
2. Is the information still current and accurate?
3. Are there any missing important updates or developments?
4. What specific changes would improve accuracy?

Provide a structured analysis with:
- is_outdated: true/false
- concerns: list of specific issues
- suggested_updates: concrete suggestions for improvements
- confidence: high/medium/low`;

    const analysisPrompt = args.analysis_prompt || defaultPrompt;

    // For now, we'll create a placeholder analysis since we don't have AI integration
    // In a real implementation, this would call an LLM API
    const analysis: ReviewAnalysis = {
      is_outdated: false,
      concerns: [
        'Manual review required - AI analysis not yet implemented',
        'Please review the content below and provide your assessment',
      ],
      suggested_updates: 'Please review the topic content and suggest specific updates if needed.',
      confidence: 'low',
    };

    // Generate review ID and store pending review
    const reviewId = `review_${Date.now()}_${slug}`;
    const pendingReview: PendingReview = {
      review_id: reviewId,
      topic: title,
      slug,
      current_content: content,
      analysis,
      timestamp: Date.now(),
    };

    this.pendingReviews.set(reviewId, pendingReview);

    let resultText = `# Review Analysis: ${title}\n\n`;
    resultText += `**Review ID:** ${reviewId}\n`;
    resultText += `**Topic File:** topics/${slug}.md\n\n`;
    resultText += `## Current Content\n\n${mainContent}\n\n`;
    resultText += `## AI Analysis\n\n`;
    resultText += `**Status:** ${analysis.is_outdated ? '⚠️ Potentially Outdated' : '✅ Appears Current'}\n`;
    resultText += `**Confidence:** ${analysis.confidence}\n\n`;
    resultText += `**Concerns:**\n`;
    analysis.concerns.forEach(c => resultText += `- ${c}\n`);
    resultText += `\n**Suggested Updates:**\n${analysis.suggested_updates}\n\n`;
    resultText += `---\n\n`;
    resultText += `**Next Steps:**\n`;
    resultText += `Use approve_topic_update with one of these actions:\n`;
    resultText += `- \`update\`: Apply suggested changes (you can provide modified_content)\n`;
    resultText += `- \`keep\`: Mark as reviewed without changes\n`;
    resultText += `- \`archive\`: Move to archive\n`;
    resultText += `- \`dismiss\`: Cancel this review\n`;

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
    };
  }

  private async approveTopicUpdate(args: { review_id: string; action: string; modified_content?: string }) {
    const pendingReview = this.pendingReviews.get(args.review_id);

    if (!pendingReview) {
      throw new Error(`Review not found: ${args.review_id}. It may have expired or already been processed.`);
    }

    const { slug, topic, current_content } = pendingReview;
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);
    const today = new Date().toISOString().split('T')[0];

    try {
      switch (args.action) {
        case 'update': {
          // Update content
          const contentToWrite = args.modified_content || pendingReview.analysis.suggested_updates;

          // Parse existing frontmatter
          const frontmatterMatch = current_content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) throw new Error('Invalid frontmatter');

          const frontmatter = frontmatterMatch[1];
          const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
          const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;

          // Update frontmatter with new review info
          let updatedFrontmatter = frontmatter
            .replace(/last_reviewed:.*/, `last_reviewed: ${today}`)
            .replace(/review_count:.*/, `review_count: ${reviewCount + 1}`);

          // Add to review history
          const reviewHistoryEntry = `  - date: ${today}\n    action: updated\n    notes: "Content updated via review process"`;
          if (updatedFrontmatter.includes('review_history:')) {
            updatedFrontmatter = updatedFrontmatter.replace(
              /review_history:/,
              `review_history:\n${reviewHistoryEntry}`
            );
          } else {
            updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
          }

          const mainContent = current_content.substring(frontmatterMatch[0].length).trim();
          const newContent = `---\n${updatedFrontmatter}\n---\n\n${args.modified_content || mainContent}`;

          await fs.writeFile(topicFile, newContent);

          this.pendingReviews.delete(args.review_id);

          return {
            content: [
              {
                type: 'text',
                text: `Topic updated: ${topic}\nFile: topics/${slug}.md\nReview count: ${reviewCount + 1}`,
              },
            ],
          };
        }

        case 'keep': {
          // Mark as reviewed without content changes
          const frontmatterMatch = current_content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) throw new Error('Invalid frontmatter');

          const frontmatter = frontmatterMatch[1];
          const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
          const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;

          let updatedFrontmatter = frontmatter
            .replace(/last_reviewed:.*/, `last_reviewed: ${today}`)
            .replace(/review_count:.*/, `review_count: ${reviewCount + 1}`);

          const reviewHistoryEntry = `  - date: ${today}\n    action: reviewed\n    notes: "Reviewed - no changes needed"`;
          if (updatedFrontmatter.includes('review_history:')) {
            updatedFrontmatter = updatedFrontmatter.replace(
              /review_history:/,
              `review_history:\n${reviewHistoryEntry}`
            );
          } else {
            updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
          }

          const mainContent = current_content.substring(frontmatterMatch[0].length).trim();
          const newContent = `---\n${updatedFrontmatter}\n---\n\n${mainContent}`;

          await fs.writeFile(topicFile, newContent);

          this.pendingReviews.delete(args.review_id);

          return {
            content: [
              {
                type: 'text',
                text: `Topic marked as reviewed: ${topic}\nNo content changes made.\nReview count: ${reviewCount + 1}`,
              },
            ],
          };
        }

        case 'archive': {
          return await this.archiveTopic({ topic: slug, reason: 'Archived via review process' });
        }

        case 'dismiss': {
          this.pendingReviews.delete(args.review_id);

          return {
            content: [
              {
                type: 'text',
                text: `Review dismissed for: ${topic}`,
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown action: ${args.action}. Use: update, keep, archive, or dismiss`);
      }
    } catch (error) {
      throw new Error(`Failed to process review: ${error}`);
    }
  }

  private async archiveTopic(args: { topic: string; reason?: string }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);
    const archiveFile = path.join(VAULT_PATH, 'archive', 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      throw new Error(`Topic not found: ${args.topic}`);
    }

    await this.ensureVaultStructure();

    // Read current content
    const content = await fs.readFile(topicFile, 'utf-8');
    const today = new Date().toISOString().split('T')[0];

    // Update frontmatter to mark as archived
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) throw new Error('Invalid frontmatter');

    const frontmatter = frontmatterMatch[1];
    let updatedFrontmatter = frontmatter;

    // Add archived date and reason
    updatedFrontmatter += `\narchived: ${today}`;
    if (args.reason) {
      updatedFrontmatter += `\narchive_reason: ${args.reason}`;
    }

    // Add to review history
    const reviewHistoryEntry = `  - date: ${today}\n    action: archived\n    notes: "${args.reason || 'Topic archived'}"`;
    if (updatedFrontmatter.includes('review_history:')) {
      updatedFrontmatter = updatedFrontmatter.replace(
        /review_history:/,
        `review_history:\n${reviewHistoryEntry}`
      );
    } else {
      updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
    }

    const mainContent = content.substring(frontmatterMatch[0].length).trim();
    const newContent = `---\n${updatedFrontmatter}\n---\n\n${mainContent}`;

    // Move to archive
    await fs.writeFile(archiveFile, newContent);
    await fs.unlink(topicFile);

    return {
      content: [
        {
          type: 'text',
          text: `Topic archived: ${args.topic}\nMoved from topics/${slug}.md to archive/topics/${slug}.md${args.reason ? `\nReason: ${args.reason}` : ''}`,
        },
      ],
    };
  }

  private async listRecentSessions(args: { limit?: number; _invoked_by_slash_command?: boolean }) {
    // Enforce that this tool can only be called via the /sessions slash command
    if (!args._invoked_by_slash_command) {
      throw new Error('This tool can only be invoked via the /sessions slash command. Please ask the user to run the /sessions command.');
    }

    await this.ensureVaultStructure();

    const limit = args.limit || 5;
    const sessionsDir = path.join(VAULT_PATH, 'sessions');

    try {
      // Filter for .md files and get their stats, including from month subdirectories
      const sessionFiles: Array<{
        file: string;
        filePath: string;
        mtime: Date;
        session_id: string;
        topic?: string;
        date?: string;
        status?: string;
      }> = [];

      // Helper function to parse session file metadata
      const parseSessionFile = (file: string, filePath: string, stats: any, content: string) => {
        // Parse frontmatter to get metadata
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let session_id = file.replace('.md', '');
        let topic: string | undefined;
        let date: string | undefined;
        let status: string | undefined;

        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const sessionIdMatch = frontmatter.match(/session_id:\s*(.+)/);
          const topicsMatch = frontmatter.match(/topics:\s*(\[.*?\])/);
          const dateMatch = frontmatter.match(/date:\s*(.+)/);
          const statusMatch = frontmatter.match(/status:\s*(.+)/);

          if (sessionIdMatch) session_id = sessionIdMatch[1].trim();
          if (dateMatch) date = dateMatch[1].trim();
          if (statusMatch) status = statusMatch[1].trim();

          if (topicsMatch) {
            try {
              const topicsArray = JSON.parse(topicsMatch[1]);
              if (Array.isArray(topicsArray) && topicsArray.length > 0) {
                topic = topicsArray[0];
              }
            } catch {
              // If parsing fails, try to extract from filename
              const topicFromFilename = file.match(/_(.+)\.md$/);
              if (topicFromFilename) {
                topic = topicFromFilename[1].replace(/-/g, ' ');
              }
            }
          } else {
            // Extract from filename if not in frontmatter
            const topicFromFilename = file.match(/_(.+)\.md$/);
            if (topicFromFilename) {
              topic = topicFromFilename[1].replace(/-/g, ' ');
            }
          }
        }

        sessionFiles.push({
          file,
          filePath,
          mtime: stats.mtime,
          session_id,
          topic,
          date,
          status,
        });
      };

      // Read both root sessions directory and month subdirectories (YYYY-MM)
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(sessionsDir, entry.name);

        if (entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)) {
          // This is a month directory, read .md files from it
          const monthFiles = await fs.readdir(entryPath);
          for (const file of monthFiles) {
            if (!file.endsWith('.md')) continue;
            const filePath = path.join(entryPath, file);
            const stats = await fs.stat(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            parseSessionFile(file, filePath, stats, content);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Root-level .md file (for backwards compatibility)
          const stats = await fs.stat(entryPath);
          const content = await fs.readFile(entryPath, 'utf-8');
          parseSessionFile(entry.name, entryPath, stats, content);
        }
      }

      if (sessionFiles.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No sessions found. Start a new session with start_session.',
            },
          ],
        };
      }

      // Sort by modification time (most recent first)
      sessionFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Limit results
      const recentSessions = sessionFiles.slice(0, limit);

      if (recentSessions.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No sessions found. Start a new session with start_session.',
            },
          ],
        };
      }

      // Format the output
      let resultText = `Found ${recentSessions.length} recent session(s):\n\n`;

      recentSessions.forEach((session, idx) => {
        const number = idx + 1;
        const statusIcon = session.status === 'completed' ? '✓' : '○';
        const topicText = session.topic ? `: ${session.topic}` : '';
        const dateText = session.date ? ` (${session.date})` : '';

        resultText += `${number}. ${statusIcon} ${session.session_id}${topicText}${dateText}\n`;
      });

      resultText += `\nTo continue a session, use get_session_context with the session_id.`;

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list sessions: ${error}`);
    }
  }

  private async listRecentProjects(args: { limit?: number; _invoked_by_slash_command?: boolean }) {
    // Enforce that this tool can only be called via the /projects slash command
    if (!args._invoked_by_slash_command) {
      throw new Error('This tool can only be invoked via the /projects slash command. Please ask the user to run the /projects command.');
    }

    await this.ensureVaultStructure();

    const limit = args.limit || 5;
    const projectsDir = path.join(VAULT_PATH, 'projects');

    try {
      // Check if projects directory exists
      try {
        await fs.access(projectsDir);
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: 'No projects directory found. Create a project with create_project_page.',
            },
          ],
        };
      }

      // Find all project.md files in subdirectories
      const projectFiles: Array<{
        file: string;
        filePath: string;
        mtime: Date;
        title?: string;
        project_slug?: string;
        repo_path?: string;
        repo_name?: string;
        created?: string;
        status?: string;
      }> = [];

      const entries = await fs.readdir(projectsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const projectFile = path.join(projectsDir, entry.name, 'project.md');
        try {
          const stats = await fs.stat(projectFile);
          const content = await fs.readFile(projectFile, 'utf-8');

          // Parse frontmatter
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          let title: string | undefined;
          let project_slug: string | undefined;
          let repo_path: string | undefined;
          let repo_name: string | undefined;
          let created: string | undefined;
          let status: string | undefined;

          if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            const titleMatch = frontmatter.match(/title:\s*(.+)/);
            const slugMatch = frontmatter.match(/project_slug:\s*(.+)/);
            const createdMatch = frontmatter.match(/created:\s*(.+)/);
            const statusMatch = frontmatter.match(/status:\s*(.+)/);

            // Extract repository info
            const repoPathMatch = frontmatter.match(/repository:\s*\n\s*path:\s*(.+)/);
            const repoNameMatch = frontmatter.match(/repository:\s*\n\s*path:.*\n\s*name:\s*(.+)/);

            if (titleMatch) title = titleMatch[1].trim();
            if (slugMatch) project_slug = slugMatch[1].trim();
            if (createdMatch) created = createdMatch[1].trim();
            if (statusMatch) status = statusMatch[1].trim();
            if (repoPathMatch) repo_path = repoPathMatch[1].trim();
            if (repoNameMatch) repo_name = repoNameMatch[1].trim();
          }

          projectFiles.push({
            file: entry.name,
            filePath: projectFile,
            mtime: stats.mtime,
            title: title || entry.name,
            project_slug,
            repo_path,
            repo_name,
            created,
            status,
          });
        } catch {
          // Skip if project.md doesn't exist in this directory
          continue;
        }
      }

      if (projectFiles.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No projects found. Create a project with create_project_page.',
            },
          ],
        };
      }

      // Sort by modification time (most recent first)
      projectFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Limit results
      const recentProjects = projectFiles.slice(0, limit);

      // Format the output
      let resultText = `Found ${recentProjects.length} recent project(s):\n\n`;

      recentProjects.forEach((project, idx) => {
        const number = idx + 1;
        const statusIcon = project.status === 'active' ? '●' : '○';
        const titleText = project.title || project.file;
        const repoText = project.repo_path ? `\n   Repository: ${project.repo_path}` : '';
        const createdText = project.created ? ` (created ${project.created})` : '';

        resultText += `${number}. ${statusIcon} ${titleText}${createdText}${repoText}\n`;
      });

      resultText += `\nTo view project details, please specify which project number you'd like to see.`;

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list projects: ${error}`);
    }
  }

  private async trackFileAccess(args: { path: string; action: 'read' | 'edit' | 'create' }) {
    // Track file access regardless of whether a session exists
    // This data will be used when /close is invoked to create the session
    const timestamp = new Date().toISOString();
    this.filesAccessed.push({
      path: args.path,
      action: args.action,
      timestamp,
    });

    return {
      content: [
        {
          type: 'text',
          text: `File access tracked: ${args.action} ${args.path}`,
        },
      ],
    };
  }

  private async findGitRepos(startPath: string, maxDepth: number = 2): Promise<string[]> {
    const repos: string[] = [];

    const searchDir = async (dirPath: string, depth: number) => {
      if (depth > maxDepth) return;

      try {
        // Check if this directory is a git repo
        const gitDir = path.join(dirPath, '.git');
        try {
          await fs.access(gitDir);
          repos.push(dirPath);
        } catch {
          // Not a git repo, continue searching
        }

        // Search subdirectories
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            await searchDir(path.join(dirPath, entry.name), depth + 1);
          }
        }
      } catch (error) {
        // Skip directories we can't access
      }
    };

    await searchDir(startPath, 0);

    // Also check parent directories
    let currentPath = startPath;
    for (let i = 0; i < 3; i++) {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) break; // Reached root

      try {
        const gitDir = path.join(parentPath, '.git');
        await fs.access(gitDir);
        if (!repos.includes(parentPath)) {
          repos.push(parentPath);
        }
      } catch {
        // No git repo here
      }

      currentPath = parentPath;
    }

    return repos;
  }

  private async getRepoInfo(repoPath: string): Promise<{ name: string; branch?: string; remote?: string }> {
    const name = path.basename(repoPath);

    try {
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
      const branch = branchOutput.trim();

      let remote: string | undefined;
      try {
        const { stdout: remoteOutput } = await execAsync('git config --get remote.origin.url', { cwd: repoPath });
        remote = remoteOutput.trim();
      } catch {
        // No remote configured
      }

      return { name, branch, remote };
    } catch (error) {
      return { name };
    }
  }

  private async detectSessionRepositories() {
    // Can be called before or after session creation
    // If before, it helps inform user. If after, it can update session metadata.

    // Get current working directory from environment or use vault path
    const cwd = process.env.PWD || process.cwd();

    // Find all git repositories
    const repoPaths = await this.findGitRepos(cwd);

    if (repoPaths.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No Git repositories found in the current working directory or subdirectories.',
          },
        ],
      };
    }

    // Score each repository
    const candidates: RepoCandidate[] = [];

    for (const repoPath of repoPaths) {
      let score = 0;
      const reasons: string[] = [];

      // Score based on files accessed
      const filesInRepo = this.filesAccessed.filter(f => f.path.startsWith(repoPath));
      const editedFiles = filesInRepo.filter(f => f.action === 'edit' || f.action === 'create');
      const readFiles = filesInRepo.filter(f => f.action === 'read');

      if (editedFiles.length > 0) {
        score += editedFiles.length * 10;
        reasons.push(`${editedFiles.length} file(s) modified`);
      }

      if (readFiles.length > 0) {
        score += readFiles.length * 5;
        reasons.push(`${readFiles.length} file(s) read`);
      }

      // Score based on session topic
      if (this.currentSessionId) {
        const repoName = path.basename(repoPath);
        if (this.currentSessionId.toLowerCase().includes(repoName.toLowerCase())) {
          score += 20;
          reasons.push('Session topic matches repo name');
        }
      }

      // Score based on proximity to CWD
      if (repoPath === cwd) {
        score += 15;
        reasons.push('Repo is current working directory');
      } else if (cwd.startsWith(repoPath)) {
        score += 8;
        reasons.push('CWD is within this repo');
      } else if (repoPath.startsWith(cwd)) {
        score += 5;
        reasons.push('Repo is subdirectory of CWD');
      }

      if (score > 0 || repoPaths.length === 1) {
        const info = await this.getRepoInfo(repoPath);
        candidates.push({
          path: repoPath,
          name: info.name,
          score,
          reasons,
          branch: info.branch,
          remote: info.remote,
        });
      }
    }

    // Sort by score
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No relevant repositories detected for this session. This may be a research/exploratory session.',
          },
        ],
      };
    }

    // Format results
    let resultText = `Detected ${candidates.length} repository candidate(s):\n\n`;

    candidates.forEach((candidate, idx) => {
      resultText += `${idx + 1}. **${candidate.name}** (score: ${candidate.score})\n`;
      resultText += `   Path: ${candidate.path}\n`;
      if (candidate.branch) resultText += `   Branch: ${candidate.branch}\n`;
      if (candidate.remote) resultText += `   Remote: ${candidate.remote}\n`;
      resultText += `   Reasons: ${candidate.reasons.join(', ')}\n\n`;
    });

    if (candidates.length === 1 || candidates[0].score > candidates[1]?.score * 2) {
      resultText += `\nRecommendation: Auto-select **${candidates[0].name}**\n`;
      resultText += `Use link_session_to_repository with path: ${candidates[0].path}`;
    } else {
      resultText += `\nMultiple candidates detected. Please select the appropriate repository using link_session_to_repository.`;
    }

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
    };
  }

  private async linkSessionToRepository(args: { repo_path: string }) {
    if (!this.currentSessionFile) {
      throw new Error('No active session.');
    }

    // Verify repo exists and is a git repo
    try {
      await fs.access(path.join(args.repo_path, '.git'));
    } catch {
      throw new Error(`Not a valid Git repository: ${args.repo_path}`);
    }

    const info = await this.getRepoInfo(args.repo_path);

    // Update session file with repository info
    const content = await fs.readFile(this.currentSessionFile, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      throw new Error('Invalid session file format');
    }

    let frontmatter = frontmatterMatch[1];

    // Add or update repository field
    if (frontmatter.includes('repository:')) {
      // Update existing
      frontmatter = frontmatter.replace(
        /repository:[\s\S]*?(?=\n[a-z_]+:|$)/,
        `repository:\n  path: ${args.repo_path}\n  name: ${info.name}\n  commits: []`
      );
    } else {
      // Add new
      frontmatter += `\nrepository:\n  path: ${args.repo_path}\n  name: ${info.name}\n  commits: []`;
    }

    // Add files accessed
    if (this.filesAccessed.length > 0) {
      const filesYaml = this.filesAccessed.map(f =>
        `  - path: ${f.path}\n    action: ${f.action}\n    timestamp: ${f.timestamp}`
      ).join('\n');
      frontmatter += `\nfiles_accessed:\n${filesYaml}`;
    }

    const mainContent = content.substring(frontmatterMatch[0].length);
    const newContent = `---\n${frontmatter}\n---${mainContent}`;

    await fs.writeFile(this.currentSessionFile, newContent);

    // Create or update project page
    await this.createProjectPage({ repo_path: args.repo_path });

    return {
      content: [
        {
          type: 'text',
          text: `Session linked to repository: ${info.name}\nPath: ${args.repo_path}\nProject page created/updated in vault.`,
        },
      ],
    };
  }

  private async createProjectPage(args: { repo_path: string }) {
    await this.ensureVaultStructure();

    const info = await this.getRepoInfo(args.repo_path);
    const slug = this.slugify(info.name);
    const projectDir = path.join(VAULT_PATH, 'projects', slug);
    const projectFile = path.join(projectDir, 'project.md');

    // Create project directory structure
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, 'commits'), { recursive: true });

    const today = new Date().toISOString().split('T')[0];

    // Track project creation for lazy session creation
    this.projectsCreated.push({ slug, name: info.name, file: projectFile });

    // Check if project page already exists
    let content: string;
    try {
      content = await fs.readFile(projectFile, 'utf-8');

      // Update existing project page (only if session exists)
      if (this.currentSessionId) {
        const sessionLink = `- [[${this.currentSessionId}]]`;
        if (!content.includes(sessionLink)) {
          content = content.replace(
            /## Related Sessions\n/,
            `## Related Sessions\n${sessionLink}\n`
          );
        }
        await fs.writeFile(projectFile, content);
      }
    } catch {
      // Create new project page
      content = `---
project_name: ${info.name}
repo_path: ${args.repo_path}
repo_url: ${info.remote || 'N/A'}
created: ${today}
last_commit_tracked: ${today}
total_sessions: 1
total_commits_tracked: 0
tags: [project]
---

# Project: ${info.name}

## Overview
Git repository tracked via Claude Code sessions.

## Repository Info
- **Path:** \`${args.repo_path}\`
- **Current Branch:** ${info.branch || 'unknown'}
- **Remote:** ${info.remote || 'N/A'}

## Recent Activity

## Related Sessions
${this.currentSessionId ? `- [[${this.currentSessionId}]]` : ''}

## Topics

`;
      await fs.writeFile(projectFile, content);
    }

    // Link topics from current session to this project
    if (this.currentSessionId && this.topicsCreated.length > 0) {
      // Read the current content again (may have changed)
      content = await fs.readFile(projectFile, 'utf-8');

      // Add topic links to project
      for (const topic of this.topicsCreated) {
        const topicLink = `- [[topics/${topic.slug}|${topic.title}]]`;
        if (!content.includes(topicLink)) {
          content = content.replace(
            /## Topics\n/,
            `## Topics\n${topicLink}\n`
          );
        }
      }
      await fs.writeFile(projectFile, content);

      // Add project link to topics
      for (const topic of this.topicsCreated) {
        try {
          let topicContent = await fs.readFile(topic.file, 'utf-8');
          const projectLink = `- [[projects/${slug}/project|${info.name}]]`;
          if (!topicContent.includes(projectLink)) {
            topicContent = topicContent.replace(
              /## Related Projects\n/,
              `## Related Projects\n${projectLink}\n`
            );
            await fs.writeFile(topic.file, topicContent);
          }
        } catch (error) {
          // Continue on error
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Project page created/updated: projects/${slug}/project.md`,
        },
      ],
    };
  }

  private async recordCommit(args: { repo_path: string; commit_hash: string }) {
    if (!this.currentSessionId) {
      throw new Error('No active session.');
    }

    await this.ensureVaultStructure();

    const info = await this.getRepoInfo(args.repo_path);
    const slug = this.slugify(info.name);
    const projectDir = path.join(VAULT_PATH, 'projects', slug);
    const commitsDir = path.join(projectDir, 'commits');

    await fs.mkdir(commitsDir, { recursive: true });

    // Get commit information
    const { stdout: commitInfo } = await execAsync(
      `git show --format="%H%n%h%n%an%n%ae%n%aI%n%s%n%b" --stat ${args.commit_hash}`,
      { cwd: args.repo_path }
    );

    const lines = commitInfo.split('\n');
    const fullHash = lines[0];
    const shortHash = lines[1];
    const authorName = lines[2];
    const authorEmail = lines[3];
    const date = lines[4];
    const subject = lines[5];
    const body = lines.slice(6).join('\n');

    // Get diff
    const { stdout: diff } = await execAsync(
      `git show ${args.commit_hash}`,
      { cwd: args.repo_path }
    );

    // Get stats
    const { stdout: stats } = await execAsync(
      `git show --stat ${args.commit_hash}`,
      { cwd: args.repo_path }
    );

    const commitFile = path.join(commitsDir, `${shortHash}.md`);
    const today = new Date().toISOString().split('T')[0];

    const content = `---
commit_hash: ${fullHash}
short_hash: ${shortHash}
author: ${authorName} <${authorEmail}>
date: ${date}
session_id: ${this.currentSessionId}
project: ${info.name}
---

# Commit: ${subject}

**Session:** [[${this.currentSessionId}]]
**Project:** [[projects/${slug}/project|${info.name}]]
**Date:** ${date}
**Author:** ${authorName}

## Summary
${subject}

${body}

## Changes Overview
\`\`\`
${stats}
\`\`\`

## Full Diff
\`\`\`diff
${diff}
\`\`\`

## Related
- **Session:** [[${this.currentSessionId}]]
- **Project:** [[projects/${slug}/project|${info.name}]]
`;

    await fs.writeFile(commitFile, content);

    // Update project page with commit link
    const projectFile = path.join(projectDir, 'project.md');
    const projectContent = await fs.readFile(projectFile, 'utf-8');
    const commitLink = `- [[projects/${slug}/commits/${shortHash}|${shortHash}: ${subject}]] (${today})`;

    const updatedContent = projectContent.replace(
      /## Recent Activity\n/,
      `## Recent Activity\n${commitLink}\n`
    );

    await fs.writeFile(projectFile, updatedContent);

    // Update session file with commit reference
    if (this.currentSessionFile) {
      const sessionContent = await fs.readFile(this.currentSessionFile, 'utf-8');
      const appendContent = `\n## Git Commit\n- [[projects/${slug}/commits/${shortHash}|${shortHash}]]: ${subject}\n`;
      await fs.writeFile(this.currentSessionFile, sessionContent + appendContent);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Commit recorded: ${shortHash}\nCommit page: projects/${slug}/commits/${shortHash}.md\nLinked to session and project.`,
        },
      ],
    };
  }

  /**
   * Find the correct path for a broken link by searching vault directories
   */
  private async findCorrectLinkPath(linkPath: string): Promise<string | null> {
    // Extract filename from path (remove any directory prefixes)
    const filename = path.basename(linkPath);

    // Check if it looks like a session file (YYYY-MM-DD_HH-MM-SS_...)
    const sessionPattern = /^(\d{4})-(\d{2})-(\d{2})_/;
    const sessionMatch = filename.match(sessionPattern);

    if (sessionMatch) {
      const year = sessionMatch[1];
      const month = sessionMatch[2];
      const sessionPath = path.join(VAULT_PATH, 'sessions', `${year}-${month}`, `${filename}.md`);

      try {
        await fs.access(sessionPath);
        return filename; // Return just the filename for wiki-style links
      } catch {
        // File doesn't exist
        return null;
      }
    }

    // Check if it looks like an old-format session file (YYYY-MM-DD-...)
    const oldSessionPattern = /^(\d{4})-(\d{2})-(\d{2})-/;
    const oldSessionMatch = filename.match(oldSessionPattern);

    if (oldSessionMatch) {
      const year = oldSessionMatch[1];
      const month = oldSessionMatch[2];
      const sessionPath = path.join(VAULT_PATH, 'sessions', `${year}-${month}`, `${filename}.md`);

      try {
        await fs.access(sessionPath);
        return filename; // Return just the filename for wiki-style links
      } catch {
        // File doesn't exist
        return null;
      }
    }

    // Check topics directory
    const topicPath = path.join(VAULT_PATH, 'topics', `${filename}.md`);
    try {
      await fs.access(topicPath);
      return filename;
    } catch {
      // Continue checking
    }

    // Check decisions directory (exact match)
    const decisionPath = path.join(VAULT_PATH, 'decisions', `${filename}.md`);
    try {
      await fs.access(decisionPath);
      return filename;
    } catch {
      // Try fuzzy matching - find file that starts with this name
      try {
        const decisionsDir = path.join(VAULT_PATH, 'decisions');
        const decisionFiles = await fs.readdir(decisionsDir);
        const match = decisionFiles.find(f =>
          f.startsWith(filename) && f.endsWith('.md')
        );
        if (match) {
          return match.replace(/\.md$/, '');
        }
      } catch {
        // Continue checking
      }
    }

    // Check for project files (projects/project-name/project.md)
    // Look for pattern: projects/xxx/project or just xxx
    if (linkPath.includes('projects/') || linkPath.includes('/project')) {
      const projectsDir = path.join(VAULT_PATH, 'projects');
      try {
        const projectDirs = await fs.readdir(projectsDir);

        for (const projectDir of projectDirs) {
          const projectFile = path.join(projectsDir, projectDir, 'project.md');
          try {
            await fs.access(projectFile);
            // Check if the link mentions this project
            if (linkPath.includes(projectDir) || linkPath.includes('project')) {
              return `projects/${projectDir}/project`;
            }
          } catch {
            continue;
          }
        }
      } catch {
        // Projects dir doesn't exist
      }
    }

    // Check for commit files (projects/project-name/commits/hash.md)
    if (linkPath.includes('commits/') || /^[a-f0-9]{7,40}$/.test(filename)) {
      const projectsDir = path.join(VAULT_PATH, 'projects');
      try {
        const projectDirs = await fs.readdir(projectsDir);

        for (const projectDir of projectDirs) {
          const commitFile = path.join(projectsDir, projectDir, 'commits', `${filename}.md`);
          try {
            await fs.access(commitFile);
            return `projects/${projectDir}/commits/${filename}`;
          } catch {
            continue;
          }
        }
      } catch {
        // Projects dir doesn't exist
      }
    }

    return null;
  }

  /**
   * Smart filtering for link validation to reduce false positives
   */
  private shouldSkipLinkValidation(linkPath: string, content: string, matchIndex: number): boolean {
    // Skip template variables (e.g., [[sessions/${this.currentSessionId}]])
    if (linkPath.includes('${')) {
      return true;
    }

    // Skip bash conditionals (e.g., [[ "$OSTYPE" == "darwin"* ]])
    // These start with quotes or $ and aren't wiki links
    if (linkPath.startsWith('"') || linkPath.startsWith('$')) {
      return true;
    }

    // Skip common placeholder patterns used in documentation/examples
    const placeholderPatterns = [
      'topic-name',
      'note-name',
      'other-topic',
      'another-topic',
      'file',
      'path/to/note',
      'topic-slug',
      'sessions/null',  // Common in project files when session_id is null
      'session-id',
      'sessions/session-id',
      '2025-11-06_...',  // Truncated session IDs in examples
      'xxx',
      'example',
      'placeholder',
    ];

    if (placeholderPatterns.includes(linkPath)) {
      return true;
    }

    // Skip links with ellipsis or other obvious placeholder indicators
    if (linkPath.includes('...') || linkPath.includes('XXX')) {
      return true;
    }

    // Check if the link is inside a code block (triple backticks)
    // Find all code block boundaries before this match
    const beforeContent = content.substring(0, matchIndex);
    const codeBlockMatches = beforeContent.match(/```/g);

    // If odd number of ``` before this point, we're inside a code block
    if (codeBlockMatches && codeBlockMatches.length % 2 === 1) {
      return true;
    }

    // Skip links that look like bash conditions (contain operators)
    if (linkPath.includes('==') || linkPath.includes('!=') || linkPath.includes('||') || linkPath.includes('&&')) {
      return true;
    }

    return false;
  }

  private async vaultCustodian() {
    await this.ensureVaultStructure();

    const issues: string[] = [];
    const fixes: string[] = [];
    const warnings: string[] = [];

    try {
      // Check 1: Verify sessions are in the correct directory
      const sessionsDir = path.join(VAULT_PATH, 'sessions');
      const sessionFiles = await this.findMarkdownFiles(sessionsDir);

      for (const file of sessionFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

        if (!frontmatterMatch) {
          issues.push(`Session file missing frontmatter: ${path.relative(VAULT_PATH, file)}`);
          continue;
        }

        // Check if session file is in date-organized subdirectory
        const relativePath = path.relative(sessionsDir, file);
        const dateMatch = relativePath.match(/^(\d{4})-(\d{2})\//);
        const filenameDate = path.basename(file).match(/^(\d{4})-(\d{2})-(\d{2})/);

        if (filenameDate) {
          const expectedDir = path.join(sessionsDir, `${filenameDate[1]}-${filenameDate[2]}`);
          const actualDir = path.dirname(file);

          if (actualDir !== expectedDir) {
            issues.push(`Session in wrong directory: ${path.relative(VAULT_PATH, file)}`);

            // Move to correct directory
            await fs.mkdir(expectedDir, { recursive: true });
            const newPath = path.join(expectedDir, path.basename(file));
            await fs.rename(file, newPath);
            fixes.push(`Moved ${path.relative(VAULT_PATH, file)} to ${path.relative(VAULT_PATH, newPath)}`);
          }
        }
      }

      // Check 2: Verify topics are properly formatted
      const topicsDir = path.join(VAULT_PATH, 'topics');
      const topicFiles = await this.findMarkdownFiles(topicsDir);

      for (const file of topicFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

        if (!frontmatterMatch) {
          issues.push(`Topic file missing frontmatter: ${path.relative(VAULT_PATH, file)}`);

          // Add basic frontmatter
          const title = path.basename(file, '.md');
          const today = new Date().toISOString().split('T')[0];
          const newContent = `---
title: ${title}
created: ${today}
tags: []
---

${content}`;
          await fs.writeFile(file, newContent);
          fixes.push(`Added frontmatter to ${path.relative(VAULT_PATH, file)}`);
        }
      }

      // Check 3: Verify project structure
      const projectsDir = path.join(VAULT_PATH, 'projects');
      try {
        const projectDirs = await fs.readdir(projectsDir);

        for (const projectDir of projectDirs) {
          const projectPath = path.join(projectsDir, projectDir);
          const stat = await fs.stat(projectPath);

          if (!stat.isDirectory()) continue;

          const projectFile = path.join(projectPath, 'project.md');
          try {
            await fs.access(projectFile);
          } catch {
            issues.push(`Project directory missing project.md: projects/${projectDir}`);
            warnings.push(`Consider creating a project.md file in projects/${projectDir}`);
          }

          // Check for commits directory
          const commitsDir = path.join(projectPath, 'commits');
          try {
            const commitStat = await fs.stat(commitsDir);
            if (commitStat.isDirectory()) {
              const commits = await fs.readdir(commitsDir);
              if (commits.length === 0) {
                warnings.push(`Empty commits directory: projects/${projectDir}/commits`);
              }
            }
          } catch {
            // No commits directory is fine
          }
        }
      } catch (error) {
        // No projects directory is fine
      }

      // Check 4: Validate and fix internal links
      const decisionsDir = path.join(VAULT_PATH, 'decisions');
      const allFiles = [
        ...await this.findMarkdownFiles(sessionsDir),
        ...await this.findMarkdownFiles(topicsDir),
        ...await this.findMarkdownFiles(decisionsDir),
        ...await this.findMarkdownFiles(projectsDir),
      ];

      for (const file of allFiles) {
        let content = await fs.readFile(file, 'utf-8');
        const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        let fileModified = false;
        const linksToFix: Array<{ original: string; corrected: string; fullMatch: string }> = [];

        // First pass: collect all broken links
        while ((match = linkRegex.exec(content)) !== null) {
          const linkPath = match[1];
          const matchIndex = match.index;
          const fullMatch = match[0];

          // Skip false positives
          if (this.shouldSkipLinkValidation(linkPath, content, matchIndex)) {
            continue;
          }

          // Check if link has directory prefix that violates wiki-link standards
          // Per Decision 002, internal links should not include directory prefixes
          // Note: projects/ prefix is kept because project files are not uniquely named
          // (all project pages are "project.md", commit files may have overlapping hashes)
          const directoryPrefixPattern = /^(sessions|topics|decisions)\//;
          const prefixMatch = linkPath.match(directoryPrefixPattern);

          if (prefixMatch) {
            // Strip the directory prefix to get the base filename
            const strippedPath = linkPath.replace(directoryPrefixPattern, '');

            // Try to find the correct file for this stripped path
            const correctedPath = await this.findCorrectLinkPath(strippedPath);

            if (correctedPath) {
              // Found the file, add it to fixes
              linksToFix.push({
                original: linkPath,
                corrected: correctedPath,
                fullMatch: fullMatch,
              });
            } else {
              // File doesn't exist even after stripping prefix - it's truly broken
              warnings.push(`Broken link in ${path.relative(VAULT_PATH, file)}: [[${linkPath}]] (file not found even after stripping prefix)`);
            }
            continue; // Skip to next link
          }

          // Try to resolve the link
          const possiblePaths = [
            path.join(VAULT_PATH, `${linkPath}.md`),
            path.join(VAULT_PATH, linkPath),
            path.join(path.dirname(file), `${linkPath}.md`),
            path.join(path.dirname(file), linkPath),
          ];

          let found = false;
          for (const p of possiblePaths) {
            try {
              await fs.access(p);
              found = true;
              break;
            } catch {
              // Continue checking
            }
          }

          if (!found) {
            // Try to find the correct path
            const correctedPath = await this.findCorrectLinkPath(linkPath);

            if (correctedPath) {
              linksToFix.push({
                original: linkPath,
                corrected: correctedPath,
                fullMatch: fullMatch,
              });
            } else {
              warnings.push(`Broken link in ${path.relative(VAULT_PATH, file)}: [[${linkPath}]]`);
            }
          }
        }

        // Second pass: fix all broken links
        if (linksToFix.length > 0) {
          for (const link of linksToFix) {
            // Replace the link in content
            // Handle both [[link]] and [[link|display]] formats
            const escapedOriginal = link.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const linkPattern = new RegExp(`\\[\\[${escapedOriginal}(?:\\|[^\\]]+)?\\]\\]`, 'g');
            content = content.replace(linkPattern, `[[${link.corrected}]]`);
            fixes.push(`Fixed link in ${path.relative(VAULT_PATH, file)}: [[${link.original}]] → [[${link.corrected}]]`);
            fileModified = true;
          }

          // Write the updated content back to the file
          await fs.writeFile(file, content);
        }
      }

      // Generate report
      let report = '# Vault Custodian Report\n\n';

      if (issues.length === 0 && warnings.length === 0) {
        report += '✅ Vault integrity check passed! No issues found.\n';
      } else {
        if (issues.length > 0) {
          report += `## Issues Found (${issues.length})\n`;
          for (const issue of issues) {
            report += `- ❌ ${issue}\n`;
          }
          report += '\n';
        }

        if (fixes.length > 0) {
          report += `## Fixes Applied (${fixes.length})\n`;
          for (const fix of fixes) {
            report += `- ✅ ${fix}\n`;
          }
          report += '\n';
        }

        if (warnings.length > 0) {
          report += `## Warnings (${warnings.length})\n`;
          for (const warning of warnings) {
            report += `- ⚠️  ${warning}\n`;
          }
          report += '\n';
        }
      }

      report += '\n---\n';
      report += `**Checked:** ${allFiles.length} files\n`;
      report += `**Issues:** ${issues.length} found, ${fixes.length} fixed\n`;
      report += `**Warnings:** ${warnings.length}\n`;

      return {
        content: [
          {
            type: 'text',
            text: report,
          },
        ],
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error during vault integrity check: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories and cache directories
          if (!entry.name.startsWith('.')) {
            files.push(...await this.findMarkdownFiles(fullPath));
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }

    return files;
  }

  // ==================== Sub-Agent Powered Analysis Methods ====================

  private async analyzeTopicContent(args: {
    content: string;
    topic_name?: string;
    context?: string;
  }) {
    // Build analysis prompt for the sub-agent
    const analysisPrompt = `Analyze the following topic content and provide structured analysis.

${args.topic_name ? `Topic Name: ${args.topic_name}` : ''}
${args.context ? `Context: ${args.context}` : ''}

Content to analyze:
${args.content}

Please provide:
1. **Tags**: 3-7 relevant tags that categorize this topic (e.g., technology names, concepts, domains)
2. **Summary**: A concise 1-2 sentence summary of the main idea
3. **Key Concepts**: List 3-5 key technical concepts or terms discussed
4. **Related Topics**: Suggest 2-4 topic names that would be related (based on common knowledge and the content)
5. **Content Type**: Categorize as one of: implementation, architecture, troubleshooting, reference, tutorial, concept

Respond in JSON format:
{
  "tags": ["tag1", "tag2", ...],
  "summary": "...",
  "key_concepts": ["concept1", "concept2", ...],
  "related_topics": ["topic1", "topic2", ...],
  "content_type": "..."
}`;

    try {
      // Search for similar existing topics
      const searchResults = await this.searchVault({
        query: args.content.substring(0, 200), // Use first 200 chars for similarity search
        directories: ['topics'],
        max_results: 5,
        snippets_only: true,
      });

      // Parse search results to find potential duplicates
      const potentialDuplicates = searchResults.content[0].text.includes('Found 0 matches')
        ? []
        : searchResults.content[0].text.split('\n')
            .filter(line => line.includes('**'))
            .slice(0, 3)
            .map(line => {
              const match = line.match(/\*\*(.+?)\*\*/);
              return match ? match[1] : null;
            })
            .filter(Boolean);

      return {
        content: [
          {
            type: 'text',
            text: `# Topic Content Analysis

## Analysis Prompt for Sub-Agent
To complete this analysis, use a sub-agent with the following prompt:

\`\`\`
${analysisPrompt}
\`\`\`

## Potential Duplicate Topics
${potentialDuplicates.length > 0
  ? `Found ${potentialDuplicates.length} potentially similar existing topics:\n${potentialDuplicates.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
  : 'No similar topics found in the vault.'}

## Next Steps
1. Run the analysis prompt above through a sub-agent to get structured analysis
2. Review the potential duplicates to decide if this is truly new content
3. Use the analysis results to enhance topic creation with auto-generated tags and summary`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error analyzing topic content: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async extractDecisionsFromSession(args: {
    session_id?: string;
    content?: string;
  }) {
    try {
      let sessionContent = args.content;
      let sessionId = args.session_id;

      // If no content provided, read from session file
      if (!sessionContent) {
        if (!sessionId && !this.currentSessionFile) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: No session_id provided and no current session active.',
              },
            ],
          };
        }

        sessionId = sessionId || this.currentSessionId || '';
        const sessionFile = sessionId
          ? await this.findSessionFile(sessionId)
          : this.currentSessionFile;

        if (!sessionFile) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Session file not found for ID: ${sessionId}`,
              },
            ],
          };
        }

        sessionContent = await fs.readFile(sessionFile, 'utf-8');
      }

      // Build decision extraction prompt
      const extractionPrompt = `Analyze the following session content and extract any architectural or technical decisions that were made.

Session Content:
${sessionContent}

For each decision found, provide:
1. **Decision Title**: A clear, concise title (e.g., "Use PostgreSQL instead of MongoDB")
2. **Context**: What problem or situation led to this decision?
3. **Alternatives Considered**: What other options were discussed or considered?
4. **Decision Made**: What was ultimately chosen?
5. **Rationale**: Why was this choice made?
6. **Consequences**: What are the positive and negative consequences?
7. **Strategic Level**: Rate from 1-5 (1=tactical implementation detail, 5=major architectural choice)

Only extract decisions with strategic level 3 or higher. Ignore minor implementation details.

Respond in JSON format:
{
  "decisions": [
    {
      "title": "...",
      "context": "...",
      "alternatives": ["...", "..."],
      "decision": "...",
      "rationale": "...",
      "consequences": {
        "positive": ["...", "..."],
        "negative": ["..."]
      },
      "strategic_level": 4
    }
  ]
}

If no significant decisions are found, return { "decisions": [] }`;

      return {
        content: [
          {
            type: 'text',
            text: `# Decision Extraction Analysis

## Session Information
- Session ID: ${sessionId || 'Current session'}
- Content length: ${sessionContent?.length || 0} characters

## Extraction Prompt for Sub-Agent
To complete this extraction, use a sub-agent with the following prompt:

\`\`\`
${extractionPrompt}
\`\`\`

## Next Steps
1. Run the extraction prompt through a sub-agent to identify decisions
2. For each decision found with strategic_level >= 3:
   - Review the extracted information for accuracy
   - Use \`create_decision\` tool to generate an ADR
   - Link the ADR back to this session
3. If no significant decisions found, no action needed

## How to Create ADRs from Results
For each decision in the JSON response:
\`\`\`
create_decision({
  title: decision.title,
  context: decision.context,
  content: \`
## Decision
\${decision.decision}

## Alternatives Considered
\${decision.alternatives.map((alt, i) => \`\${i + 1}. \${alt}\`).join('\\n')}

## Rationale
\${decision.rationale}

## Consequences

### Positive
\${decision.consequences.positive.map(c => \`- \${c}\`).join('\\n')}

### Negative
\${decision.consequences.negative.map(c => \`- \${c}\`).join('\\n')}
\`
})
\`\`\``,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error extracting decisions: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async enhancedSearch(args: {
    query: string;
    context?: string;
    current_session_id?: string;
    max_results_per_query?: number;
  }) {
    try {
      const maxResults = args.max_results_per_query || 5;

      // Get current session context if provided
      let sessionContext = '';
      if (args.current_session_id) {
        const sessionFile = await this.findSessionFile(args.current_session_id);
        if (sessionFile) {
          const content = await fs.readFile(sessionFile, 'utf-8');
          // Extract just the context section for brevity
          const contextMatch = content.match(/## Context\n(.*?)(?=\n##|\n---|$)/s);
          sessionContext = contextMatch ? contextMatch[1].trim() : '';
        }
      }

      // Build query expansion prompt
      const expansionPrompt = `You are helping expand a search query to find relevant information in an Obsidian vault.

Original Query: "${args.query}"
${args.context ? `Additional Context: ${args.context}` : ''}
${sessionContext ? `Current Session Context: ${sessionContext}` : ''}

Your task:
1. Understand the user's intent behind this query
2. Generate 4-5 diverse search query variations that capture different aspects
3. Include:
   - Technical terms and synonyms
   - Related concepts
   - Different phrasings
   - Specific vs. general variations

Format your response as a JSON array of query strings:
["query1", "query2", "query3", "query4", "query5"]

Each query should be concise (2-5 words) and focused on a specific aspect of the original query.`;

      // Perform a preliminary search to understand available content
      const preliminarySearch = await this.searchVault({
        query: args.query,
        max_results: 3,
        snippets_only: true,
      });

      return {
        content: [
          {
            type: 'text',
            text: `# Enhanced Search Analysis

## Original Query
"${args.query}"

${args.context ? `## Context\n${args.context}\n` : ''}
${sessionContext ? `## Current Session Context\n${sessionContext}\n` : ''}

## Query Expansion Prompt
To complete this search, use a sub-agent with the following prompt to generate query variations:

\`\`\`
${expansionPrompt}
\`\`\`

## Preliminary Results
Here's what a basic search for "${args.query}" found:

${preliminarySearch.content[0].text}

## Next Steps

1. **Generate Query Variations**: Run the expansion prompt through a sub-agent to get 4-5 query variations
2. **Execute Multiple Searches**: For each variation, call \`search_vault\` with max_results=${maxResults}
3. **Deduplicate Results**: Track unique file paths to avoid duplicates
4. **Synthesize Findings**: Combine results and identify key themes

## Example Workflow

\`\`\`javascript
// After getting query variations from sub-agent:
const queryVariations = ["variation1", "variation2", ...];
const allResults = new Map(); // filePath -> result

for (const query of queryVariations) {
  const results = await search_vault({
    query: query,
    max_results: ${maxResults}
  });

  // Extract file paths and add to map (deduplicates automatically)
  // Higher scores override lower scores for same file
}

// Present synthesized results to user
\`\`\`

## Benefits of This Approach

- **Improved Recall**: Multiple query variations find more relevant content
- **Semantic Understanding**: Captures user intent beyond literal keywords
- **Context Awareness**: Uses session context to refine search direction
- **Efficient Deduplication**: Map structure ensures each file appears once
- **Embedding Cache Reuse**: Subsequent searches benefit from cached embeddings`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error in enhanced search: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async analyzeCommitImpact(args: {
    repo_path: string;
    commit_hash: string;
    include_diff?: boolean;
  }) {
    try {
      // Validate repository exists
      const gitDir = path.join(args.repo_path, '.git');
      try {
        await fs.access(gitDir);
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Not a git repository: ${args.repo_path}`,
            },
          ],
        };
      }

      // Get commit information using git commands
      const { execSync } = require('child_process');

      let commitInfo: string;
      let commitDiff: string;
      let commitFiles: string;

      try {
        // Get commit message and metadata
        commitInfo = execSync(
          `git -C "${args.repo_path}" show --no-patch --format="%H%n%an%n%ae%n%ad%n%s%n%b" ${args.commit_hash}`,
          { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );

        // Get files changed (stat summary)
        commitFiles = execSync(
          `git -C "${args.repo_path}" show --stat ${args.commit_hash}`,
          { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );

        // Get diff (full or summary based on flag)
        if (args.include_diff) {
          commitDiff = execSync(
            `git -C "${args.repo_path}" show ${args.commit_hash}`,
            { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
          );
        } else {
          commitDiff = execSync(
            `git -C "${args.repo_path}" diff ${args.commit_hash}^ ${args.commit_hash} --stat`,
            { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
          );
        }
      } catch (gitError: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing git command: ${gitError.message}`,
            },
          ],
        };
      }

      // Parse commit info
      const [hash, author, email, date, subject, ...bodyLines] = commitInfo.split('\n');
      const body = bodyLines.join('\n').trim();

      // Extract changed file paths for searching related topics
      const filePathsMatch = commitFiles.match(/\s([\w\/\.\-_]+)\s+\|/g);
      const changedFiles = filePathsMatch
        ? filePathsMatch.map(m => m.trim().split('|')[0].trim())
        : [];

      // Search for related topics and decisions based on commit content
      const searchTerms = [
        subject,
        ...changedFiles.slice(0, 3).map(f => path.basename(f, path.extname(f)))
      ];

      const relatedContent: string[] = [];

      for (const term of searchTerms) {
        try {
          const results = await this.searchVault({
            query: term,
            max_results: 3,
            snippets_only: true,
          });

          if (!results.content[0].text.includes('Found 0 matches')) {
            relatedContent.push(`**Search for "${term}":**\n${results.content[0].text}\n`);
          }
        } catch {
          // Skip failed searches
        }
      }

      // Build impact analysis prompt
      const analysisPrompt = `Analyze this Git commit and provide impact assessment for documentation updates.

## Commit Information
- **Hash**: ${hash.substring(0, 12)}
- **Author**: ${author} <${email}>
- **Date**: ${date}
- **Subject**: ${subject}
${body ? `- **Body**: ${body}` : ''}

## Files Changed
${commitFiles}

${args.include_diff ? `## Full Diff\n\`\`\`\n${commitDiff}\n\`\`\`` : `## Summary\n${commitDiff}`}

## Your Task
Analyze this commit and provide:

1. **Summary** (2-3 sentences): What was changed and why?
2. **Key Changes**: List 3-5 main technical changes
3. **Impact Level** (1-5): How significant is this change?
   - 1: Minor fix or tweak
   - 2: Small feature or bug fix
   - 3: Notable feature or refactoring
   - 4: Major feature or architectural change
   - 5: Fundamental system redesign

4. **Affected Topics**: Which existing topics should be updated? (provide topic names)
5. **New Topics**: Should new documentation be created?
6. **Related Decisions**: Does this relate to any architectural decisions?
7. **Suggested Actions**: What documentation updates are recommended?

Respond in JSON format:
{
  "summary": "...",
  "key_changes": ["change1", "change2", ...],
  "impact_level": 3,
  "affected_topics": ["topic1", "topic2", ...],
  "new_topics": ["topic1", "topic2", ...],
  "related_decisions": ["decision1", ...],
  "suggested_actions": [
    {"action": "update", "target": "topic-name", "reason": "..."},
    {"action": "create", "target": "new-topic-name", "reason": "..."}
  ]
}`;

      return {
        content: [
          {
            type: 'text',
            text: `# Git Commit Impact Analysis

## Commit Summary
- **Hash**: ${hash.substring(0, 12)}
- **Author**: ${author}
- **Date**: ${date}
- **Message**: ${subject}

## Files Changed
\`\`\`
${commitFiles}
\`\`\`

## Related Content in Vault
${relatedContent.length > 0 ? relatedContent.join('\n') : 'No directly related topics found in vault.'}

## Impact Analysis Prompt
To complete this analysis, use a sub-agent with the following prompt:

\`\`\`
${analysisPrompt}
\`\`\`

## Next Steps

1. **Run Analysis**: Execute the prompt through a sub-agent to get structured impact assessment
2. **Review Suggestions**: Check which topics need updates based on the analysis
3. **Update Documentation**:
   - For affected topics: Use \`update_topic_page\` with new information
   - For new topics: Use \`create_topic_page\` with commit context
   - For decisions: Use \`create_decision\` if architectural choices were made
4. **Link Commit**: The commit is already recorded via \`record_commit\`, ensure it links to updated topics

## Benefits of This Analysis

- **Automatic Documentation Triggers**: Identifies when docs need updates
- **Context Preservation**: Links code changes to conceptual documentation
- **Decision Tracking**: Connects implementation to architectural rationale
- **Knowledge Graph**: Builds relationships between commits, topics, and decisions

## Integration with Existing record_commit

The \`record_commit\` tool already creates commit pages. This analysis enhances it by:
- Providing human-readable summaries (beyond raw diffs)
- Suggesting specific documentation actions
- Identifying architectural implications
- Linking to existing knowledge base`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error analyzing commit impact: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async findSessionFile(sessionId: string): Promise<string | null> {
    const primaryPath = this.getPrimaryVaultPath();
    const sessionsDir = path.join(primaryPath, 'sessions');

    try {
      // Try to find the session file in monthly subdirectories
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)) {
          const monthDir = path.join(sessionsDir, entry.name);
          const files = await fs.readdir(monthDir);

          for (const file of files) {
            if (file.includes(sessionId)) {
              return path.join(monthDir, file);
            }
          }
        }
      }

      // Also check root sessions directory for older sessions
      const rootFiles = await fs.readdir(sessionsDir);
      for (const file of rootFiles) {
        if (file.endsWith('.md') && file.includes(sessionId)) {
          return path.join(sessionsDir, file);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }

    return null;
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Obsidian MCP Server running on stdio');
  }
}

const server = new ObsidianMCPServer();
server.run().catch(console.error);
