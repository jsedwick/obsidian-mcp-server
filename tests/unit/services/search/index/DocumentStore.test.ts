/**
 * Unit tests for DocumentStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentStore } from '../../../../../src/services/search/index/DocumentStore.js';
import type { DocumentMetadata } from '../../../../../src/models/IndexModels.js';

describe('DocumentStore', () => {
  let store: DocumentStore;

  const createMetadata = (id: string, overrides?: Partial<DocumentMetadata>): DocumentMetadata => ({
    id,
    path: `/vault/${id}.md`,
    category: 'topics',
    vault: 'TestVault',
    lastModified: Date.now(),
    contentLength: 100,
    hash: `hash_${id}`,
    ...overrides,
  });

  beforeEach(() => {
    store = new DocumentStore();
  });

  describe('upsert', () => {
    it('should add new document', () => {
      const doc = createMetadata('doc1');
      store.upsert(doc);

      expect(store.has('doc1')).toBe(true);
      expect(store.getTotalDocuments()).toBe(1);
    });

    it('should update existing document', () => {
      const doc1 = createMetadata('doc1', { contentLength: 100 });
      const doc2 = createMetadata('doc1', { contentLength: 200 });

      store.upsert(doc1);
      store.upsert(doc2);

      expect(store.getTotalDocuments()).toBe(1);
      expect(store.get('doc1')?.contentLength).toBe(200);
    });
  });

  describe('get', () => {
    it('should retrieve document metadata', () => {
      const doc = createMetadata('doc1');
      store.upsert(doc);

      const retrieved = store.get('doc1');
      expect(retrieved).toEqual(doc);
    });

    it('should return undefined for non-existent document', () => {
      expect(store.get('missing')).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should remove document', () => {
      store.upsert(createMetadata('doc1'));
      const removed = store.remove('doc1');

      expect(removed).toBe(true);
      expect(store.has('doc1')).toBe(false);
    });

    it('should return false if document does not exist', () => {
      const removed = store.remove('missing');
      expect(removed).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all documents', () => {
      store.upsert(createMetadata('doc1'));
      store.upsert(createMetadata('doc2'));

      const all = store.getAll();
      expect(all).toHaveLength(2);
    });

    it('should return empty array for empty store', () => {
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('getAverageDocumentLength', () => {
    it('should calculate average length', () => {
      store.upsert(createMetadata('doc1', { contentLength: 100 }));
      store.upsert(createMetadata('doc2', { contentLength: 200 }));
      store.upsert(createMetadata('doc3', { contentLength: 300 }));

      expect(store.getAverageDocumentLength()).toBe(200);
    });

    it('should return 0 for empty store', () => {
      expect(store.getAverageDocumentLength()).toBe(0);
    });
  });

  describe('getByCategory', () => {
    beforeEach(() => {
      store.upsert(createMetadata('doc1', { category: 'topics' }));
      store.upsert(createMetadata('doc2', { category: 'sessions' }));
      store.upsert(createMetadata('doc3', { category: 'topics' }));
    });

    it('should filter documents by category', () => {
      const topics = store.getByCategory('topics');
      expect(topics).toHaveLength(2);
      expect(topics.every(d => d.category === 'topics')).toBe(true);
    });

    it('should return empty array for non-existent category', () => {
      expect(store.getByCategory('decisions')).toEqual([]);
    });
  });

  describe('getByVault', () => {
    beforeEach(() => {
      store.upsert(createMetadata('doc1', { vault: 'VaultA' }));
      store.upsert(createMetadata('doc2', { vault: 'VaultB' }));
      store.upsert(createMetadata('doc3', { vault: 'VaultA' }));
    });

    it('should filter documents by vault', () => {
      const vaultA = store.getByVault('VaultA');
      expect(vaultA).toHaveLength(2);
      expect(vaultA.every(d => d.vault === 'VaultA')).toBe(true);
    });
  });

  describe('getModifiedSince', () => {
    it('should return documents modified after timestamp', () => {
      const now = Date.now();
      const past = now - 10000;
      const future = now + 10000;

      store.upsert(createMetadata('doc1', { lastModified: past }));
      store.upsert(createMetadata('doc2', { lastModified: future }));

      const modified = store.getModifiedSince(now);
      expect(modified).toHaveLength(1);
      expect(modified[0].id).toBe('doc2');
    });
  });

  describe('detectChanges', () => {
    beforeEach(() => {
      store.upsert(createMetadata('doc1', { hash: 'hash1', lastModified: 1000 }));
      store.upsert(createMetadata('doc2', { hash: 'hash2', lastModified: 2000 }));
    });

    it('should detect added files', () => {
      const current = new Map([
        ['doc1', { hash: 'hash1', lastModified: 1000 }],
        ['doc2', { hash: 'hash2', lastModified: 2000 }],
        ['doc3', { hash: 'hash3', lastModified: 3000 }],
      ]);

      const changes = store.detectChanges(current);
      expect(changes.added).toEqual(['doc3']);
      expect(changes.modified).toEqual([]);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect modified files', () => {
      const current = new Map([
        ['doc1', { hash: 'hash1_modified', lastModified: 1500 }],
        ['doc2', { hash: 'hash2', lastModified: 2000 }],
      ]);

      const changes = store.detectChanges(current);
      expect(changes.added).toEqual([]);
      expect(changes.modified).toEqual(['doc1']);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect deleted files', () => {
      const current = new Map([
        ['doc1', { hash: 'hash1', lastModified: 1000 }],
      ]);

      const changes = store.detectChanges(current);
      expect(changes.added).toEqual([]);
      expect(changes.modified).toEqual([]);
      expect(changes.deleted).toEqual(['doc2']);
    });
  });

  describe('toJSON and fromJSON', () => {
    beforeEach(() => {
      store.upsert(createMetadata('doc1'));
      store.upsert(createMetadata('doc2'));
    });

    it('should serialize store', () => {
      const json = store.toJSON();
      expect(json).toHaveProperty('documents');
      expect((json.documents as Array<unknown>)).toHaveLength(2);
    });

    it('should deserialize store', () => {
      const json = store.toJSON();
      const restored = DocumentStore.fromJSON(json);

      expect(restored.getTotalDocuments()).toBe(2);
      expect(restored.has('doc1')).toBe(true);
      expect(restored.has('doc2')).toBe(true);
    });
  });

  describe('validate', () => {
    it('should pass validation for valid documents', () => {
      store.upsert(createMetadata('doc1'));
      const errors = store.validate();
      expect(errors).toEqual([]);
    });

    it('should detect missing required fields', () => {
      store.upsert(createMetadata('doc1', { path: '' } as DocumentMetadata));
      const errors = store.validate();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('missing path'))).toBe(true);
    });

    it('should detect negative content length', () => {
      store.upsert(createMetadata('doc1', { contentLength: -1 }));
      const errors = store.validate();
      expect(errors.some(e => e.includes('negative contentLength'))).toBe(true);
    });
  });

  describe('getStoreStatistics', () => {
    beforeEach(() => {
      store.upsert(createMetadata('doc1', { category: 'topics', vault: 'VaultA', contentLength: 100 }));
      store.upsert(createMetadata('doc2', { category: 'sessions', vault: 'VaultA', contentLength: 200 }));
      store.upsert(createMetadata('doc3', { category: 'topics', vault: 'VaultB', contentLength: 300 }));
    });

    it('should return comprehensive statistics', () => {
      const stats = store.getStoreStatistics();

      expect(stats.totalDocuments).toBe(3);
      expect(stats.averageDocumentLength).toBe(200);
      expect(stats.categoryCounts).toEqual({ topics: 2, sessions: 1 });
      expect(stats.vaultCounts).toEqual({ VaultA: 2, VaultB: 1 });
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });
});
