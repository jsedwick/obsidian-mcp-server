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
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from '@xenova/transformers';
import * as tools from './tools/index.js';
import { GitService } from './services/git/GitService.js';
import { validateToolArgs, ValidationError } from './validation/index.js';

const execAsync = promisify(exec);

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
  keywordCandidatesLimit: number; // Number of top keyword results to re-rank with semantic search
}

interface EmbeddingToggleConfig {
  enabled: boolean;
  lastModified: string;
}

// Response detail levels for tiered responses
enum ResponseDetail {
  MINIMAL = 'minimal',    // IDs, titles, counts only
  SUMMARY = 'summary',    // + brief snippets (default)
  DETAILED = 'detailed',  // + extended context
  FULL = 'full'          // Complete content
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
  private gitService: GitService;

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
      keywordCandidatesLimit: 100, // Re-rank top 100 keyword results with semantic search
    };

    // Initialize GitService
    this.gitService = new GitService();

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
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      const { name, arguments: args } = request.params;

      try {
        // Validate tool arguments using Zod schemas
        // This provides runtime type safety and helpful error messages
        const validatedArgs = validateToolArgs(name as any, args);

        switch (name) {
          case 'search_vault':
            return await tools.searchVault(validatedArgs as tools.SearchVaultArgs, {
              vaultPath: this.config.primaryVault.path,
              config: this.config,
              embeddingConfig: this.embeddingConfig,
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              loadEmbeddingCache: this.loadEmbeddingCache.bind(this),
              saveEmbeddingCache: this.saveEmbeddingCache.bind(this),
              generateEmbedding: this.generateEmbedding.bind(this),
              getOrCreateEmbedding: this.getOrCreateEmbedding.bind(this),
              cosineSimilarity: this.cosineSimilarity.bind(this),
              scoreSearchResult: this.scoreSearchResult.bind(this),
              formatSearchResults: this.formatSearchResults.bind(this),
              getAllVaults: this.getAllVaults.bind(this),
            });

          case 'create_topic_page':
            return await tools.createTopicPage(validatedArgs as tools.CreateTopicPageArgs, {
              vaultPath: this.config.primaryVault.path,
              currentSessionId: this.currentSessionId,
              slugify: this.slugify.bind(this),
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              analyzeTopicContentInternal: this.analyzeTopicContentInternal.bind(this),
              findRelatedProjects: this.findRelatedProjects.bind(this),
              trackTopicCreation: (topic) => this.topicsCreated.push(topic),
            });

          case 'create_decision':
            return await tools.createDecision(validatedArgs as tools.CreateDecisionArgs, {
              vaultPath: this.config.primaryVault.path,
              currentSessionId: this.currentSessionId,
              slugify: this.slugify.bind(this),
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              findRelatedContentInText: this.findRelatedContentInText.bind(this),
              trackDecisionCreation: (decision) => this.decisionsCreated.push(decision),
            });

          case 'update_topic_page':
            return await tools.updateTopicPage(validatedArgs as tools.UpdateTopicPageArgs, {
              vaultPath: this.config.primaryVault.path,
              slugify: this.slugify.bind(this),
              createTopicPage: this.createTopicPageWrapper.bind(this),
            });

          case 'get_session_context':
            return await tools.getSessionContext(validatedArgs as tools.GetSessionContextArgs, {
              vaultPath: this.config.primaryVault.path,
              currentSessionId: this.currentSessionId,
              currentSessionFile: this.currentSessionFile,
            });

          case 'get_topic_context':
            return await tools.getTopicContext(validatedArgs as tools.GetTopicContextArgs, {
              vaultPath: this.config.primaryVault.path,
              slugify: this.slugify.bind(this),
            });

          case 'link_to_topic':
            return await tools.linkToTopic(validatedArgs as tools.LinkToTopicArgs, {
              vaultPath: this.config.primaryVault.path,
              slugify: this.slugify.bind(this),
              createTopicPage: this.createTopicPageWrapper.bind(this),
            });

          case 'close_session':
            return await tools.closeSession(validatedArgs as tools.CloseSessionArgs, {
              vaultPath: this.config.primaryVault.path,
              currentSessionId: this.currentSessionId,
              filesAccessed: this.filesAccessed,
              topicsCreated: this.topicsCreated,
              decisionsCreated: this.decisionsCreated,
              projectsCreated: this.projectsCreated,
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              findGitRepos: this.findGitRepos.bind(this),
              getRepoInfo: this.getRepoInfo.bind(this),
              createProjectPage: this.createProjectPageWrapper.bind(this),
              findRelatedContentInText: this.findRelatedContentInText.bind(this),
              vaultCustodian: this.vaultCustodianWrapper.bind(this),
              slugify: this.slugify.bind(this),
              setCurrentSession: this.setCurrentSession.bind(this),
              clearSessionState: this.clearSessionState.bind(this),
            });

          case 'find_stale_topics':
            return await tools.findStaleTopics(validatedArgs as tools.FindStaleTopicsArgs, {
              vaultPath: this.config.primaryVault.path,
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              getFileAgeDays: this.getFileAgeDays.bind(this),
            });

          case 'review_topic':
            return await tools.reviewTopic(validatedArgs as tools.ReviewTopicArgs, {
              vaultPath: this.config.primaryVault.path,
              slugify: this.slugify.bind(this),
              pendingReviews: this.pendingReviews,
            });

          case 'approve_topic_update':
            return await tools.approveTopicUpdate(validatedArgs as tools.ApproveTopicUpdateArgs, {
              vaultPath: this.config.primaryVault.path,
              pendingReviews: this.pendingReviews,
              archiveTopic: this.archiveTopicWrapper.bind(this),
            });

          case 'archive_topic':
            return await tools.archiveTopic(validatedArgs as tools.ArchiveTopicArgs, {
              vaultPath: this.config.primaryVault.path,
              slugify: this.slugify.bind(this),
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
            });

          case 'list_recent_sessions':
            return await tools.listRecentSessions(validatedArgs as tools.ListRecentSessionsArgs, {
              vaultPath: this.config.primaryVault.path,
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
            });

          case 'list_recent_projects':
            return await tools.listRecentProjects(validatedArgs as tools.ListRecentProjectsArgs, {
              vaultPath: this.config.primaryVault.path,
            });

          case 'track_file_access':
            return await tools.trackFileAccess(validatedArgs as tools.TrackFileAccessArgs, {
              filesAccessed: this.filesAccessed,
            });

          case 'detect_session_repositories':
            return await tools.detectSessionRepositories(validatedArgs as tools.DetectSessionRepositoriesArgs, {
              currentSessionId: this.currentSessionId,
              filesAccessed: this.filesAccessed,
              findGitRepos: this.findGitRepos.bind(this),
              getRepoInfo: this.getRepoInfo.bind(this),
            });

          case 'link_session_to_repository':
            return await tools.linkSessionToRepository(validatedArgs as tools.LinkSessionToRepositoryArgs, {
              currentSessionFile: this.currentSessionFile,
              filesAccessed: this.filesAccessed,
              gitService: this.gitService,
              createProjectPage: this.createProjectPageWrapper.bind(this),
            });

          case 'create_project_page':
            return await tools.createProjectPage(validatedArgs as tools.CreateProjectPageArgs, {
              vaultPath: this.config.primaryVault.path,
              gitService: this.gitService,
              trackProjectCreation: (project) => this.projectsCreated.push(project),
            });

          case 'record_commit':
            return await tools.recordCommit(validatedArgs as tools.RecordCommitArgs, {
              vaultPath: this.config.primaryVault.path,
              gitService: this.gitService,
              currentSessionId: this.currentSessionId,
              currentSessionFile: this.currentSessionFile,
              vaultCustodian: this.vaultCustodianWrapper.bind(this),
            });

          case 'toggle_embeddings':
            return await tools.toggleEmbeddings(validatedArgs as tools.ToggleEmbeddingsArgs, {
              embeddingConfig: this.embeddingConfig,
              embeddingToggleFile: this.embeddingToggleFile,
              embeddingCache: this.embeddingCache,
              setExtractor: (extractor) => { this.extractor = extractor; },
              setEmbeddingInitPromise: (promise) => { this.embeddingInitPromise = promise; },
            });

          case 'vault_custodian':
            return await tools.vaultCustodian(validatedArgs as tools.VaultCustodianArgs, {
              vaultPath: this.config.primaryVault.path,
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              findSessionFile: this.findSessionFile.bind(this),
            });

          case 'migrate_commit_branches':
            return await tools.migrateCommitBranches(validatedArgs as tools.MigrateCommitBranchesArgs, {
              vaultPath: this.config.primaryVault.path,
              gitService: this.gitService,
            });

          case 'analyze_topic_content':
            return await tools.analyzeTopicContent(validatedArgs as tools.AnalyzeTopicContentArgs, {
              searchVault: this.searchVaultWrapper.bind(this),
            });

          case 'extract_decisions_from_session':
            return await tools.extractDecisionsFromSession(validatedArgs as tools.ExtractDecisionsFromSessionArgs, {
              vaultPath: this.config.primaryVault.path,
              currentSessionFile: this.currentSessionFile,
              currentSessionId: this.currentSessionId,
              slugify: this.slugify.bind(this),
              findSessionFile: this.findSessionFile.bind(this),
            });

          case 'enhanced_search':
            return await tools.enhancedSearch(validatedArgs as tools.EnhancedSearchArgs, {
              findSessionFile: this.findSessionFile.bind(this),
              searchVault: this.searchVaultWrapper.bind(this),
            });

          case 'analyze_commit_impact':
            return await tools.analyzeCommitImpact(validatedArgs as tools.AnalyzeCommitImpactArgs, {
              vaultPath: this.config.primaryVault.path,
              gitService: this.gitService,
              searchVault: this.searchVaultWrapper.bind(this),
            });

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        // Enhanced error handling with special formatting for validation errors
        let errorMessage: string;

        if (error instanceof ValidationError) {
          // Validation errors already have well-formatted messages
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = `Error executing ${name}: ${error.message}`;
        } else {
          errorMessage = `Error executing ${name}: ${String(error)}`;
        }

        return {
          content: [
            {
              type: 'text',
              text: errorMessage,
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
            detail: {
              type: 'string',
              enum: ['minimal', 'summary', 'detailed', 'full'],
              description: 'Response detail level. minimal: files only, summary: + snippets (default), detailed: + extended context, full: complete matches',
              default: 'summary',
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
            auto_analyze: {
              type: ['boolean', 'string'],
              description: 'Auto-analyze content for tags and metadata. false (default): generic tags, true: always analyze, "smart": analyze if content >500 words and no existing tags',
              enum: [false, true, 'smart'],
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

NOTE: If your title contains implementation keywords (fix, bug, implement, etc.), the tool will suggest using create_topic_page instead. Use force: true if the decision is genuinely strategic despite the keywords (e.g., decision to fix architecture that also includes implementation guide).

SCOPE: Decisions can be vault-level (affecting the MCP system itself) or project-specific (affecting a particular codebase). If project is not specified, decision is created as vault-level.`,
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
            project: {
              type: 'string',
              description: 'Optional project slug (e.g., "obsidian-mcp-server", "accessibility-automatic-testing"). If provided, decision is created in decisions/{project}/. If omitted, decision is vault-level and created in decisions/vault/.',
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
            detail: {
              type: 'string',
              enum: ['minimal', 'summary', 'detailed', 'full'],
              description: 'Response detail level. minimal: IDs only, summary: + date/status (default), detailed: + files/commits, full: + summaries',
              default: 'summary',
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
            detail: {
              type: 'string',
              enum: ['minimal', 'summary', 'detailed', 'full'],
              description: 'Response detail level. minimal: names only, summary: + paths/dates (default), detailed: + recent commits, full: + full project pages',
              default: 'summary',
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
        description: 'Verify vault integrity by checking file organization, validating links, and reorganizing/relinking files as necessary. Ensures all files are in logical locations and properly connected. Can optionally be scoped to only check specific files.',
        inputSchema: {
          type: 'object',
          properties: {
            files_to_check: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: Array of absolute file paths to check. If not provided, checks all vault files.',
            },
          },
        },
      },
      {
        name: 'migrate_commit_branches',
        description: 'Migrate existing commit files to add branch information. Scans all recorded commits and adds branch field to frontmatter based on Git history. Optional: specify project slug to migrate only that project.',
        inputSchema: {
          type: 'object',
          properties: {
            project_slug: {
              type: 'string',
              description: 'Optional: Project slug to migrate (e.g., "obsidian-mcp-server"). If not provided, migrates all projects.',
            },
            dry_run: {
              type: 'boolean',
              description: 'If true, shows what would be changed without making changes. Default: false.',
            },
          },
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

  // ==================== Tool Wrapper Methods ====================
  // These wrappers allow modular tools to call other tools without circular dependencies

  private async createTopicPageWrapper(args: { topic: string; content: string; auto_analyze?: boolean | 'true' | 'smart' }): Promise<any> {
    return tools.createTopicPage(args as unknown as tools.CreateTopicPageArgs, {
      vaultPath: this.config.primaryVault.path,
      currentSessionId: this.currentSessionId,
      slugify: this.slugify.bind(this),
      ensureVaultStructure: this.ensureVaultStructure.bind(this),
      analyzeTopicContentInternal: this.analyzeTopicContentInternal.bind(this),
      findRelatedProjects: this.findRelatedProjects.bind(this),
      trackTopicCreation: (topic) => this.topicsCreated.push(topic),
    });
  }

  private async createProjectPageWrapper(args: { repo_path: string }): Promise<any> {
    return tools.createProjectPage(args as unknown as tools.CreateProjectPageArgs, {
      vaultPath: this.config.primaryVault.path,
      gitService: this.gitService,
      trackProjectCreation: (project) => this.projectsCreated.push(project),
    });
  }

  private async vaultCustodianWrapper(args: { files_to_check?: string[] }): Promise<any> {
    return tools.vaultCustodian(args as unknown as tools.VaultCustodianArgs, {
      vaultPath: this.config.primaryVault.path,
      ensureVaultStructure: this.ensureVaultStructure.bind(this),
      findSessionFile: this.findSessionFile.bind(this),
    });
  }

  private async archiveTopicWrapper(args: { topic: string; reason?: string }): Promise<any> {
    return tools.archiveTopic(args as unknown as tools.ArchiveTopicArgs, {
      vaultPath: this.config.primaryVault.path,
      slugify: this.slugify.bind(this),
      ensureVaultStructure: this.ensureVaultStructure.bind(this),
    });
  }

  private async searchVaultWrapper(args: {
    query: string;
    directories?: string[];
    max_results?: number;
    snippets_only?: boolean;
  }): Promise<any> {
    return tools.searchVault(args as unknown as tools.SearchVaultArgs, {
      vaultPath: this.config.primaryVault.path,
      config: this.config,
      embeddingConfig: this.embeddingConfig,
      ensureVaultStructure: this.ensureVaultStructure.bind(this),
      loadEmbeddingCache: this.loadEmbeddingCache.bind(this),
      saveEmbeddingCache: this.saveEmbeddingCache.bind(this),
      generateEmbedding: this.generateEmbedding.bind(this),
      getOrCreateEmbedding: this.getOrCreateEmbedding.bind(this),
      cosineSimilarity: this.cosineSimilarity.bind(this),
      scoreSearchResult: this.scoreSearchResult.bind(this),
      formatSearchResults: this.formatSearchResults.bind(this),
      getAllVaults: this.getAllVaults.bind(this),
    });
  }

  private setCurrentSession(sessionId: string, sessionFile: string): void {
    this.currentSessionId = sessionId;
    this.currentSessionFile = sessionFile;
  }

  private clearSessionState(): void {
    this.filesAccessed = [];
    this.topicsCreated = [];
    this.decisionsCreated = [];
    this.projectsCreated = [];
  }

  // ==================== End Tool Wrapper Methods ====================

  /**
   * Strip Obsidian-specific markdown syntax from text for cleaner CLI output
   */
  private cleanObsidianMarkdown(text: string): string {
    return text
      // Convert wiki links: [[link|display]] -> display, [[link]] -> link
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1');
  }

  private smartTruncate(text: string, options: {
    maxLength: number;
    preserveContext: boolean;
    ellipsis: string;
  }): string {
    if (text.length <= options.maxLength) return text;

    let truncated = text.substring(0, options.maxLength);

    if (options.preserveContext) {
      // Find last complete sentence or paragraph
      const lastPeriod = truncated.lastIndexOf('. ');
      const lastNewline = truncated.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);

      // Only use breakpoint if it's not too far back (>70% of max length)
      if (breakPoint > options.maxLength * 0.7) {
        truncated = truncated.substring(0, breakPoint + 1);
      }
    }

    return truncated + options.ellipsis;
  }

  private formatSearchResults(
    results: Array<{
      file: string;
      matches: string[];
      date?: string;
      score: number;
      semanticScore?: number;
      vault?: string;
    }>,
    totalCount: number,
    detail: ResponseDetail,
    hasSemanticSearch: boolean,
    query: string
  ): { content: Array<{ type: string; text: string }> } {
    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No results found for "${query}".`,
          },
        ],
      };
    }

    let resultText = `Search results for "${query}":\n\n`;

    switch (detail) {
      case ResponseDetail.MINIMAL:
        // Just file paths and basic metadata
        resultText += `Found ${totalCount} matches. Top ${results.length}:\n\n`;
        results.forEach((r, idx) => {
          const vaultIndicator = r.vault && r.vault !== this.config.primaryVault.name
            ? ` [${r.vault}]`
            : '';
          resultText += `${idx + 1}. ${r.file}${r.date ? ` (${r.date})` : ''}${vaultIndicator}\n`;
        });
        resultText += `\n💡 Use detail: "summary" to see snippets`;
        break;

      case ResponseDetail.SUMMARY:
        // Current implementation - snippets truncated to 100 chars
        resultText += `Found ${totalCount} matches. Top ${results.length} results:\n\n`;
        results.forEach((r, idx) => {
          const semanticIndicator = r.semanticScore !== undefined
            ? ` [semantic: ${(r.semanticScore * 100).toFixed(0)}%]`
            : '';
          const vaultIndicator = r.vault && r.vault !== this.config.primaryVault.name
            ? ` [${r.vault}]`
            : '';

          resultText += `${idx + 1}. **${r.file}** ${r.date ? `(${r.date})` : ''}${semanticIndicator}${vaultIndicator}\n`;

          if (r.matches.length > 0) {
            const snippets = r.matches
              .slice(0, 3)  // Max 3 snippets per result
              .map(m => {
                const cleaned = this.cleanObsidianMarkdown(m.trim());
                return `   ${cleaned.substring(0, 100)}${cleaned.length > 100 ? '...' : ''}`;
              })
              .join('\n');
            resultText += snippets + '\n';
          }
          resultText += '\n';
        });

        if (totalCount > results.length) {
          resultText += `\n_Showing top ${results.length} of ${totalCount} results. Refine your query or increase max_results for more._\n`;
        }
        resultText += `\n💡 Use get_session_context/get_topic_context for full content`;
        resultText += `\n💡 Use detail: "detailed" for more context per result`;
        break;

      case ResponseDetail.DETAILED:
        // Extended snippets - up to 300 chars, more matches per result
        resultText += `Found ${totalCount} matches. Showing ${results.length} detailed results:\n\n`;
        results.forEach((r, idx) => {
          const semanticIndicator = r.semanticScore !== undefined
            ? ` [semantic: ${(r.semanticScore * 100).toFixed(0)}%]`
            : '';
          const vaultIndicator = r.vault && r.vault !== this.config.primaryVault.name
            ? ` [${r.vault}]`
            : '';

          resultText += `${idx + 1}. **${r.file}** ${r.date ? `(${r.date})` : ''}${semanticIndicator}${vaultIndicator}\n`;

          if (r.matches.length > 0) {
            const snippets = r.matches
              .slice(0, 5)  // Up to 5 snippets
              .map(m => {
                const cleaned = this.cleanObsidianMarkdown(m.trim());
                const truncated = this.smartTruncate(cleaned, {
                  maxLength: 300,
                  preserveContext: true,
                  ellipsis: '...'
                });
                return `   ${truncated}`;
              })
              .join('\n');
            resultText += snippets + '\n';
          }
          resultText += '\n';
        });

        if (totalCount > results.length) {
          resultText += `\n_Showing top ${results.length} of ${totalCount} results._\n`;
        }
        resultText += `\n💡 Use get_session_context/get_topic_context for complete files`;
        resultText += `\n💡 Use detail: "full" for all matches without truncation`;
        break;

      case ResponseDetail.FULL:
        // Complete matches - no truncation (backwards compatible)
        resultText += `Found ${totalCount} matches. Showing ${results.length} complete results:\n\n`;
        results.forEach(r => {
          resultText += `**${r.file}** ${r.date ? `(${r.date})` : ''}:\n`;
          if (r.matches.length > 0) {
            resultText += r.matches.map(m => `  - ${this.cleanObsidianMarkdown(m.trim())}`).join('\n') + '\n';
          }
          resultText += '\n';
        });
        break;
    }

    // Add footer metadata
    if (hasSemanticSearch) {
      resultText += `\n✨ Results semantically re-ranked from top ${this.embeddingConfig.keywordCandidatesLimit} keyword matches`;
    }
    if (this.config.secondaryVaults.length > 0) {
      resultText += `\n📚 Searched ${1 + this.config.secondaryVaults.length} vault(s)`;
    }

    return {
      content: [
        {
          type: 'text',
          text: resultText
        }
      ]
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

    // Return keyword-based results only
    // Semantic re-ranking will happen in a separate phase in searchVault
    if (hasMatch) {
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
        score: keywordScore,
        content: content, // Include content for later semantic scoring
        fileStats: fileStats, // Include file stats for embedding cache
      };
    }

    return null;
  }

  /**
   * Find projects related to a topic by searching for repo URLs and semantic matches
   */
  private async findRelatedProjects(
    topicContent: string
  ): Promise<Array<{ link: string; name: string }>> {
    const relatedProjects: Array<{ link: string; name: string }> = [];
    const projectsDir = path.join(VAULT_PATH, 'projects');

    try {
      // Get all project directories
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      const projectDirs = entries.filter(e => e.isDirectory());

      for (const dir of projectDirs) {
        const projectFile = path.join(projectsDir, dir.name, 'project.md');

        try {
          await fs.access(projectFile);
          const projectContent = await fs.readFile(projectFile, 'utf-8');
          const frontmatterMatch = projectContent.match(/^---\n([\s\S]*?)\n---/);

          if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];

            // Extract repo URL and name from project frontmatter
            const repoUrlMatch = frontmatter.match(/repo_url:\s*(.+)/);
            const projectNameMatch = frontmatter.match(/project_name:\s*(.+)/);
            const repoPathMatch = frontmatter.match(/repo_path:\s*(.+)/);

            const repoUrl = repoUrlMatch ? repoUrlMatch[1].trim() : null;
            const projectName = projectNameMatch ? projectNameMatch[1].trim() : dir.name;
            const repoPath = repoPathMatch ? repoPathMatch[1].trim() : null;

            // Strategy 1: Check if topic content mentions the repo URL
            if (repoUrl && repoUrl !== 'N/A' && topicContent.includes(repoUrl)) {
              relatedProjects.push({
                link: `projects/${dir.name}/project`,
                name: projectName,
              });
              continue;
            }

            // Strategy 2: Check if topic content mentions the repo path
            if (repoPath && topicContent.includes(repoPath)) {
              relatedProjects.push({
                link: `projects/${dir.name}/project`,
                name: projectName,
              });
              continue;
            }

            // Strategy 3: Check if project name is mentioned in topic
            if (projectName && topicContent.toLowerCase().includes(projectName.toLowerCase())) {
              relatedProjects.push({
                link: `projects/${dir.name}/project`,
                name: projectName,
              });
              continue;
            }
          }
        } catch (error) {
          // Skip projects that can't be read
          continue;
        }
      }
    } catch (error) {
      // If projects directory doesn't exist or can't be read, return empty array
    }

    return relatedProjects;
  }











  /**
   * Find topics, decisions, and projects mentioned in text content
   */
  private async findRelatedContentInText(
    text: string
  ): Promise<{
    topics: Array<{ link: string; title: string }>;
    decisions: Array<{ link: string; title: string }>;
    projects: Array<{ link: string; name: string }>;
  }> {
    const result = {
      topics: [] as Array<{ link: string; title: string }>,
      decisions: [] as Array<{ link: string; title: string }>,
      projects: [] as Array<{ link: string; name: string }>,
    };

    try {
      const topicsDir = path.join(VAULT_PATH, 'topics');
      const decisionsDir = path.join(VAULT_PATH, 'decisions');
      const projectsDir = path.join(VAULT_PATH, 'projects');

      // Search topics
      try {
        const topicFiles = await this.findMarkdownFiles(topicsDir);
        for (const topicFile of topicFiles) {
          const content = await fs.readFile(topicFile, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const titleMatch = frontmatterMatch[1].match(/title:\s*(.+)/);
            const title = titleMatch ? titleMatch[1].trim() : path.basename(topicFile, '.md');

            // Check if title is mentioned in text
            if (text.toLowerCase().includes(title.toLowerCase())) {
              const relativePath = path.relative(VAULT_PATH, topicFile);
              result.topics.push({
                link: relativePath.replace(/\.md$/, ''),
                title,
              });
            }
          }
        }
      } catch (error) {
        // Skip if topics directory doesn't exist
      }

      // Search decisions
      try {
        const decisionFiles = await this.findMarkdownFiles(decisionsDir);
        for (const decisionFile of decisionFiles) {
          const content = await fs.readFile(decisionFile, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const titleMatch = frontmatterMatch[1].match(/title:\s*(.+)/);
            const title = titleMatch ? titleMatch[1].trim() : path.basename(decisionFile, '.md');

            // Check if title is mentioned in text
            if (text.toLowerCase().includes(title.toLowerCase())) {
              const relativePath = path.relative(VAULT_PATH, decisionFile);
              result.decisions.push({
                link: relativePath.replace(/\.md$/, ''),
                title,
              });
            }
          }
        }
      } catch (error) {
        // Skip if decisions directory doesn't exist
      }

      // Search projects
      try {
        const entries = await fs.readdir(projectsDir, { withFileTypes: true });
        const projectDirEntries = entries.filter(e => e.isDirectory());

        for (const dir of projectDirEntries) {
          const projectFile = path.join(projectsDir, dir.name, 'project.md');
          try {
            const content = await fs.readFile(projectFile, 'utf-8');
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
              const projectNameMatch = frontmatterMatch[1].match(/project_name:\s*(.+)/);
              const projectName = projectNameMatch ? projectNameMatch[1].trim() : dir.name;

              // Check if project name is mentioned in text
              if (text.toLowerCase().includes(projectName.toLowerCase())) {
                result.projects.push({
                  link: `projects/${dir.name}/project`,
                  name: projectName,
                });
              }
            }
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        // Skip if projects directory doesn't exist
      }
    } catch (error) {
      // Return empty results on error
    }

    return result;
  }



  private getFileAgeDays(dateString: string): number {
    const fileDate = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - fileDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
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





  /**
   * Extract repository slug from various URL formats
   */
  /**
   * Migrate existing commit files to add branch information
   */



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



  /**
   * Internal method to analyze topic content using heuristic tag extraction.
   * Extracts meaningful keywords from title and content without LLM calls.
   * Used by auto_analyze feature in createTopicPage.
   */
  private async analyzeTopicContentInternal(args: {
    content: string;
    topic_name?: string;
    context?: string;
  }): Promise<{
    tags: string[];
    summary: string;
    key_concepts: string[];
    related_topics: string[];
    content_type: string;
  }> {
    // Common words to filter out (expanded stop words list)
    const commonWords = new Set([
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
      'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
      'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
      'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
      'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go',
      'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
      'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them',
      'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its',
      'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our',
      'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any',
      'these', 'give', 'day', 'most', 'us', 'is', 'was', 'are', 'been', 'has',
      'had', 'were', 'said', 'did', 'having', 'may', 'should', 'does', 'done'
    ]);

    // Extract words from title and content
    const text = `${args.topic_name || ''} ${args.content}`.toLowerCase();

    // Extract all words (3+ characters, alphanumeric and hyphens)
    const words = text.match(/\b[a-z0-9]+(?:-[a-z0-9]+)*\b/g) || [];

    // Count word frequency
    const wordFreq = new Map<string, number>();
    for (const word of words) {
      if (word.length >= 3 && !commonWords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    // Extract technical terms and acronyms from original text (preserve case)
    const technicalTerms = new Set<string>();

    // Find acronyms (2+ uppercase letters)
    const acronyms = args.content.match(/\b[A-Z]{2,}\b/g) || [];
    acronyms.forEach(term => technicalTerms.add(term.toLowerCase()));

    // Find capitalized technical terms (but not sentence starts)
    const capitalizedWords = args.content.match(/(?<!^|\. )\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) || [];
    capitalizedWords.forEach(term => technicalTerms.add(term.toLowerCase()));

    // Find hyphenated terms
    const hyphenatedTerms = args.content.match(/\b[a-z]+-[a-z]+(?:-[a-z]+)*\b/gi) || [];
    hyphenatedTerms.forEach(term => technicalTerms.add(term.toLowerCase()));

    // Combine technical terms with high-frequency words
    const candidateTags = new Set<string>();

    // Add technical terms first (higher priority)
    technicalTerms.forEach(term => candidateTags.add(term));

    // Add high-frequency words (appearing 2+ times)
    Array.from(wordFreq.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([word, _]) => candidateTags.add(word));

    // Convert to array and limit to 7 tags
    const tags = Array.from(candidateTags).slice(0, 7);

    // If we have too few tags, add single-occurrence technical terms
    if (tags.length < 3) {
      Array.from(wordFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .forEach(([word, _]) => {
          if (tags.length < 7 && !tags.includes(word)) {
            tags.push(word);
          }
        });
    }

    return {
      tags: tags.length > 0 ? tags : ['topic'],
      summary: '',
      key_concepts: [],
      related_topics: [],
      content_type: 'reference',
    };
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
