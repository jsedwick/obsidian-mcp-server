/**
 * SearchEngine unit tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as path from 'path';

// Mock fs/promises for directory traversal
const { mockReaddir, mockStat, mockReadFile } = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockReadFile: vi.fn(),
}));
vi.mock('fs/promises', () => ({
  readdir: mockReaddir,
  stat: mockStat,
  readFile: mockReadFile,
}));

import { SearchEngine } from '../../../../src/services/search/SearchEngine.js';
import { KeywordSearch } from '../../../../src/services/search/KeywordSearch.js';
import { SemanticSearch } from '../../../../src/services/search/SemanticSearch.js';
import { SearchRanker } from '../../../../src/services/search/SearchRanker.js';
import type { VaultInfo } from '../../../../src/services/search/SearchEngine.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Set up fs mocks for a vault directory with markdown files */
function setupVaultFiles(
  vaultPath: string,
  dirs: Record<string, Array<{ name: string; content: string }>>
) {
  mockReaddir.mockImplementation(async (dirPath: string, _opts?: any) => {
    for (const [dir, files] of Object.entries(dirs)) {
      const fullDir = path.join(vaultPath, dir);
      if (dirPath === fullDir) {
        return files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }));
      }
    }
    // Unknown directory — empty
    return [];
  });

  mockStat.mockResolvedValue({ mtime: new Date('2025-01-15'), size: 100 });

  mockReadFile.mockImplementation(async (filePath: string) => {
    for (const [dir, files] of Object.entries(dirs)) {
      for (const file of files) {
        const fullPath = path.join(vaultPath, dir, file.name);
        if (filePath === fullPath) return file.content;
      }
    }
    throw new Error(`ENOENT: ${filePath}`);
  });
}

describe('SearchEngine', () => {
  function createEngine(
    overrides: {
      semanticQueryEmbedding?: number[] | null;
    } = {}
  ) {
    const keywordSearch = new KeywordSearch();
    const mockEmbeddingService = {
      generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
      cosineSimilarity: vi.fn().mockReturnValue(0.8),
    } as any;
    const mockEmbeddingCache = {
      isEnabled: vi.fn().mockReturnValue(false),
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
    } as any;
    const semanticSearch = new SemanticSearch(mockEmbeddingService, mockEmbeddingCache);
    vi.spyOn(semanticSearch, 'generateQueryEmbedding').mockResolvedValue(
      overrides.semanticQueryEmbedding ?? null
    );
    const searchRanker = new SearchRanker();

    return new SearchEngine(keywordSearch, semanticSearch, searchRanker);
  }

  describe('primary vault search', () => {
    it('should search standard directories in primary vault', async () => {
      const engine = createEngine();
      const vaultPath = '/primary/vault';

      setupVaultFiles(vaultPath, {
        topics: [{ name: 'test-topic.md', content: '---\ntitle: Test\n---\nfoo bar baz' }],
      });

      const vaults: VaultInfo[] = [{ path: vaultPath, name: 'Primary' }];
      const results = await engine.search(
        { query: 'foo bar', directories: ['topics'] },
        vaults,
        vaultPath
      );

      expect(results.totalMatches).toBeGreaterThanOrEqual(1);
      expect(results.results[0].file).toContain('test-topic.md');
    });
  });

  describe('secondary vault recursive search', () => {
    it('should search secondary vaults recursively', async () => {
      const engine = createEngine();
      const primaryPath = '/primary/vault';
      const secondaryPath = '/secondary/vault';

      // Primary: empty topics
      setupVaultFiles(primaryPath, { topics: [] });

      // Override readdir for secondary vault root
      mockReaddir.mockImplementation(async (dirPath: string, _opts?: any) => {
        if (dirPath === path.join(primaryPath, 'topics')) return [];
        if (dirPath === secondaryPath) {
          return [
            {
              name: 'note.md',
              isDirectory: () => false,
              isFile: () => true,
            },
          ];
        }
        return [];
      });
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath === path.join(secondaryPath, 'note.md')) {
          return '---\ntitle: Note\n---\nsearch term here';
        }
        throw new Error('ENOENT');
      });

      const vaults: VaultInfo[] = [
        { path: primaryPath, name: 'Primary' },
        { path: secondaryPath, name: 'Secondary' },
      ];
      const results = await engine.search(
        { query: 'search term', directories: ['topics'] },
        vaults,
        primaryPath
      );

      const secondaryResults = results.results.filter(r => r.vault === 'Secondary');
      expect(secondaryResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('maxResults limit', () => {
    it('should respect maxResults', async () => {
      const engine = createEngine();
      const vaultPath = '/primary/vault';

      // Create many files
      const files = Array.from({ length: 20 }, (_, i) => ({
        name: `topic-${i}.md`,
        content: `---\ntitle: Topic ${i}\n---\nkeyword appears here`,
      }));

      setupVaultFiles(vaultPath, { topics: files });

      const vaults: VaultInfo[] = [{ path: vaultPath, name: 'Primary' }];
      const results = await engine.search(
        { query: 'keyword', maxResults: 5, directories: ['topics'] },
        vaults,
        vaultPath
      );

      expect(results.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('semantic re-ranking', () => {
    it('should use semantic re-ranking when embedding is available', async () => {
      const engine = createEngine({ semanticQueryEmbedding: [0.1, 0.2] });
      const vaultPath = '/primary/vault';

      setupVaultFiles(vaultPath, {
        topics: [{ name: 'a.md', content: '---\ntitle: A\n---\nkeyword content' }],
      });

      const vaults: VaultInfo[] = [{ path: vaultPath, name: 'Primary' }];
      const results = await engine.search(
        { query: 'keyword', directories: ['topics'] },
        vaults,
        vaultPath
      );

      expect(results.usedSemanticSearch).toBe(true);
    });
  });

  describe('date range passthrough', () => {
    it('should filter results by date range', async () => {
      const engine = createEngine();
      const vaultPath = '/primary/vault';

      setupVaultFiles(vaultPath, {
        topics: [
          { name: 'old.md', content: '---\ncreated: 2020-01-01\n---\nkeyword in old doc' },
          { name: 'new.md', content: '---\ncreated: 2025-06-01\n---\nkeyword in new doc' },
        ],
      });

      const vaults: VaultInfo[] = [{ path: vaultPath, name: 'Primary' }];
      const results = await engine.search(
        {
          query: 'keyword',
          directories: ['topics'],
          dateRange: { start: '2025-01-01', end: '2025-12-31' },
        },
        vaults,
        vaultPath
      );

      // Only the new doc should match
      expect(results.totalMatches).toBe(1);
      expect(results.results[0].file).toContain('new.md');
    });
  });
});
