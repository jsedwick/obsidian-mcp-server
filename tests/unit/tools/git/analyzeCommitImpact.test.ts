/**
 * Unit tests for analyzeCommitImpact tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analyzeCommitImpact } from '../../../../src/tools/git/analyzeCommitImpact.js';
import type { GitService } from '../../../../src/services/git/GitService.js';

// analyzeCommitImpact uses promisify(execFile). The mock invokes the
// node-style callback with `{ stdout, stderr }` as the value so the
// promisified return resolves to that shape.
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

type ExecFileCallback = (err: Error | null, value?: { stdout: string; stderr: string }) => void;

/**
 * Wires `mockExecFile` so a per-test resolver decides what stdout to return
 * for a given args array. Callback shape mirrors what promisify expects.
 */
function setExecFileResolver(resolver: (args: string[]) => string | Error) {
  mockExecFile.mockImplementation(
    (_file: string, args: string[], _options: unknown, callback: ExecFileCallback) => {
      const result = resolver(args);
      if (result instanceof Error) {
        callback(result);
      } else {
        callback(null, { stdout: result, stderr: '' });
      }
    }
  );
}

describe('analyzeCommitImpact', () => {
  let context: {
    vaultPath: string;
    gitService: GitService;
    searchVault: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    context = {
      vaultPath: '/tmp/test-vault',
      gitService: {
        isGitRepository: vi.fn().mockResolvedValue(true),
      } as unknown as GitService,
      searchVault: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Found 0 matches' }],
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should analyze commit and return impact summary', async () => {
    setExecFileResolver(args => {
      if (args.includes('--no-patch')) {
        return 'abc123def456\nTest Author\ntest@example.com\n2026-02-16\nFix search algorithm\n\n';
      }
      if (args.includes('--stat') && !args.includes('diff')) {
        return ' src/search.ts | 10 ++++------\n 1 file changed, 4 insertions(+), 6 deletions(-)\n';
      }
      if (args.includes('diff')) {
        return ' src/search.ts | 10 ++++------\n 1 file changed, 4 insertions(+), 6 deletions(-)\n';
      }
      return '';
    });

    const result = await analyzeCommitImpact(
      { repo_path: '/tmp/test-repo', commit_hash: 'abc123def456' },
      context
    );

    expect(result.content[0].text).toContain('Git Commit Impact Analysis');
    expect(result.content[0].text).toContain('abc123def456');
    expect(result.content[0].text).toContain('Fix search algorithm');
    expect(result.content[0].text).toContain('Test Author');
  });

  it('should error when path is not a git repository', async () => {
    (context.gitService.isGitRepository as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await analyzeCommitImpact(
      { repo_path: '/tmp/not-a-repo', commit_hash: 'abc123' },
      context
    );

    expect(result.content[0].text).toContain('Not a git repository');
  });

  it('should handle git command failure gracefully', async () => {
    setExecFileResolver(() => new Error('bad object abc123'));

    const result = await analyzeCommitImpact(
      { repo_path: '/tmp/test-repo', commit_hash: 'bad-hash' },
      context
    );

    expect(result.content[0].text).toContain('Error');
  });

  it('should search vault for related topics and include in result', async () => {
    setExecFileResolver(args => {
      if (args.includes('--no-patch')) {
        return 'abc123\nAuthor\nemail\n2026-02-16\nUpdate auth module\n\n';
      }
      if (args.includes('--stat')) {
        return ' src/auth.ts | 5 ++---\n 1 file changed\n';
      }
      return ' src/auth.ts | 5 ++---\n';
    });

    context.searchVault.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `Found 1 match:\n\n**1. ${context.vaultPath}/topics/auth-system.md**\nAuth system docs`,
        },
      ],
    });

    const result = await analyzeCommitImpact(
      { repo_path: '/tmp/test-repo', commit_hash: 'abc123' },
      context
    );

    expect(context.searchVault).toHaveBeenCalled();
    expect(result.content[0].text).toContain('Related Content');
  });

  it('should return structured relatedTopics when topics match', async () => {
    setExecFileResolver(args => {
      if (args.includes('--no-patch')) {
        return 'abc123\nAuthor\nemail\n2026-02-16\nUpdate search\n\n';
      }
      if (args.includes('--stat')) {
        return ' src/search.ts | 3 ++-\n';
      }
      return ' src/search.ts | 3 ++-\n';
    });

    context.searchVault.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `Found 1 match:\n\n**/tmp/test-vault/topics/search-algo.md**\nSearch algorithm docs`,
        },
      ],
    });

    const result = await analyzeCommitImpact(
      { repo_path: '/tmp/test-repo', commit_hash: 'abc123' },
      context
    );

    expect(result.relatedTopics).toBeDefined();
    if (result.relatedTopics) {
      expect(result.relatedTopics.length).toBeGreaterThanOrEqual(1);
      expect(result.relatedTopics[0].path).toContain('search-algo.md');
    }
  });
});
