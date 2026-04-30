/**
 * Unit tests for createProjectPage tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createProjectPage } from '../../../../src/tools/git/createProjectPage.js';
import type { GitService } from '../../../../src/services/git/GitService.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('createProjectPage', () => {
  let vaultPath: string;
  let context: {
    vaultPath: string;
    gitService: GitService;
    currentSessionId?: string;
    trackProjectCreation?: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vaultPath = await createTestVault('project-page');
    context = {
      vaultPath,
      gitService: {
        getRepositoryName: vi.fn().mockResolvedValue('test-repo'),
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getRemoteUrl: vi.fn().mockResolvedValue('https://github.com/user/test-repo.git'),
      } as unknown as GitService,
      currentSessionId: 'test-session-2026-02-16',
      trackProjectCreation: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should create project page for repository', async () => {
    const result = await createProjectPage({ repo_path: '/tmp/test-repo' }, context);

    expect(result.content[0].text).toContain('Project page created/updated');

    // Verify project directory structure
    const projectDir = path.join(vaultPath, 'projects');
    const dirs = await fs.readdir(projectDir);
    expect(dirs.length).toBeGreaterThanOrEqual(1);

    // Find the project slug directory
    const slug = dirs.find(d => d.includes('test-repo'));
    expect(slug).toBeDefined();

    // Check project.md exists
    const projectFile = path.join(projectDir, slug!, 'project.md');
    const content = await fs.readFile(projectFile, 'utf-8');
    expect(content).toContain('test-repo');
    expect(content).toContain('https://github.com/user/test-repo.git');
  });

  it('should update existing project page with session link', async () => {
    // Create initial project page
    await createProjectPage({ repo_path: '/tmp/test-repo' }, context);

    // Update with new session
    context.currentSessionId = 'new-session-2026-02-17';
    const result = await createProjectPage({ repo_path: '/tmp/test-repo' }, context);

    expect(result.content[0].text).toContain('created/updated');
  });

  it('should track project creation', async () => {
    await createProjectPage({ repo_path: '/tmp/test-repo' }, context);

    expect(context.trackProjectCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test-repo',
      })
    );
  });

  it('does not track project creation when only updating an existing page', async () => {
    // First call creates the page → track fires.
    await createProjectPage({ repo_path: '/tmp/test-repo' }, context);
    expect(context.trackProjectCreation).toHaveBeenCalledTimes(1);

    // Second call finds the page already on disk and only appends a session
    // link → must NOT fire trackProjectCreation again. Otherwise the session's
    // `## Projects Created` section gets pre-existing projects misreported as
    // newly created (especially under Decision 061 step 7, which now creates
    // /updates project pages for every qualifying repo on every close).
    context.currentSessionId = 'second-session';
    await createProjectPage({ repo_path: '/tmp/test-repo' }, context);
    expect(context.trackProjectCreation).toHaveBeenCalledTimes(1);
  });

  it('should create commits subdirectory', async () => {
    await createProjectPage({ repo_path: '/tmp/test-repo' }, context);

    const projectDir = path.join(vaultPath, 'projects');
    const dirs = await fs.readdir(projectDir);
    const slug = dirs.find(d => d.includes('test-repo'))!;

    const commitsDir = path.join(projectDir, slug, 'commits');
    const stat = await fs.stat(commitsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should handle missing remote URL', async () => {
    (context.gitService.getRemoteUrl as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await createProjectPage({ repo_path: '/tmp/test-repo' }, context);

    expect(result.content[0].text).toContain('Project page created/updated');
  });
});
