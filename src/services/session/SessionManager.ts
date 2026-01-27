/**
 * SessionManager - Session lifecycle management
 *
 * Responsible for:
 * - Creating and closing sessions
 * - Managing session metadata and state
 * - Coordinating with file tracking and repository detection
 * - Building session files from templates
 * - Linking sessions to repositories, topics, and decisions
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { VaultError } from '../../utils/errors.js';
import { formatLocalDate } from '../../utils/dateFormat.js';
import { SessionTracker } from './SessionTracker.js';
import { RepositoryDetector } from '../git/RepositoryDetector.js';
import type {
  SessionMetadata,
  SessionCloseOptions,
  SessionCloseResult,
  SessionContext,
} from '../../models/Session.js';
import type { RepositoryInfo } from '../../models/Git.js';

const logger = createLogger('SessionManager');

/**
 * Service for managing session lifecycle
 */
export class SessionManager {
  private vaultPath: string;
  private sessionTracker: SessionTracker;
  private repositoryDetector: RepositoryDetector;
  private currentSessionId: string | null = null;
  private currentSessionFile: string | null = null;

  constructor(
    vaultPath: string,
    sessionTracker: SessionTracker,
    repositoryDetector: RepositoryDetector
  ) {
    this.vaultPath = vaultPath;
    this.sessionTracker = sessionTracker;
    this.repositoryDetector = repositoryDetector;
    logger.info('SessionManager initialized', { vaultPath });
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get current session file path
   */
  getCurrentSessionFile(): string | null {
    return this.currentSessionFile;
  }

  /**
   * Check if a session is currently active
   */
  hasActiveSession(): boolean {
    return this.currentSessionId !== null && this.currentSessionFile !== null;
  }

  /**
   * Close the current session and create session file
   *
   * @param options - Session close options
   * @param additionalContext - Additional context (topics, decisions, projects created)
   * @returns Session close result
   */
  async closeSession(
    options: SessionCloseOptions,
    additionalContext: {
      topicsCreated?: Array<{ title: string; file: string }>;
      decisionsCreated?: Array<{ title: string; file: string }>;
      projectsCreated?: Array<{ name: string; file: string }>;
    } = {}
  ): Promise<SessionCloseResult> {
    logger.info('Closing session', { topic: options.topic });

    // Generate session ID
    const sessionId = this.generateSessionId(options.topic);

    // Create session file
    const sessionFile = await this.createSessionFile(sessionId, options);

    // Detect repository if not skipped
    let detectedRepository: RepositoryInfo | undefined;
    if (!options.skipRepoDetection) {
      detectedRepository = await this.detectAndLinkRepository(sessionId);
    }

    // Extract context
    const topicsCreated = additionalContext.topicsCreated?.map(t => t.title) || [];
    const decisionsCreated = additionalContext.decisionsCreated?.map(d => d.title) || [];

    // Build result
    const result: SessionCloseResult = {
      sessionFile,
      sessionId,
      repositoriesDetected: detectedRepository ? 1 : 0,
      repositories: detectedRepository ? [detectedRepository] : [],
      filesAccessedCount: this.sessionTracker.getAccessCount(),
      topics: topicsCreated,
      decisions: decisionsCreated,
    };

    // Set current session
    this.currentSessionId = sessionId;
    this.currentSessionFile = sessionFile;

    logger.info('Session closed successfully', {
      sessionId,
      repositoriesDetected: result.repositoriesDetected,
      filesAccessed: result.filesAccessedCount,
    });

    return result;
  }

  /**
   * Generate a unique session ID
   *
   * Format: YYYY-MM-DD_HH-MM-SS[_topic-slug]
   *
   * @param topic - Optional topic/title
   * @returns Session ID
   */
  private generateSessionId(topic?: string): string {
    const now = new Date();
    const dateStr = formatLocalDate(now);
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const topicSlug = topic ? `_${this.slugify(topic)}` : '';
    const sessionId = `${dateStr}_${timeStr}${topicSlug}`;

    logger.debug('Generated session ID', { sessionId, topic });

    return sessionId;
  }

  /**
   * Create session file with frontmatter and content
   *
   * @param sessionId - Session identifier
   * @param options - Session close options
   * @returns Path to created session file
   */
  private async createSessionFile(
    sessionId: string,
    options: SessionCloseOptions
  ): Promise<string> {
    // Organize sessions by month (YYYY-MM)
    const dateStr = sessionId.split('_')[0]; // Extract YYYY-MM-DD
    const monthStr = dateStr.substring(0, 7); // YYYY-MM
    const monthDir = path.join(this.vaultPath, 'sessions', monthStr);

    // Ensure directory exists
    await fs.mkdir(monthDir, { recursive: true });

    const sessionFile = path.join(monthDir, `${sessionId}.md`);

    // Build frontmatter
    const metadata: SessionMetadata = {
      date: dateStr,
      session_id: sessionId,
      topics: [],
      decisions: [],
      status: 'completed',
    };

    // Add file access data if available
    const filesAccessed = this.sessionTracker.getAllAccess();
    if (filesAccessed.length > 0) {
      metadata.files_accessed = filesAccessed;
    }

    // Build file content
    const content = this.buildSessionContent(metadata, options);

    // Write file
    await fs.writeFile(sessionFile, content);

    logger.debug('Session file created', { sessionFile, sessionId });

    return sessionFile;
  }

  /**
   * Build session file content from metadata and options
   *
   * @param metadata - Session metadata
   * @param options - Session close options
   * @returns Session file content
   */
  private buildSessionContent(metadata: SessionMetadata, options: SessionCloseOptions): string {
    let content = '---\n';

    // Basic metadata
    content += `date: "${metadata.date}"\n`;
    content += `session_id: "${metadata.session_id}"\n`;
    content += `status: "${metadata.status}"\n`;

    // Arrays (initially empty, will be populated by vault_custodian)
    content += 'topics: []\n';
    content += 'decisions: []\n';

    // File access data
    if (metadata.files_accessed && metadata.files_accessed.length > 0) {
      content += 'files_accessed:\n';
      for (const access of metadata.files_accessed) {
        content += `  - path: "${access.path}"\n`;
        content += `    action: "${access.action}"\n`;
        content += `    timestamp: "${access.timestamp}"\n`;
      }
    }

    content += '---\n\n';

    // Title
    const title = options.topic || metadata.session_id;
    content += `# ${title}\n\n`;

    // Summary
    content += `## Summary\n\n${options.summary}\n\n`;

    // Related sections (will be populated by vault_custodian)
    content += '## Related Topics\n\n';
    content += '## Related Sessions\n\n';
    content += '## Related Decisions\n\n';
    content += '## Related Projects\n\n';
    content += '## Related Git Commits\n\n';

    return content;
  }

  /**
   * Detect repository from file access and link to session
   *
   * @param sessionId - Session identifier
   * @returns Detected repository info or undefined
   */
  private async detectAndLinkRepository(sessionId: string): Promise<RepositoryInfo | undefined> {
    const filesAccessed = this.sessionTracker.getAllAccess();

    if (filesAccessed.length === 0) {
      logger.debug('No files accessed, skipping repository detection');
      return undefined;
    }

    try {
      const candidate = await this.repositoryDetector.getTopCandidate(filesAccessed, {
        sessionId,
        includeMetadata: true,
      });

      if (!candidate) {
        logger.debug('No repository candidate found');
        return undefined;
      }

      // Check if this is a clear winner
      const allCandidates = await this.repositoryDetector.detectFromFileAccess(filesAccessed, {
        sessionId,
        maxCandidates: 2,
      });

      if (!this.repositoryDetector.isClearWinner(allCandidates)) {
        logger.debug('No clear repository winner', {
          candidatesCount: allCandidates.length,
        });
        return undefined;
      }

      // Build repository info
      const repoInfo: RepositoryInfo = {
        path: candidate.path,
        name: candidate.name,
        commits: [],
      };

      logger.info('Repository detected and linked', {
        sessionId,
        repository: candidate.name,
        score: candidate.score,
      });

      return repoInfo;
    } catch (error) {
      logger.error('Repository detection failed', error as Error);
      return undefined;
    }
  }

  /**
   * Link a repository to the current session
   *
   * @param repoPath - Absolute path to repository
   * @throws VaultError if no active session
   */
  async linkRepository(repoPath: string): Promise<void> {
    if (!this.currentSessionFile) {
      throw new VaultError('No active session to link repository to', {
        operation: 'linkRepository',
      });
    }

    logger.info('Linking repository to session', {
      sessionFile: this.currentSessionFile,
      repoPath,
    });

    // Read session file
    const content = await fs.readFile(this.currentSessionFile, 'utf-8');

    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new VaultError('Invalid session file format: no frontmatter found', {
        sessionFile: this.currentSessionFile,
      });
    }

    let frontmatter = frontmatterMatch[1];
    const bodyContent = content.substring(frontmatterMatch[0].length);

    // Extract repository name from path
    const repoName = path.basename(repoPath);

    // Add or update repository field in frontmatter
    const repoYaml = `repository:\n  path: "${repoPath}"\n  name: "${repoName}"\n  commits: []`;

    if (frontmatter.includes('repository:')) {
      // Replace existing
      frontmatter = frontmatter.replace(/repository:[\s\S]*?(?=\n[a-z_]+:|$)/, repoYaml);
    } else {
      // Add new
      frontmatter += `\n${repoYaml}`;
    }

    // Write updated content
    const newContent = `---\n${frontmatter}\n---${bodyContent}`;
    await fs.writeFile(this.currentSessionFile, newContent);

    logger.info('Repository linked successfully', {
      sessionFile: this.currentSessionFile,
      repository: repoName,
    });
  }

  /**
   * Read session context from file
   *
   * @param sessionId - Session ID or file path
   * @returns Session context
   */
  async getSessionContext(sessionId?: string): Promise<SessionContext> {
    let sessionFile: string;

    if (!sessionId && this.currentSessionFile) {
      // Use current session
      sessionFile = this.currentSessionFile;
    } else if (sessionId) {
      // Find session file
      sessionFile = await this.findSessionFile(sessionId);
    } else {
      throw new VaultError('No session ID provided and no active session', {
        operation: 'getSessionContext',
      });
    }

    logger.debug('Reading session context', { sessionFile });

    // Read file
    const content = await fs.readFile(sessionFile, 'utf-8');

    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new VaultError('Invalid session file format: no frontmatter found', {
        sessionFile,
      });
    }

    const frontmatterText = frontmatterMatch[1];
    const bodyContent = content.substring(frontmatterMatch[0].length).trim();

    // Parse frontmatter (simple YAML parsing)
    const metadata = this.parseFrontmatter(frontmatterText);

    return {
      metadata,
      content: bodyContent,
      filePath: sessionFile,
    };
  }

  /**
   * Find session file by ID
   *
   * @param sessionId - Session identifier
   * @returns Absolute path to session file
   */
  private async findSessionFile(sessionId: string): Promise<string> {
    // If sessionId looks like a path, use it directly
    if (sessionId.includes('/') || sessionId.endsWith('.md')) {
      return sessionId;
    }

    // Extract date from session ID (YYYY-MM-DD)
    const dateMatch = sessionId.match(/^(\d{4}-\d{2})/);
    if (!dateMatch) {
      throw new VaultError(`Invalid session ID format: ${sessionId}`, {
        sessionId,
      });
    }

    const monthStr = dateMatch[1]; // YYYY-MM
    const monthDir = path.join(this.vaultPath, 'sessions', monthStr);
    const sessionFile = path.join(monthDir, `${sessionId}.md`);

    // Verify file exists
    try {
      await fs.access(sessionFile);
    } catch {
      throw new VaultError(`Session file not found: ${sessionId}`, {
        sessionId,
        expectedPath: sessionFile,
      });
    }

    return sessionFile;
  }

  /**
   * Parse YAML frontmatter into SessionMetadata
   *
   * Simple parser for session frontmatter
   *
   * @param frontmatterText - YAML frontmatter text
   * @returns Session metadata
   */
  private parseFrontmatter(frontmatterText: string): SessionMetadata {
    const metadata: Record<string, string | string[]> = {};

    const lines = frontmatterText.split('\n');

    for (const line of lines) {
      // Simple key: value parsing
      const match = line.match(/^([a-z_]+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;

        if (value === '[]') {
          metadata[key] = [];
        } else if (value.startsWith('"') && value.endsWith('"')) {
          metadata[key] = value.slice(1, -1);
        } else if (value) {
          metadata[key] = value;
        }
      }
    }

    return metadata as unknown as SessionMetadata;
  }

  /**
   * Clear session state (for next session)
   */
  clearState(): void {
    this.sessionTracker.clear();
    // Keep currentSessionId and currentSessionFile for potential follow-up operations
    logger.debug('Session state cleared');
  }

  /**
   * Slugify a string for use in filenames
   *
   * @param text - Text to slugify
   * @returns Slugified text
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
}
