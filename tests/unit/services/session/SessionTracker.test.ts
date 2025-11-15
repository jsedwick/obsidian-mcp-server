/**
 * SessionTracker unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionTracker } from '../../../../src/services/session/SessionTracker.js';
import type { FileAccess } from '../../../../src/models/Session.js';

describe('SessionTracker', () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    tracker = new SessionTracker();
  });

  describe('trackAccess', () => {
    it('should track file access with timestamp', () => {
      tracker.trackAccess('/test/file.ts', 'read', '2025-01-14T10:00:00Z');

      const access = tracker.getAllAccess();

      expect(access).toHaveLength(1);
      expect(access[0]).toEqual({
        path: '/test/file.ts',
        action: 'read',
        timestamp: '2025-01-14T10:00:00Z',
      });
    });

    it('should auto-generate timestamp if not provided', () => {
      const before = new Date().toISOString();
      tracker.trackAccess('/test/file.ts', 'read');
      const after = new Date().toISOString();

      const access = tracker.getAllAccess();

      expect(access[0].timestamp).toBeDefined();
      expect(access[0].timestamp >= before).toBe(true);
      expect(access[0].timestamp <= after).toBe(true);
    });

    it('should track multiple accesses', () => {
      tracker.trackAccess('/test/file1.ts', 'read');
      tracker.trackAccess('/test/file2.ts', 'edit');
      tracker.trackAccess('/test/file3.ts', 'create');

      const access = tracker.getAllAccess();

      expect(access).toHaveLength(3);
    });

    it('should maintain chronological order', () => {
      tracker.trackAccess('/test/file1.ts', 'read', '2025-01-14T10:00:00Z');
      tracker.trackAccess('/test/file2.ts', 'edit', '2025-01-14T10:01:00Z');
      tracker.trackAccess('/test/file3.ts', 'create', '2025-01-14T10:02:00Z');

      const access = tracker.getAllAccess();

      expect(access[0].timestamp).toBe('2025-01-14T10:00:00Z');
      expect(access[1].timestamp).toBe('2025-01-14T10:01:00Z');
      expect(access[2].timestamp).toBe('2025-01-14T10:02:00Z');
    });
  });

  describe('getAllAccess', () => {
    it('should return copy of access array', () => {
      tracker.trackAccess('/test/file.ts', 'read');

      const access1 = tracker.getAllAccess();
      const access2 = tracker.getAllAccess();

      expect(access1).toEqual(access2);
      expect(access1).not.toBe(access2); // Different array instances
    });

    it('should return empty array if no access tracked', () => {
      expect(tracker.getAllAccess()).toEqual([]);
    });
  });

  describe('getAccessByAction', () => {
    beforeEach(() => {
      tracker.trackAccess('/test/file1.ts', 'read');
      tracker.trackAccess('/test/file2.ts', 'edit');
      tracker.trackAccess('/test/file3.ts', 'read');
      tracker.trackAccess('/test/file4.ts', 'create');
    });

    it('should filter by read action', () => {
      const readAccess = tracker.getAccessByAction('read');

      expect(readAccess).toHaveLength(2);
      expect(readAccess.every(a => a.action === 'read')).toBe(true);
    });

    it('should filter by edit action', () => {
      const editAccess = tracker.getAccessByAction('edit');

      expect(editAccess).toHaveLength(1);
      expect(editAccess[0].path).toBe('/test/file2.ts');
    });

    it('should filter by create action', () => {
      const createAccess = tracker.getAccessByAction('create');

      expect(createAccess).toHaveLength(1);
      expect(createAccess[0].path).toBe('/test/file4.ts');
    });
  });

  describe('getAccessByPathPrefix', () => {
    beforeEach(() => {
      tracker.trackAccess('/vault/topics/file1.md', 'read');
      tracker.trackAccess('/vault/sessions/file2.md', 'read');
      tracker.trackAccess('/vault/topics/file3.md', 'edit');
      tracker.trackAccess('/repo/src/file.ts', 'edit');
    });

    it('should filter by path prefix', () => {
      const vaultAccess = tracker.getAccessByPathPrefix('/vault');

      expect(vaultAccess).toHaveLength(3);
      expect(vaultAccess.every(a => a.path.startsWith('/vault'))).toBe(true);
    });

    it('should filter by specific subdirectory', () => {
      const topicsAccess = tracker.getAccessByPathPrefix('/vault/topics');

      expect(topicsAccess).toHaveLength(2);
      expect(topicsAccess.every(a => a.path.startsWith('/vault/topics'))).toBe(true);
    });

    it('should return empty array if no matches', () => {
      const noAccess = tracker.getAccessByPathPrefix('/nonexistent');

      expect(noAccess).toEqual([]);
    });
  });

  describe('getAccessForFile', () => {
    beforeEach(() => {
      tracker.trackAccess('/test/file.ts', 'read', '2025-01-14T10:00:00Z');
      tracker.trackAccess('/test/file.ts', 'edit', '2025-01-14T10:01:00Z');
      tracker.trackAccess('/test/other.ts', 'read', '2025-01-14T10:02:00Z');
    });

    it('should return all access for specific file', () => {
      const fileAccess = tracker.getAccessForFile('/test/file.ts');

      expect(fileAccess).toHaveLength(2);
      expect(fileAccess.every(a => a.path === '/test/file.ts')).toBe(true);
    });

    it('should return empty array if file not accessed', () => {
      const noAccess = tracker.getAccessForFile('/test/never-accessed.ts');

      expect(noAccess).toEqual([]);
    });
  });

  describe('getUniqueFiles', () => {
    it('should return unique file paths', () => {
      tracker.trackAccess('/test/file1.ts', 'read');
      tracker.trackAccess('/test/file1.ts', 'edit');
      tracker.trackAccess('/test/file2.ts', 'read');
      tracker.trackAccess('/test/file1.ts', 'create');

      const uniqueFiles = tracker.getUniqueFiles();

      expect(uniqueFiles).toHaveLength(2);
      expect(uniqueFiles).toContain('/test/file1.ts');
      expect(uniqueFiles).toContain('/test/file2.ts');
    });

    it('should return empty array if no access', () => {
      expect(tracker.getUniqueFiles()).toEqual([]);
    });
  });

  describe('getModifiedFiles', () => {
    beforeEach(() => {
      tracker.trackAccess('/test/file1.ts', 'read');
      tracker.trackAccess('/test/file2.ts', 'edit');
      tracker.trackAccess('/test/file3.ts', 'create');
      tracker.trackAccess('/test/file4.ts', 'read');
    });

    it('should return files that were edited or created', () => {
      const modifiedFiles = tracker.getModifiedFiles();

      expect(modifiedFiles).toHaveLength(2);
      expect(modifiedFiles).toContain('/test/file2.ts');
      expect(modifiedFiles).toContain('/test/file3.ts');
    });

    it('should not include read-only files', () => {
      const modifiedFiles = tracker.getModifiedFiles();

      expect(modifiedFiles).not.toContain('/test/file1.ts');
      expect(modifiedFiles).not.toContain('/test/file4.ts');
    });

    it('should deduplicate files', () => {
      tracker.trackAccess('/test/file.ts', 'edit');
      tracker.trackAccess('/test/file.ts', 'edit');

      const modifiedFiles = tracker.getModifiedFiles();

      // Should have file2.ts, file3.ts (from beforeEach) and file.ts (from this test)
      expect(modifiedFiles).toHaveLength(3);
      expect(modifiedFiles).toContain('/test/file.ts');
      expect(modifiedFiles).toContain('/test/file2.ts');
      expect(modifiedFiles).toContain('/test/file3.ts');
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', () => {
      tracker.trackAccess('/test/file1.ts', 'read', '2025-01-14T10:00:00Z');
      tracker.trackAccess('/test/file1.ts', 'edit', '2025-01-14T10:01:00Z');
      tracker.trackAccess('/test/file2.ts', 'read', '2025-01-14T10:02:00Z');
      tracker.trackAccess('/test/file3.ts', 'create', '2025-01-14T10:03:00Z');

      const stats = tracker.getStats();

      expect(stats).toEqual({
        totalFiles: 4,
        filesRead: 2,
        filesEdited: 1,
        filesCreated: 1,
        uniqueFiles: 3,
        timeline: {
          firstAccess: '2025-01-14T10:00:00Z',
          lastAccess: '2025-01-14T10:03:00Z',
        },
      });
    });

    it('should handle empty tracker', () => {
      const stats = tracker.getStats();

      expect(stats).toEqual({
        totalFiles: 0,
        filesRead: 0,
        filesEdited: 0,
        filesCreated: 0,
        uniqueFiles: 0,
        timeline: {
          firstAccess: '',
          lastAccess: '',
        },
      });
    });
  });

  describe('hasAccess', () => {
    it('should return true if files have been accessed', () => {
      tracker.trackAccess('/test/file.ts', 'read');

      expect(tracker.hasAccess()).toBe(true);
    });

    it('should return false if no files accessed', () => {
      expect(tracker.hasAccess()).toBe(false);
    });
  });

  describe('hasAccessedFile', () => {
    beforeEach(() => {
      tracker.trackAccess('/test/file1.ts', 'read');
      tracker.trackAccess('/test/file2.ts', 'edit');
    });

    it('should return true if file was accessed', () => {
      expect(tracker.hasAccessedFile('/test/file1.ts')).toBe(true);
      expect(tracker.hasAccessedFile('/test/file2.ts')).toBe(true);
    });

    it('should return false if file was not accessed', () => {
      expect(tracker.hasAccessedFile('/test/file3.ts')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all tracked access', () => {
      tracker.trackAccess('/test/file1.ts', 'read');
      tracker.trackAccess('/test/file2.ts', 'edit');

      tracker.clear();

      expect(tracker.getAllAccess()).toEqual([]);
      expect(tracker.hasAccess()).toBe(false);
    });
  });

  describe('getAccessCount', () => {
    it('should return number of access records', () => {
      tracker.trackAccess('/test/file1.ts', 'read');
      tracker.trackAccess('/test/file2.ts', 'edit');
      tracker.trackAccess('/test/file1.ts', 'edit');

      expect(tracker.getAccessCount()).toBe(3);
    });

    it('should return 0 if no access', () => {
      expect(tracker.getAccessCount()).toBe(0);
    });
  });

  describe('getMostRecentAccess', () => {
    it('should return most recent access', () => {
      tracker.trackAccess('/test/file1.ts', 'read', '2025-01-14T10:00:00Z');
      tracker.trackAccess('/test/file2.ts', 'edit', '2025-01-14T10:01:00Z');
      tracker.trackAccess('/test/file3.ts', 'create', '2025-01-14T10:02:00Z');

      const recent = tracker.getMostRecentAccess();

      expect(recent).toEqual({
        path: '/test/file3.ts',
        action: 'create',
        timestamp: '2025-01-14T10:02:00Z',
      });
    });

    it('should return null if no access', () => {
      expect(tracker.getMostRecentAccess()).toBeNull();
    });
  });

  describe('getFirstAccess', () => {
    it('should return first access', () => {
      tracker.trackAccess('/test/file1.ts', 'read', '2025-01-14T10:00:00Z');
      tracker.trackAccess('/test/file2.ts', 'edit', '2025-01-14T10:01:00Z');
      tracker.trackAccess('/test/file3.ts', 'create', '2025-01-14T10:02:00Z');

      const first = tracker.getFirstAccess();

      expect(first).toEqual({
        path: '/test/file1.ts',
        action: 'read',
        timestamp: '2025-01-14T10:00:00Z',
      });
    });

    it('should return null if no access', () => {
      expect(tracker.getFirstAccess()).toBeNull();
    });
  });

  describe('exportData / importData', () => {
    it('should export and import data correctly', () => {
      tracker.trackAccess('/test/file1.ts', 'read', '2025-01-14T10:00:00Z');
      tracker.trackAccess('/test/file2.ts', 'edit', '2025-01-14T10:01:00Z');

      const exported = tracker.exportData();

      const newTracker = new SessionTracker();
      newTracker.importData(exported);

      expect(newTracker.getAllAccess()).toEqual(tracker.getAllAccess());
    });

    it('should preserve all access details', () => {
      const access: FileAccess[] = [
        { path: '/test/file1.ts', action: 'read', timestamp: '2025-01-14T10:00:00Z' },
        { path: '/test/file2.ts', action: 'edit', timestamp: '2025-01-14T10:01:00Z' },
      ];

      tracker.importData(access);

      expect(tracker.getAllAccess()).toEqual(access);
    });
  });
});
