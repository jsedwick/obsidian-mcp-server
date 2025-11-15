/**
 * Unit tests for closeSession tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { closeSession } from '../../../../src/tools/session/closeSession.js';
import {
  createSessionToolsContext,
  createTestVault,
  cleanupTestVault,
  vaultFileExists,
  readVaultFile,
  type SessionToolsContext,
} from '../../../helpers/index.js';

describe('closeSession', () => {
  let vaultPath: string;
  let context: SessionToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('close-session');
    context = createSessionToolsContext({
      vaultPath,
      currentSessionId: null,
      findGitRepos: vi.fn().mockResolvedValue([]),
      getRepoInfo: vi.fn().mockResolvedValue({ name: 'test-repo', branch: 'main', remote: null }),
      createProjectPage: vi.fn().mockResolvedValue({ content: [] }),
      findRelatedContentInText: vi.fn().mockResolvedValue({ topics: [], decisions: [], projects: [] }),
      vaultCustodian: vi.fn().mockResolvedValue({ content: [{ text: 'Vault check complete' }] }),
      setCurrentSession: vi.fn(),
      clearSessionState: vi.fn(),
    });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  describe('slash command enforcement', () => {
    it('should reject calls without _invoked_by_slash_command flag', async () => {
      await expect(
        closeSession(
          {
            summary: 'Test session',
          },
          context
        )
      ).rejects.toThrow('can ONLY be called via the /close slash command');
    });

    it('should accept calls with _invoked_by_slash_command flag', async () => {
      const result = await closeSession(
        {
          summary: 'Test session summary',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Session created');
    });
  });

  describe('session file creation', () => {
    it('should create session file in monthly directory', async () => {
      const result = await closeSession(
        {
          summary: 'Test session summary',
          _invoked_by_slash_command: true,
        },
        context
      );

      // Extract session ID from result
      const sessionIdMatch = result.content[0].text.match(/Session created: (.+)/);
      expect(sessionIdMatch).toBeTruthy();

      const sessionId = sessionIdMatch![1].trim();
      const dateStr = sessionId.split('_')[0];
      const monthStr = dateStr.substring(0, 7); // YYYY-MM

      const exists = await vaultFileExists(vaultPath, `sessions/${monthStr}/${sessionId}.md`);
      expect(exists).toBe(true);
    });

    it('should create session with topic in filename', async () => {
      const result = await closeSession(
        {
          summary: 'Session with specific topic',
          topic: 'My Feature',
          _invoked_by_slash_command: true,
        },
        context
      );

      // Should have "my-feature" in the result
      expect(result.content[0].text).toMatch(/my-feature/);
    });

    it('should include summary in session file', async () => {
      const summary = 'This is a detailed session summary with multiple points.';
      const result = await closeSession(
        {
          summary,
          _invoked_by_slash_command: true,
        },
        context
      );

      const sessionIdMatch = result.content[0].text.match(/Session created: (.+)/);
      const sessionId = sessionIdMatch![1].trim();
      const dateStr = sessionId.split('_')[0];
      const monthStr = dateStr.substring(0, 7);

      const content = await readVaultFile(vaultPath, `sessions/${monthStr}/${sessionId}.md`);
      expect(content).toContain(summary);
    });
  });

  describe('content tracking', () => {
    it('should link created topics', async () => {
      context.topicsCreated.push({
        slug: 'test-topic',
        title: 'Test Topic',
        file: `${vaultPath}/topics/test-topic.md`,
      });

      const result = await closeSession(
        {
          summary: 'Created a topic',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(result.content[0].text).toContain('Topics linked (1)');
      expect(result.content[0].text).toContain('Test Topic');
    });

    it('should link created decisions', async () => {
      context.decisionsCreated.push({
        slug: '001-test-decision',
        title: 'Test Decision',
        file: `${vaultPath}/decisions/vault/001-test-decision.md`,
      });

      const result = await closeSession(
        {
          summary: 'Made a decision',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(result.content[0].text).toContain('Decisions linked (1)');
      expect(result.content[0].text).toContain('Test Decision');
    });

    it('should track files accessed', async () => {
      context.filesAccessed.push(
        { path: '/tmp/file1.ts', action: 'read', timestamp: new Date().toISOString() },
        { path: '/tmp/file2.ts', action: 'edit', timestamp: new Date().toISOString() }
      );

      const result = await closeSession(
        {
          summary: 'Accessed files',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(result.content[0].text).toContain('Files accessed: 2');
    });
  });

  describe('Git repository detection', () => {
    it('should detect and link repository when files accessed', async () => {
      const repoPath = '/tmp/test-repo';
      context.filesAccessed.push({
        path: `${repoPath}/src/file.ts`,
        action: 'edit',
        timestamp: new Date().toISOString(),
      });

      context.findGitRepos = vi.fn().mockResolvedValue([repoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'test-repo',
        branch: 'main',
        remote: 'https://github.com/user/test-repo.git',
      });

      const result = await closeSession(
        {
          summary: 'Modified repository files',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(result.content[0].text).toContain('Git Repository Auto-Linked');
      expect(result.content[0].text).toContain('test-repo');
      expect(context.createProjectPage).toHaveBeenCalledWith({ repo_path: repoPath });
    });

    it('should handle missing repository gracefully', async () => {
      context.findGitRepos = vi.fn().mockResolvedValue([]);

      const result = await closeSession(
        {
          summary: 'No repository',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(result.content[0].text).not.toContain('Git Repository Auto-Linked');
    });
  });

  describe('vault custodian integration', () => {
    it('should run vault custodian on created files', async () => {
      context.topicsCreated.push({
        slug: 'test-topic',
        title: 'Test Topic',
        file: `${vaultPath}/topics/test-topic.md`,
      });

      await closeSession(
        {
          summary: 'Created content',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(context.vaultCustodian).toHaveBeenCalled();
      const callArgs = (context.vaultCustodian as any).mock.calls[0][0];
      expect(callArgs.files_to_check).toContain(`${vaultPath}/topics/test-topic.md`);
    });

    it('should handle vault custodian errors gracefully', async () => {
      context.vaultCustodian = vi.fn().mockRejectedValue(new Error('Custodian error'));

      const result = await closeSession(
        {
          summary: 'Test session',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(result.content[0].text).toContain('Vault custodian check failed');
    });
  });

  describe('state management', () => {
    it('should set current session', async () => {
      await closeSession(
        {
          summary: 'Test session',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(context.setCurrentSession).toHaveBeenCalled();
    });

    it('should clear session state after creation', async () => {
      await closeSession(
        {
          summary: 'Test session',
          _invoked_by_slash_command: true,
        },
        context
      );

      expect(context.clearSessionState).toHaveBeenCalled();
    });
  });
});
