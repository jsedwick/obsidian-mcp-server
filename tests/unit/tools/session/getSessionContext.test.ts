/**
 * Unit tests for getSessionContext tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSessionContext } from '../../../../src/tools/session/getSessionContext.js';
import {
  createSessionToolsContext,
  createTestVault,
  cleanupTestVault,
  createSessionFile,
  type SessionToolsContext,
} from '../../../helpers/index.js';

describe('getSessionContext', () => {
  let vaultPath: string;
  let context: SessionToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('get-session');
    context = createSessionToolsContext({
      vaultPath,
      currentSessionId: null,
      currentSessionFile: null,
    });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  describe('current session retrieval', () => {
    it('should retrieve current session context', async () => {
      const sessionId = 'test-session-2025-01-15';
      const sessionContent = 'This is the test session content.';
      const sessionFile = await createSessionFile(vaultPath, sessionId, sessionContent);

      context.currentSessionId = sessionId;
      context.currentSessionFile = sessionFile;

      const result = await getSessionContext({}, context);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain(`Session context for ${sessionId}`);
      expect(result.content[0].text).toContain(sessionContent);
    });

    it('should throw error when no session ID provided and no active session', async () => {
      await expect(getSessionContext({}, context)).rejects.toThrow(
        'No session ID provided and no active session'
      );
    });
  });

  describe('specific session retrieval', () => {
    it('should retrieve specific session by ID from monthly directory', async () => {
      const sessionId = '2025-01-15_14-30-00';
      const sessionContent = 'Monthly session content';
      await createSessionFile(vaultPath, sessionId, sessionContent, {
        date: '2025-01-15',
      });

      const result = await getSessionContext({ session_id: sessionId }, context);

      expect(result.content[0].text).toContain(`Session context for ${sessionId}`);
      expect(result.content[0].text).toContain(sessionContent);
    });

    it('should fall back to root sessions directory if not in monthly dir', async () => {
      const sessionId = 'legacy-session';
      const sessionContent = 'Legacy session content';
      await createSessionFile(vaultPath, sessionId, sessionContent);

      const result = await getSessionContext({ session_id: sessionId }, context);

      expect(result.content[0].text).toContain(sessionContent);
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        getSessionContext({ session_id: 'non-existent-session' }, context)
      ).rejects.toThrow();
    });
  });

  describe('session ID extraction', () => {
    it('should extract month from session ID with date prefix', async () => {
      const sessionId = '2025-02-20_10-15-30_my-topic';
      const sessionContent = 'February session';
      await createSessionFile(vaultPath, sessionId, sessionContent, {
        date: '2025-02-20',
      });

      const result = await getSessionContext({ session_id: sessionId }, context);

      expect(result.content[0].text).toContain(sessionContent);
    });

    it('should handle session ID without date prefix', async () => {
      const sessionId = 'custom-session-name';
      const sessionContent = 'Custom session';
      await createSessionFile(vaultPath, sessionId, sessionContent);

      const result = await getSessionContext({ session_id: sessionId }, context);

      expect(result.content[0].text).toContain(sessionContent);
    });
  });

  describe('content formatting', () => {
    it('should include full frontmatter and content', async () => {
      const sessionId = '2025-01-15_14-30-00';
      const sessionContent = 'Session with metadata';
      await createSessionFile(vaultPath, sessionId, sessionContent, {
        date: '2025-01-15',
        topics: ['topic-one', 'topic-two'],
        decisions: ['decision-001'],
        status: 'completed',
      });

      const result = await getSessionContext({ session_id: sessionId }, context);

      const text = result.content[0].text;
      expect(text).toContain('date:');
      expect(text).toContain('topics:');
      expect(text).toContain('decisions:');
      expect(text).toContain('status:');
      expect(text).toContain(sessionContent);
    });

    it('should preserve markdown formatting in content', async () => {
      const sessionContent = `# Session Summary

## What We Did
- Item one
- Item two

**Bold text** and *italic text*.

\`\`\`typescript
const code = 'example';
\`\`\``;

      const sessionId = 'markdown-session';
      await createSessionFile(vaultPath, sessionId, sessionContent);

      const result = await getSessionContext({ session_id: sessionId }, context);

      const text = result.content[0].text;
      expect(text).toContain('# Session Summary');
      expect(text).toContain('**Bold text**');
      expect(text).toContain('```typescript');
    });
  });

  describe('edge cases', () => {
    it('should handle session with very long content', async () => {
      const longContent = 'Lorem ipsum '.repeat(1000);
      const sessionId = 'long-session';
      await createSessionFile(vaultPath, sessionId, longContent);

      const result = await getSessionContext({ session_id: sessionId }, context);

      expect(result.content[0].text).toContain(longContent);
    });

    it('should handle session with special characters', async () => {
      const specialContent = 'Content with émojis 🚀 and unicode 中文';
      const sessionId = 'special-session';
      await createSessionFile(vaultPath, sessionId, specialContent);

      const result = await getSessionContext({ session_id: sessionId }, context);

      expect(result.content[0].text).toContain(specialContent);
    });

    it('should handle empty session content', async () => {
      const sessionId = 'empty-session';
      await createSessionFile(vaultPath, sessionId, '');

      const result = await getSessionContext({ session_id: sessionId }, context);

      expect(result.content[0].text).toContain(`Session context for ${sessionId}`);
    });
  });
});
