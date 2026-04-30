/**
 * SessionStateFile unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SessionStateFile } from '../../../../src/services/session/SessionStateFile.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('SessionStateFile', () => {
  let vaultPath: string;
  const recoveryDir = '.obsidian-mcp/recovery';

  beforeEach(async () => {
    vaultPath = await createTestVault('session-state');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('initialize', () => {
    it('should create a per-session JSON recovery file', async () => {
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      const files = await fs.readdir(path.join(vaultPath, recoveryDir));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^session-.*\.json$/);

      const content = JSON.parse(
        await fs.readFile(path.join(vaultPath, recoveryDir, files[0]), 'utf-8')
      );
      expect(content.schemaVersion).toBe(3);
      expect(content.phase1Completed).toBe(false);
      expect(content.filesAccessed).toEqual([]);
      expect(content.topicsCreated).toEqual([]);
      expect(content.decisionsCreated).toEqual([]);
      expect(content.projectsCreated).toEqual([]);
      expect(content.phase1SessionData).toBeNull();
    });

    it('should clean up legacy session-state.md if it exists', async () => {
      const legacyPath = path.join(vaultPath, 'session-state.md');
      await fs.writeFile(legacyPath, 'legacy content', 'utf-8');

      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      // Give fire-and-forget cleanup time to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      await expect(fs.access(legacyPath)).rejects.toThrow();
    });
  });

  describe('storePhase1Data / restore round-trip', () => {
    it('should store and then restore Phase 1 data', async () => {
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      const phase1Data = {
        sessionId: 'test-session',
        filePath: '/vault/sessions/test.md',
        commits: ['abc123'],
      };

      await ssf.storePhase1Data(phase1Data);

      const restored = await ssf.restore();
      expect(restored).not.toBeNull();
      expect(restored!.phase1Completed).toBe(true);
      expect(restored!.phase1SessionData).toEqual(phase1Data);
    });
  });

  describe('filesAccessed via storePhase1Data flush', () => {
    it('should flush pending file accesses when storePhase1Data is called', async () => {
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      // Track a file access (queued, not yet flushed)
      ssf.trackFileAccess({
        path: '/vault/topics/test.md',
        action: 'read',
        timestamp: '2025-01-15T10:01:00Z',
      });

      // storePhase1Data explicitly flushes pending accesses
      await ssf.storePhase1Data({ key: 'value' });

      const restored = await ssf.restore();
      expect(restored).not.toBeNull();
      expect(restored!.filesAccessed).toHaveLength(1);
      expect(restored!.filesAccessed[0].path).toBe('/vault/topics/test.md');
    });
  });

  describe('eager flush durability', () => {
    it('should persist file accesses without waiting on a debounce timer', async () => {
      // Regression: prior 500ms-debounce design lost entries on fork-restart
      // because the timer kept getting reset by continuous activity. Eager
      // flush guarantees on-disk durability before the next async tool call.
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      ssf.trackFileAccess({
        path: '/vault/topics/eager-1.md',
        action: 'read',
        timestamp: '2025-01-15T10:01:00Z',
      });
      ssf.trackFileAccess({
        path: '/vault/topics/eager-2.md',
        action: 'edit',
        timestamp: '2025-01-15T10:01:00Z',
      });

      // Drain the writeQueue without using a wall-clock wait — relying on
      // setTimeout would just retest the bug that was fixed.
      await (ssf as unknown as { writeQueue: Promise<unknown> }).writeQueue;

      const restored = await ssf.restore();
      expect(restored).not.toBeNull();
      expect(restored!.filesAccessed).toHaveLength(2);
      expect(restored!.filesAccessed.map(f => f.path)).toEqual([
        '/vault/topics/eager-1.md',
        '/vault/topics/eager-2.md',
      ]);
    });
  });

  describe('tracker eager-flush durability (Decision 065)', () => {
    it('should persist topic, decision, and project creations without a debounce wait', async () => {
      // Decision 065: tracker arrays survive fork-restart by sharing the
      // eager-flush pattern proven for filesAccessed in Decision 063.
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      ssf.trackTopicCreation({
        slug: 'topic-a',
        title: 'Topic A',
        file: '/vault/topics/topic-a.md',
      });
      ssf.trackDecisionCreation({
        slug: '001-foo-vs-bar',
        title: 'Foo vs Bar',
        file: '/vault/decisions/vault/001-foo-vs-bar.md',
      });
      ssf.trackProjectCreation({
        slug: 'my-repo',
        name: 'my-repo',
        file: '/vault/projects/my-repo/project.md',
      });

      // Drain the writeQueue without a wall-clock wait — same trick as the
      // filesAccessed eager-flush test.
      await (ssf as unknown as { writeQueue: Promise<unknown> }).writeQueue;

      const restored = await ssf.restore();
      expect(restored).not.toBeNull();
      expect(restored!.topicsCreated).toHaveLength(1);
      expect(restored!.topicsCreated[0].slug).toBe('topic-a');
      expect(restored!.decisionsCreated).toHaveLength(1);
      expect(restored!.decisionsCreated[0].slug).toBe('001-foo-vs-bar');
      expect(restored!.projectsCreated).toHaveLength(1);
      expect(restored!.projectsCreated[0].slug).toBe('my-repo');
    });

    it('should silently skip tracker calls before initialize', () => {
      const ssf = new SessionStateFile(vaultPath);
      // Should not throw on any of the three tracker entry points.
      ssf.trackTopicCreation({ slug: 's', title: 't', file: 'f' });
      ssf.trackDecisionCreation({ slug: 's', title: 't', file: 'f' });
      ssf.trackProjectCreation({ slug: 's', name: 'n', file: 'f' });
    });
  });

  describe('v2 forward-compat (Decision 065)', () => {
    it('should backfill missing tracker fields when restoring a pre-v3 file', async () => {
      // A session that was already in flight when the runtime upgraded from
      // v2 → v3 has no tracker fields on disk. restore() must default them
      // to [] so subsequent flushes can push without crashing.
      const dir = path.join(vaultPath, recoveryDir);
      await fs.mkdir(dir, { recursive: true });

      const v2State = {
        schemaVersion: 2,
        sessionStart: '2025-01-15T10:00:00',
        lastUpdated: '2025-01-15T10:00:00',
        phase1Completed: false,
        filesAccessed: [],
        phase1SessionData: null,
      };
      await fs.writeFile(
        path.join(dir, 'session-2025-01-15T10-00-00-000.json'),
        JSON.stringify(v2State),
        'utf-8'
      );

      const ssf = new SessionStateFile(vaultPath);
      const restored = await ssf.restore();
      expect(restored).not.toBeNull();
      expect(restored!.topicsCreated).toEqual([]);
      expect(restored!.decisionsCreated).toEqual([]);
      expect(restored!.projectsCreated).toEqual([]);

      // A track call after restoring a v2 file should land cleanly.
      ssf.trackTopicCreation({
        slug: 'after-restore',
        title: 'After Restore',
        file: '/vault/topics/after-restore.md',
      });
      await (ssf as unknown as { writeQueue: Promise<unknown> }).writeQueue;

      const reRestored = await ssf.restore();
      expect(reRestored!.topicsCreated).toHaveLength(1);
      expect(reRestored!.topicsCreated[0].slug).toBe('after-restore');
    });
  });

  describe('missing recovery directory', () => {
    it('should return null when recovery directory does not exist', async () => {
      const ssf = new SessionStateFile(vaultPath);
      // Don't initialize — directory doesn't exist
      const restored = await ssf.restore();
      expect(restored).toBeNull();
    });
  });

  describe('corrupt content', () => {
    it('should return null for invalid/corrupt JSON content', async () => {
      const ssf = new SessionStateFile(vaultPath);
      const dir = path.join(vaultPath, recoveryDir);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(
        path.join(dir, 'session-2025-01-15T10-00-00-000.json'),
        'not valid json',
        'utf-8'
      );

      const restored = await ssf.restore();
      expect(restored).toBeNull();
    });
  });

  describe('deep clone prevention', () => {
    it('should not allow mutation of restored data to affect stored state', async () => {
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      const phase1Data = { key: 'original' };
      await ssf.storePhase1Data(phase1Data);

      const restored1 = await ssf.restore();
      expect(restored1).not.toBeNull();

      // Mutate the restored object
      restored1!.phase1SessionData.key = 'mutated';

      // Restore again — should still have original value (read from disk)
      const restored2 = await ssf.restore();
      expect(restored2!.phase1SessionData.key).toBe('original');
    });
  });

  describe('deleteRecoveryFile', () => {
    it('should delete the current session recovery file', async () => {
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      const files = await fs.readdir(path.join(vaultPath, recoveryDir));
      expect(files).toHaveLength(1);

      await ssf.deleteRecoveryFile();

      const filesAfter = await fs.readdir(path.join(vaultPath, recoveryDir));
      expect(filesAfter).toHaveLength(0);
    });

    it('should be safe to call when no file is initialized', async () => {
      const ssf = new SessionStateFile(vaultPath);
      // Should not throw
      await ssf.deleteRecoveryFile();
    });
  });

  describe('concurrent sessions', () => {
    it('should create separate recovery files for concurrent sessions', async () => {
      const ssf1 = new SessionStateFile(vaultPath);
      const ssf2 = new SessionStateFile(vaultPath);

      await ssf1.initialize(new Date('2025-01-15T10:00:00.000Z'));
      await ssf2.initialize(new Date('2025-01-15T10:00:00.001Z'));

      const files = await fs.readdir(path.join(vaultPath, recoveryDir));
      expect(files).toHaveLength(2);
      expect(files[0]).not.toBe(files[1]);
    });
  });

  describe('stale file cleanup', () => {
    it('should remove recovery files older than 24 hours', async () => {
      const dir = path.join(vaultPath, recoveryDir);
      await fs.mkdir(dir, { recursive: true });

      // Create a stale file with old mtime
      const staleFile = path.join(dir, 'session-2025-01-14T08-00-00-000.json');
      await fs.writeFile(staleFile, '{}', 'utf-8');
      const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      await fs.utimes(staleFile, oldTime / 1000, oldTime / 1000);

      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      // Give fire-and-forget cleanup time to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const files = await fs.readdir(dir);
      // Only the new session file should remain
      expect(files).toHaveLength(1);
      expect(files[0]).not.toBe('session-2025-01-14T08-00-00-000.json');
    });
  });

  describe('guards', () => {
    it('should silently skip trackFileAccess before initialize', () => {
      const ssf = new SessionStateFile(vaultPath);
      // Should not throw
      ssf.trackFileAccess({
        path: '/vault/topics/test.md',
        action: 'read',
        timestamp: '2025-01-15T10:01:00Z',
      });
    });

    it('should silently skip storePhase1Data before initialize', async () => {
      const ssf = new SessionStateFile(vaultPath);
      // Should not throw
      await ssf.storePhase1Data({ key: 'value' });
    });
  });

  describe('write race between storePhase1Data and trackFileAccess', () => {
    it('should preserve Phase 1 data when file accesses fire concurrently', async () => {
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      const phase1Data = { sessionId: 'race-test', commits: ['abc123'] };

      // Fire storePhase1Data and a burst of trackFileAccess calls concurrently.
      // Each trackFileAccess kicks off flushFileAccesses immediately; without
      // the write mutex, those flushes can read the pre-Phase-1 state, append,
      // and write back, clobbering phase1Completed/phase1SessionData.
      const phase1Promise = ssf.storePhase1Data(phase1Data);
      for (let i = 0; i < 20; i++) {
        ssf.trackFileAccess({
          path: `/vault/topics/race-${i}.md`,
          action: 'read',
          timestamp: '2025-01-15T10:01:00Z',
        });
      }

      await phase1Promise;
      // Wait briefly for any in-flight flushes to drain through the writeQueue.
      await new Promise(resolve => setTimeout(resolve, 100));

      const restored = await ssf.restore();
      expect(restored).not.toBeNull();
      expect(restored!.phase1Completed).toBe(true);
      expect(restored!.phase1SessionData).toEqual(phase1Data);
      expect(restored!.filesAccessed.length).toBeGreaterThan(0);
    });
  });

  describe('restore picks newest file', () => {
    it('should restore from the most recent recovery file', async () => {
      const dir = path.join(vaultPath, recoveryDir);
      await fs.mkdir(dir, { recursive: true });

      // Write an older file
      const olderState = {
        schemaVersion: 2,
        sessionStart: '2025-01-15T09:00:00',
        lastUpdated: '2025-01-15T09:00:00',
        phase1Completed: false,
        filesAccessed: [],
        phase1SessionData: { session: 'older' },
      };
      await fs.writeFile(
        path.join(dir, 'session-2025-01-15T09-00-00-000.json'),
        JSON.stringify(olderState),
        'utf-8'
      );

      // Write a newer file
      const newerState = {
        schemaVersion: 2,
        sessionStart: '2025-01-15T10:00:00',
        lastUpdated: '2025-01-15T10:00:00',
        phase1Completed: true,
        filesAccessed: [],
        phase1SessionData: { session: 'newer' },
      };
      await fs.writeFile(
        path.join(dir, 'session-2025-01-15T10-00-00-000.json'),
        JSON.stringify(newerState),
        'utf-8'
      );

      const ssf = new SessionStateFile(vaultPath);
      const restored = await ssf.restore();
      expect(restored).not.toBeNull();
      expect(restored!.phase1SessionData).toEqual({ session: 'newer' });
    });
  });
});
