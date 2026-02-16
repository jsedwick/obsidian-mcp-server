/**
 * LRUCache unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { LRUCache } from '../../../src/utils/LRUCache.js';

describe('LRUCache', () => {
  describe('constructor', () => {
    it('should create cache with valid maxSize', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      expect(cache.size).toBe(0);
    });

    it('should create cache with maxSize of 1', () => {
      const cache = new LRUCache<string, number>({ maxSize: 1 });
      expect(cache.size).toBe(0);
    });

    it('should throw error when maxSize < 1', () => {
      expect(() => new LRUCache<string, number>({ maxSize: 0 })).toThrow(
        'LRUCache maxSize must be at least 1'
      );
      expect(() => new LRUCache<string, number>({ maxSize: -1 })).toThrow(
        'LRUCache maxSize must be at least 1'
      );
    });
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
    });

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing key without eviction', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('a', 100);
      expect(cache.get('a')).toBe(100);
      expect(cache.size).toBe(3);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('eviction', () => {
    it('should evict LRU entry when capacity exceeded', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.size).toBe(2);
    });

    it('should promote entry on get (LRU reordering)', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // promote 'a' — 'b' is now LRU
      cache.set('c', 3); // should evict 'b', not 'a'
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });

    it('should handle maxSize of 1', () => {
      const cache = new LRUCache<string, number>({ maxSize: 1 });
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      cache.set('b', 2);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.size).toBe(1);
    });
  });

  describe('TTL expiration', () => {
    it('should return value before TTL expires', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5, ttlMs: 1000 });
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should return undefined after TTL expires', () => {
      vi.useFakeTimers();
      try {
        const cache = new LRUCache<string, number>({ maxSize: 5, ttlMs: 100 });
        cache.set('a', 1);
        expect(cache.get('a')).toBe(1);

        vi.advanceTimersByTime(150);
        expect(cache.get('a')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should remove expired entry from cache on get', () => {
      vi.useFakeTimers();
      try {
        const cache = new LRUCache<string, number>({ maxSize: 5, ttlMs: 100 });
        cache.set('a', 1);
        expect(cache.size).toBe(1);

        vi.advanceTimersByTime(150);
        cache.get('a');
        expect(cache.size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not expire entries when TTL not set', () => {
      vi.useFakeTimers();
      try {
        const cache = new LRUCache<string, number>({ maxSize: 5 });
        cache.set('a', 1);

        vi.advanceTimersByTime(999999);
        expect(cache.get('a')).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
    });

    it('should return false for missing key', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      expect(cache.has('a')).toBe(false);
    });

    it('should return false for expired key', () => {
      vi.useFakeTimers();
      try {
        const cache = new LRUCache<string, number>({ maxSize: 5, ttlMs: 100 });
        cache.set('a', 1);
        vi.advanceTimersByTime(150);
        expect(cache.has('a')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('delete', () => {
    it('should delete existing entry', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('should return false for non-existent key', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should empty the cache', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should report correct stats', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.set('b', 2);

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10);
      expect(stats.utilizationPercent).toBe(20);
    });

    it('should report 0% utilization for empty cache', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      expect(cache.getStats().utilizationPercent).toBe(0);
    });

    it('should report 100% utilization when full', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.getStats().utilizationPercent).toBe(100);
    });
  });

  describe('entries iterator', () => {
    it('should iterate over all entries', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const entries = Array.from(cache.entries());
      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual(['a', 1]);
      expect(entries).toContainEqual(['b', 2]);
      expect(entries).toContainEqual(['c', 3]);
    });

    it('should yield nothing for empty cache', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      expect(Array.from(cache.entries())).toHaveLength(0);
    });
  });

  describe('keys', () => {
    it('should return all keys', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      cache.set('b', 2);
      const keys = Array.from(cache.keys());
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });
  });

  describe('getEntry', () => {
    it('should return entry with timestamp', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      const entry = cache.getEntry('a');
      expect(entry).toBeDefined();
      expect(entry!.value).toBe(1);
      expect(entry!.timestamp).toBeTypeOf('number');
      expect(entry!.timestamp).toBeGreaterThan(0);
    });

    it('should return undefined for missing key', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      expect(cache.getEntry('missing')).toBeUndefined();
    });
  });

  describe('setWithTimestamp', () => {
    it('should store entry with custom timestamp', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.setWithTimestamp('a', 1, 1000);
      const entry = cache.getEntry('a');
      expect(entry!.value).toBe(1);
      expect(entry!.timestamp).toBe(1000);
    });

    it('should evict LRU when at capacity', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.setWithTimestamp('c', 3, Date.now());
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });

    it('should overwrite existing key with new timestamp', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      cache.setWithTimestamp('a', 100, 5000);
      expect(cache.get('a')).toBe(100);
      expect(cache.getEntry('a')!.timestamp).toBe(5000);
      expect(cache.size).toBe(1);
    });
  });
});
