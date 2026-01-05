#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import fssync from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from '@xenova/transformers';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import * as tools from './tools/index.js';
import { GitService } from './services/git/GitService.js';
import { validateToolArgs, ValidationError } from './validation/index.js';
import { IndexBuilder } from './services/search/index/IndexBuilder.js';
import { IndexedSearch } from './services/search/IndexedSearch.js';
import { DEFAULT_INDEX_CONFIG } from './models/IndexModels.js';
import type { VaultConfig, VaultAuthority, VaultMode } from './models/Vault.js';
import { LRUCache } from './utils/LRUCache.js';
import { createLogger } from './utils/logger.js';

const execAsync = promisify(exec);
const logger = createLogger('MCPServer');

interface ServerConfig {
  primaryVault: VaultConfig;
  secondaryVaults: VaultConfig[];
}

/**
 * Full configuration containing all vaults from all modes
 * Used internally to support mode switching
 */
interface FullServerConfig {
  allPrimaryVaults: VaultConfig[];
  allSecondaryVaults: VaultConfig[];
  hasModeSupport: boolean; // True if config uses new primaryVaults[] format
}

// Current mode state (default: work)
let currentMode: VaultMode = 'work';

// Full configuration (loaded once, contains all vaults from all modes)
let fullConfig: FullServerConfig | null = null;

/**
 * Get the current vault mode
 */
function getCurrentMode(): VaultMode {
  return currentMode;
}

/**
 * Check if mode switching is available
 * Mode switching requires the new primaryVaults[] config format
 */
function isModeSupported(): boolean {
  return fullConfig?.hasModeSupport ?? false;
}

/**
 * Get available modes based on configured vaults
 */
function getAvailableModes(): VaultMode[] {
  if (!fullConfig) return ['work'];
  const modes = new Set<VaultMode>();
  for (const vault of [...fullConfig.allPrimaryVaults, ...fullConfig.allSecondaryVaults]) {
    modes.add(vault.mode || 'work');
  }
  return Array.from(modes);
}

/**
 * Load full configuration from file (all vaults, all modes)
 */
function loadFullConfig(): FullServerConfig {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.join(currentDir, '..');

  const configPaths = [
    path.join(projectRoot, '.obsidian-mcp.json'),
    path.join(process.env.HOME || '', '.obsidian-mcp.json'),
    path.join(process.env.HOME || '', '.config', '.obsidian-mcp.json'),
  ];

  const normalizePath = (p: string): string => p.replace(/\/+$/, '');

  for (const configPath of configPaths) {
    try {
      const configData = fssync.readFileSync(configPath, 'utf-8');
      const config: unknown = JSON.parse(configData);

      if (!config || typeof config !== 'object') continue;

      // Check for new format: primaryVaults array
      if ('primaryVaults' in config && Array.isArray(config.primaryVaults)) {
        const typedConfig = config as {
          primaryVaults: Array<{
            path: string;
            name?: string;
            authority?: VaultAuthority;
            mode?: VaultMode;
          }>;
          secondaryVaults?: Array<{
            path: string;
            name?: string;
            authority?: VaultAuthority;
            mode?: VaultMode;
          }>;
        };

        return {
          allPrimaryVaults: typedConfig.primaryVaults.map(v => ({
            path: normalizePath(v.path),
            name: v.name || path.basename(v.path),
            authority: v.authority || 'default',
            mode: v.mode || 'work',
          })),
          allSecondaryVaults: (typedConfig.secondaryVaults || []).map(v => ({
            path: normalizePath(v.path),
            name: v.name || path.basename(v.path),
            authority: v.authority || 'default',
            mode: v.mode || 'work',
          })),
          hasModeSupport: true,
        };
      }

      // Legacy format: single primaryVault object
      if (
        'primaryVault' in config &&
        config.primaryVault &&
        typeof config.primaryVault === 'object' &&
        'path' in config.primaryVault &&
        typeof config.primaryVault.path === 'string'
      ) {
        const typedConfig = config as {
          primaryVault: { path: string; name?: string; authority?: VaultAuthority };
          secondaryVaults?: Array<{ path: string; name?: string; authority?: VaultAuthority }>;
        };

        return {
          allPrimaryVaults: [
            {
              path: normalizePath(typedConfig.primaryVault.path),
              name: typedConfig.primaryVault.name || 'Primary Vault',
              authority: typedConfig.primaryVault.authority || 'default',
              mode: 'work', // Legacy configs default to work mode
            },
          ],
          allSecondaryVaults: (typedConfig.secondaryVaults || []).map(v => ({
            path: normalizePath(v.path),
            name: v.name || path.basename(v.path),
            authority: v.authority || 'default',
            mode: 'work', // Legacy configs default to work mode
          })),
          hasModeSupport: false,
        };
      }
    } catch {
      continue;
    }
  }

  // Fall back to environment variables (legacy, work mode only)
  const primaryPath =
    process.env.OBSIDIAN_VAULT_PATH || path.join(process.env.HOME || '', 'obsidian-vault');

  const secondaryPaths = process.env.OBSIDIAN_SECONDARY_VAULTS
    ? process.env.OBSIDIAN_SECONDARY_VAULTS.split(',')
        .map(p => p.trim())
        .filter(p => p)
    : [];

  return {
    allPrimaryVaults: [
      {
        path: normalizePath(primaryPath),
        name: process.env.OBSIDIAN_VAULT_NAME || 'Primary Vault',
        authority: 'default',
        mode: 'work',
      },
    ],
    allSecondaryVaults: secondaryPaths.map((p, idx) => ({
      path: normalizePath(p),
      name: `Secondary Vault ${idx + 1}`,
      authority: 'default',
      mode: 'work',
    })),
    hasModeSupport: false,
  };
}

/**
 * Get configuration filtered by the current mode
 */
function getConfigForMode(mode: VaultMode): ServerConfig {
  if (!fullConfig) {
    fullConfig = loadFullConfig();
  }

  // Filter vaults by mode
  const primaryVaults = fullConfig.allPrimaryVaults.filter(v => (v.mode || 'work') === mode);
  const secondaryVaults = fullConfig.allSecondaryVaults.filter(v => (v.mode || 'work') === mode);

  // If no primary vault for this mode, throw an error
  if (primaryVaults.length === 0) {
    throw new Error(`No primary vault configured for mode: ${mode}`);
  }

  return {
    primaryVault: primaryVaults[0], // First primary vault for this mode
    secondaryVaults: secondaryVaults,
  };
}

/**
 * Load configuration for the current mode
 * This is the main entry point - backwards compatible with existing code
 */
function loadConfig(): ServerConfig {
  if (!fullConfig) {
    fullConfig = loadFullConfig();
  }
  return getConfigForMode(currentMode);
}

const CONFIG = loadConfig();
const VAULT_PATH = CONFIG.primaryVault.path; // Keep for backward compatibility

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
  confidenceThreshold: number; // Score above which to skip semantic re-ranking (0-1)
  precomputeEmbeddings: boolean; // Whether to pre-compute embeddings on startup
  enableSmartSearch: boolean; // Whether to use heuristic query analysis for semantic search optimization
}

interface EmbeddingToggleConfig {
  enabled: boolean;
  lastModified: string;
}

// Response detail levels for tiered responses
enum ResponseDetail {
  MINIMAL = 'minimal', // IDs, titles, counts only
  SUMMARY = 'summary', // + brief snippets (default)
  DETAILED = 'detailed', // + extended context
  FULL = 'full', // Complete content
}

class ObsidianMCPServer {
  private server: Server;
  private config: ServerConfig;
  private currentSessionId: string | null = null;
  private currentSessionFile: string | null = null;
  // Limit file access tracking to prevent unbounded memory growth
  // 5000 entries is sufficient for session tracking while keeping memory bounded
  private static readonly MAX_FILES_ACCESSED = 5000;
  private filesAccessed: Array<{
    path: string;
    action: 'read' | 'edit' | 'create';
    timestamp: string;
  }> = [];
  // Track content created during conversation (for lazy session creation)
  private topicsCreated: Array<{ slug: string; title: string; file: string }> = [];
  private decisionsCreated: Array<{ slug: string; title: string; file: string }> = [];
  private projectsCreated: Array<{ slug: string; name: string; file: string }> = [];
  // Explicit session start time (set when get_memory_base is called)
  private sessionStartTime: Date | null = null;
  // Track if Phase 1 analysis has completed to prevent loop bug
  private phase1Completed: boolean = false;
  private embeddingConfig: EmbeddingConfig;
  // LRU cache with 2000 entry limit (~6MB for embeddings at 384 dimensions × 4 bytes × 2000)
  // Prevents unbounded memory growth during heavy search sessions
  private embeddingCache: LRUCache<string, EmbeddingCacheEntry> = new LRUCache({
    maxSize: 2000,
  });
  private extractor: any = null;
  private embeddingInitPromise: Promise<void> | null = null;
  private embeddingToggleFile: string = '';
  private gitService: GitService;
  private indexBuilders: Map<string, IndexBuilder> = new Map(); // Per-vault index builders
  private indexedSearches: Map<string, IndexedSearch> = new Map(); // Per-vault indexed searches

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
    cacheDirs.set(
      this.config.primaryVault.path,
      path.join(this.config.primaryVault.path, '.embedding-cache')
    );
    // Secondary vaults cache
    for (const vault of this.config.secondaryVaults) {
      cacheDirs.set(vault.path, path.join(vault.path, '.embedding-cache'));
    }

    this.embeddingToggleFile = path.join(this.config.primaryVault.path, '.embedding-toggle.json');

    // Try to load embedding state from toggle file, fallback to env var
    this.embeddingConfig = {
      enabled: this.loadEmbeddingToggleState(),
      modelName: 'Xenova/all-MiniLM-L6-v2',
      cacheDirs: cacheDirs,
      keywordCandidatesLimit: parseInt(process.env.EMBEDDING_CANDIDATES_LIMIT || '100', 10),
      confidenceThreshold: parseFloat(process.env.EMBEDDING_CONFIDENCE_THRESHOLD || '0.75'),
      precomputeEmbeddings: process.env.EMBEDDING_PRECOMPUTE !== 'false',
      enableSmartSearch: process.env.ENABLE_SMART_SEARCH !== 'false', // Default: enabled
    };

    // Initialize GitService
    this.gitService = new GitService();

    // Initialize IndexBuilder and IndexedSearch for each vault if enabled
    if (DEFAULT_INDEX_CONFIG.enabled) {
      logger.info('Initializing search indexes for vaults...');

      // Build vault authorities map for all vaults
      const vaultAuthorities = this.buildVaultAuthoritiesMap();

      // Primary vault
      const primaryCacheDir = path.join(
        this.config.primaryVault.path,
        DEFAULT_INDEX_CONFIG.cacheDir
      );
      const primaryBuilder = new IndexBuilder(primaryCacheDir);
      logger.info('Primary vault initialized', {
        name: this.config.primaryVault.name,
        path: this.config.primaryVault.path,
      });
      this.indexBuilders.set(this.config.primaryVault.path, primaryBuilder);
      this.indexedSearches.set(
        this.config.primaryVault.path,
        new IndexedSearch(primaryBuilder, primaryCacheDir, vaultAuthorities)
      );

      // Secondary vaults
      for (const vault of this.config.secondaryVaults) {
        const cacheDir = path.join(vault.path, DEFAULT_INDEX_CONFIG.cacheDir);
        const builder = new IndexBuilder(cacheDir);
        logger.info('Secondary vault initialized', { name: vault.name, path: vault.path });
        this.indexBuilders.set(vault.path, builder);
        this.indexedSearches.set(
          vault.path,
          new IndexedSearch(builder, cacheDir, vaultAuthorities)
        );
      }

      logger.debug('IndexBuilder and IndexedSearch maps initialized', {
        indexBuilders: Array.from(this.indexBuilders.keys()),
        indexedSearches: Array.from(this.indexedSearches.keys()),
      });
    }

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = error => {
      logger.error('MCP Error', error instanceof Error ? error : new Error(String(error)));
    };

    process.on('SIGINT', () => {
      // With lazy session creation, we don't need to close sessions on SIGINT
      // Sessions are only created when user explicitly runs /close
      void this.server.close().then(() => process.exit(0));
    });
  }

  // Helper methods for vault management
  private getAllVaults(): VaultConfig[] {
    return [this.config.primaryVault, ...this.config.secondaryVaults];
  }

  private getPrimaryVaultPath(): string {
    return this.config.primaryVault.path;
  }

  /**
   * Build a map of vault names to their authority levels
   * Used for search ranking to prioritize curated content
   *
   * @returns Map of vault name to authority level
   */
  private buildVaultAuthoritiesMap(): Map<string, VaultAuthority> {
    const authorities = new Map<string, VaultAuthority>();

    // Add primary vault
    const primaryAuthority = this.config.primaryVault.authority || 'default';
    authorities.set(this.config.primaryVault.name, primaryAuthority);

    // Add secondary vaults
    for (const vault of this.config.secondaryVaults) {
      const authority = vault.authority || 'default';
      authorities.set(vault.name, authority);
    }

    return authorities;
  }

  /**
   * Switch to a different vault mode and reinitialize vault-dependent structures
   *
   * @param mode - The mode to switch to ('work' or 'personal')
   * @returns Result object with success status and message
   */
  private switchMode(mode: VaultMode): {
    success: boolean;
    message: string;
    previousMode: VaultMode;
    currentMode: VaultMode;
  } {
    const previousMode = currentMode;

    // Check if mode switching is supported
    if (!isModeSupported()) {
      return {
        success: false,
        message:
          'Mode switching is not available. Your configuration uses the legacy format. To enable mode switching, update your .obsidian-mcp.json to use the primaryVaults[] array format with mode properties.',
        previousMode,
        currentMode: previousMode,
      };
    }

    // Check if the requested mode is available
    const availableModes = getAvailableModes();
    if (!availableModes.includes(mode)) {
      return {
        success: false,
        message: `Mode "${mode}" is not configured. Available modes: ${availableModes.join(', ')}`,
        previousMode,
        currentMode: previousMode,
      };
    }

    // If already in the requested mode, return early
    if (mode === previousMode) {
      return {
        success: true,
        message: `Already in ${mode} mode.`,
        previousMode,
        currentMode: mode,
      };
    }

    // Update the global mode
    currentMode = mode;

    // Get the new configuration for this mode
    try {
      this.config = getConfigForMode(mode);
    } catch (error) {
      // Rollback on failure
      currentMode = previousMode;
      return {
        success: false,
        message: `Failed to switch to ${mode} mode: ${error instanceof Error ? error.message : String(error)}`,
        previousMode,
        currentMode: previousMode,
      };
    }

    // Reinitialize embedding config with new vault paths
    const cacheDirs = new Map<string, string>();
    cacheDirs.set(
      this.config.primaryVault.path,
      path.join(this.config.primaryVault.path, '.embedding-cache')
    );
    for (const vault of this.config.secondaryVaults) {
      cacheDirs.set(vault.path, path.join(vault.path, '.embedding-cache'));
    }
    this.embeddingConfig.cacheDirs = cacheDirs;
    this.embeddingToggleFile = path.join(this.config.primaryVault.path, '.embedding-toggle.json');

    // Clear embedding cache (will be repopulated as needed)
    this.embeddingCache.clear();

    // Reinitialize index builders and indexed searches for new vaults
    this.indexBuilders.clear();
    this.indexedSearches.clear();

    if (DEFAULT_INDEX_CONFIG.enabled) {
      const vaultAuthorities = this.buildVaultAuthoritiesMap();

      // Primary vault
      const primaryCacheDir = path.join(
        this.config.primaryVault.path,
        DEFAULT_INDEX_CONFIG.cacheDir
      );
      const primaryBuilder = new IndexBuilder(primaryCacheDir);
      this.indexBuilders.set(this.config.primaryVault.path, primaryBuilder);
      this.indexedSearches.set(
        this.config.primaryVault.path,
        new IndexedSearch(primaryBuilder, primaryCacheDir, vaultAuthorities)
      );

      // Secondary vaults
      for (const vault of this.config.secondaryVaults) {
        const cacheDir = path.join(vault.path, DEFAULT_INDEX_CONFIG.cacheDir);
        const builder = new IndexBuilder(cacheDir);
        this.indexBuilders.set(vault.path, builder);
        this.indexedSearches.set(
          vault.path,
          new IndexedSearch(builder, cacheDir, vaultAuthorities)
        );
      }
    }

    logger.info('Mode switched', {
      previousMode,
      currentMode: mode,
      primaryVault: this.config.primaryVault.name,
      secondaryVaults: this.config.secondaryVaults.length,
    });

    return {
      success: true,
      message: `Switched from ${previousMode} mode to ${mode} mode. Now using ${this.config.primaryVault.name} as primary vault.`,
      previousMode,
      currentMode: mode,
    };
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      const { name, arguments: args } = request.params;

      try {
        // Validate tool arguments using Zod schemas
        // This provides runtime type safety and helpful error messages
        const validatedArgs = validateToolArgs(name as any, args);

        // Set session start time on first tool call if not already set
        // This ensures Phase 1 of two-phase close workflow has a valid start time
        // even if /mb is not explicitly run at session start
        if (!this.sessionStartTime) {
          this.sessionStartTime = new Date();
        }

        switch (name) {
          case 'search_vault':
            return await tools.searchVault(validatedArgs as tools.SearchVaultArgs, {
              vaultPath: this.config.primaryVault.path,
              config: this.config,
              embeddingConfig: this.embeddingConfig,
              indexedSearches: this.indexedSearches,
              indexBuilders: this.indexBuilders,
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
              trackTopicCreation: topic => this.topicsCreated.push(topic),
              trackFileAccess: this.trackFileAccess.bind(this),
              searchVault: this.searchVaultWrapper.bind(this),
            });

          case 'create_decision':
            return await tools.createDecision(validatedArgs as tools.CreateDecisionArgs, {
              vaultPath: this.config.primaryVault.path,
              currentSessionId: this.currentSessionId,
              slugify: this.slugify.bind(this),
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              findRelatedContentInText: this.findRelatedContentInText.bind(this),
              trackDecisionCreation: decision => this.decisionsCreated.push(decision),
              getRemoteUrl: (repoPath: string) => this.gitService.getRemoteUrl(repoPath),
              trackFileAccess: this.trackFileAccess.bind(this),
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

          case 'analyze_session_commits':
            return await tools.analyzeSessionCommits(
              validatedArgs as tools.AnalyzeSessionCommitsArgs,
              {
                vaultPath: this.config.primaryVault.path,
                filesAccessed: this.filesAccessed,
                findGitRepos: this.findGitRepos.bind(this),
                getRepoInfo: this.getRepoInfo.bind(this),
                analyzeCommitImpact: this.analyzeCommitImpactWrapper.bind(this),
                getSessionStartTime: this.getSessionStartTime.bind(this),
              }
            );

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
              recordCommit: this.recordCommitWrapper.bind(this),
              analyzeCommitImpact: this.analyzeCommitImpactWrapper.bind(this),
              updateDocument: this.updateDocumentWrapper.bind(this),
              slugify: this.slugify.bind(this),
              setCurrentSession: this.setCurrentSession.bind(this),
              clearSessionState: this.clearSessionState.bind(this),
              hasPhase1Completed: this.hasPhase1Completed.bind(this),
              markPhase1Complete: this.markPhase1Complete.bind(this),
              getMostRecentSessionDate: this.getMostRecentSessionDate.bind(this),
              getSessionStartTime: this.getSessionStartTime.bind(this),
              searchVault: this.searchVaultWrapper.bind(this),
            });

          case 'find_stale_topics':
            return await tools.findStaleTopics(validatedArgs as tools.FindStaleTopicsArgs, {
              vaultPath: this.config.primaryVault.path,
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              getFileAgeDays: this.getFileAgeDays.bind(this),
              slugify: this.slugify.bind(this),
              archiveTopic: async (args: tools.ArchiveTopicArgs) =>
                await tools.archiveTopic(args, {
                  vaultPath: this.config.primaryVault.path,
                  slugify: this.slugify.bind(this),
                  ensureVaultStructure: this.ensureVaultStructure.bind(this),
                }),
            });

          case 'submit_topic_reviews':
            return tools.submitTopicReviews(validatedArgs as tools.SubmitTopicReviewsArgs, {
              vaultPath: this.config.primaryVault.path,
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
            return tools.trackFileAccess(validatedArgs as tools.TrackFileAccessArgs, {
              filesAccessed: this.filesAccessed,
            });

          case 'detect_session_repositories':
            return await tools.detectSessionRepositories(
              validatedArgs as tools.DetectSessionRepositoriesArgs,
              {
                currentSessionId: this.currentSessionId,
                filesAccessed: this.filesAccessed,
                findGitRepos: this.findGitRepos.bind(this),
                getRepoInfo: this.getRepoInfo.bind(this),
              }
            );

          case 'link_session_to_repository':
            return await tools.linkSessionToRepository(
              validatedArgs as tools.LinkSessionToRepositoryArgs,
              {
                currentSessionFile: this.currentSessionFile,
                filesAccessed: this.filesAccessed,
                gitService: this.gitService,
                createProjectPage: this.createProjectPageWrapper.bind(this),
              }
            );

          case 'create_project_page':
            return await tools.createProjectPage(validatedArgs as tools.CreateProjectPageArgs, {
              vaultPath: this.config.primaryVault.path,
              gitService: this.gitService,
              trackProjectCreation: project => this.projectsCreated.push(project),
            });

          case 'record_commit':
            return await tools.recordCommit(validatedArgs as tools.RecordCommitArgs, {
              vaultPath: this.config.primaryVault.path,
              gitService: this.gitService,
              currentSessionId: this.currentSessionId,
              currentSessionFile: this.currentSessionFile,
            });

          case 'toggle_embeddings':
            return await tools.toggleEmbeddings(validatedArgs as tools.ToggleEmbeddingsArgs, {
              embeddingConfig: this.embeddingConfig,
              embeddingToggleFile: this.embeddingToggleFile,
              embeddingCache: this.embeddingCache,
              setExtractor: extractor => {
                this.extractor = extractor;
              },
              setEmbeddingInitPromise: promise => {
                this.embeddingInitPromise = promise;
              },
            });

          case 'vault_custodian':
            return await tools.vaultCustodian(validatedArgs as tools.VaultCustodianArgs, {
              vaultPath: this.config.primaryVault.path,
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
              findSessionFile: this.findSessionFile.bind(this),
              secondaryVaults: this.config.secondaryVaults.map(v => ({
                path: v.path,
                name: v.name,
              })),
            });

          case 'analyze_topic_content':
            return await tools.analyzeTopicContent(validatedArgs as tools.AnalyzeTopicContentArgs, {
              searchVault: this.searchVaultWrapper.bind(this),
            });

          case 'analyze_commit_impact':
            return await tools.analyzeCommitImpact(validatedArgs as tools.AnalyzeCommitImpactArgs, {
              vaultPath: this.config.primaryVault.path,
              gitService: this.gitService,
              searchVault: this.searchVaultWrapper.bind(this),
            });

          case 'get_memory_base':
            // Clear session state when memory base is loaded (signals new session start)
            // This ensures filesAccessed array is fresh for Phase 1 commit detection
            this.clearSessionState();
            // Set explicit session start time for two-phase /close workflow
            this.sessionStartTime = new Date();
            return await tools.getMemoryBase(
              validatedArgs as tools.GetMemoryBaseArgs,
              this.config.primaryVault.path,
              { sessionStartTime: this.sessionStartTime }
            );

          case 'append_to_accumulator':
            return await tools.appendToAccumulator(validatedArgs as tools.AppendToAccumulatorArgs, {
              vaultPath: this.config.primaryVault.path,
              trackFileAccess: this.trackFileAccess.bind(this),
            });

          case 'get_tasks_by_date':
            return await tools.getTasksByDate(
              validatedArgs as tools.GetTasksByDateArgs,
              this.config.primaryVault.path
            );

          case 'add_task':
            return await tools.addTask(
              validatedArgs as tools.AddTaskArgs,
              this.config.primaryVault.path
            );

          case 'complete_task':
            return await tools.completeTask(
              validatedArgs as tools.CompleteTaskArgs,
              this.config.primaryVault.path
            );

          case 'update_document':
            return await tools.updateDocument(validatedArgs as tools.UpdateDocumentArgs, {
              vaultPath: this.config.primaryVault.path,
              slugify: this.slugify.bind(this),
              trackFileAccess: this.trackFileAccess.bind(this),
              secondaryVaults: this.config.secondaryVaults.map(v => ({
                path: v.path,
                name: v.name,
              })),
              ensureVaultStructure: this.ensureVaultStructure.bind(this),
            });

          case 'code_file':
            return await tools.codeFile(validatedArgs as tools.CodeFileArgs, {
              vaultPath: this.config.primaryVault.path,
              secondaryVaults: this.config.secondaryVaults.map(v => ({
                path: v.path,
                name: v.name,
              })),
              trackFileAccess: this.trackFileAccess.bind(this),
            });

          case 'switch_mode': {
            const { mode } = validatedArgs as { mode: VaultMode };
            const result = this.switchMode(mode);

            // Format response
            let responseText = result.message;
            if (result.success) {
              responseText += `\n\n**Current Mode:** ${result.currentMode}`;
              responseText += `\n**Primary Vault:** ${this.config.primaryVault.name}`;
              if (this.config.secondaryVaults.length > 0) {
                responseText += `\n**Secondary Vaults:** ${this.config.secondaryVaults.map(v => v.name).join(', ')}`;
              }
            }

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'get_current_mode': {
            const modeSupported = isModeSupported();
            const availableModes = getAvailableModes();

            let responseText = `**Current Mode:** ${getCurrentMode()}`;
            if (modeSupported) {
              responseText += `\n**Available Modes:** ${availableModes.join(', ')}`;
            } else {
              responseText += `\n\n*Mode switching is not available. Your configuration uses the legacy format.*`;
            }
            responseText += `\n\n**Active Vaults:**`;
            responseText += `\n- Primary: ${this.config.primaryVault.name} (${this.config.primaryVault.path})`;
            for (const vault of this.config.secondaryVaults) {
              responseText += `\n- Secondary: ${vault.name} (${vault.path})`;
            }

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

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
        logger.error(
          'Failed to initialize embedding extractor',
          error instanceof Error ? error : new Error(String(error))
        );
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

      // Convert to array if needed - result type varies by transformers.js version
      let embedding: number[];
      if (result.data) {
        embedding = Array.from(result.data as ArrayLike<number>);
      } else if (Array.isArray(result)) {
        const arr = result as unknown[];
        embedding = arr[0]
          ? Array.from(arr[0] as ArrayLike<number>)
          : Array.from(arr as unknown as ArrayLike<number>);
      } else {
        embedding = Array.from(result as ArrayLike<number>);
      }
      return embedding;
    } catch (error) {
      logger.error(
        'Failed to generate embedding',
        error instanceof Error ? error : new Error(String(error))
      );
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
    // Sort by timestamp so newest entries are loaded last (preserved by LRU)
    const allEntries: Array<{ key: string; entry: EmbeddingCacheEntry; timestamp: number }> = [];

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
          allEntries.push({
            key: absolutePath,
            entry: cacheEntry,
            timestamp: entry.timestamp,
          });
        }
      } catch {
        // Cache file doesn't exist for this vault yet, which is fine
      }
    }

    // Sort by timestamp (oldest first) so newest entries end up as "most recently used"
    allEntries.sort((a, b) => a.timestamp - b.timestamp);

    // Load into LRU cache (will auto-evict if over limit)
    for (const { key, entry, timestamp } of allEntries) {
      this.embeddingCache.setWithTimestamp(key, entry, timestamp * 1000); // Convert to ms
    }

    const stats = this.embeddingCache.getStats();
    logger.info('Loaded cached embeddings', { size: stats.size, maxSize: stats.maxSize });
  }

  private async saveEmbeddingCache(): Promise<void> {
    if (!this.embeddingConfig.enabled) {
      return;
    }

    // Group cache entries by vault
    const entriesByVault = new Map<string, EmbeddingCacheEntry[]>();

    for (const [absolutePath, entry] of this.embeddingCache.entries()) {
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
        logger.error(
          `Failed to save embedding cache for vault ${vaultPath}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }

    const stats = this.embeddingCache.getStats();
    logger.info('Saved embeddings to cache', { size: stats.size });
  }

  private getCachedEmbedding(file: string, fileStats: any): number[] | null {
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

  private async getOrCreateEmbedding(
    file: string,
    content: string,
    fileStats: any
  ): Promise<number[]> {
    // Try to get from cache
    const cached = this.getCachedEmbedding(file, fileStats);
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
      if (fssync.existsSync(this.embeddingToggleFile)) {
        const data = fssync.readFileSync(this.embeddingToggleFile, 'utf-8');
        const config: EmbeddingToggleConfig = JSON.parse(data);
        return config.enabled;
      }
    } catch (_error) {
      // Fall through to env var
    }

    // Fall back to environment variable (default: enabled)
    return process.env.ENABLE_EMBEDDINGS !== 'false';
  }

  /**
   * Pre-compute embeddings for all vault files on startup
   * This ensures fast search performance on first query
   */
  private async precomputeAllEmbeddings(): Promise<void> {
    await this.loadEmbeddingCache();

    const vaults = this.getAllVaults();
    let filesProcessed = 0;
    let filesSkipped = 0;

    for (const vault of vaults) {
      const searchDirs =
        vault.path === this.config.primaryVault.path ? ['sessions', 'topics', 'decisions'] : []; // Search everything in secondary vaults

      try {
        // Recursively find all markdown files
        const mdFiles = await this.findAllMarkdownFiles(
          vault.path,
          searchDirs,
          vault.path === this.config.primaryVault.path
        );

        for (const filePath of mdFiles) {
          try {
            // Check if already cached and up to date
            const fileStats = await fs.stat(filePath);
            const cached = this.getCachedEmbedding(filePath, fileStats);

            if (cached) {
              filesSkipped++;
              continue;
            }

            // Generate and cache embedding
            const content = await fs.readFile(filePath, 'utf-8');
            await this.getOrCreateEmbedding(filePath, content, fileStats);
            filesProcessed++;

            // Log progress every 10 files
            if (filesProcessed % 10 === 0) {
              logger.debug('Pre-computing embeddings progress', { filesProcessed });
            }
          } catch (err) {
            logger.error(
              `Error processing file ${filePath}`,
              err instanceof Error ? err : new Error(String(err))
            );
          }
        }
      } catch (err) {
        logger.error(
          `Error pre-computing embeddings for vault ${vault.name}`,
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }

    // Save all computed embeddings
    await this.saveEmbeddingCache();

    logger.info('Pre-computation complete', { filesProcessed, filesSkipped });
  }

  /**
   * Recursively find all markdown files in a directory
   */
  private async findAllMarkdownFiles(
    dirPath: string,
    searchDirs: string[],
    isPartialSearch: boolean
  ): Promise<string[]> {
    const files: string[] = [];

    const searchDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip ignored directories
          if (entry.isDirectory()) {
            if (
              ['.git', 'node_modules', '.DS_Store', '.obsidian', '.embedding-cache'].includes(
                entry.name
              )
            ) {
              continue;
            }

            // Handle month subdirectories (YYYY-MM format) for sessions
            if (/^\d{4}-\d{2}$/.test(entry.name)) {
              const monthFiles = await fs.readdir(fullPath);
              for (const file of monthFiles) {
                if (file.endsWith('.md')) {
                  files.push(path.join(fullPath, file));
                }
              }
            } else {
              // Recursively search subdirectories
              await searchDir(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      } catch (_error) {
        // Directory doesn't exist or can't be accessed
      }
    };

    if (isPartialSearch && searchDirs.length > 0) {
      // Only search specific directories
      for (const dir of searchDirs) {
        const dirPath2 = path.join(dirPath, dir);
        await searchDir(dirPath2);
      }
    } else {
      // Search entire vault
      await searchDir(dirPath);
    }

    return files;
  }

  // ==================== End Embedding Methods ====================

  private getTools(): Tool[] {
    return [
      {
        name: 'search_vault',
        description:
          'Search the Obsidian vault for relevant notes and context. Returns ranked results with snippets. Use get_session_context to read full files.',
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
            category: {
              type: 'string',
              enum: ['topic', 'task-list', 'decision', 'session', 'project', 'commit'],
              description: 'Optional: filter by document category (from frontmatter)',
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
              description:
                'If true, return condensed snippets instead of full matches (default: true)',
              default: true,
            },
            detail: {
              type: 'string',
              enum: ['minimal', 'summary', 'detailed', 'full'],
              description:
                'Response detail level. minimal: files only, summary: + snippets (default), detailed: + extended context, full: complete matches',
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
              description:
                'Auto-analyze content for tags and metadata. false (default): generic tags, true: always analyze, "smart": analyze if content >500 words and no existing tags',
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

SCOPE: Decisions can be vault-level (affecting the MCP system itself) or project-specific (affecting a particular codebase). Use repo_path to auto-generate a collision-resistant project slug. If neither repo_path nor project is specified, decision is created as vault-level.`,
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
            repo_path: {
              type: 'string',
              description:
                'Absolute path to Git repository. Auto-generates collision-resistant project slug from remote URL (e.g., "uoregon-jsdev-obsidian-mcp-server"). Preferred over project parameter.',
            },
            project: {
              type: 'string',
              description:
                'Manual project slug override. Deprecated: prefer repo_path for automatic slug generation to prevent collisions.',
            },
            force: {
              type: 'boolean',
              description:
                'Set to true to bypass keyword detection warnings. Use when title contains implementation keywords but the decision is genuinely strategic (e.g., "Implement Feature X: considered approach A vs B, chose B")',
            },
          },
          required: ['title', 'content'],
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
        description:
          'Load full topic content when you need complete, authoritative information. Topics are living documents that represent the gold standard for their subject matter.\n\n**When to use:**\n- You need detailed, comprehensive understanding of a concept\n- Search snippets are insufficient or incomplete\n- User asks for in-depth explanation\n- Multiple follow-up questions are expected\n\n**When NOT to use:**\n- Quick factual lookup (use search snippets instead)\n- Topic would be very large but you only need a small detail\n- One-off questions where snippets suffice\n\n**Best practice:** Search first to identify relevant topics, then load the full topic for authoritative reference.',
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
        name: 'analyze_session_commits',
        description:
          'Analyze commits made during the current session to identify documentation that may need updating. This is a read-only analysis tool that helps prevent documentation drift by proactively identifying topics, decisions, and other documentation that should be updated based on code changes.\n\n**When to use:**\n- Before running /close to see what commits were made\n- To get suggestions for which documentation needs updating\n- To understand the impact of code changes on existing documentation\n\n**Workflow:**\n1. Make commits during your session\n2. Call analyze_session_commits to see commit analysis\n3. Update affected topics/decisions using update_document\n4. Call /close to finalize the session\n\n**Note:** This tool does not modify any files. It only analyzes and provides suggestions.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'close_session',
        description:
          'Create a session retroactively to capture the work done in this conversation. ONLY callable via the /close slash command. Call this at the end of a conversation to persist the session to the vault.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description:
                'A summary of what was accomplished in this conversation. This will be the main content of the session file.',
            },
            topic: {
              type: 'string',
              description:
                'Optional topic or title for this session (will be slugified for the filename)',
            },
            handoff: {
              type: 'string',
              description:
                'Optional handoff notes for the next session - unfinished business, queued questions, context needed for continuity. Be verbose - these notes improve cross-session continuity.',
            },
            _invoked_by_slash_command: {
              type: 'boolean',
              description:
                'Internal parameter - must be true to invoke this tool. Only set by slash commands.',
              default: false,
            },
            finalize: {
              type: 'boolean',
              description:
                'Phase 2 flag: Set to true to finalize the session after documentation updates. Requires session_data from Phase 1.',
              default: false,
            },
            session_data: {
              type: 'object',
              description:
                'Session state from Phase 1. Required when finalize=true. Contains session ID, file path, and metadata needed for finalization.',
            },
            skip_analysis: {
              type: 'boolean',
              description: 'Skip commit analysis and go straight to single-phase finalization.',
              default: false,
            },
            working_directories: {
              type: 'array',
              items: { type: 'string' },
              description:
                "Claude Code's working directories. The MCP server runs as a separate process with a different cwd, " +
                "so passing Claude Code's working directories enables correct Git repository detection.",
            },
            session_start_override: {
              type: 'string',
              description:
                'ISO 8601 timestamp of session start. Fallback if MCP server state was lost. ' +
                'Extract from context (SESSION_START_TIME: ...) emitted by /mb.',
            },
          },
          required: ['summary'],
        },
      },
      {
        name: 'find_stale_topics',
        description:
          "Find topics that haven't been reviewed recently (>30 days), automatically archive obsolete ones using Decision 038 relevance assessment, and return remaining stale topics for manual review. Processes top 10 oldest topics.",
        inputSchema: {
          type: 'object',
          properties: {
            age_threshold_days: {
              type: 'number',
              description:
                'Number of days since creation or last review to consider a topic stale (default: 30)',
              default: 30,
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
        name: 'submit_topic_reviews',
        description:
          'Submit structured topic review assessments with validation to detect rubber-stamping and ensure meaningful quality review. Enforces critical review workflow through tool architecture (Decision 033 principle). Returns validation errors if all topics marked as "current" without justification or if required notes are missing.',
        inputSchema: {
          type: 'object',
          properties: {
            reviews: {
              type: 'array',
              description: 'Array of structured assessments for each topic reviewed',
              items: {
                type: 'object',
                properties: {
                  topic_slug: {
                    type: 'string',
                    description: 'Topic slug (filename without .md)',
                  },
                  technical_accuracy: {
                    type: 'string',
                    enum: ['verified', 'outdated', 'needs_check'],
                    description: 'Technical accuracy assessment',
                  },
                  technical_accuracy_notes: {
                    type: 'string',
                    description: 'Required if outdated or needs_check',
                  },
                  completeness: {
                    type: 'string',
                    enum: ['comprehensive', 'needs_expansion', 'adequate'],
                    description: 'Completeness assessment',
                  },
                  completeness_notes: {
                    type: 'string',
                    description: 'Required if needs_expansion',
                  },
                  organization: {
                    type: 'string',
                    enum: ['excellent', 'needs_improvement', 'poor'],
                    description: 'Organization assessment',
                  },
                  organization_notes: {
                    type: 'string',
                    description: 'Required if needs_improvement or poor',
                  },
                  redundancy_check: {
                    type: 'string',
                    enum: ['no_duplicates', 'consolidate_with', 'not_checked'],
                    description: 'Redundancy/consolidation check',
                  },
                  consolidate_with_topic: {
                    type: 'string',
                    description: 'Required if consolidate_with selected',
                  },
                  outcome: {
                    type: 'string',
                    enum: ['current', 'expand', 'reorganize', 'consolidate', 'archive'],
                    description: 'Final review outcome',
                  },
                  issues_found: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Issues discovered during review (broken links, outdated info, etc.)',
                  },
                  updates_needed: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Updates needed (add examples, fix organization, etc.)',
                  },
                },
                required: [
                  'topic_slug',
                  'technical_accuracy',
                  'completeness',
                  'organization',
                  'redundancy_check',
                  'outcome',
                  'issues_found',
                  'updates_needed',
                ],
              },
            },
          },
          required: ['reviews'],
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
        description:
          'List the most recent conversation sessions. Returns session metadata including ID, topic, date, and status.',
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
              description:
                'Response detail level. minimal: IDs only, summary: + date/status (default), detailed: + files/commits, full: + summaries',
              default: 'summary',
            },
            _invoked_by_slash_command: {
              type: 'boolean',
              description:
                'Internal parameter - must be true to invoke this tool. Only set by slash commands.',
              default: false,
            },
          },
        },
      },
      {
        name: 'list_recent_projects',
        description:
          'List the most recent projects. Returns project metadata including name, repository path, creation date, and activity.',
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
              description:
                'Response detail level. minimal: names only, summary: + paths/dates (default), detailed: + recent commits, full: + full project pages',
              default: 'summary',
            },
            _invoked_by_slash_command: {
              type: 'boolean',
              description:
                'Internal parameter - must be true to invoke this tool. Only set by slash commands.',
              default: false,
            },
          },
        },
      },
      {
        name: 'track_file_access',
        description:
          'Track a file that was accessed during the session. Used to help detect relevant Git repositories.',
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
        description:
          'Analyze the current session to detect relevant Git repositories based on files accessed and session context.',
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
        description:
          'Create or update a project page in the Obsidian vault for tracking a Git repository.',
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
        description:
          'Record a Git commit in the Obsidian vault, creating a commit page with diff and session links.',
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
        description:
          'Toggle the embedding cache on or off. Embeddings are used for semantic search in search_vault. Easily toggle without restarting the server.',
        inputSchema: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              description:
                'Optional: true to enable, false to disable. If not provided, toggles current state.',
            },
          },
        },
      },
      {
        name: 'vault_custodian',
        description:
          'Verify vault integrity by checking file organization, validating links, and reorganizing/relinking files as necessary. Ensures all files are in logical locations and properly connected. Can optionally be scoped to only check specific files.',
        inputSchema: {
          type: 'object',
          properties: {
            files_to_check: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional: Array of absolute file paths to check. If not provided, checks all vault files.',
            },
          },
        },
      },
      {
        name: 'analyze_topic_content',
        description:
          'Analyze topic content using AI to generate tags, summary, find related topics, and detect duplicates. Returns structured analysis that can be used to enhance topic creation.',
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
        name: 'analyze_commit_impact',
        description:
          'Analyze a Git commit to understand what changed, generate human-readable summaries, and identify related topics/decisions. Provides impact analysis for documentation updates.',
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
      {
        name: 'get_memory_base',
        description:
          'Load session context at startup including: system directives, user reference, recent session handoffs (last 2-3 sessions), recent corrections (last 2 mistake/correction pairs), and vault index. Used for session initialization and establishing timing for commit detection. Provides orientation context with recent continuity information.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'append_to_accumulator',
        description:
          "Append content to accumulator files - running logs that preserve context across sessions. Accumulators are append-only to prevent accidental overwrites. Primary use: accumulator-corrections.md for recording mistakes and corrections to prevent repeating errors. Pattern: MISTAKE → CONSEQUENCE → ROOT CAUSE → CORRECTION → PATTERN → REFERENCE. Creates the accumulator file if it doesn't exist.",
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              pattern: '^accumulator-.+\\.md$',
              description:
                'Accumulator filename (must match pattern: accumulator-{name}.md). Primary use: accumulator-corrections.md for recording mistakes and corrections.',
            },
            content: {
              type: 'string',
              description: 'Content to append to the accumulator',
            },
            add_timestamp: {
              type: 'boolean',
              description: 'Add timestamp to entry (default: true)',
              default: true,
            },
          },
          required: ['filename', 'content'],
        },
      },
      {
        name: 'get_tasks_by_date',
        description:
          'Query and aggregate tasks across all task lists by date. Automatically reads all active task list files (category: task-list, tags: active) and returns tasks due on specified date.',
        inputSchema: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description:
                'Date to query tasks for. Accepts: "today", "tomorrow", "this-week", or YYYY-MM-DD format',
            },
            status: {
              type: 'string',
              enum: ['incomplete', 'complete', 'all'],
              description: 'Filter by task status (default: incomplete)',
            },
            project: {
              type: 'string',
              description: 'Optional: filter tasks by project slug',
            },
          },
          required: ['date'],
        },
      },
      {
        name: 'add_task',
        description:
          "Add a task to appropriate task list with automatic list selection. Creates task list if it doesn't exist (like update_user_reference creates user-reference.md). Auto-selects list based on project/context/date.",
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Task description',
            },
            due: {
              type: 'string',
              description:
                'When task is due. Accepts: "today", "tomorrow", "this-week", or YYYY-MM-DD format',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Task priority',
            },
            project: {
              type: 'string',
              description: 'Project slug - will add task to {project}-tasks.md',
            },
            context: {
              type: 'string',
              enum: ['work', 'personal'],
              description: 'Task context - will add task to {context}-tasks.md',
            },
            list: {
              type: 'string',
              description: 'Override auto-selection with specific list name',
            },
          },
          required: ['task'],
        },
      },
      {
        name: 'complete_task',
        description:
          'Mark a task as complete across any task list. Automatically searches all active task lists, marks task complete ([ ] → [x]), moves to Completed section, and adds completion date.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Full or partial task description for fuzzy matching',
            },
            date: {
              type: 'string',
              description: 'Completion date in YYYY-MM-DD format (defaults to today)',
            },
          },
          required: ['task'],
        },
      },
      {
        name: 'update_document',
        description:
          'Unified type-aware document update tool for all vault file modifications. Automatically tracks file access (ensuring vault_custodian processes changes), enforces type-specific rules (read-only, append-only), and updates frontmatter metadata. Works for topics, decisions, projects, user-reference, accumulators, and task lists. ALWAYS use this instead of Edit/Write for vault files during Phase 1 documentation updates.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Absolute path to the document to update',
            },
            content: {
              type: 'string',
              description: 'New content to write or append',
            },
            strategy: {
              type: 'string',
              enum: ['append', 'replace', 'section-edit'],
              description:
                'Update strategy: append (add to end), replace (full replacement), section-edit (user-reference sections). Default: replace',
            },
            reason: {
              type: 'string',
              description:
                'Why updating (required for topics per Decision 011, optional for others). Used for audit trail in review_history.',
            },
          },
          required: ['file_path', 'content'],
        },
      },
      {
        name: 'code_file',
        description:
          'Edit or write non-vault code files with automatic file access tracking. Use this instead of native Edit/Write to ensure repository detection and vault_custodian processing. For vault files, use update_document instead.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Absolute path to the code file',
            },
            operation: {
              type: 'string',
              enum: ['edit', 'write'],
              description: 'Operation type: edit (search-replace) or write (create/overwrite)',
            },
            content: {
              type: 'string',
              description: 'For write: full file content. For edit: replacement text (new_string)',
            },
            old_string: {
              type: 'string',
              description: 'Required for edit: text to find and replace',
            },
          },
          required: ['file_path', 'operation', 'content'],
        },
      },
      {
        name: 'switch_mode',
        description:
          'Switch between work and personal vault modes. Each mode uses different vaults for complete context separation. Requires the new primaryVaults[] config format with mode properties. Default mode is "work".',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['work', 'personal'],
              description: 'The mode to switch to',
            },
          },
          required: ['mode'],
        },
      },
      {
        name: 'get_current_mode',
        description:
          'Get the current vault mode and list available modes. Shows which vaults are currently active.',
        inputSchema: {
          type: 'object',
          properties: {},
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
      await fs.writeFile(
        indexPath,
        `# Obsidian Vault Index

This vault contains context from Claude Code conversations.

## Structure
- **sessions/**: Individual conversation sessions
- **topics/**: Technical topics and concepts
- **decisions/**: Architectural decision records

## Recent Sessions
Check the sessions/ directory for recent conversations.
`
      );
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

  private async createProjectPageWrapper(args: { repo_path: string }): Promise<any> {
    return tools.createProjectPage(args as unknown as tools.CreateProjectPageArgs, {
      vaultPath: this.config.primaryVault.path,
      gitService: this.gitService,
      trackProjectCreation: project => this.projectsCreated.push(project),
    });
  }

  private async vaultCustodianWrapper(args: { files_to_check?: string[] }): Promise<any> {
    return tools.vaultCustodian(args as unknown as tools.VaultCustodianArgs, {
      vaultPath: this.config.primaryVault.path,
      ensureVaultStructure: this.ensureVaultStructure.bind(this),
      findSessionFile: this.findSessionFile.bind(this),
    });
  }

  private async searchVaultWrapper(args: {
    query: string;
    directories?: string[];
    max_results?: number;
    snippets_only?: boolean;
    category?: 'topic' | 'task-list' | 'decision' | 'session' | 'project' | 'commit';
  }): Promise<any> {
    return tools.searchVault(args as unknown as tools.SearchVaultArgs, {
      vaultPath: this.config.primaryVault.path,
      config: this.config,
      embeddingConfig: this.embeddingConfig,
      indexedSearches: this.indexedSearches,
      indexBuilders: this.indexBuilders,
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

  private async recordCommitWrapper(args: {
    repo_path: string;
    commit_hash: string;
  }): Promise<any> {
    return tools.recordCommit(args as unknown as tools.RecordCommitArgs, {
      vaultPath: this.config.primaryVault.path,
      gitService: this.gitService,
      currentSessionId: this.currentSessionId,
      currentSessionFile: this.currentSessionFile,
    });
  }

  private async analyzeCommitImpactWrapper(args: {
    repo_path: string;
    commit_hash: string;
    include_diff?: boolean;
  }): Promise<any> {
    return tools.analyzeCommitImpact(args as unknown as tools.AnalyzeCommitImpactArgs, {
      vaultPath: this.config.primaryVault.path,
      gitService: this.gitService,
      searchVault: this.searchVaultWrapper.bind(this),
    });
  }

  private async updateDocumentWrapper(args: {
    file_path: string;
    content: string;
    strategy?: 'append' | 'replace' | 'section-edit';
    reason?: string;
  }): Promise<any> {
    return tools.updateDocument(args as unknown as tools.UpdateDocumentArgs, {
      vaultPath: this.config.primaryVault.path,
      slugify: this.slugify.bind(this),
      trackFileAccess: this.trackFileAccess.bind(this),
      secondaryVaults: this.config.secondaryVaults.map(v => ({ path: v.path, name: v.name })),
      ensureVaultStructure: this.ensureVaultStructure.bind(this),
    });
  }

  private getSessionStartTime(): Date | null {
    // Prefer explicit session start time (set when get_memory_base is called)
    if (this.sessionStartTime) {
      return this.sessionStartTime;
    }
    // Fallback to first file access timestamp for backwards compatibility
    if (this.filesAccessed.length > 0) {
      const firstAccess = this.filesAccessed[0];
      return new Date(firstAccess.timestamp);
    }
    return null;
  }

  private async getMostRecentSessionDate(repoSlug: string): Promise<Date | null> {
    try {
      const projectPath = path.join(this.config.primaryVault.path, 'projects', repoSlug);
      const projectFile = path.join(projectPath, 'project.md');

      // Check if project file exists
      try {
        await fs.access(projectFile);
      } catch (_error) {
        return null;
      }

      // Read the project file to find linked sessions
      const content = await fs.readFile(projectFile, 'utf-8');
      const sessionLinks = content.match(/\[\[2025-\d{2}_\d{2}-\d{2}-\d{2}[^\]]*\]\]/g) || [];

      if (sessionLinks.length === 0) {
        return null;
      }

      // Extract the most recent date from session links
      // Format: [[2025-11-15_12-01-39_session-name]]
      let mostRecentDate: Date | null = null;

      for (const link of sessionLinks) {
        // Extract session ID from [[...]]
        const sessionMatch = link.match(/\[\[(2025-\d{2}_\d{2}-\d{2}-\d{2})/);
        if (sessionMatch) {
          const sessionPart = sessionMatch[1];
          // Parse date and time: 2025-11-15_12-01-39
          const [datePart, timePart] = sessionPart.split('_');
          const [year, month, day] = datePart.split('-');
          const [hours, minutes, seconds] = timePart.split('-');

          const date = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hours),
            parseInt(minutes),
            parseInt(seconds)
          );

          if (!mostRecentDate || date > mostRecentDate) {
            mostRecentDate = date;
          }
        }
      }

      return mostRecentDate;
    } catch (_error) {
      // If anything fails, return null - not critical
      return null;
    }
  }

  private setCurrentSession(sessionId: string, sessionFile: string): void {
    this.currentSessionId = sessionId;
    this.currentSessionFile = sessionFile;
  }

  private hasPhase1Completed(): boolean {
    return this.phase1Completed;
  }

  private markPhase1Complete(): void {
    this.phase1Completed = true;
  }

  private clearSessionState(): void {
    this.filesAccessed = [];
    this.topicsCreated = [];
    this.decisionsCreated = [];
    this.projectsCreated = [];
    this.sessionStartTime = null;
    this.phase1Completed = false;
  }

  /**
   * Track file access with bounded array size.
   * When limit is reached, older entries are removed (FIFO).
   */
  private trackFileAccess(filePath: string, action: 'read' | 'edit' | 'create'): void {
    // If at capacity, remove oldest entry (FIFO)
    if (this.filesAccessed.length >= ObsidianMCPServer.MAX_FILES_ACCESSED) {
      this.filesAccessed.shift();
    }
    this.filesAccessed.push({ path: filePath, action, timestamp: new Date().toISOString() });
  }

  // ==================== End Tool Wrapper Methods ====================

  /**
   * Strip Obsidian-specific markdown syntax from text for cleaner CLI output
   */
  private cleanObsidianMarkdown(text: string): string {
    return (
      text
        // Convert wiki links: [[link|display]] -> display, [[link]] -> link
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
    );
  }

  private smartTruncate(
    text: string,
    options: {
      maxLength: number;
      preserveContext: boolean;
      ellipsis: string;
    }
  ): string {
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
          const vaultIndicator =
            r.vault && r.vault !== this.config.primaryVault.name ? ` [${r.vault}]` : '';
          resultText += `${idx + 1}. ${r.file}${r.date ? ` (${r.date})` : ''}${vaultIndicator}\n`;
        });
        resultText += `\n💡 Use detail: "summary" to see snippets`;
        break;

      case ResponseDetail.SUMMARY:
        // Current implementation - snippets truncated to 100 chars
        resultText += `Found ${totalCount} matches. Top ${results.length} results:\n\n`;
        results.forEach((r, idx) => {
          const semanticIndicator =
            r.semanticScore !== undefined
              ? ` [semantic: ${(r.semanticScore * 100).toFixed(0)}%]`
              : '';
          const vaultIndicator =
            r.vault && r.vault !== this.config.primaryVault.name ? ` [${r.vault}]` : '';

          resultText += `${idx + 1}. **${r.file}** ${r.date ? `(${r.date})` : ''}${semanticIndicator}${vaultIndicator}\n`;

          if (r.matches.length > 0) {
            const snippets = r.matches
              .slice(0, 3) // Max 3 snippets per result
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
          const semanticIndicator =
            r.semanticScore !== undefined
              ? ` [semantic: ${(r.semanticScore * 100).toFixed(0)}%]`
              : '';
          const vaultIndicator =
            r.vault && r.vault !== this.config.primaryVault.name ? ` [${r.vault}]` : '';

          resultText += `${idx + 1}. **${r.file}** ${r.date ? `(${r.date})` : ''}${semanticIndicator}${vaultIndicator}\n`;

          if (r.matches.length > 0) {
            const snippets = r.matches
              .slice(0, 5) // Up to 5 snippets
              .map(m => {
                const cleaned = this.cleanObsidianMarkdown(m.trim());
                const truncated = this.smartTruncate(cleaned, {
                  maxLength: 300,
                  preserveContext: true,
                  ellipsis: '...',
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
            resultText +=
              r.matches.map(m => `  - ${this.cleanObsidianMarkdown(m.trim())}`).join('\n') + '\n';
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
          text: resultText,
        },
      ],
    };
  }

  private scoreSearchResult(
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
    const firstParagraph = lines
      .slice(firstParagraphStart, firstParagraphEnd + 1)
      .join('\n')
      .toLowerCase();

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
        if (
          frontmatter.toLowerCase().includes(`tags:`) &&
          frontmatter.toLowerCase().includes(term)
        ) {
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
        } catch (_error) {
          // Skip projects that can't be read
          continue;
        }
      }
    } catch (_error) {
      // If projects directory doesn't exist or can't be read, return empty array
    }

    return relatedProjects;
  }

  /**
   * Find topics, decisions, and projects mentioned in text content
   */
  private async findRelatedContentInText(text: string): Promise<{
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
      } catch (_error) {
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
      } catch (_error) {
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
          } catch (_error) {
            continue;
          }
        }
      } catch (_error) {
        // Skip if projects directory doesn't exist
      }
    } catch (_error) {
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
      } catch (_error) {
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

  private async getRepoInfo(
    repoPath: string
  ): Promise<{ name: string; branch?: string; remote?: string }> {
    const name = path.basename(repoPath);

    try {
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
      });
      const branch = branchOutput.trim();

      let remote: string | undefined;
      try {
        const { stdout: remoteOutput } = await execAsync('git config --get remote.origin.url', {
          cwd: repoPath,
        });
        remote = remoteOutput.trim();
      } catch {
        // No remote configured
      }

      return { name, branch, remote };
    } catch (_error) {
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
            files.push(...(await this.findMarkdownFiles(fullPath)));
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch (_error) {
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
  private analyzeTopicContentInternal(args: {
    content: string;
    topic_name?: string;
    context?: string;
  }): {
    tags: string[];
    summary: string;
    key_concepts: string[];
    related_topics: string[];
    content_type: string;
  } {
    // Common words to filter out (expanded stop words list)
    const commonWords = new Set([
      'the',
      'be',
      'to',
      'of',
      'and',
      'a',
      'in',
      'that',
      'have',
      'i',
      'it',
      'for',
      'not',
      'on',
      'with',
      'he',
      'as',
      'you',
      'do',
      'at',
      'this',
      'but',
      'his',
      'by',
      'from',
      'they',
      'we',
      'say',
      'her',
      'she',
      'or',
      'an',
      'will',
      'my',
      'one',
      'all',
      'would',
      'there',
      'their',
      'what',
      'so',
      'up',
      'out',
      'if',
      'about',
      'who',
      'get',
      'which',
      'go',
      'me',
      'when',
      'make',
      'can',
      'like',
      'time',
      'no',
      'just',
      'him',
      'know',
      'take',
      'people',
      'into',
      'year',
      'your',
      'good',
      'some',
      'could',
      'them',
      'see',
      'other',
      'than',
      'then',
      'now',
      'look',
      'only',
      'come',
      'its',
      'over',
      'think',
      'also',
      'back',
      'after',
      'use',
      'two',
      'how',
      'our',
      'work',
      'first',
      'well',
      'way',
      'even',
      'new',
      'want',
      'because',
      'any',
      'these',
      'give',
      'day',
      'most',
      'us',
      'is',
      'was',
      'are',
      'been',
      'has',
      'had',
      'were',
      'said',
      'did',
      'having',
      'may',
      'should',
      'does',
      'done',
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
    } catch (_error) {
      // Directory doesn't exist or can't be read
    }

    return null;
  }

  async run(): Promise<void> {
    // Parse command-line arguments
    const args = process.argv.slice(2);
    const useHttp = args.includes('--http');
    const useHttps = args.includes('--https');
    const portArg = args.find(arg => arg.startsWith('--port='));
    const port = portArg ? parseInt(portArg.split('=')[1], 10) : useHttps ? 3443 : 3000;

    // Pre-compute embeddings if enabled
    if (this.embeddingConfig.enabled && this.embeddingConfig.precomputeEmbeddings) {
      logger.info('Pre-computing embeddings on startup...');
      try {
        await this.precomputeAllEmbeddings();
        logger.info('Embedding pre-computation complete');
      } catch (error) {
        logger.error(
          'Embedding pre-computation failed',
          error instanceof Error ? error : new Error(String(error))
        );
        // Continue anyway - searches will still work with on-demand embedding
      }
    }

    if (useHttp || useHttps) {
      // HTTP/HTTPS mode with Streamable HTTP transport
      const app = express();

      // Store transports by session ID
      const transports: Record<string, StreamableHTTPServerTransport> = {};

      // Middleware
      app.use(cors());
      app.use(bodyParser.json());

      // Health check endpoint
      app.get('/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
      });

      // MCP POST endpoint - handles initialization and method calls
      app.post('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport for this session
          transport = transports[sessionId];
        } else {
          // Create new transport for new session
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => {
              const newId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              logger.info(`New session initialized: ${newId}`);
              return newId;
            },
            onsessioninitialized: sid => {
              logger.info(`Storing transport for session: ${sid}`);
              transports[sid] = transport;
            },
          });

          // Set up cleanup on transport close
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              logger.info(`Transport closed for session ${sid}`);
              delete transports[sid];
            }
          };

          // Connect transport to MCP server
          await this.server.connect(transport);
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      });

      // MCP GET endpoint - handles SSE streams for established sessions
      app.get('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (!sessionId || !transports[sessionId]) {
          res.status(400).send('Invalid or missing session ID');
          return;
        }

        logger.info(`SSE stream requested for session: ${sessionId}`);
        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
      });

      // MCP DELETE endpoint - handles session termination
      app.delete('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (!sessionId || !transports[sessionId]) {
          res.status(400).send('Invalid or missing session ID');
          return;
        }

        logger.info(`Session termination requested for: ${sessionId}`);
        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
      });

      // Start HTTP or HTTPS server
      if (useHttps) {
        // HTTPS mode - load certificates
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const certsPath = path.join(currentDir, '..', 'certs');
        const httpsOptions = {
          key: fssync.readFileSync(path.join(certsPath, 'key.pem')),
          cert: fssync.readFileSync(path.join(certsPath, 'cert.pem')),
        };

        https.createServer(httpsOptions, app).listen(port, '0.0.0.0', () => {
          logger.info(`Obsidian MCP Server running on HTTPS at https://0.0.0.0:${port}`);
          logger.info(`MCP endpoint: https://0.0.0.0:${port}/mcp`);
          logger.info(`Health check: https://0.0.0.0:${port}/health`);
        });
      } else {
        // HTTP mode
        app.listen(port, '0.0.0.0', () => {
          logger.info(`Obsidian MCP Server running on HTTP at http://0.0.0.0:${port}`);
          logger.info(`MCP endpoint: http://0.0.0.0:${port}/mcp`);
          logger.info(`Health check: http://0.0.0.0:${port}/health`);
        });
      }

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        void (async () => {
          logger.info('Shutting down server...');
          for (const sessionId in transports) {
            try {
              logger.info(`Closing transport for session ${sessionId}`);
              await transports[sessionId].close();
              delete transports[sessionId];
            } catch (error) {
              logger.error(
                `Error closing transport for session ${sessionId}`,
                error instanceof Error ? error : new Error(String(error))
              );
            }
          }
          logger.info('Server shutdown complete');
          process.exit(0);
        })();
      });
    } else {
      // Stdio mode (default)
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('Obsidian MCP Server running on stdio');
    }
  }
}

const server = new ObsidianMCPServer();
server.run().catch(error => {
  logger.error('Server run failed', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
