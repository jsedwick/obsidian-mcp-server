/**
 * Structured logging utility for Obsidian MCP Server
 *
 * Provides context-aware logging with multiple log levels.
 * Log level can be controlled via LOG_LEVEL environment variable.
 * Logging output can be controlled via LOG_FILE environment variable:
 *   - If LOG_FILE is set: logs write to file (prevents JSON-RPC interference)
 *   - If LOG_FILE is unset: logs write to stderr (for CLI/testing)
 */

import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  meta?: Record<string, unknown>;
  error?: Error;
}

/**
 * Logger class with structured logging support
 *
 * @example
 * ```typescript
 * const logger = createLogger('MyService');
 * logger.info('Operation started', { userId: 123 });
 * logger.error('Operation failed', error, { userId: 123 });
 * ```
 */
export class Logger {
  constructor(
    private context: string,
    private minLevel: LogLevel = LogLevel.INFO
  ) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, error?: Error, meta?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, { ...meta, error: error?.message, stack: error?.stack });
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (level < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      meta,
    };

    // Format and output based on level
    const formatted = this.format(entry);

    // Determine output destination
    const logFile = process.env.LOG_FILE;

    if (logFile) {
      // File-based logging (safe for MCP/JSON-RPC)
      try {
        // Ensure log directory exists
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        // Append to log file with newline
        fs.appendFileSync(logFile, formatted + '\n', 'utf-8');
      } catch (error) {
        // If file logging fails, fall back to stderr (but only for critical errors)
        if (level === LogLevel.ERROR) {
          console.error(
            `[Logger] Failed to write to log file: ${error instanceof Error ? error.message : String(error)}`
          );
          console.error(formatted);
        }
      }
    } else {
      // Console-based logging (for CLI/testing)
      // Always use stderr to avoid corrupting JSON-RPC on stdout
      console.error(formatted);
    }
  }

  private format(entry: LogEntry): string {
    const levelStr = LogLevel[entry.level];
    const metaStr =
      entry.meta && Object.keys(entry.meta).length > 0 ? ` ${JSON.stringify(entry.meta)}` : '';
    return `[${entry.timestamp}] [${levelStr}] [${entry.context}] ${entry.message}${metaStr}`;
  }

  /**
   * Create a child logger with extended context
   *
   * @example
   * ```typescript
   * const logger = createLogger('VaultManager');
   * const childLogger = logger.child('readFile');
   * // childLogger context will be 'VaultManager:readFile'
   * ```
   */
  child(additionalContext: string): Logger {
    return new Logger(`${this.context}:${additionalContext}`, this.minLevel);
  }
}

/**
 * Create a new logger with the specified context
 *
 * Log level is determined by LOG_LEVEL environment variable.
 * Defaults to INFO if not set.
 *
 * @param context - The context identifier for this logger (e.g., 'VaultManager', 'SearchEngine')
 * @returns Logger instance
 */
export function createLogger(context: string): Logger {
  const level = process.env.LOG_LEVEL
    ? (LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO)
    : LogLevel.INFO;

  return new Logger(context, level);
}
