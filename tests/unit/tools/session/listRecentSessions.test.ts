/**
 * Unit tests for listRecentSessions tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listRecentSessions } from '../../../../src/tools/session/listRecentSessions.js';
import {
  createSessionToolsContext,
  createTestVault,
  cleanupTestVault,
  type SessionToolsContext,
} from '../../../helpers/index.js';
import { createSessionFile } from '../../../helpers/vault.js';

describe('listRecentSessions', () => {
  let vaultPath: string;
  let context: SessionToolsContext;

  beforeEach(async () => {
    // Create a temporary vault for each test
    vaultPath = await createTestVault('list-sessions-test');

    // Create context with the vault path
    context = createSessionToolsContext({
      vaultPath,
    });
  });

  afterEach(async () => {
    // Clean up temporary vault
    await cleanupTestVault(vaultPath);
  });

  describe('slash command enforcement', () => {
    it('should reject calls without _invoked_by_slash_command flag', async () => {
      await expect(listRecentSessions({}, context)).rejects.toThrow(
        'can only be invoked via the /sessions slash command'
      );
    });

    it('should accept calls with _invoked_by_slash_command flag', async () => {
      await expect(
        listRecentSessions({ _invoked_by_slash_command: true }, context)
      ).resolves.toBeDefined();
    });
  });

  describe('empty vault', () => {
    it('should handle vault with no sessions', async () => {
      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('No sessions found');
    });
  });

  describe('session listing', () => {
    it('should list recent sessions with default limit', async () => {
      // Create 7 sessions
      for (let i = 1; i <= 7; i++) {
        await createSessionFile(
          vaultPath,
          `2025-01-${String(15 + i).padStart(2, '0')}_session-${i}`,
          `Session content ${i}`,
          { date: `2025-01-${String(15 + i).padStart(2, '0')}` }
        );
      }

      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('session-7');
      // Should show 5 sessions (default limit)
      const lines = result.content[0].text.split('\n').filter(l => l.match(/^\d+\./));
      expect(lines.length).toBe(5);
    });

    it('should respect custom limit parameter', async () => {
      // Create 5 sessions
      for (let i = 1; i <= 5; i++) {
        await createSessionFile(
          vaultPath,
          `2025-01-${String(15 + i).padStart(2, '0')}_session-${i}`,
          `Session content ${i}`,
          { date: `2025-01-${String(15 + i).padStart(2, '0')}` }
        );
      }

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true, limit: 3 },
        context
      );
      expect(result.content).toHaveLength(1);
      const lines = result.content[0].text.split('\n').filter(l => l.match(/^\d+\./));
      expect(lines.length).toBe(3);
    });

    it('should sort sessions by modification time', async () => {
      await createSessionFile(vaultPath, '2025-01-15_session-1', 'Old session', {
        date: '2025-01-15',
      });
      await new Promise(resolve => setTimeout(resolve, 10)); // ensure modification time difference
      await createSessionFile(vaultPath, '2025-01-16_session-2', 'Mid session', {
        date: '2025-01-16',
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await createSessionFile(vaultPath, '2025-01-17_session-3', 'New session', {
        date: '2025-01-17',
      });

      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      // Most recent should be listed first
      expect(result.content[0].text).toMatch(/1\. .*session-3/);
      expect(result.content[0].text).toMatch(/2\. .*session-2/);
      expect(result.content[0].text).toMatch(/3\. .*session-1/);
    });
  });

  describe('detail levels', () => {
    beforeEach(async () => {
      const sessionContent = `## Summary

Summary of the session.

## Files Accessed

_No files tracked_`;

      await createSessionFile(vaultPath, '2025-01-15_test-session', sessionContent, {
        date: '2025-01-15',
        topics: ['Test Topic'],
        status: 'completed',
        repository: {
          path: '/path/to/repo',
          name: 'test-repo',
        },
      });
    });

    it('should return minimal detail level', async () => {
      const result = await listRecentSessions(
        { _invoked_by_slash_command: true, detail: 'minimal' },
        context
      );
      expect(result.content[0].text).toContain('test-session');
      // Minimal should not include dates in parentheses
      expect(result.content[0].text).not.toMatch(/\(\d{4}-\d{2}-\d{2}\)/);
    });

    it('should return summary detail level (default)', async () => {
      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      expect(result.content[0].text).toContain('test-session');
      // Summary should include date and status icon
      expect(result.content[0].text).toMatch(/✓.*test-session/); // completed = ✓
      expect(result.content[0].text).toContain('(2025-01-15)');
    });

    it('should return detailed level with repository info', async () => {
      const result = await listRecentSessions(
        { _invoked_by_slash_command: true, detail: 'detailed' },
        context
      );
      expect(result.content[0].text).toContain('test-session');
      expect(result.content[0].text).toContain('Repository:');
      expect(result.content[0].text).toContain('test-repo');
    });

    it('should return full level with summary snippets', async () => {
      const result = await listRecentSessions(
        { _invoked_by_slash_command: true, detail: 'full' },
        context
      );
      expect(result.content[0].text).toContain('test-session');
      expect(result.content[0].text).toContain('Summary of the session');
    });
  });

  describe('session metadata extraction', () => {
    it('should extract topic from frontmatter', async () => {
      await createSessionFile(vaultPath, '2025-01-15_my-topic', 'Content', {
        date: '2025-01-15',
        topics: ['My Awesome Topic'],
      });
      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      expect(result.content[0].text).toContain('My Awesome Topic');
    });

    it('should extract status from frontmatter', async () => {
      await createSessionFile(vaultPath, '2025-01-15_in-progress', 'Content', {
        date: '2025-01-15',
        status: 'in-progress',
      });
      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      // in-progress status uses ○ icon
      expect(result.content[0].text).toMatch(/○.*in-progress/);
    });

    it('should handle sessions without frontmatter', async () => {
      await createSessionFile(vaultPath, 'simple-session', 'Plain content');

      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      expect(result.content[0].text).toContain('simple-session');
    });
  });

  describe('monthly directory structure', () => {
    it('should read sessions from monthly directories', async () => {
      await createSessionFile(vaultPath, '2025-01-15_jan-session', 'Content', {
        date: '2025-01-15',
      });
      await createSessionFile(vaultPath, '2025-02-10_feb-session', 'Content', {
        date: '2025-02-10',
      });

      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      const lines = result.content[0].text.split('\n').filter(l => l.match(/^\d+\./));
      expect(lines.length).toBe(2);
      expect(result.content[0].text).toContain('jan-session');
      expect(result.content[0].text).toContain('feb-session');
    });

    it('should handle mix of root and monthly sessions', async () => {
      // Create a monthly session
      await createSessionFile(vaultPath, '2025-03-20_monthly-session', 'March content', {
        date: '2025-03-20',
      });

      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      const lines = result.content[0].text.split('\n').filter(l => l.match(/^\d+\./));
      expect(lines.length).toBeGreaterThan(0);
      expect(result.content[0].text).toContain('monthly-session');
    });
  });

  describe('edge cases', () => {
    it('should handle sessions with very long IDs', async () => {
      const longId = '2025-01-15_' + 'very-long-topic-name-'.repeat(10);
      await createSessionFile(vaultPath, longId, 'Content', { date: '2025-01-15' });

      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      expect(result.content[0].text).toContain('very-long');
    });

    it('should handle sessions with special characters', async () => {
      await createSessionFile(vaultPath, '2025-01-15_topic-with-special', 'Content', {
        date: '2025-01-15',
      });
      const result = await listRecentSessions({ _invoked_by_slash_command: true }, context);
      expect(result.content[0].text).toContain('special');
    });

    it('should handle limit larger than available sessions', async () => {
      await createSessionFile(vaultPath, '2025-01-15_only-session', 'Content', {
        date: '2025-01-15',
      });
      const result = await listRecentSessions(
        { _invoked_by_slash_command: true, limit: 10 },
        context
      );
      const lines = result.content[0].text.split('\n').filter(l => l.match(/^\d+\./));
      expect(lines.length).toBe(1);
    });
  });
});
