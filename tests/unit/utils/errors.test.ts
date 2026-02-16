/**
 * Custom error classes unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  ObsidianMCPError,
  VaultError,
  SearchError,
  GitError,
  ValidationError,
  ConfigError,
  EmbeddingError,
  SessionError,
  MigrationError,
} from '../../../src/utils/errors.js';

describe('errors', () => {
  const errorClasses = [
    { Class: VaultError, code: 'VAULT_ERROR', name: 'VaultError' },
    { Class: SearchError, code: 'SEARCH_ERROR', name: 'SearchError' },
    { Class: GitError, code: 'GIT_ERROR', name: 'GitError' },
    { Class: ValidationError, code: 'VALIDATION_ERROR', name: 'ValidationError' },
    { Class: ConfigError, code: 'CONFIG_ERROR', name: 'ConfigError' },
    { Class: EmbeddingError, code: 'EMBEDDING_ERROR', name: 'EmbeddingError' },
    { Class: SessionError, code: 'SESSION_ERROR', name: 'SessionError' },
    { Class: MigrationError, code: 'MIGRATION_ERROR', name: 'MigrationError' },
  ];

  describe('ObsidianMCPError (base class)', () => {
    it('should set message, code, and name', () => {
      const error = new ObsidianMCPError('test message', 'TEST_CODE');
      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('ObsidianMCPError');
    });

    it('should store optional details', () => {
      const details = { path: '/test', operation: 'read' };
      const error = new ObsidianMCPError('test', 'CODE', details);
      expect(error.details).toEqual(details);
    });

    it('should have undefined details when not provided', () => {
      const error = new ObsidianMCPError('test', 'CODE');
      expect(error.details).toBeUndefined();
    });

    it('should be an instance of Error', () => {
      const error = new ObsidianMCPError('test', 'CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ObsidianMCPError);
    });

    it('should have a stack trace', () => {
      const error = new ObsidianMCPError('test', 'CODE');
      expect(error.stack).toBeDefined();
    });

    describe('toUserMessage', () => {
      it('should return formatted user message with code', () => {
        const error = new ObsidianMCPError('Something went wrong', 'MY_CODE');
        const msg = error.toUserMessage();
        expect(msg).toContain('Something went wrong');
        expect(msg).toContain('MY_CODE');
      });
    });

    describe('toLogFormat', () => {
      it('should return structured log object', () => {
        const details = { key: 'value' };
        const error = new ObsidianMCPError('log test', 'LOG_CODE', details);
        const log = error.toLogFormat();
        expect(log.name).toBe('ObsidianMCPError');
        expect(log.message).toBe('log test');
        expect(log.code).toBe('LOG_CODE');
        expect(log.details).toEqual(details);
        expect(log.stack).toBeDefined();
      });

      it('should handle missing details gracefully', () => {
        const error = new ObsidianMCPError('no details', 'CODE');
        const log = error.toLogFormat();
        expect(log.details).toBeUndefined();
        expect(log.name).toBe('ObsidianMCPError');
      });
    });
  });

  describe.each(errorClasses)('$name', ({ Class, code, name }) => {
    it('should extend ObsidianMCPError', () => {
      const error = new Class('test');
      expect(error).toBeInstanceOf(ObsidianMCPError);
      expect(error).toBeInstanceOf(Error);
    });

    it(`should have code "${code}"`, () => {
      const error = new Class('test');
      expect(error.code).toBe(code);
    });

    it(`should have name "${name}"`, () => {
      const error = new Class('test');
      expect(error.name).toBe(name);
    });

    it('should pass instanceof check', () => {
      const error = new Class('test');
      expect(error).toBeInstanceOf(Class);
    });

    it('should store message', () => {
      const error = new Class('specific message');
      expect(error.message).toBe('specific message');
    });

    it('should store optional details', () => {
      const details = { foo: 'bar' };
      const error = new Class('test', details);
      expect(error.details).toEqual(details);
    });

    it('should produce user message with code', () => {
      const error = new Class('user-facing message');
      const msg = error.toUserMessage();
      expect(msg).toContain('user-facing message');
      expect(msg).toContain(code);
    });

    it('should produce structured log format', () => {
      const error = new Class('log message', { detail: 1 });
      const log = error.toLogFormat();
      expect(log.name).toBe(name);
      expect(log.message).toBe('log message');
      expect(log.code).toBe(code);
      expect(log.details).toEqual({ detail: 1 });
      expect(log.stack).toBeDefined();
    });
  });
});
