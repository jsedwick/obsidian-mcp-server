/**
 * Logger utility unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, createLogger } from '../../../src/utils/logger.js';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

import * as fs from 'fs';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOG_FILE;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_FILE;
    delete process.env.LOG_LEVEL;
  });

  describe('log level filtering', () => {
    it('should log messages at or above minimum level', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.INFO);
      logger.info('info message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it('should filter messages below minimum level', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.WARN);
      logger.debug('debug message');
      logger.info('info message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should allow DEBUG through when level is DEBUG', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.debug('debug message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it('should always allow ERROR through', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.ERROR);
      logger.error('error message');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('console output (no LOG_FILE)', () => {
    it('should use console.error for ERROR level', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.error('error message');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('should use console.warn for WARN level', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.warn('warn message');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should use console.log for INFO level', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.info('info message');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('should use console.log for DEBUG level', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.debug('debug message');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('file output (LOG_FILE set)', () => {
    it('should write to file when LOG_FILE is set', () => {
      process.env.LOG_FILE = '/tmp/test.log';
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.info('file message');
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining('file message'),
        'utf-8'
      );
    });

    it('should create log directory if missing', () => {
      process.env.LOG_FILE = '/tmp/logs/test.log';
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.info('message');
      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/logs', { recursive: true });
    });

    it('should fall back to stderr on file write failure for ERROR level', () => {
      process.env.LOG_FILE = '/tmp/test.log';
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('disk full');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.error('critical error');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should silently swallow file write failure for non-ERROR levels', () => {
      process.env.LOG_FILE = '/tmp/test.log';
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('disk full');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.info('info message');
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('should include timestamp, level, context, and message', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('MyService', LogLevel.DEBUG);
      logger.info('test message');
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
      expect(output).toContain('[INFO]');
      expect(output).toContain('[MyService]');
      expect(output).toContain('test message');
    });

    it('should include metadata as JSON', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.info('with meta', { userId: 123, action: 'login' });
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('"userId":123');
      expect(output).toContain('"action":"login"');
    });

    it('should not include metadata section when meta is empty', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      logger.info('no meta');
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/no meta$/);
    });

    it('should include error details in error log', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new Logger('Test', LogLevel.DEBUG);
      const testError = new Error('something broke');
      logger.error('operation failed', testError, { op: 'read' });
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain('operation failed');
      expect(output).toContain('something broke');
    });
  });

  describe('child logger', () => {
    it('should create child with extended context', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const parent = new Logger('VaultManager', LogLevel.DEBUG);
      const child = parent.child('readFile');
      child.info('reading file');
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('[VaultManager:readFile]');
    });

    it('should inherit parent log level', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const parent = new Logger('Test', LogLevel.WARN);
      const child = parent.child('sub');
      child.info('should be filtered');
      expect(logSpy).not.toHaveBeenCalled();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      child.warn('should pass');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('createLogger', () => {
    it('should create logger with INFO level by default', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = createLogger('Test');
      logger.debug('should be filtered');
      expect(logSpy).not.toHaveBeenCalled();
      logger.info('should pass');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('should respect LOG_LEVEL env var', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = createLogger('Test');
      logger.debug('should pass');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('should default to INFO for invalid LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'INVALID';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = createLogger('Test');
      logger.debug('should be filtered');
      expect(logSpy).not.toHaveBeenCalled();
      logger.info('should pass');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });
});
