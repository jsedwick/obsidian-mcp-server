/**
 * Unit tests for linkSessionToRepository tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { linkSessionToRepository } from '../../../../src/tools/git/linkSessionToRepository.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { FileAccess } from '../../../../src/models/Session.js';

describe('linkSessionToRepository', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'link-session-test-'));
    await fs.mkdir(path.join(tmpDir, 'sessions', '2025-01'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should link session to repository and update frontmatter', async () => {
    const sessionFile = path.join(tmpDir, 'sessions', '2025-01', 'session.md');
    await fs.writeFile(sessionFile, `---\nsession_id: test-session\n---\n\n# Session content`);

    const context = {
      currentSessionFile: sessionFile,
      filesAccessed: [] as FileAccess[],
      gitService: {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getRepositoryName: vi.fn().mockResolvedValue('my-repo'),
      } as any,
      createProjectPage: vi.fn().mockResolvedValue({ content: [] }),
    };

    const result = await linkSessionToRepository({ repo_path: '/tmp/my-repo' }, context);

    expect(result.content[0].text).toContain('Session linked to repository: my-repo');
    expect(result.content[0].text).toContain('/tmp/my-repo');

    const updatedContent = await fs.readFile(sessionFile, 'utf-8');
    expect(updatedContent).toContain('repository:');
    expect(updatedContent).toContain('path: /tmp/my-repo');
    expect(updatedContent).toContain('name: my-repo');
    expect(context.createProjectPage).toHaveBeenCalledWith({ repo_path: '/tmp/my-repo' });
  });

  it('should throw when no active session', async () => {
    const context = {
      currentSessionFile: null,
      filesAccessed: [] as FileAccess[],
      gitService: {} as any,
      createProjectPage: vi.fn(),
    };

    await expect(linkSessionToRepository({ repo_path: '/tmp/repo' }, context)).rejects.toThrow(
      'No active session'
    );
  });

  it('should throw for non-git repository', async () => {
    const sessionFile = path.join(tmpDir, 'sessions', '2025-01', 'session.md');
    await fs.writeFile(sessionFile, `---\nsession_id: test\n---\n\n# Content`);

    const context = {
      currentSessionFile: sessionFile,
      filesAccessed: [] as FileAccess[],
      gitService: {
        isGitRepository: vi.fn().mockResolvedValue(false),
      } as any,
      createProjectPage: vi.fn(),
    };

    await expect(
      linkSessionToRepository({ repo_path: '/tmp/not-a-repo' }, context)
    ).rejects.toThrow('Not a valid Git repository');
  });

  it('should throw for invalid session file format (no frontmatter)', async () => {
    const sessionFile = path.join(tmpDir, 'sessions', '2025-01', 'session.md');
    await fs.writeFile(sessionFile, `No frontmatter here`);

    const context = {
      currentSessionFile: sessionFile,
      filesAccessed: [] as FileAccess[],
      gitService: {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getRepositoryName: vi.fn().mockResolvedValue('repo'),
      } as any,
      createProjectPage: vi.fn(),
    };

    await expect(linkSessionToRepository({ repo_path: '/tmp/repo' }, context)).rejects.toThrow(
      'Invalid session file format'
    );
  });

  it('should include files accessed in frontmatter when present', async () => {
    const sessionFile = path.join(tmpDir, 'sessions', '2025-01', 'session.md');
    await fs.writeFile(sessionFile, `---\nsession_id: test\n---\n\n# Content`);

    const filesAccessed: FileAccess[] = [
      { path: '/tmp/file1.ts', action: 'edit', timestamp: '2025-01-15T10:00:00Z' },
      { path: '/tmp/file2.ts', action: 'read', timestamp: '2025-01-15T10:01:00Z' },
    ];

    const context = {
      currentSessionFile: sessionFile,
      filesAccessed,
      gitService: {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getRepositoryName: vi.fn().mockResolvedValue('repo'),
      } as any,
      createProjectPage: vi.fn().mockResolvedValue({ content: [] }),
    };

    await linkSessionToRepository({ repo_path: '/tmp/repo' }, context);

    const updatedContent = await fs.readFile(sessionFile, 'utf-8');
    expect(updatedContent).toContain('files_accessed:');
    expect(updatedContent).toContain('/tmp/file1.ts');
    expect(updatedContent).toContain('/tmp/file2.ts');
  });
});
