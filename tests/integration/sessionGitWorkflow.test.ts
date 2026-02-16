/**
 * Integration tests for the session/Git workflow
 *
 * E2E: File tracking → repo detection → commit detection → session close workflow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackFileAccess } from '../../src/tools/session/trackFileAccess.js';
import { closeSession, findSessionCommits } from '../../src/tools/session/closeSession.js';
import {
  createSessionToolsContext,
  createTestVault,
  cleanupTestVault,
  type SessionToolsContext,
} from '../helpers/index.js';
import { createTestGitRepo, createTestCommit, cleanupTestGitRepo } from '../helpers/git.js';

// Mock the logger to prevent noise
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Session & Git Workflow', () => {
  let vaultPath: string;
  let context: SessionToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('session-git-workflow');
    context = createSessionToolsContext({
      vaultPath,
      allVaultPaths: [vaultPath],
      currentSessionId: null,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('File access tracking', () => {
    it('should track file access in context filesAccessed array', () => {
      const result = trackFileAccess(
        { path: '/tmp/test-file.ts', action: 'read' },
        { filesAccessed: context.filesAccessed }
      );

      expect(result.content[0].text).toContain('File access tracked');
      expect(context.filesAccessed).toHaveLength(1);
      expect(context.filesAccessed[0].path).toBe('/tmp/test-file.ts');
      expect(context.filesAccessed[0].action).toBe('read');
    });

    it('should track multiple file accesses', () => {
      trackFileAccess(
        { path: '/tmp/file1.ts', action: 'read' },
        { filesAccessed: context.filesAccessed }
      );
      trackFileAccess(
        { path: '/tmp/file2.ts', action: 'edit' },
        { filesAccessed: context.filesAccessed }
      );
      trackFileAccess(
        { path: '/tmp/file3.ts', action: 'create' },
        { filesAccessed: context.filesAccessed }
      );

      expect(context.filesAccessed).toHaveLength(3);
      expect(context.filesAccessed[0].action).toBe('read');
      expect(context.filesAccessed[1].action).toBe('edit');
      expect(context.filesAccessed[2].action).toBe('create');
    });

    it('should include timestamps in tracked entries', () => {
      trackFileAccess(
        { path: '/tmp/timestamped.ts', action: 'read' },
        { filesAccessed: context.filesAccessed }
      );

      expect(context.filesAccessed[0].timestamp).toBeDefined();
      // Verify it's an ISO timestamp string
      const parsed = new Date(context.filesAccessed[0].timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });
  });

  describe('Session commit detection with real Git repos', () => {
    let repoPath: string;

    beforeEach(async () => {
      repoPath = await createTestGitRepo({
        name: 'session-test-repo',
        branch: 'main',
      });
    });

    afterEach(async () => {
      await cleanupTestGitRepo(repoPath);
    });

    it('should find commits made after session start time', async () => {
      // Set a session start time slightly in the past
      const sessionStart = new Date(Date.now() - 2000);

      // Create a commit after session start
      const commitHash = await createTestCommit(repoPath, {
        message: 'Session work commit',
        files: { 'src/feature.ts': 'export function feature() { return true; }' },
      });

      // findSessionCommits returns string[] of commit hashes
      const commits = await findSessionCommits(repoPath, sessionStart);

      expect(commits.length).toBeGreaterThanOrEqual(1);
      expect(commits).toContain(commitHash);
    });

    it('should return empty array when sessionStartTime is null', async () => {
      // When no session start time, should return empty
      const commits = await findSessionCommits(repoPath, null);
      expect(commits).toHaveLength(0);
    });

    it('should detect multiple commits in a session', async () => {
      const sessionStart = new Date(Date.now() - 2000);

      await createTestCommit(repoPath, {
        message: 'First session commit',
        files: { 'file1.ts': 'content 1' },
      });

      await createTestCommit(repoPath, {
        message: 'Second session commit',
        files: { 'file2.ts': 'content 2' },
      });

      const commits = await findSessionCommits(repoPath, sessionStart);

      expect(commits.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Session close Phase 1 (two-phase workflow)', () => {
    it('should return session_data with Phase 1 analysis', async () => {
      const sessionContext = createSessionToolsContext({
        vaultPath,
        allVaultPaths: [vaultPath],
        currentSessionId: null,
        getSessionStartTime: vi.fn().mockReturnValue(null),
        findGitRepos: vi.fn().mockResolvedValue([]),
      });

      const result = await closeSession(
        {
          summary: 'Implemented feature X and fixed bug Y.',
          topic: 'Feature X Implementation',
          _invoked_by_slash_command: true,
        },
        sessionContext
      );

      // Phase 1 should return text with analysis
      expect(result.content[0].text).toBeDefined();
      expect(result.content.length).toBeGreaterThanOrEqual(1);

      // Phase 1 should have stored session_data for Phase 2 recovery
      expect(sessionContext.storePhase1SessionData).toHaveBeenCalled();
      expect(sessionContext.markPhase1Complete).toHaveBeenCalled();
    });

    it('should include topic slug in session ID when topic is provided', async () => {
      const sessionContext = createSessionToolsContext({
        vaultPath,
        allVaultPaths: [vaultPath],
        currentSessionId: null,
        getSessionStartTime: vi.fn().mockReturnValue(null),
        findGitRepos: vi.fn().mockResolvedValue([]),
      });

      await closeSession(
        {
          summary: 'Test session.',
          topic: 'My Custom Topic',
          _invoked_by_slash_command: true,
        },
        sessionContext
      );

      // Verify the stored session data has a sessionId containing the topic slug
      const storeCall = (sessionContext.storePhase1SessionData as any).mock.calls[0][0];
      expect(storeCall.sessionId).toContain('my-custom-topic');
      expect(storeCall.sessionFile).toContain('my-custom-topic');
    });
  });

  describe('closeSession orchestration', () => {
    it('should handle close without commits (single-phase path)', async () => {
      const sessionContext = createSessionToolsContext({
        vaultPath,
        allVaultPaths: [vaultPath],
        currentSessionId: null,
        getSessionStartTime: vi.fn().mockReturnValue(null),
        findGitRepos: vi.fn().mockResolvedValue([]),
      });

      const result = await closeSession(
        {
          summary: 'Quick session with no code changes.',
          _invoked_by_slash_command: true,
        },
        sessionContext
      );

      // Should succeed and create a session
      expect(result.content[0].text).toBeDefined();
    });
  });
});
