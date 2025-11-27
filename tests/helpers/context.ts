/**
 * Test context builders for creating mock contexts for tool testing
 *
 * This module provides factory functions to create mock contexts for different
 * tool categories, making it easy to write isolated unit tests.
 */

import type { FileAccess } from '../../src/models/Session.js';
import type { GitService } from '../../src/services/git/GitService.js';
import { vi } from 'vitest';

/**
 * Slugify function matching production implementation
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Common context properties shared across all tool types
 */
export interface BaseContext {
  vaultPath: string;
}

/**
 * Session tools context (for session management tools)
 */
export interface SessionToolsContext extends BaseContext {
  currentSessionId: string | null;
  currentSessionFile: string | null;
  filesAccessed: FileAccess[];
  topicsCreated: Array<{ slug: string; title: string; file: string }>;
  decisionsCreated: Array<{ number: string; title: string; file: string }>;
  projectsCreated: Array<{ slug: string; name: string; file: string }>;
  commitsRecorded: Array<{ hash: string; repoPath: string; file: string }>;
  gitService: GitService;
  slugify: (text: string) => string;
  ensureVaultStructure: () => Promise<void>;
  findSessionFile: (sessionId: string) => Promise<string | null>;
  analyzeCommitImpact?: (args: {
    repo_path: string;
    commit_hash: string;
    include_diff?: boolean;
  }) => Promise<any>;
  getSessionStartTime?: () => Date | null;
  getMostRecentSessionDate?: (repoSlug: string) => Promise<Date | null>;
  findGitRepos?: (startPath: string, maxDepth?: number) => Promise<string[]>;
  getRepoInfo?: (
    repoPath: string
  ) => Promise<{ name: string; branch?: string; remote?: string | null }>;
  createProjectPage?: (args: { repo_path: string }) => Promise<any>;
  findRelatedContentInText?: (text: string) => Promise<{
    topics: Array<{ link: string; title: string }>;
    decisions: Array<{ link: string; title: string }>;
    projects: Array<{ link: string; name: string }>;
  }>;
  vaultCustodian?: (args: { files_to_check: string[] }) => Promise<any>;
  recordCommit?: (args: { repo_path: string; commit_hash: string }) => Promise<any>;
  setCurrentSession?: (sessionId: string, sessionFile: string) => void;
  clearSessionState?: () => void;
}

/**
 * Create mock context for session tools
 */
export function createSessionToolsContext(
  overrides?: Partial<SessionToolsContext>
): SessionToolsContext {
  const filesAccessed: FileAccess[] = [];
  const topicsCreated: Array<{ slug: string; title: string; file: string }> = [];
  const decisionsCreated: Array<{ number: string; title: string; file: string }> = [];
  const projectsCreated: Array<{ slug: string; name: string; file: string }> = [];
  const commitsRecorded: Array<{ hash: string; repoPath: string; file: string }> = [];

  return {
    vaultPath: '/tmp/test-vault',
    currentSessionId: null,
    currentSessionFile: null,
    filesAccessed,
    topicsCreated,
    decisionsCreated,
    projectsCreated,
    commitsRecorded,
    gitService: {} as GitService,
    slugify,
    ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
    findSessionFile: vi.fn().mockResolvedValue(null),
    // New methods for two-phase /close workflow (Decision 022)
    analyzeCommitImpact: vi.fn().mockResolvedValue({ content: [{ text: 'Mock commit analysis' }] }),
    getSessionStartTime: vi.fn().mockReturnValue(null), // Default: no files accessed
    getMostRecentSessionDate: vi.fn().mockResolvedValue(null),
    findGitRepos: vi.fn().mockResolvedValue([]),
    getRepoInfo: vi.fn().mockResolvedValue({ name: 'test-repo', branch: 'main', remote: null }),
    createProjectPage: vi.fn().mockResolvedValue({ content: [] }),
    findRelatedContentInText: vi
      .fn()
      .mockResolvedValue({ topics: [], decisions: [], projects: [] }),
    vaultCustodian: vi.fn().mockResolvedValue({ content: [{ text: 'Vault check complete' }] }),
    recordCommit: vi.fn().mockResolvedValue({ content: [] }),
    setCurrentSession: vi.fn(),
    clearSessionState: vi.fn(),
    ...overrides,
  };
}

/**
 * Search tools context (for search and retrieval tools)
 */
export interface SearchToolsContext extends BaseContext {
  config: {
    primaryVault: { path: string; name: string };
    secondaryVaults: Array<{ path: string; name: string }>;
  };
  embeddingConfig: {
    enabled: boolean;
    keywordCandidatesLimit: number;
  };
  indexedSearches: Map<string, any>;
  indexBuilders: Map<string, any>;
  ensureVaultStructure: () => Promise<void>;
  loadEmbeddingCache: () => Promise<void>;
  saveEmbeddingCache: () => Promise<void>;
  generateEmbedding: (text: string) => Promise<number[]>;
  getOrCreateEmbedding: (file: string, content: string, fileStats: any) => Promise<number[]>;
  cosineSimilarity: (vecA: number[], vecB: number[]) => number;
  scoreSearchResult: (
    dir: string,
    relPath: string,
    fileName: string,
    content: string,
    fileStats: any,
    queryLower: string,
    queryTerms: string[],
    dateRange?: { start?: string; end?: string },
    absolutePath?: string
  ) => Promise<any>;
  formatSearchResults: (
    results: Array<{
      file: string;
      matches: string[];
      date?: string;
      score: number;
      semanticScore?: number;
      vault?: string;
    }>,
    totalCount: number,
    detail: any,
    hasSemanticSearch: boolean,
    query: string
  ) => { content: Array<{ type: string; text: string }> };
  getAllVaults: () => Array<{ path: string; name: string }>;
  slugify: (text: string) => string;
}

/**
 * Create mock context for search tools
 */
export function createSearchToolsContext(
  overrides?: Partial<SearchToolsContext>
): SearchToolsContext {
  const vaultPath = overrides?.vaultPath || '/tmp/test-vault';

  return {
    vaultPath,
    config: {
      primaryVault: { path: vaultPath, name: 'Test Vault' },
      secondaryVaults: [],
    },
    embeddingConfig: {
      enabled: false,
      keywordCandidatesLimit: 50,
    },
    indexedSearches: new Map(),
    indexBuilders: new Map(),
    ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
    loadEmbeddingCache: vi.fn().mockResolvedValue(undefined),
    saveEmbeddingCache: vi.fn().mockResolvedValue(undefined),
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    getOrCreateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    cosineSimilarity: vi.fn().mockReturnValue(0.85),
    scoreSearchResult: vi.fn().mockResolvedValue(null),
    formatSearchResults: vi.fn().mockReturnValue({
      content: [{ type: 'text', text: 'Mock search results' }],
    }),
    getAllVaults: vi.fn().mockReturnValue([{ path: vaultPath, name: 'Test Vault' }]),
    slugify,
    ...overrides,
  };
}

/**
 * Topics tools context (for topic creation and management)
 */
export interface TopicsToolsContext extends BaseContext {
  currentSessionId: string | null;
  slugify: (text: string) => string;
  ensureVaultStructure: () => Promise<void>;
  analyzeTopicContentInternal: (args: {
    content: string;
    topic_name?: string;
    context?: string;
  }) => Promise<{
    tags: string[];
    summary: string;
    key_concepts: string[];
    related_topics: string[];
    content_type: string;
  }>;
  findRelatedProjects: (topicContent: string) => Promise<Array<{ link: string; name: string }>>;
  trackTopicCreation: (topic: { slug: string; title: string; file: string }) => void;
  searchVault?: (args: any) => Promise<any>;
}

/**
 * Create mock context for topics tools
 */
export function createTopicsToolsContext(
  overrides?: Partial<TopicsToolsContext>
): TopicsToolsContext {
  return {
    vaultPath: '/tmp/test-vault',
    currentSessionId: null,
    slugify,
    ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
    analyzeTopicContentInternal: vi.fn().mockResolvedValue({
      tags: ['test', 'example'],
      summary: 'Test topic summary',
      key_concepts: ['concept1', 'concept2'],
      related_topics: [],
      content_type: 'technical-guide',
    }),
    findRelatedProjects: vi.fn().mockResolvedValue([]),
    trackTopicCreation: vi.fn(),
    ...overrides,
  };
}

/**
 * Review tools context (for topic review and archival)
 */
export interface ReviewToolsContext extends BaseContext {
  slugify: (text: string) => string;
  ensureVaultStructure: () => Promise<void>;
  pendingReviews: Map<string, any>;
  analyzeTopicForReview: (content: string, topic: string, analysisPrompt?: string) => Promise<any>;
}

/**
 * Create mock context for review tools
 */
export function createReviewToolsContext(
  overrides?: Partial<ReviewToolsContext>
): ReviewToolsContext {
  return {
    vaultPath: '/tmp/test-vault',
    slugify,
    ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
    pendingReviews: new Map(),
    analyzeTopicForReview: vi.fn().mockResolvedValue({
      is_outdated: false,
      concerns: [],
      suggested_updates: '',
      confidence: 'high',
    }),
    ...overrides,
  };
}

/**
 * Git tools context (for Git integration tools)
 */
export interface GitToolsContext extends BaseContext {
  gitService: GitService;
  currentSessionId?: string;
  slugify?: (text: string) => string;
  trackProjectCreation?: (project: { slug: string; name: string; file: string }) => void;
  trackCommitRecording?: (commit: { hash: string; repoPath: string; file: string }) => void;
  searchVault?: (args: any) => Promise<any>;
  findGitRepos?: (files: string[]) => Promise<Array<{ path: string; name: string }>>;
  getRepoInfo?: (repoPath: string) => Promise<{
    name: string;
    branch: string;
    remote: string | null;
  }>;
}

/**
 * Create mock context for Git tools
 */
export function createGitToolsContext(overrides?: Partial<GitToolsContext>): GitToolsContext {
  return {
    vaultPath: '/tmp/test-vault',
    gitService: {
      isGitRepository: vi.fn().mockResolvedValue(true),
      findGitRoot: vi.fn().mockResolvedValue('/tmp/test-repo'),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      getRemoteUrl: vi.fn().mockResolvedValue('https://github.com/user/repo.git'),
      getRepositoryName: vi.fn().mockResolvedValue('test-repo'),
      getCommitInfo: vi.fn().mockResolvedValue({
        hash: 'abc123def456',
        shortHash: 'abc123d',
        message: 'Test commit',
        author: 'Test Author',
        email: 'test@example.com',
        date: new Date('2025-01-15'),
      }),
      getDiffStats: vi.fn().mockResolvedValue({
        filesChanged: 2,
        insertions: 10,
        deletions: 5,
        files: [
          { path: 'file1.ts', insertions: 7, deletions: 3 },
          { path: 'file2.ts', insertions: 3, deletions: 2 },
        ],
      }),
      getDiff: vi.fn().mockResolvedValue('mock diff content'),
      getBranchesContainingCommit: vi.fn().mockResolvedValue(['main']),
    } as unknown as GitService,
    slugify,
    trackProjectCreation: vi.fn(),
    trackCommitRecording: vi.fn(),
    ...overrides,
  };
}

/**
 * Decisions tools context (for decision creation and extraction)
 */
export interface DecisionsToolsContext extends BaseContext {
  currentSessionId: string | null;
  slugify: (text: string) => string;
  ensureVaultStructure: () => Promise<void>;
  getNextDecisionNumber: (projectSlug?: string) => Promise<string>;
  trackDecisionCreation: (decision: { number: string; title: string; file: string }) => void;
  findSessionFile?: (sessionId: string) => Promise<string | null>;
  currentSessionFile?: string | null;
}

/**
 * Create mock context for decisions tools
 */
export function createDecisionsToolsContext(
  overrides?: Partial<DecisionsToolsContext>
): DecisionsToolsContext {
  return {
    vaultPath: '/tmp/test-vault',
    currentSessionId: null,
    slugify,
    ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
    getNextDecisionNumber: vi.fn().mockResolvedValue('001'),
    trackDecisionCreation: vi.fn(),
    ...overrides,
  };
}

/**
 * Maintenance tools context (for vault maintenance tools)
 */
export interface MaintenanceToolsContext extends BaseContext {
  embeddingConfig: {
    enabled: boolean;
  };
  toggleEmbeddings: (enabled?: boolean) => boolean;
  ensureVaultStructure: () => Promise<void>;
  findBrokenLinks?: () => Promise<Array<{ file: string; link: string }>>;
  fixBrokenLinks?: () => Promise<void>;
}

/**
 * Create mock context for maintenance tools
 */
export function createMaintenanceToolsContext(
  overrides?: Partial<MaintenanceToolsContext>
): MaintenanceToolsContext {
  return {
    vaultPath: '/tmp/test-vault',
    embeddingConfig: {
      enabled: false,
    },
    toggleEmbeddings: vi.fn().mockReturnValue(true),
    ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a file access record for testing
 */
export function createFileAccess(
  path: string,
  action: 'read' | 'edit' | 'create' = 'read',
  timestamp?: string
): FileAccess {
  return {
    path,
    action,
    timestamp: timestamp || new Date().toISOString(),
  };
}

/**
 * Create multiple file access records
 */
export function createFileAccesses(
  paths: string[],
  action: 'read' | 'edit' | 'create' = 'read'
): FileAccess[] {
  return paths.map(path => createFileAccess(path, action));
}
