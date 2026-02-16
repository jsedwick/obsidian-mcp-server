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

  beforeEach(async () => {
    vaultPath = await createTestVault('session-state');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  describe('initialize', () => {
    it('should create the session-state.md file', async () => {
      const ssf = new SessionStateFile(vaultPath);
      await ssf.initialize(new Date('2025-01-15T10:00:00Z'));

      const content = await fs.readFile(path.join(vaultPath, 'session-state.md'), 'utf-8');
      expect(content).toContain('schema_version: 1');
      expect(content).toContain('phase1_completed: false');
      expect(content).toContain('# Session State');
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

  describe('missing file', () => {
    it('should return null when session-state.md does not exist', async () => {
      const ssf = new SessionStateFile(vaultPath);
      // Don't initialize — file doesn't exist
      const restored = await ssf.restore();
      expect(restored).toBeNull();
    });
  });

  describe('corrupt content', () => {
    it('should return null for invalid/corrupt content', async () => {
      const ssf = new SessionStateFile(vaultPath);
      const filePath = path.join(vaultPath, 'session-state.md');

      await fs.writeFile(filePath, 'not valid frontmatter content at all', 'utf-8');

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
});
