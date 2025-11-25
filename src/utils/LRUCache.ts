/**
 * LRU Cache implementation with size limits
 *
 * A generic Least Recently Used cache that automatically evicts
 * the oldest entries when the cache reaches its maximum size.
 *
 * Features:
 * - O(1) get/set operations using Map's insertion order
 * - Automatic eviction of least recently used entries
 * - Optional TTL (time-to-live) for entries
 * - Memory-efficient: uses Map's native ordering
 */

export interface LRUCacheOptions {
  /** Maximum number of entries in the cache */
  maxSize: number;
  /** Optional TTL in milliseconds (entries older than this are considered stale) */
  ttlMs?: number;
}

export interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

export class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>> = new Map();
  private readonly maxSize: number;
  private readonly ttlMs?: number;

  constructor(options: LRUCacheOptions) {
    if (options.maxSize < 1) {
      throw new Error('LRUCache maxSize must be at least 1');
    }
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
  }

  /**
   * Get a value from the cache
   * Returns undefined if not found or expired
   * Moves the entry to the "most recently used" position
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check TTL if configured
    if (this.ttlMs !== undefined) {
      const age = Date.now() - entry.timestamp;
      if (age > this.ttlMs) {
        this.cache.delete(key);
        return undefined;
      }
    }

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache
   * Evicts least recently used entries if at capacity
   */
  set(key: K, value: V): void {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      // Map maintains insertion order, first key is oldest
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    // Add new entry
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (this.ttlMs !== undefined) {
      const age = Date.now() - entry.timestamp;
      if (age > this.ttlMs) {
        this.cache.delete(key);
        return false;
      }
    }

    return true;
  }

  /**
   * Delete an entry from the cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; utilizationPercent: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilizationPercent: Math.round((this.cache.size / this.maxSize) * 100),
    };
  }

  /**
   * Iterate over all entries (does not affect LRU order)
   */
  *entries(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.cache) {
      yield [key, entry.value] as [K, V];
    }
  }

  /**
   * Get all keys
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get entry with metadata (timestamp)
   * Does not affect LRU order
   */
  getEntry(key: K): CacheEntry<V> | undefined {
    return this.cache.get(key);
  }

  /**
   * Set entry with custom timestamp (for restoring from disk)
   */
  setWithTimestamp(key: K, value: V, timestamp: number): void {
    // Delete if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, timestamp });
  }
}
