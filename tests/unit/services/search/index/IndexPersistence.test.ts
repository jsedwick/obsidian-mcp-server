/**
 * Unit tests for IndexPersistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IndexPersistence } from '../../../../../src/services/search/index/IndexPersistence.js';
import { InvertedIndex } from '../../../../../src/services/search/index/InvertedIndex.js';
import { DocumentStore } from '../../../../../src/services/search/index/DocumentStore.js';
import { IndexField, DEFAULT_INDEX_CONFIG } from '../../../../../src/models/IndexModels.js';
import type { DocumentPosting, DocumentMetadata } from '../../../../../src/models/IndexModels.js';

describe('IndexPersistence', () => {
  const TEST_CACHE_DIR = path.join(process.cwd(), '.test-index-cache');
  let persistence: IndexPersistence;

  beforeEach(async () => {
    // Clean up any existing test cache
    try {
      await fs.rm(TEST_CACHE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    persistence = new IndexPersistence(TEST_CACHE_DIR);
  });

  afterEach(async () => {
    // Clean up test cache
    try {
      await fs.rm(TEST_CACHE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  const createPosting = (docId: string): DocumentPosting => ({
    docId,
    termFrequency: 1,
    positions: [0],
    fieldScores: [{
      field: IndexField.CONTENT,
      frequency: 1,
      boost: 1.0,
    }],
  });

  const createMetadata = (id: string): DocumentMetadata => ({
    id,
    path: `/vault/${id}.md`,
    category: 'topics',
    vault: 'TestVault',
    lastModified: Date.now(),
    contentLength: 100,
    hash: `hash_${id}`,
  });

  describe('exists', () => {
    it('should return false for non-existent index', async () => {
      const exists = await persistence.exists();
      expect(exists).toBe(false);
    });

    it('should return true after index is saved', async () => {
      const index = new InvertedIndex();
      const store = new DocumentStore();

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const exists = await persistence.exists();
      expect(exists).toBe(true);
    });
  });

  describe('save and load', () => {
    it('should save and load empty index', async () => {
      const index = new InvertedIndex();
      const store = new DocumentStore();

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const { index: loadedIndex, store: loadedStore } = await persistence.load();

      expect(loadedIndex.getTermCount()).toBe(0);
      expect(loadedStore.getTotalDocuments()).toBe(0);
    });

    it('should save and load index with terms', async () => {
      const index = new InvertedIndex();
      index.addTerm('hello', createPosting('doc1'));
      index.addTerm('world', createPosting('doc2'));

      const store = new DocumentStore();
      store.upsert(createMetadata('doc1'));
      store.upsert(createMetadata('doc2'));

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const { index: loadedIndex, store: loadedStore } = await persistence.load();

      expect(loadedIndex.getTermCount()).toBe(2);
      expect(loadedIndex.hasTerm('hello')).toBe(true);
      expect(loadedIndex.hasTerm('world')).toBe(true);
      expect(loadedStore.getTotalDocuments()).toBe(2);
    });

    it('should preserve posting details', async () => {
      const index = new InvertedIndex();
      const posting: DocumentPosting = {
        docId: 'doc1',
        termFrequency: 5,
        positions: [0, 10, 20, 30, 40],
        fieldScores: [
          {
            field: IndexField.TITLE,
            frequency: 1,
            boost: 2.0,
          },
          {
            field: IndexField.CONTENT,
            frequency: 4,
            boost: 1.0,
          },
        ],
      };

      index.addTerm('test', posting);

      const store = new DocumentStore();
      store.upsert(createMetadata('doc1'));

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const { index: loadedIndex } = await persistence.load();

      const loadedPostings = loadedIndex.getPostings('test');
      expect(loadedPostings).toHaveLength(1);
      expect(loadedPostings[0].docId).toBe('doc1');
      expect(loadedPostings[0].termFrequency).toBe(5);
      expect(loadedPostings[0].positions).toEqual([0, 10, 20, 30, 40]);
      expect(loadedPostings[0].fieldScores).toHaveLength(2);
    });

    it('should throw error if index does not exist', async () => {
      await expect(persistence.load()).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete index files', async () => {
      const index = new InvertedIndex();
      const store = new DocumentStore();

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);
      expect(await persistence.exists()).toBe(true);

      await persistence.delete();
      expect(await persistence.exists()).toBe(false);
    });

    it('should not throw if index does not exist', async () => {
      await expect(persistence.delete()).resolves.not.toThrow();
    });
  });

  describe('getFileSizes', () => {
    it('should return file sizes', async () => {
      const index = new InvertedIndex();
      index.addTerm('test', createPosting('doc1'));

      const store = new DocumentStore();
      store.upsert(createMetadata('doc1'));

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const sizes = await persistence.getFileSizes();

      expect(sizes.invertedIndex).toBeGreaterThan(0);
      expect(sizes.documentStore).toBeGreaterThan(0);
      expect(sizes.metadata).toBeGreaterThan(0);
      expect(sizes.total).toBe(
        sizes.invertedIndex + sizes.documentStore + sizes.metadata
      );
    });

    it('should return zeros for non-existent index', async () => {
      const sizes = await persistence.getFileSizes();

      expect(sizes.invertedIndex).toBe(0);
      expect(sizes.documentStore).toBe(0);
      expect(sizes.metadata).toBe(0);
      expect(sizes.total).toBe(0);
    });
  });

  describe('validate', () => {
    it('should pass validation for valid index', async () => {
      const index = new InvertedIndex();
      index.addTerm('valid', createPosting('doc1'));

      const store = new DocumentStore();
      store.upsert(createMetadata('doc1'));

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const errors = await persistence.validate();
      expect(errors).toEqual([]);
    });

    it('should detect if index does not exist', async () => {
      const errors = await persistence.validate();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('do not exist');
    });
  });

  describe('metadata handling', () => {
    it('should save and load metadata correctly', async () => {
      const index = new InvertedIndex();
      const store = new DocumentStore();

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const { metadata } = await persistence.load();

      expect(metadata.version).toBeDefined();
      expect(metadata.lastBuilt).toBeInstanceOf(Date);
      expect(metadata.lastValidated).toBeInstanceOf(Date);
      expect(metadata.statistics).toBeDefined();
      expect(metadata.configuration).toBeDefined();
    });

    it('should include statistics in metadata', async () => {
      const index = new InvertedIndex();
      index.addTerm('term1', createPosting('doc1'));
      index.addTerm('term2', createPosting('doc2'));

      const store = new DocumentStore();
      store.upsert(createMetadata('doc1'));
      store.upsert(createMetadata('doc2'));

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const { metadata } = await persistence.load();

      expect(metadata.statistics.totalDocuments).toBe(2);
      expect(metadata.statistics.totalTerms).toBe(2);
      expect(metadata.statistics.documentFrequency.size).toBe(2);
    });
  });

  describe('large dataset', () => {
    it('should handle many terms and documents', async () => {
      const index = new InvertedIndex();
      const store = new DocumentStore();

      // Add 100 terms and documents
      for (let i = 0; i < 100; i++) {
        index.addTerm(`term${i}`, createPosting(`doc${i}`));
        store.upsert(createMetadata(`doc${i}`));
      }

      await persistence.save(index, store, DEFAULT_INDEX_CONFIG);

      const { index: loadedIndex, store: loadedStore } = await persistence.load();

      expect(loadedIndex.getTermCount()).toBe(100);
      expect(loadedStore.getTotalDocuments()).toBe(100);
    });
  });
});
