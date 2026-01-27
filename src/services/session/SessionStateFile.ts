/**
 * SessionStateFile - Persistent session state to vault markdown file
 *
 * This service persists session state incrementally to a markdown file
 * in the vault root, enabling recovery when the MCP server restarts or crashes.
 *
 * Extends Decision 048's context truncation recovery to cover server-level state loss.
 *
 * The file is:
 * - Created fresh when /mb runs (new session starts)
 * - Updated incrementally as files are accessed
 * - Updated with Phase 1 data when close_session Phase 1 completes
 * - Read for recovery if MCP server state is lost
 *
 * Related: Decision 048 (context truncation recovery)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { formatLocalDateTime } from '../../utils/dateFormat.js';
import type { FileAccess } from '../../models/Session.js';

const logger = createLogger('SessionStateFile');

/** Schema version for migration support */
const SCHEMA_VERSION = 1;

/** File name in vault root */
const SESSION_STATE_FILENAME = 'session-state.md';

/** Debounce interval for file access writes (ms) */
const DEBOUNCE_INTERVAL = 500;

/**
 * State that can be restored from the file
 */
export interface RestoredSessionState {
  schemaVersion: number;
  sessionStart: string;
  lastUpdated: string;
  phase1Completed: boolean;
  filesAccessed: FileAccess[];
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-explicit-any
  phase1SessionData: any | null;
}

/**
 * Service for persisting and recovering session state
 */
export class SessionStateFile {
  private filePath: string;
  private debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private pendingFileAccesses: FileAccess[] = [];

  constructor(vaultPath: string) {
    this.filePath = path.join(vaultPath, SESSION_STATE_FILENAME);
    logger.info('SessionStateFile initialized', { filePath: this.filePath });
  }

  /**
   * Initialize a fresh session state file (called on /mb)
   *
   * @param sessionStart - Session start time
   */
  async initialize(sessionStart: Date): Promise<void> {
    const now = formatLocalDateTime(sessionStart);

    const content = this.generateTemplate({
      schemaVersion: SCHEMA_VERSION,
      sessionStart: now,
      lastUpdated: now,
      phase1Completed: false,
      filesAccessed: [],
      phase1SessionData: null,
    });

    try {
      await fs.writeFile(this.filePath, content, 'utf-8');
      logger.info('Session state file initialized', { sessionStart: now });
    } catch (error) {
      // Log but don't fail - session state persistence is an optimization
      logger.warn('Failed to initialize session state file', { error });
    }
  }

  /**
   * Track a file access (debounced write)
   *
   * @param entry - File access entry
   */
  trackFileAccess(entry: FileAccess): void {
    this.pendingFileAccesses.push(entry);

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new timer
    this.debounceTimer = setTimeout(() => {
      void this.flushFileAccesses();
    }, DEBOUNCE_INTERVAL);
  }

  /**
   * Flush pending file accesses to disk
   */
  private async flushFileAccesses(): Promise<void> {
    if (this.pendingFileAccesses.length === 0) {
      return;
    }

    const toFlush = [...this.pendingFileAccesses];
    this.pendingFileAccesses = [];

    try {
      // Read current file
      const content = await fs.readFile(this.filePath, 'utf-8');

      // Parse and update
      const state = this.parseFile(content);
      if (!state) {
        logger.warn('Failed to parse session state file for update');
        return;
      }

      // Add new file accesses
      state.filesAccessed.push(...toFlush);
      state.lastUpdated = formatLocalDateTime(new Date());

      // Write updated content
      const updatedContent = this.generateTemplate(state);
      await fs.writeFile(this.filePath, updatedContent, 'utf-8');

      logger.debug('Flushed file accesses to session state', { count: toFlush.length });
    } catch (error) {
      // Log but don't fail
      logger.warn('Failed to flush file accesses', { error, count: toFlush.length });
    }
  }

  /**
   * Store Phase 1 session data
   *
   * @param data - Complete Phase 1 session data
   */
  async storePhase1Data(data: unknown): Promise<void> {
    try {
      // Flush any pending file accesses first
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      await this.flushFileAccesses();

      // Read current file
      const content = await fs.readFile(this.filePath, 'utf-8');

      // Parse and update
      const state = this.parseFile(content);
      if (!state) {
        logger.warn('Failed to parse session state file for Phase 1 update');
        return;
      }

      state.phase1Completed = true;
      state.phase1SessionData = data;
      state.lastUpdated = formatLocalDateTime(new Date());

      // Write updated content
      const updatedContent = this.generateTemplate(state);
      await fs.writeFile(this.filePath, updatedContent, 'utf-8');

      logger.info('Phase 1 session data stored to file');
    } catch (error) {
      logger.warn('Failed to store Phase 1 data', { error });
    }
  }

  /**
   * Restore session state from file
   *
   * @returns Restored state or null if not available
   */
  async restore(): Promise<RestoredSessionState | null> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const state = this.parseFile(content);

      if (!state) {
        logger.warn('Failed to parse session state file for restore');
        return null;
      }

      // Check schema version
      if (state.schemaVersion > SCHEMA_VERSION) {
        logger.warn('Session state file has newer schema version', {
          fileVersion: state.schemaVersion,
          currentVersion: SCHEMA_VERSION,
        });
        return null;
      }

      logger.info('Session state restored from file', {
        sessionStart: state.sessionStart,
        filesAccessedCount: state.filesAccessed.length,
        phase1Completed: state.phase1Completed,
      });

      return state;
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        logger.debug('Session state file does not exist');
      } else {
        logger.warn('Failed to restore session state', { error });
      }
      return null;
    }
  }

  /**
   * Generate markdown file content from state
   */
  private generateTemplate(state: RestoredSessionState): string {
    const filesTable = this.generateFilesTable(state.filesAccessed);
    const phase1Json = JSON.stringify(state.phase1SessionData, null, 2);

    return `---
schema_version: ${state.schemaVersion}
session_start: "${state.sessionStart}"
last_updated: "${state.lastUpdated}"
phase1_completed: ${state.phase1Completed}
---

# Session State

This file tracks the current session state for recovery purposes.
It is overwritten at the start of each new session when /mb runs.

## Files Accessed

${filesTable}

## Phase 1 Data

\`\`\`json
${phase1Json}
\`\`\`
`;
  }

  /**
   * Generate markdown table for files accessed
   */
  private generateFilesTable(files: FileAccess[]): string {
    if (files.length === 0) {
      return '| Path | Action | Timestamp |\n|------|--------|-----------|';
    }

    const rows = files.map(f => `| ${f.path} | ${f.action} | ${f.timestamp} |`);
    return `| Path | Action | Timestamp |\n|------|--------|-----------|
${rows.join('\n')}`;
  }

  /**
   * Parse markdown file content to extract state
   */
  private parseFile(content: string): RestoredSessionState | null {
    try {
      // Extract frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        return null;
      }

      const frontmatter = frontmatterMatch[1];
      const schemaVersion = this.extractFrontmatterValue(frontmatter, 'schema_version', '1');
      const sessionStart = this.extractFrontmatterValue(frontmatter, 'session_start', '');
      const lastUpdated = this.extractFrontmatterValue(frontmatter, 'last_updated', '');
      const phase1Completed = this.extractFrontmatterValue(
        frontmatter,
        'phase1_completed',
        'false'
      );

      // Extract files accessed table
      const filesAccessed = this.parseFilesTable(content);

      // Extract Phase 1 JSON
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const phase1SessionData = this.parsePhase1Json(content);

      return {
        schemaVersion: parseInt(schemaVersion, 10),
        sessionStart: sessionStart.replace(/"/g, ''),
        lastUpdated: lastUpdated.replace(/"/g, ''),
        phase1Completed: phase1Completed === 'true',

        filesAccessed,
        phase1SessionData,
      };
    } catch (error) {
      logger.warn('Error parsing session state file', { error });
      return null;
    }
  }

  /**
   * Extract a value from YAML frontmatter
   */
  private extractFrontmatterValue(frontmatter: string, key: string, defaultValue: string): string {
    const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
    const match = frontmatter.match(regex);
    return match ? match[1].trim() : defaultValue;
  }

  /**
   * Parse the files accessed table from markdown
   */
  private parseFilesTable(content: string): FileAccess[] {
    const files: FileAccess[] = [];

    // Find the table section
    const tableMatch = content.match(/## Files Accessed\n\n([\s\S]*?)(?=\n## |$)/);
    if (!tableMatch) {
      return files;
    }

    const tableContent = tableMatch[1];
    const lines = tableContent.split('\n');

    // Skip header and separator rows
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || !line.startsWith('|')) continue;

      // Parse table row: | path | action | timestamp |
      const parts = line
        .split('|')
        .map(p => p.trim())
        .filter(p => p);
      if (parts.length >= 3) {
        files.push({
          path: parts[0],
          action: parts[1] as FileAccess['action'],
          timestamp: parts[2],
        });
      }
    }

    return files;
  }

  /**
   * Parse the Phase 1 JSON block from markdown
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-explicit-any
  private parsePhase1Json(content: string): any | null {
    const jsonMatch = content.match(/## Phase 1 Data\n\n```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      return null;
    }
  }

  /**
   * Get the file path for testing/debugging
   */
  getFilePath(): string {
    return this.filePath;
  }
}
