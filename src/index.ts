#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
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
    const configData = require('fs').readFileSync(configPath, 'utf-8');
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
}

interface EmbeddingConfig {
  enabled: boolean;
  modelName: string;
  cacheDir: string;
  semanticWeight: number; // 0-1, how much weight semantic search gets (rest goes to keyword)
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
  private embeddingConfig: EmbeddingConfig;
  private embeddingCache: Map<string, EmbeddingCacheEntry> = new Map();
  private extractor: any = null;
  private embeddingInitPromise: Promise<void> | null = null;

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

    // Initialize embedding config
    this.embeddingConfig = {
      enabled: process.env.ENABLE_EMBEDDINGS !== 'false', // Default: enabled
      modelName: 'Xenova/all-MiniLM-L6-v2',
      cacheDir: path.join(this.config.primaryVault.path, '.embedding-cache'),
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
      await this.closeSession();
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
          case 'start_session':
            return await this.startSession(args as { topic?: string });
          
          case 'save_session_note':
            return await this.saveSessionNote(args as { content: string; append?: boolean });
          
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
            return await this.createDecision(args as { title: string; content: string; context?: string });
          
          case 'update_topic_page':
            return await this.updateTopicPage(args as { topic: string; content: string; append?: boolean });
          
          case 'get_session_context':
            return await this.getSessionContext(args as { session_id?: string });
          
          case 'link_to_topic':
            return await this.linkToTopic(args as { topic: string });
          
          case 'close_session':
            return await this.closeSession();

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

    try {
      const cacheFile = path.join(this.embeddingConfig.cacheDir, 'embeddings.json');
      const data = await fs.readFile(cacheFile, 'utf-8');
      const entries = JSON.parse(data) as EmbeddingCacheEntry[];

      for (const entry of entries) {
        this.embeddingCache.set(entry.file, entry);
      }
    } catch (error) {
      // Cache file doesn't exist yet, which is fine
    }
  }

  private async saveEmbeddingCache(): Promise<void> {
    if (!this.embeddingConfig.enabled) {
      return;
    }

    try {
      await fs.mkdir(this.embeddingConfig.cacheDir, { recursive: true });
      const entries = Array.from(this.embeddingCache.values());
      const cacheFile = path.join(this.embeddingConfig.cacheDir, 'embeddings.json');
      await fs.writeFile(cacheFile, JSON.stringify(entries, null, 2));
    } catch (error) {
      console.error('[Embedding] Failed to save cache:', error);
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

    // Cache it
    this.embeddingCache.set(file, {
      file,
      embedding,
      timestamp: Math.floor(fileStats.mtime.getTime() / 1000),
    });

    return embedding;
  }

  // ==================== End Embedding Methods ====================

  private getTools(): Tool[] {
    return [
      {
        name: 'start_session',
        description: 'Start a new conversation session and create a session file in the Obsidian vault. Call this at the beginning of each conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Optional initial topic for the session',
            },
          },
        },
      },
      {
        name: 'save_session_note',
        description: 'Save or append content to the current session file. Use this to record key points, decisions, and context during the conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content to save in the session note',
            },
            append: {
              type: 'boolean',
              description: 'If true, append to existing content; if false, replace. Default: true',
              default: true,
            },
          },
          required: ['content'],
        },
      },
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
        description: 'Create a new topic page in the topics/ directory. Use this for significant technical concepts or areas that will be referenced multiple times.',
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
        description: 'Create a new architectural decision record in the decisions/ directory.',
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
        description: 'Mark the current session as completed. Call this at the end of a conversation.',
        inputSchema: {
          type: 'object',
          properties: {},
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

  private async startSession(args: { topic?: string }) {
    await this.ensureVaultStructure();

    // Clear file access tracking from previous session
    this.filesAccessed = [];

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const topicSlug = args.topic ? `_${this.slugify(args.topic)}` : '';

    this.currentSessionId = `${dateStr}_${timeStr}${topicSlug}`;

    // Organize sessions by month: sessions/YYYY-MM/
    const monthStr = dateStr.substring(0, 7); // YYYY-MM
    const monthDir = path.join(VAULT_PATH, 'sessions', monthStr);
    await fs.mkdir(monthDir, { recursive: true });
    this.currentSessionFile = path.join(monthDir, `${this.currentSessionId}.md`);

    const metadata: SessionMetadata = {
      date: dateStr,
      session_id: this.currentSessionId,
      topics: args.topic ? [args.topic] : [],
      decisions: [],
      status: 'ongoing',
    };

    const content = `---
date: ${metadata.date}
session_id: ${metadata.session_id}
topics: ${JSON.stringify(metadata.topics)}
decisions: []
status: ongoing
---

# Session: ${args.topic || 'New Session'}

## Context
${args.topic ? `Working on: ${args.topic}` : 'New conversation session started.'}

## Key Points

## Outcomes

## Code References

`;

    await fs.writeFile(this.currentSessionFile, content);

    return {
      content: [
        {
          type: 'text',
          text: `Session started: ${this.currentSessionId}\nSession file: ${this.currentSessionFile}\n\nUse save_session_note to record key information during the conversation.`,
        },
      ],
    };
  }

  private async saveSessionNote(args: { content: string; append?: boolean }) {
    if (!this.currentSessionFile) {
      throw new Error('No active session. Call start_session first.');
    }

    const append = args.append !== false;

    if (append) {
      const existing = await fs.readFile(this.currentSessionFile, 'utf-8');
      const newContent = existing + '\n' + args.content;
      await fs.writeFile(this.currentSessionFile, newContent);
    } else {
      await fs.writeFile(this.currentSessionFile, args.content);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Session note ${append ? 'updated' : 'saved'}: ${this.currentSessionFile}`,
        },
      ],
    };
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
                  args.date_range
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
              args.date_range
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
      if (vault === this.config.primaryVault) {
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
    dateRange?: { start?: string; end?: string }
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

        // Filename matching
        if (fileName.toLowerCase().includes(term)) keywordScore += 5;

        // Recency
        if (fileDate) {
          const age = this.getFileAgeDays(fileDate);
          if (age < 7) keywordScore += 3;
          else if (age < 30) keywordScore += 2;
          else if (age < 90) keywordScore += 1;
        }
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
        const docEmbedding = await this.getOrCreateEmbedding(relPath, content, fileStats);
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
        file: path.join(dir, relPath),
        matches: matchingLines,
        date: fileDate,
        score: finalScore,
        semanticScore: queryEmbedding ? semanticScore : undefined,
      };
    }

    return null;
  }

  private async createTopicPage(args: { topic: string; content: string }) {
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

## Related Decisions

`;

    await fs.writeFile(topicFile, content);

    // Update current session to reference this topic
    if (this.currentSessionFile) {
      await this.saveSessionNote({
        content: `\n- Created topic page: [[topics/${slug}|${args.topic}]]`,
        append: true,
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: `Topic page created: ${topicFile}\nObsidian link: [[topics/${slug}|${args.topic}]]`,
        },
      ],
    };
  }

  private async createDecision(args: { title: string; content: string; context?: string }) {
    await this.ensureVaultStructure();

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
${this.currentSessionId ? `- Session: [[sessions/${this.currentSessionId}]]` : ''}

`;

    await fs.writeFile(decisionFile, content);

    // Update current session
    if (this.currentSessionFile) {
      await this.saveSessionNote({
        content: `\n- [[decisions/${numberStr}-${slug}|Decision ${numberStr}]]: ${args.title}`,
        append: true,
      });
    }

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
      const newContent = existing + '\n' + args.content;
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

  private async closeSession() {
    if (!this.currentSessionFile) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active session to close.',
          },
        ],
      };
    }

    // Update status in frontmatter
    const content = await fs.readFile(this.currentSessionFile, 'utf-8');
    const updatedContent = content.replace(/status: ongoing/, 'status: completed');
    await fs.writeFile(this.currentSessionFile, updatedContent);

    const sessionId = this.currentSessionId;

    // Auto-detect Git repositories before closing
    let repoDetectionMessage = '';
    if (this.filesAccessed.length > 0) {
      try {
        const cwd = process.env.PWD || process.cwd();
        const repoPaths = await this.findGitRepos(cwd);

        if (repoPaths.length > 0) {
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
            if (sessionId) {
              const repoName = path.basename(repoPath);
              if (sessionId.toLowerCase().includes(repoName.toLowerCase())) {
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

          if (candidates.length > 0) {
            const topCandidate = candidates[0];
            repoDetectionMessage = `\n\n📦 Git Repository Detected:\n`;
            repoDetectionMessage += `   ${topCandidate.name} (score: ${topCandidate.score})\n`;
            repoDetectionMessage += `   Path: ${topCandidate.path}\n`;
            if (topCandidate.branch) repoDetectionMessage += `   Branch: ${topCandidate.branch}\n`;
            repoDetectionMessage += `   Reasons: ${topCandidate.reasons.join(', ')}\n\n`;

            if (candidates.length === 1 || topCandidate.score > (candidates[1]?.score || 0) * 2) {
              repoDetectionMessage += `💡 Recommendation: Create a commit for this work\n`;
              repoDetectionMessage += `   To link and commit:\n`;
              repoDetectionMessage += `   1. link_session_to_repository (path: ${topCandidate.path})\n`;
              repoDetectionMessage += `   2. Create your git commit\n`;
              repoDetectionMessage += `   3. record_commit (with the commit hash)`;
            } else {
              repoDetectionMessage += `💡 Multiple repositories detected (${candidates.length})\n`;
              repoDetectionMessage += `   Run detect_session_repositories to see all options`;
            }
          }
        }
      } catch (error) {
        // Silently fail - repo detection is optional
      }
    }

    this.currentSessionId = null;
    this.currentSessionFile = null;

    return {
      content: [
        {
          type: 'text',
          text: `Session closed: ${sessionId}${repoDetectionMessage}`,
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

  private async trackFileAccess(args: { path: string; action: 'read' | 'edit' | 'create' }) {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call start_session first.');
    }

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
    if (!this.currentSessionId || !this.currentSessionFile) {
      throw new Error('No active session.');
    }

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

    // Check if project page already exists
    let content: string;
    try {
      content = await fs.readFile(projectFile, 'utf-8');

      // Update existing project page
      const sessionLink = `- [[sessions/${this.currentSessionId}|${this.currentSessionId}]]`;
      if (!content.includes(sessionLink)) {
        content = content.replace(
          /## Related Sessions\n/,
          `## Related Sessions\n${sessionLink}\n`
        );
      }

      await fs.writeFile(projectFile, content);
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
- [[sessions/${this.currentSessionId}|${this.currentSessionId}]]

## Topics

`;
      await fs.writeFile(projectFile, content);
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

**Session:** [[sessions/${this.currentSessionId}|${this.currentSessionId}]]
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
- **Session:** [[sessions/${this.currentSessionId}|${this.currentSessionId}]]
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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Obsidian MCP Server running on stdio');
  }
}

const server = new ObsidianMCPServer();
server.run().catch(console.error);
