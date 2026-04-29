/**
 * SessionStateFile - Per-session recovery files for crash recovery
 *
 * Persists session state to individual JSON files in .obsidian-mcp/recovery/,
 * enabling recovery when the MCP server restarts or crashes. Each session gets
 * its own file keyed by session start timestamp, allowing concurrent sessions
 * to coexist without clobbering each other's recovery data.
 *
 * Extends Decision 048's context truncation recovery to cover server-level state loss.
 *
 * Each recovery file is:
 * - Created fresh when /mb runs (new session starts)
 * - Updated incrementally as files are accessed
 * - Updated with Phase 1 data when close_session Phase 1 completes
 * - Read for recovery if MCP server state is lost
 * - Deleted on successful session close (Phase 2 complete)
 *
 * Related: Decision 048 (context truncation recovery), Decision 054 (persistent state)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { formatLocalDateTime, formatFilesafeTimestamp } from '../../utils/dateFormat.js';
import type { FileAccess } from '../../models/Session.js';

const logger = createLogger('SessionStateFile');

/** Schema version for migration support */
const SCHEMA_VERSION = 3;

/** Recovery directory within .obsidian-mcp */
const RECOVERY_DIR = '.obsidian-mcp/recovery';

/** Legacy filename to clean up */
const LEGACY_FILENAME = 'session-state.md';

/** Stale file threshold (24 hours) */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Tracked content created during a session (topics + decisions share this shape).
 */
export interface TrackedContent {
  slug: string;
  title: string;
  file: string;
}

/**
 * Tracked project page (uses `name` instead of `title` to match the project tool's contract).
 */
export interface TrackedProject {
  slug: string;
  name: string;
  file: string;
}

/**
 * State that can be restored from the file
 */
export interface RestoredSessionState {
  schemaVersion: number;
  sessionStart: string;
  lastUpdated: string;
  phase1Completed: boolean;
  filesAccessed: FileAccess[];
  // Decision 065: tracker arrays persist across fork-restart so Phase 2's
  // ## Topics Created / ## Decisions Made / ## Projects Created sections
  // reflect actual mid-session work even when the runtime restarted between
  // creation and /close.
  topicsCreated: TrackedContent[];
  decisionsCreated: TrackedContent[];
  projectsCreated: TrackedProject[];
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-explicit-any
  phase1SessionData: any | null;
}

/**
 * Service for persisting and recovering session state via per-session JSON files
 */
export class SessionStateFile {
  private vaultPath: string;
  private recoveryDir: string;
  private filePath: string | null = null;
  private pendingFileAccesses: FileAccess[] = [];
  private pendingTopicsCreated: TrackedContent[] = [];
  private pendingDecisionsCreated: TrackedContent[] = [];
  private pendingProjectsCreated: TrackedProject[] = [];
  // Serializes read-modify-write on the recovery file so concurrent paths
  // (storePhase1Data + flush*) cannot clobber each other.
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.recoveryDir = path.join(vaultPath, RECOVERY_DIR);
    logger.info('SessionStateFile initialized', { recoveryDir: this.recoveryDir });
  }

  /**
   * Initialize a fresh session recovery file (called on /mb).
   * Routed through withWriteLock so concurrent fire-and-forget calls in
   * clearSessionState (deleteRecoveryFile then initialize) execute in submit
   * order — otherwise delete's trailing `this.filePath = null` could clobber
   * the new path initialize just set.
   *
   * @param sessionStart - Session start time
   */
  async initialize(sessionStart: Date): Promise<void> {
    const timestamp = formatFilesafeTimestamp(sessionStart);
    const now = formatLocalDateTime(sessionStart);

    await this.withWriteLock(async () => {
      try {
        await fs.mkdir(this.recoveryDir, { recursive: true });
        this.filePath = path.join(this.recoveryDir, `session-${timestamp}.json`);

        const state: RestoredSessionState = {
          schemaVersion: SCHEMA_VERSION,
          sessionStart: now,
          lastUpdated: now,
          phase1Completed: false,
          filesAccessed: [],
          topicsCreated: [],
          decisionsCreated: [],
          projectsCreated: [],
          phase1SessionData: null,
        };

        await this.writeState(state);
        logger.info('Session recovery file initialized', {
          filePath: this.filePath,
          sessionStart: now,
        });
      } catch (error) {
        logger.warn('Failed to initialize session recovery file', { error });
      }
    });

    // Cleanup tasks run outside the lock — they don't touch this.filePath.
    this.cleanupStaleFiles().catch(err => {
      logger.debug('Failed to clean up stale recovery files', { error: err });
    });
    this.cleanupLegacyFile().catch(err => {
      logger.debug('Failed to clean up legacy session-state.md', { error: err });
    });
  }

  /**
   * Track a file access. Flush is kicked off immediately; the writeQueue
   * serializes concurrent flushes, and synchronous bursts coalesce because
   * flushFileAccesses early-returns once pendingFileAccesses is drained.
   * Eager flush guarantees durability before the next async tool call —
   * fork-restart can no longer drop entries that lived only in volatile memory.
   *
   * @param entry - File access entry
   */
  trackFileAccess(entry: FileAccess): void {
    if (!this.filePath) {
      logger.debug('Skipping file access tracking - no recovery file initialized');
      return;
    }

    this.pendingFileAccesses.push(entry);
    void this.flushFileAccesses();
  }

  /**
   * Flush pending file accesses to disk
   */
  private async flushFileAccesses(): Promise<void> {
    if (this.pendingFileAccesses.length === 0 || !this.filePath) {
      return;
    }

    const toFlush = [...this.pendingFileAccesses];
    this.pendingFileAccesses = [];

    await this.withWriteLock(async () => {
      try {
        const state = await this.readState();
        if (!state) {
          logger.warn('Failed to read recovery file for update');
          return;
        }

        state.filesAccessed.push(...toFlush);
        state.lastUpdated = formatLocalDateTime(new Date());

        await this.writeState(state);
        logger.debug('Flushed file accesses to recovery file', { count: toFlush.length });
      } catch (error) {
        // Log but don't fail
        logger.warn('Failed to flush file accesses', { error, count: toFlush.length });
      }
    });
  }

  /**
   * Track a topic creation. Eager-flush pattern matches trackFileAccess
   * (Decision 063) — synchronous bursts coalesce via the early-return guard
   * inside flushTopicsCreated, fork-restart cannot drop entries that lived
   * only in volatile memory.
   */
  trackTopicCreation(item: TrackedContent): void {
    if (!this.filePath) {
      logger.debug('Skipping topic creation tracking - no recovery file initialized');
      return;
    }
    this.pendingTopicsCreated.push(item);
    void this.flushTopicsCreated();
  }

  /**
   * Track a decision creation. See trackTopicCreation for the durability contract.
   */
  trackDecisionCreation(item: TrackedContent): void {
    if (!this.filePath) {
      logger.debug('Skipping decision creation tracking - no recovery file initialized');
      return;
    }
    this.pendingDecisionsCreated.push(item);
    void this.flushDecisionsCreated();
  }

  /**
   * Track a project page creation. See trackTopicCreation for the durability contract.
   */
  trackProjectCreation(item: TrackedProject): void {
    if (!this.filePath) {
      logger.debug('Skipping project creation tracking - no recovery file initialized');
      return;
    }
    this.pendingProjectsCreated.push(item);
    void this.flushProjectsCreated();
  }

  private async flushTopicsCreated(): Promise<void> {
    if (this.pendingTopicsCreated.length === 0 || !this.filePath) {
      return;
    }
    const toFlush = [...this.pendingTopicsCreated];
    this.pendingTopicsCreated = [];

    await this.withWriteLock(async () => {
      try {
        const state = await this.readState();
        if (!state) {
          logger.warn('Failed to read recovery file for topics update');
          return;
        }
        state.topicsCreated.push(...toFlush);
        state.lastUpdated = formatLocalDateTime(new Date());
        await this.writeState(state);
        logger.debug('Flushed topics created to recovery file', { count: toFlush.length });
      } catch (error) {
        logger.warn('Failed to flush topics created', { error, count: toFlush.length });
      }
    });
  }

  private async flushDecisionsCreated(): Promise<void> {
    if (this.pendingDecisionsCreated.length === 0 || !this.filePath) {
      return;
    }
    const toFlush = [...this.pendingDecisionsCreated];
    this.pendingDecisionsCreated = [];

    await this.withWriteLock(async () => {
      try {
        const state = await this.readState();
        if (!state) {
          logger.warn('Failed to read recovery file for decisions update');
          return;
        }
        state.decisionsCreated.push(...toFlush);
        state.lastUpdated = formatLocalDateTime(new Date());
        await this.writeState(state);
        logger.debug('Flushed decisions created to recovery file', { count: toFlush.length });
      } catch (error) {
        logger.warn('Failed to flush decisions created', { error, count: toFlush.length });
      }
    });
  }

  private async flushProjectsCreated(): Promise<void> {
    if (this.pendingProjectsCreated.length === 0 || !this.filePath) {
      return;
    }
    const toFlush = [...this.pendingProjectsCreated];
    this.pendingProjectsCreated = [];

    await this.withWriteLock(async () => {
      try {
        const state = await this.readState();
        if (!state) {
          logger.warn('Failed to read recovery file for projects update');
          return;
        }
        state.projectsCreated.push(...toFlush);
        state.lastUpdated = formatLocalDateTime(new Date());
        await this.writeState(state);
        logger.debug('Flushed projects created to recovery file', { count: toFlush.length });
      } catch (error) {
        logger.warn('Failed to flush projects created', { error, count: toFlush.length });
      }
    });
  }

  /**
   * Store Phase 1 session data
   *
   * @param data - Complete Phase 1 session data
   */
  async storePhase1Data(data: unknown): Promise<void> {
    if (!this.filePath) {
      logger.warn('Cannot store Phase 1 data - no recovery file initialized');
      return;
    }

    try {
      // Drain any pending tracker writes before stamping Phase 1 data
      await Promise.all([
        this.flushFileAccesses(),
        this.flushTopicsCreated(),
        this.flushDecisionsCreated(),
        this.flushProjectsCreated(),
      ]);

      await this.withWriteLock(async () => {
        const state = await this.readState();
        if (!state) {
          logger.warn('Failed to read recovery file for Phase 1 update');
          return;
        }

        state.phase1Completed = true;
        state.phase1SessionData = data;
        state.lastUpdated = formatLocalDateTime(new Date());

        await this.writeState(state);
        logger.info('Phase 1 session data stored to recovery file');
      });
    } catch (error) {
      logger.warn('Failed to store Phase 1 data', { error });
    }
  }

  /**
   * Run fn with exclusive access to the recovery file write path. Operations
   * are queued in call order; failures don't break the chain.
   */
  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * Restore session state from the most recent recovery file
   *
   * @returns Restored state or null if not available
   */
  async restore(): Promise<RestoredSessionState | null> {
    try {
      // Scan recovery directory for files
      let files: string[];
      try {
        files = await fs.readdir(this.recoveryDir);
      } catch (error) {
        const err = error as { code?: string };
        if (err.code === 'ENOENT') {
          logger.debug('Recovery directory does not exist');
          return null;
        }
        throw error;
      }

      // Filter to session JSON files and sort descending (newest first)
      const recoveryFiles = files
        .filter(f => f.startsWith('session-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (recoveryFiles.length === 0) {
        logger.debug('No recovery files found');
        return null;
      }

      // Try each file starting from newest
      for (const file of recoveryFiles) {
        const filePath = path.join(this.recoveryDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const state = JSON.parse(content) as RestoredSessionState;

          if (state.schemaVersion > SCHEMA_VERSION) {
            logger.warn('Recovery file has newer schema version', {
              file,
              fileVersion: state.schemaVersion,
              currentVersion: SCHEMA_VERSION,
            });
            continue;
          }

          // Set filePath so subsequent operations use this file
          this.filePath = filePath;

          const normalized = this.normalizeRestoredState(state);
          logger.info('Session state restored from recovery file', {
            file,
            sessionStart: normalized.sessionStart,
            filesAccessedCount: normalized.filesAccessed.length,
            topicsCreatedCount: normalized.topicsCreated.length,
            decisionsCreatedCount: normalized.decisionsCreated.length,
            projectsCreatedCount: normalized.projectsCreated.length,
            phase1Completed: normalized.phase1Completed,
          });

          return normalized;
        } catch (error) {
          logger.warn('Failed to parse recovery file, trying next', { file, error });
          continue;
        }
      }

      logger.warn('No valid recovery files found');
      return null;
    } catch (error) {
      logger.warn('Failed to restore session state', { error });
      return null;
    }
  }

  /**
   * Delete this session's recovery file (called on successful session close).
   * Routed through withWriteLock so concurrent calls (delete-then-initialize
   * in clearSessionState) cannot have delete's trailing `this.filePath = null`
   * race against initialize's `this.filePath = newPath`.
   */
  async deleteRecoveryFile(): Promise<void> {
    await this.withWriteLock(async () => {
      const target = this.filePath;
      if (!target) return;

      try {
        await fs.unlink(target);
        logger.info('Recovery file deleted', { filePath: target });
      } catch (error) {
        const err = error as { code?: string };
        if (err.code !== 'ENOENT') {
          logger.warn('Failed to delete recovery file', { error, filePath: target });
        }
      }

      // Only clear filePath if it still points at the file we just deleted —
      // a queued-after-us initialize() may have already promoted it to a new
      // path (and we don't want to wipe that out).
      if (this.filePath === target) {
        this.filePath = null;
      }
    });
  }

  /**
   * Write state to JSON file
   */
  private async writeState(state: RestoredSessionState): Promise<void> {
    if (!this.filePath) {
      return;
    }
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Read state from current JSON file
   */
  private async readState(): Promise<RestoredSessionState | null> {
    if (!this.filePath) {
      return null;
    }

    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return this.normalizeRestoredState(JSON.parse(content) as RestoredSessionState);
    } catch (error) {
      logger.warn('Failed to read recovery file', { error, filePath: this.filePath });
      return null;
    }
  }

  /**
   * Backfill tracker arrays for v2 files (Decision 065 added them in v3).
   * Older sessions still mid-flight when the runtime upgrades will read with
   * undefined tracker fields; default them to [] so flush paths can push safely.
   * Also stamps schemaVersion to current so the next writeState doesn't leave
   * a v2-tagged file holding v3-shaped data.
   */
  private normalizeRestoredState(raw: RestoredSessionState): RestoredSessionState {
    return {
      ...raw,
      schemaVersion: SCHEMA_VERSION,
      topicsCreated: raw.topicsCreated ?? [],
      decisionsCreated: raw.decisionsCreated ?? [],
      projectsCreated: raw.projectsCreated ?? [],
    };
  }

  /**
   * Remove recovery files older than 24 hours
   */
  private async cleanupStaleFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.recoveryDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.startsWith('session-') || !file.endsWith('.json')) continue;

        const filePath = path.join(this.recoveryDir, file);

        // Don't delete our own file
        if (filePath === this.filePath) continue;

        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > STALE_THRESHOLD_MS) {
          await fs.unlink(filePath);
          logger.info('Deleted stale recovery file', { file });
        }
      }
    } catch (error) {
      const err = error as { code?: string };
      if (err.code !== 'ENOENT') {
        logger.debug('Failed to clean up stale recovery files', { error });
      }
    }
  }

  /**
   * Remove legacy session-state.md from vault root
   */
  private async cleanupLegacyFile(): Promise<void> {
    const legacyPath = path.join(this.vaultPath, LEGACY_FILENAME);
    try {
      await fs.unlink(legacyPath);
      logger.info('Deleted legacy session-state.md', { path: legacyPath });
    } catch (error) {
      const err = error as { code?: string };
      if (err.code !== 'ENOENT') {
        logger.debug('Failed to delete legacy session-state.md', { error });
      }
    }
  }

  /**
   * Get the file path for testing/debugging
   */
  getFilePath(): string | null {
    return this.filePath;
  }
}
