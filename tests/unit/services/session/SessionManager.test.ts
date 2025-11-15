/**
 * SessionManager unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager } from '../../../../src/services/session/SessionManager.js';
import { SessionTracker } from '../../../../src/services/session/SessionTracker.js';
import { RepositoryDetector } from '../../../../src/services/git/RepositoryDetector.js';
import { GitService } from '../../../../src/services/git/GitService.js';
import { VaultError } from '../../../../src/utils/errors.js';
import * as fs from 'fs/promises';

// Mock modules
vi.mock('fs/promises');

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let sessionTracker: SessionTracker;
  let repositoryDetector: RepositoryDetector;
  let gitService: GitService;
  const vaultPath = '/test/vault';

  beforeEach(() => {
    gitService = new GitService();
    sessionTracker = new SessionTracker();
    repositoryDetector = new RepositoryDetector(gitService);
    sessionManager = new SessionManager(vaultPath, sessionTracker, repositoryDetector);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCurrentSessionId', () => {
    it('should return null initially', () => {
      expect(sessionManager.getCurrentSessionId()).toBeNull();
    });
  });

  describe('getCurrentSessionFile', () => {
    it('should return null initially', () => {
      expect(sessionManager.getCurrentSessionFile()).toBeNull();
    });
  });

  describe('hasActiveSession', () => {
    it('should return false initially', () => {
      expect(sessionManager.hasActiveSession()).toBe(false);
    });
  });

  describe('closeSession', () => {
    beforeEach(() => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.spyOn(repositoryDetector, 'getTopCandidate').mockResolvedValue(null);
    });

    it('should create session file with correct structure', async () => {
      const result = await sessionManager.closeSession({
        summary: 'Test session summary',
        topic: 'Test Topic',
      });

      expect(result.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_test-topic$/);
      expect(result.sessionFile).toContain('/test/vault/sessions/');
      expect(result.sessionFile).toContain('.md');
    });

    it('should create session in month-based directory', async () => {
      await sessionManager.closeSession({
        summary: 'Test summary',
      });

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/\/test\/vault\/sessions\/\d{4}-\d{2}$/),
        { recursive: true }
      );
    });

    it('should include file access count', async () => {
      sessionTracker.trackAccess('/test/file1.ts', 'read');
      sessionTracker.trackAccess('/test/file2.ts', 'edit');

      const result = await sessionManager.closeSession({
        summary: 'Test summary',
      });

      expect(result.filesAccessedCount).toBe(2);
    });

    it('should detect repository if not skipped', async () => {
      const mockRepoInfo = {
        path: '/test/repo',
        name: 'test-repo',
        score: 100,
        reasons: ['test'],
        branch: 'main',
      };

      vi.spyOn(repositoryDetector, 'getTopCandidate').mockResolvedValue(mockRepoInfo);
      vi.spyOn(repositoryDetector, 'detectFromFileAccess').mockResolvedValue([mockRepoInfo]);
      vi.spyOn(repositoryDetector, 'isClearWinner').mockReturnValue(true);

      sessionTracker.trackAccess('/test/repo/file.ts', 'edit');

      const result = await sessionManager.closeSession({
        summary: 'Test summary',
      });

      expect(result.repositoriesDetected).toBe(1);
      expect(result.repositories[0].name).toBe('test-repo');
    });

    it('should skip repository detection if requested', async () => {
      const mockGetTopCandidate = vi.spyOn(repositoryDetector, 'getTopCandidate');

      await sessionManager.closeSession({
        summary: 'Test summary',
        skipRepoDetection: true,
      });

      expect(mockGetTopCandidate).not.toHaveBeenCalled();
    });

    it('should include topics from additional context', async () => {
      const result = await sessionManager.closeSession(
        {
          summary: 'Test summary',
        },
        {
          topicsCreated: [
            { title: 'Topic 1', file: '/vault/topics/topic-1.md' },
            { title: 'Topic 2', file: '/vault/topics/topic-2.md' },
          ],
        }
      );

      expect(result.topics).toEqual(['Topic 1', 'Topic 2']);
    });

    it('should include decisions from additional context', async () => {
      const result = await sessionManager.closeSession(
        {
          summary: 'Test summary',
        },
        {
          decisionsCreated: [{ title: 'Decision 1', file: '/vault/decisions/001.md' }],
        }
      );

      expect(result.decisions).toEqual(['Decision 1']);
    });

    it('should set current session after closing', async () => {
      const result = await sessionManager.closeSession({
        summary: 'Test summary',
      });

      expect(sessionManager.getCurrentSessionId()).toBe(result.sessionId);
      expect(sessionManager.getCurrentSessionFile()).toBe(result.sessionFile);
      expect(sessionManager.hasActiveSession()).toBe(true);
    });
  });

  describe('linkRepository', () => {
    beforeEach(() => {
      vi.mocked(fs.readFile).mockResolvedValue(
        '---\ndate: "2025-01-14"\nsession_id: "test"\nstatus: "completed"\ntopics: []\ndecisions: []\n---\n\n# Test\n'
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    });

    it('should throw error if no active session', async () => {
      await expect(sessionManager.linkRepository('/test/repo')).rejects.toThrow(VaultError);
      await expect(sessionManager.linkRepository('/test/repo')).rejects.toThrow(
        'No active session'
      );
    });

    it('should add repository to session frontmatter', async () => {
      // Create a session first
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      await sessionManager.closeSession({
        summary: 'Test',
        skipRepoDetection: true,
      });

      // Clear previous writeFile calls
      vi.mocked(fs.writeFile).mockClear();

      // Now link repository
      await sessionManager.linkRepository('/test/my-repo');

      // Should have called writeFile once for linking repository
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;

      expect(content).toContain('repository:');
      expect(content).toContain('path: "/test/my-repo"');
      expect(content).toContain('name: "my-repo"');
    });

    it('should update existing repository field', async () => {
      const existingContent =
        '---\ndate: "2025-01-14"\nsession_id: "test"\nstatus: "completed"\ntopics: []\ndecisions: []\nrepository:\n  path: "/old/repo"\n  name: "old-repo"\n  commits: []\n---\n\n# Test\n';

      vi.mocked(fs.readFile).mockResolvedValue(existingContent);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      await sessionManager.closeSession({
        summary: 'Test',
        skipRepoDetection: true,
      });

      // Clear previous calls
      vi.mocked(fs.writeFile).mockClear();

      // Mock readFile to return existing content (for linkRepository to read)
      vi.mocked(fs.readFile).mockResolvedValue(existingContent);

      await sessionManager.linkRepository('/test/new-repo');

      // Should have called writeFile once for linking repository
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;

      expect(content).toContain('path: "/test/new-repo"');
      expect(content).toContain('name: "new-repo"');
      expect(content).not.toContain('/old/repo');
    });
  });

  describe('getSessionContext', () => {
    const mockSessionContent =
      '---\ndate: "2025-01-14"\nsession_id: "2025-01-14_10-30-00"\nstatus: "completed"\ntopics: []\ndecisions: []\n---\n\n# Test Session\n\nSession content here';

    beforeEach(() => {
      vi.mocked(fs.readFile).mockResolvedValue(mockSessionContent);
      vi.mocked(fs.access).mockResolvedValue(undefined);
    });

    it('should read session context from file', async () => {
      const context = await sessionManager.getSessionContext('2025-01-14_10-30-00');

      expect(context.metadata.date).toBe('2025-01-14');
      expect(context.metadata.session_id).toBe('2025-01-14_10-30-00');
      expect(context.content).toContain('Session content here');
    });

    it('should use current session if no ID provided', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.spyOn(repositoryDetector, 'getTopCandidate').mockResolvedValue(null);

      await sessionManager.closeSession({
        summary: 'Test',
      });

      const context = await sessionManager.getSessionContext();

      expect(context.filePath).toBe(sessionManager.getCurrentSessionFile());
    });

    it('should throw error if no session ID and no active session', async () => {
      await expect(sessionManager.getSessionContext()).rejects.toThrow(VaultError);
    });

    it('should parse session ID to find file path', async () => {
      await sessionManager.getSessionContext('2025-01-14_10-30-00');

      expect(fs.access).toHaveBeenCalledWith('/test/vault/sessions/2025-01/2025-01-14_10-30-00.md');
    });

    it('should throw error if session file not found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      await expect(sessionManager.getSessionContext('2025-01-14_10-30-00')).rejects.toThrow(
        VaultError
      );
    });

    it('should throw error if session file has invalid format', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# No frontmatter\n\nContent here');

      await expect(sessionManager.getSessionContext('2025-01-14_10-30-00')).rejects.toThrow(
        VaultError
      );
      await expect(sessionManager.getSessionContext('2025-01-14_10-30-00')).rejects.toThrow(
        'no frontmatter'
      );
    });
  });

  describe('clearState', () => {
    it('should clear session tracker', () => {
      sessionTracker.trackAccess('/test/file.ts', 'read');

      sessionManager.clearState();

      expect(sessionTracker.getAccessCount()).toBe(0);
    });

    it('should preserve current session references', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.spyOn(repositoryDetector, 'getTopCandidate').mockResolvedValue(null);

      const result = await sessionManager.closeSession({
        summary: 'Test',
      });

      sessionManager.clearState();

      expect(sessionManager.getCurrentSessionId()).toBe(result.sessionId);
      expect(sessionManager.getCurrentSessionFile()).toBe(result.sessionFile);
    });
  });
});
