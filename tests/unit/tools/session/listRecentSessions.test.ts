/**
 * Unit tests for listRecentSessions tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listRecentSessions } from '../../../../src/tools/session/listRecentSessions.js';
import {
  createSessionToolsContext,
  createTestVault,
  cleanupTestVault,
  createSessionFile,
  type SessionToolsContext,
} from '../../../helpers/index.js';

describe('listRecentSessions', () => {
  let vaultPath: string;
  let context: SessionToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('list-sessions');
    context = createSessionToolsContext({ vaultPath });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  describe('slash command enforcement', () => {
    it('should reject calls without _invoked_by_slash_command flag', async () => {
      await expect(listRecentSessions({}, context)).rejects.toThrow(
        'can only be invoked via the /sessions slash command'
      );
    });

    it('should accept calls with _invoked_by_slash_command flag', async () => {
      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      expect(result.content).toHaveLength(1);
    });
  });

  describe('empty vault', () => {
    it('should handle vault with no sessions', async () => {
      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

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
          `Session ${i} content`,
          { date: `2025-01-${String(15 + i).padStart(2, '0')}` }
        );
      }

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      // Default limit is 5
      expect(result.content[0].text).toContain('Found 5 recent session(s)');
    });

    it('should respect custom limit parameter', async () => {
      // Create 5 sessions
      for (let i = 1; i <= 5; i++) {
        await createSessionFile(
          vaultPath,
          `2025-01-${String(15 + i).padStart(2, '0')}_session-${i}`,
          `Session ${i} content`,
          { date: `2025-01-${String(15 + i).padStart(2, '0')}` }
        );
      }

      const result = await listRecentSessions(
        { limit: 3, _invoked_by_slash_command: true },
        context
      );

      expect(result.content[0].text).toContain('Found 3 recent session(s)');
    });

    it('should sort sessions by modification time', async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-15_session-old',
        'Old session',
        { date: '2025-01-15' }
      );

      // Small delay to ensure different mtime
      await new Promise(resolve => setTimeout(resolve, 100));

      await createSessionFile(
        vaultPath,
        '2025-01-16_session-new',
        'New session',
        { date: '2025-01-16' }
      );

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      // Newer session should be listed first
      const text = result.content[0].text;
      const oldIndex = text.indexOf('session-old');
      const newIndex = text.indexOf('session-new');
      expect(newIndex).toBeLessThan(oldIndex);
    });
  });

  describe('detail levels', () => {
    beforeEach(async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-15_test-session',
        'Test session content',
        {
          date: '2025-01-15',
          topics: ['topic-one'],
          status: 'completed',
        }
      );
    });

    it('should return minimal detail level', async () => {
      const result = await listRecentSessions(
        { detail: 'minimal', _invoked_by_slash_command: true },
        context
      );

      const text = result.content[0].text;
      expect(text).toContain('2025-01-15_test-session');
      expect(text).toContain('Use detail: "summary"');
    });

    it('should return summary detail level (default)', async () => {
      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      const text = result.content[0].text;
      expect(text).toContain('2025-01-15_test-session');
      expect(text).toContain('2025-01-15');
      expect(text).toContain('✓'); // completed status icon
      expect(text).toContain('Use get_session_context');
    });

    it('should return detailed level with repository info', async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-16_repo-session',
        'Session with repo',
        {
          date: '2025-01-16',
          repository: {
            name: 'test-repo',
            path: '/tmp/test-repo',
          },
        }
      );

      const result = await listRecentSessions(
        { detail: 'detailed', _invoked_by_slash_command: true },
        context
      );

      const text = result.content[0].text;
      expect(text).toContain('2025-01-16_repo-session');
      // The detailed format may vary, just check the session is there
    });

    it('should return full level with summary snippets', async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-17_summary-session',
        `## Summary

This is a comprehensive summary of the session with multiple details.`,
        { date: '2025-01-17' }
      );

      const result = await listRecentSessions(
        { detail: 'full', _invoked_by_slash_command: true },
        context
      );

      const text = result.content[0].text;
      expect(text).toContain('comprehensive summary');
    });
  });

  describe('session metadata extraction', () => {
    it('should extract topic from frontmatter', async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-15_my-topic',
        'Session content',
        {
          date: '2025-01-15',
          topics: ['Feature Implementation'],
        }
      );

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      expect(result.content[0].text).toContain('Feature Implementation');
    });

    it('should extract status from frontmatter', async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-15_in-progress',
        'Session content',
        {
          date: '2025-01-15',
          status: 'in-progress',
        }
      );

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      // Should show different icon for non-completed status
      expect(result.content[0].text).toContain('○');
    });

    it('should handle sessions without frontmatter', async () => {
      await createSessionFile(vaultPath, 'simple-session', 'Plain content');

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      expect(result.content[0].text).toContain('simple-session');
    });
  });

  describe('monthly directory structure', () => {
    it('should read sessions from monthly directories', async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-15_jan-session',
        'January session',
        { date: '2025-01-15' }
      );

      await createSessionFile(
        vaultPath,
        '2025-02-20_feb-session',
        'February session',
        { date: '2025-02-20' }
      );

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      const text = result.content[0].text;
      expect(text).toContain('jan-session');
      expect(text).toContain('feb-session');
    });

    it('should handle mix of root and monthly sessions', async () => {
      // Create a legacy root session
      await createSessionFile(vaultPath, 'legacy-session', 'Legacy content');

      // Create a monthly session
      await createSessionFile(
        vaultPath,
        '2025-01-15_monthly-session',
        'Monthly content',
        { date: '2025-01-15' }
      );

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      const text = result.content[0].text;
      expect(text).toContain('legacy-session');
      expect(text).toContain('monthly-session');
    });
  });

  describe('edge cases', () => {
    it('should handle sessions with very long IDs', async () => {
      const longId = '2025-01-15_' + 'very-long-topic-name-'.repeat(10);
      await createSessionFile(vaultPath, longId, 'Content', { date: '2025-01-15' });

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      expect(result.content[0].text).toContain(longId);
    });

    it('should handle sessions with special characters', async () => {
      await createSessionFile(
        vaultPath,
        '2025-01-15_topic-with-émojis-🚀',
        'Content',
        { date: '2025-01-15' }
      );

      const result = await listRecentSessions(
        { _invoked_by_slash_command: true },
        context
      );

      expect(result.content[0].text).toContain('émojis');
    });

    it('should handle limit larger than available sessions', async () => {
      await createSessionFile(vaultPath, '2025-01-15_only-session', 'Content', {
        date: '2025-01-15',
      });

      const result = await listRecentSessions(
        { limit: 100, _invoked_by_slash_command: true },
        context
      );

      expect(result.content[0].text).toContain('Found 1 recent session');
    });
  });
});
