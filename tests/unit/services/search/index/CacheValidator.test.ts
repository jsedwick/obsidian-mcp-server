/**
 * Unit tests for CacheValidator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CacheValidator,
  ChangeType,
} from '../../../../../src/services/search/index/CacheValidator.js';
import { DocumentStore } from '../../../../../src/services/search/index/DocumentStore.js';
import type { ScannedFile } from '../../../../../src/services/search/index/FileScanner.js';
import type { DocumentMetadata } from '../../../../../src/models/IndexModels.js';

describe('CacheValidator', () => {
  let validator: CacheValidator;
  let store: DocumentStore;

  beforeEach(() => {
    validator = new CacheValidator();
    store = new DocumentStore();
  });

  const createScannedFile = (
    path: string,
    lastModified: number = Date.now(),
    hash: string = 'hash123'
  ): ScannedFile => ({
    absolutePath: path,
    relativePath: path.replace('/vault/', ''),
    size: 100,
    lastModified,
    hash,
    vault: 'test-vault',
    category: 'document',
  });

  const createMetadata = (
    path: string,
    lastModified: number = Date.now(),
    hash: string = 'hash123'
  ): DocumentMetadata => ({
    id: path,
    path: path.replace('/vault/', ''),
    category: 'document',
    vault: 'test-vault',
    lastModified,
    contentLength: 50,
    hash,
  });

  describe('constructor', () => {
    it('should create validator with default options', () => {
      expect(validator).toBeDefined();
    });

    it('should create validator with custom options', () => {
      const customValidator = new CacheValidator({
        useHashComparison: false,
        skipUnchanged: false,
      });
      expect(customValidator).toBeDefined();
    });
  });

  describe('validate', () => {
    it('should detect added files', () => {
      const scannedFiles = [
        createScannedFile('/vault/new-file.md'),
      ];

      const result = validator.validate(scannedFiles, store);

      expect(result.added).toBe(1);
      expect(result.modified).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.changes[0].changeType).toBe(ChangeType.ADDED);
    });

    it('should detect deleted files', () => {
      store.upsert(createMetadata('/vault/deleted-file.md'));

      const result = validator.validate([], store);

      expect(result.added).toBe(0);
      expect(result.modified).toBe(0);
      expect(result.deleted).toBe(1);
      expect(result.changes[0].changeType).toBe(ChangeType.DELETED);
    });

    it('should detect modified files by hash', () => {
      const path = '/vault/modified-file.md';
      store.upsert(createMetadata(path, Date.now(), 'oldHash'));

      const scannedFiles = [
        createScannedFile(path, Date.now(), 'newHash'),
      ];

      const result = validator.validate(scannedFiles, store);

      expect(result.added).toBe(0);
      expect(result.modified).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.changes[0].changeType).toBe(ChangeType.MODIFIED);
      expect(result.changes[0].reason).toContain('hash');
    });

    it('should detect modified files by mtime', () => {
      const path = '/vault/modified-file.md';
      const oldTime = Date.now() - 10000; // 10 seconds ago
      const newTime = Date.now();

      store.upsert(createMetadata(path, oldTime, 'hash123'));

      const scannedFiles = [
        createScannedFile(path, newTime, 'hash123'),
      ];

      const result = validator.validate(scannedFiles, store);

      expect(result.modified).toBe(1);
      expect(result.changes[0].reason).toContain('Modified time');
    });

    it('should detect unchanged files', () => {
      const path = '/vault/unchanged-file.md';
      const time = Date.now();
      const hash = 'hash123';

      store.upsert(createMetadata(path, time, hash));

      const scannedFiles = [
        createScannedFile(path, time, hash),
      ];

      const validatorWithUnchanged = new CacheValidator({
        skipUnchanged: false,
      });

      const result = validatorWithUnchanged.validate(scannedFiles, store);

      expect(result.unchanged).toBe(1);
      expect(result.changes[0].changeType).toBe(ChangeType.UNCHANGED);
    });

    it('should skip unchanged files when configured', () => {
      const path = '/vault/unchanged-file.md';
      const time = Date.now();
      const hash = 'hash123';

      store.upsert(createMetadata(path, time, hash));

      const scannedFiles = [
        createScannedFile(path, time, hash),
      ];

      const result = validator.validate(scannedFiles, store);

      // Default is to skip unchanged
      expect(result.unchanged).toBe(0);
      expect(result.changes.length).toBe(0);
    });

    it('should handle mixed changes', () => {
      store.upsert(createMetadata('/vault/unchanged.md', Date.now(), 'hash1'));
      store.upsert(createMetadata('/vault/modified.md', Date.now(), 'oldHash'));
      store.upsert(createMetadata('/vault/deleted.md', Date.now(), 'hash3'));

      const scannedFiles = [
        createScannedFile('/vault/unchanged.md', Date.now(), 'hash1'),
        createScannedFile('/vault/modified.md', Date.now(), 'newHash'),
        createScannedFile('/vault/added.md', Date.now(), 'hash4'),
      ];

      const result = validator.validate(scannedFiles, store);

      expect(result.added).toBe(1);
      expect(result.modified).toBe(1);
      expect(result.deleted).toBe(1);
      expect(result.totalScanned).toBe(3);
      expect(result.totalCached).toBe(3);
    });

    it('should respect mtime tolerance', () => {
      const customValidator = new CacheValidator({
        mtimeTolerance: 5000, // 5 seconds
      });

      const path = '/vault/file.md';
      const baseTime = Date.now();

      store.upsert(createMetadata(path, baseTime, 'hash123'));

      // Within tolerance
      const scannedFiles = [
        createScannedFile(path, baseTime + 1000, 'hash123'), // 1 second diff
      ];

      const result = customValidator.validate(scannedFiles, store);

      expect(result.modified).toBe(0); // Should be unchanged
    });

    it('should validate with empty cache', () => {
      const scannedFiles = [
        createScannedFile('/vault/file1.md'),
        createScannedFile('/vault/file2.md'),
      ];

      const result = validator.validate(scannedFiles, store);

      expect(result.added).toBe(2);
      expect(result.modified).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('should validate with empty scan', () => {
      store.upsert(createMetadata('/vault/file1.md'));
      store.upsert(createMetadata('/vault/file2.md'));

      const result = validator.validate([], store);

      expect(result.added).toBe(0);
      expect(result.modified).toBe(0);
      expect(result.deleted).toBe(2);
    });
  });

  describe('getChangedFiles', () => {
    it('should return only changed files', () => {
      store.upsert(createMetadata('/vault/modified.md', Date.now(), 'oldHash'));

      const scannedFiles = [
        createScannedFile('/vault/modified.md', Date.now(), 'newHash'),
        createScannedFile('/vault/added.md'),
      ];

      const validatorWithUnchanged = new CacheValidator({ skipUnchanged: false });
      const result = validatorWithUnchanged.validate(scannedFiles, store);
      const changed = validator.getChangedFiles(result);

      expect(changed.length).toBe(2); // modified + added
      expect(changed.every(c => c.changeType !== ChangeType.UNCHANGED)).toBe(true);
    });
  });

  describe('filterByType', () => {
    it('should filter by ADDED type', () => {
      const scannedFiles = [
        createScannedFile('/vault/added.md'),
      ];

      const result = validator.validate(scannedFiles, store);
      const added = validator.filterByType(result, ChangeType.ADDED);

      expect(added.length).toBe(1);
      expect(added[0].changeType).toBe(ChangeType.ADDED);
    });

    it('should filter by DELETED type', () => {
      store.upsert(createMetadata('/vault/deleted.md'));

      const result = validator.validate([], store);
      const deleted = validator.filterByType(result, ChangeType.DELETED);

      expect(deleted.length).toBe(1);
      expect(deleted[0].changeType).toBe(ChangeType.DELETED);
    });

    it('should filter by MODIFIED type', () => {
      store.upsert(createMetadata('/vault/modified.md', Date.now(), 'oldHash'));

      const scannedFiles = [
        createScannedFile('/vault/modified.md', Date.now(), 'newHash'),
      ];

      const result = validator.validate(scannedFiles, store);
      const modified = validator.filterByType(result, ChangeType.MODIFIED);

      expect(modified.length).toBe(1);
      expect(modified[0].changeType).toBe(ChangeType.MODIFIED);
    });
  });

  describe('getFilesNeedingReindex', () => {
    it('should return added and modified files', () => {
      store.upsert(createMetadata('/vault/modified.md', Date.now(), 'oldHash'));

      const scannedFiles = [
        createScannedFile('/vault/modified.md', Date.now(), 'newHash'),
        createScannedFile('/vault/added.md'),
      ];

      const result = validator.validate(scannedFiles, store);
      const needsReindex = validator.getFilesNeedingReindex(result);

      expect(needsReindex.length).toBe(2);
      expect(needsReindex.every(f => f !== null)).toBe(true);
    });

    it('should exclude deleted and unchanged files', () => {
      store.upsert(createMetadata('/vault/deleted.md'));
      store.upsert(createMetadata('/vault/unchanged.md', Date.now(), 'hash123'));

      const scannedFiles = [
        createScannedFile('/vault/unchanged.md', Date.now(), 'hash123'),
      ];

      const result = validator.validate(scannedFiles, store);
      const needsReindex = validator.getFilesNeedingReindex(result);

      expect(needsReindex.length).toBe(0);
    });
  });

  describe('getDeletedPaths', () => {
    it('should return paths of deleted files', () => {
      store.upsert(createMetadata('/vault/deleted1.md'));
      store.upsert(createMetadata('/vault/deleted2.md'));

      const result = validator.validate([], store);
      const deletedPaths = validator.getDeletedPaths(result);

      expect(deletedPaths.length).toBe(2);
      expect(deletedPaths).toContain('/vault/deleted1.md');
      expect(deletedPaths).toContain('/vault/deleted2.md');
    });

    it('should return empty array when no deletions', () => {
      const scannedFiles = [
        createScannedFile('/vault/file.md'),
      ];

      const result = validator.validate(scannedFiles, store);
      const deletedPaths = validator.getDeletedPaths(result);

      expect(deletedPaths).toEqual([]);
    });
  });

  describe('shouldUseIncrementalUpdate', () => {
    it('should recommend incremental for small changes', () => {
      // Create 100 unchanged files
      for (let i = 0; i < 100; i++) {
        const path = `/vault/file${i}.md`;
        store.upsert(createMetadata(path, Date.now(), `hash${i}`));
      }

      // Scan same files plus 5 new ones (5% change)
      const scannedFiles = [];
      for (let i = 0; i < 100; i++) {
        scannedFiles.push(createScannedFile(`/vault/file${i}.md`, Date.now(), `hash${i}`));
      }
      for (let i = 100; i < 105; i++) {
        scannedFiles.push(createScannedFile(`/vault/file${i}.md`));
      }

      const result = validator.validate(scannedFiles, store);
      const shouldIncremental = validator.shouldUseIncrementalUpdate(result);

      expect(shouldIncremental).toBe(true);
    });

    it('should recommend full rebuild for large changes', () => {
      // Create 100 files
      for (let i = 0; i < 100; i++) {
        const path = `/vault/file${i}.md`;
        store.upsert(createMetadata(path, Date.now(), `hash${i}`));
      }

      // Change 50 of them (50% change, above 30% threshold)
      const scannedFiles = [];
      for (let i = 0; i < 50; i++) {
        scannedFiles.push(createScannedFile(`/vault/file${i}.md`, Date.now(), `newHash${i}`));
      }
      for (let i = 50; i < 100; i++) {
        scannedFiles.push(createScannedFile(`/vault/file${i}.md`, Date.now(), `hash${i}`));
      }

      const result = validator.validate(scannedFiles, store);
      const shouldIncremental = validator.shouldUseIncrementalUpdate(result);

      expect(shouldIncremental).toBe(false);
    });

    it('should recommend full rebuild for empty cache', () => {
      const scannedFiles = [
        createScannedFile('/vault/file1.md'),
        createScannedFile('/vault/file2.md'),
      ];

      const result = validator.validate(scannedFiles, store);
      const shouldIncremental = validator.shouldUseIncrementalUpdate(result);

      expect(shouldIncremental).toBe(false);
    });

    it('should respect custom threshold', () => {
      // 20% change with 10% threshold
      for (let i = 0; i < 100; i++) {
        const path = `/vault/file${i}.md`;
        store.upsert(createMetadata(path, Date.now(), `hash${i}`));
      }

      const scannedFiles = [];
      for (let i = 0; i < 80; i++) {
        scannedFiles.push(createScannedFile(`/vault/file${i}.md`, Date.now(), `hash${i}`));
      }
      for (let i = 80; i < 100; i++) {
        scannedFiles.push(createScannedFile(`/vault/file${i}.md`, Date.now(), `newHash${i}`));
      }

      const result = validator.validate(scannedFiles, store);

      // With 10% threshold, 20% change should trigger full rebuild
      expect(validator.shouldUseIncrementalUpdate(result, 0.1)).toBe(false);

      // With 30% threshold, 20% change should use incremental
      expect(validator.shouldUseIncrementalUpdate(result, 0.3)).toBe(true);
    });
  });

  describe('validateConsistency', () => {
    it('should pass validation for consistent store', () => {
      store.upsert(createMetadata('/vault/file1.md'));
      store.upsert(createMetadata('/vault/file2.md'));

      const issues = validator.validateConsistency(store);

      expect(issues).toEqual([]);
    });

    it('should detect missing required fields', () => {
      store.upsert({
        id: '/vault/file.md',
        path: '',
        category: 'document',
        vault: 'test-vault',
        lastModified: Date.now(),
        contentLength: 50,
        hash: 'hash123',
      });

      const issues = validator.validateConsistency(store);

      expect(issues.some(i => i.includes('missing path'))).toBe(true);
    });

    it('should detect invalid lastModified', () => {
      store.upsert({
        id: '/vault/file.md',
        path: 'file.md',
        category: 'document',
        vault: 'test-vault',
        lastModified: -1,
        contentLength: 50,
        hash: 'hash123',
      });

      const issues = validator.validateConsistency(store);

      expect(issues.some(i => i.includes('invalid lastModified'))).toBe(true);
    });

    it('should detect negative content length', () => {
      store.upsert({
        id: '/vault/file.md',
        path: 'file.md',
        category: 'document',
        vault: 'test-vault',
        lastModified: Date.now(),
        contentLength: -10,
        hash: 'hash123',
      });

      const issues = validator.validateConsistency(store);

      expect(issues.some(i => i.includes('negative content length'))).toBe(true);
    });

    it('should detect missing hash', () => {
      store.upsert({
        id: '/vault/file.md',
        path: 'file.md',
        category: 'document',
        vault: 'test-vault',
        lastModified: Date.now(),
        contentLength: 50,
        hash: '',
      });

      const issues = validator.validateConsistency(store);

      expect(issues.some(i => i.includes('missing hash'))).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('should generate readable report', () => {
      store.upsert(createMetadata('/vault/modified.md', Date.now(), 'oldHash'));

      const scannedFiles = [
        createScannedFile('/vault/modified.md', Date.now(), 'newHash'),
        createScannedFile('/vault/added.md'),
      ];

      const result = validator.validate(scannedFiles, store);
      const report = validator.generateReport(result);

      expect(report).toContain('Cache Validation Report');
      expect(report).toContain('Added:     1');
      expect(report).toContain('Modified:  1');
      expect(report).toContain('Recommendation:');
    });
  });

  describe('getChangeDetails', () => {
    it('should return detailed change descriptions', () => {
      const scannedFiles = [
        createScannedFile('/vault/added.md'),
      ];

      const result = validator.validate(scannedFiles, store);
      const details = validator.getChangeDetails(result);

      expect(details.length).toBe(1);
      expect(details[0]).toContain('ADDED');
      expect(details[0]).toContain('/vault/added.md');
    });

    it('should filter by change type', () => {
      store.upsert(createMetadata('/vault/modified.md', Date.now(), 'oldHash'));
      store.upsert(createMetadata('/vault/deleted.md'));

      const scannedFiles = [
        createScannedFile('/vault/modified.md', Date.now(), 'newHash'),
        createScannedFile('/vault/added.md'),
      ];

      const result = validator.validate(scannedFiles, store);
      const addedDetails = validator.getChangeDetails(result, ChangeType.ADDED);

      expect(addedDetails.length).toBe(1);
      expect(addedDetails[0]).toContain('ADDED');
    });
  });

  describe('edge cases', () => {
    it('should handle validation with no hash comparison', () => {
      const noHashValidator = new CacheValidator({
        useHashComparison: false,
      });

      const path = '/vault/file.md';
      const time = Date.now();

      store.upsert(createMetadata(path, time, 'oldHash'));

      // Same mtime, different hash - should be unchanged without hash comparison
      const scannedFiles = [
        createScannedFile(path, time, 'newHash'),
      ];

      const validatorWithUnchanged = new CacheValidator({
        useHashComparison: false,
        skipUnchanged: false,
      });

      const result = validatorWithUnchanged.validate(scannedFiles, store);

      expect(result.unchanged).toBe(1);
      expect(result.modified).toBe(0);
    });

    it('should handle very large change sets', () => {
      // Create 10,000 files
      for (let i = 0; i < 10000; i++) {
        store.upsert(createMetadata(`/vault/file${i}.md`));
      }

      const scannedFiles = [];
      for (let i = 0; i < 10000; i++) {
        scannedFiles.push(createScannedFile(`/vault/file${i}.md`));
      }

      const result = validator.validate(scannedFiles, store);

      expect(result.totalScanned).toBe(10000);
      expect(result.totalCached).toBe(10000);
    });
  });
});
