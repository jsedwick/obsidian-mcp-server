/**
 * Unit tests for closeSession tool - Two-Phase Workflow (Decision 022)
 *
 * Tests cover:
 * - findSessionCommits: Detect commits made during session
 * - runPhase1Analysis: Analyze commits and provide suggestions
 * - runPhase2Finalization: Save session after user updates
 * - closeSession: Main orchestration function (two-phase only, Decision 044)
 * - closeSession: Main orchestration function
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  closeSession,
  findSessionCommits,
  runPhase1Analysis,
  runPhase2Finalization,
  type CloseSessionArgs,
  type SessionData,
} from '../../../../src/tools/session/closeSession.js';
import {
  createSessionToolsContext,
  createTestVault,
  cleanupTestVault,
  type SessionToolsContext,
} from '../../../helpers/index.js';
import { createTestGitRepo, createTestCommit, cleanupTestGitRepo } from '../../../helpers/git.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock logger to prevent console output during tests
vi.mock('../../../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

/**
 * Well-formed sessionContent fixture. Must include ## Summary, ## Handoff, and
 * ## Files Accessed sections (with non-empty Summary/Handoff bodies) to satisfy
 * closeSession's structural validation and post-write integrity check.
 */
const VALID_SESSION_CONTENT = [
  '# Session: test',
  '',
  '## Summary',
  '',
  'Test summary body.',
  '',
  '## Handoff',
  '',
  'Test handoff body.',
  '',
  '## Files Accessed',
  '',
  '_No files tracked_',
  '',
].join('\n');

describe('closeSession - Two-Phase Workflow', () => {
  let vaultPath: string;
  let context: SessionToolsContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('close-session-test');
    context = createSessionToolsContext({
      vaultPath,
      currentSessionId: 'test-session-2025-01-15',
    });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  describe('findSessionCommits', () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = await createTestGitRepo({
        name: 'test-repo',
        initialCommit: 'Initial setup',
      });
    });

    afterEach(async () => {
      await cleanupTestGitRepo(testRepoPath);
    });

    it('should find commits made since session start time', async () => {
      const sessionStart = new Date('2025-01-15T10:00:00Z');

      // Make a commit after session start
      await createTestCommit(testRepoPath, {
        message: 'Session commit 1',
        files: { 'file1.ts': 'content 1' },
      });

      const commits = await findSessionCommits(testRepoPath, sessionStart);

      expect(commits.length).toBeGreaterThan(0);
      expect(commits[0]).toMatch(/^[0-9a-f]{40}$/); // Full commit hash
    });

    it('should return empty array when session start time is null', async () => {
      const commits = await findSessionCommits(testRepoPath, null);
      expect(commits).toEqual([]);
    });

    it('should return empty array when no commits made since session start', async () => {
      // Set session start to future date
      const sessionStart = new Date('2099-01-01T00:00:00Z');
      const commits = await findSessionCommits(testRepoPath, sessionStart);
      expect(commits).toEqual([]);
    });

    it('should exclude merge commits', async () => {
      const sessionStart = new Date('2025-01-15T10:00:00Z');

      // Make regular commits
      await createTestCommit(testRepoPath, {
        message: 'Regular commit',
        files: { 'file2.ts': 'content 2' },
      });

      const commits = await findSessionCommits(testRepoPath, sessionStart);

      // All returned commits should be regular commits (not merge commits)
      // Merge commits have multiple parents and are excluded by --no-merges flag
      expect(commits.length).toBeGreaterThan(0);
    });

    it('should throw GitError when git command fails', async () => {
      await expect(findSessionCommits('/nonexistent/path', new Date())).rejects.toThrow();
    });
  });

  describe('runPhase1Analysis', () => {
    it('should analyze commits and call analyzeCommitImpact for each', async () => {
      // Use a real git repo so findSessionCommits works (it's a module-level function)
      const testRepoPath = await createTestGitRepo({
        name: 'phase1-analysis-repo',
        initialCommit: 'Initial setup',
      });

      try {
        // Wait to ensure initial commit timestamp is strictly before session start
        await new Promise(resolve => setTimeout(resolve, 1100));

        const sessionStart = new Date();
        context.getSessionStartTime = vi.fn().mockReturnValue(sessionStart);

        // Wait to ensure test commits are after session start
        await new Promise(resolve => setTimeout(resolve, 1100));

        // Make a commit after session start
        await createTestCommit(testRepoPath, {
          message: 'Add feature X',
          files: { 'feature.ts': 'export function featureX() {}' },
        });

        context.analyzeCommitImpact = vi.fn().mockResolvedValue({
          content: [
            {
              text: '**Commit Analysis**\n\nChanged files:\n- feature.ts',
            },
          ],
        });

        const args: CloseSessionArgs = {
          summary: 'Implemented feature X',
          _invoked_by_slash_command: true,
        };

        const sessionId = '2025-01-15_14-30-00';
        const monthDir = path.join(vaultPath, 'sessions/2025-01');
        await fs.mkdir(monthDir, { recursive: true });
        const sessionFile = path.join(monthDir, '2025-01-15_14-30-00.md');
        const sessionContent = '# Session content';
        const dateStr = '2025-01-15';
        const detectedRepoInfo = {
          path: testRepoPath,
          name: 'phase1-analysis-repo',
          branch: 'main',
        };

        const result = await runPhase1Analysis(
          args,
          context,
          sessionId,
          sessionFile,
          sessionContent,
          dateStr,
          monthDir,
          detectedRepoInfo,
          ''
        );

        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).toContain('Session Analysis Complete');
        expect(result.content[0].text).toMatch(/1 commits? (was|were) made during this session/);
        expect(result.content[0].text).toContain('finalize: true');
        expect(context.analyzeCommitImpact).toHaveBeenCalledTimes(1);
        expect(context.analyzeCommitImpact).toHaveBeenCalledWith(
          expect.objectContaining({
            repo_path: testRepoPath,
            include_diff: false,
          })
        );
      } finally {
        await cleanupTestGitRepo(testRepoPath);
      }
    });

    it('should detect and analyze multiple commits', async () => {
      const testRepoPath = await createTestGitRepo({
        name: 'multi-commit-repo',
        initialCommit: 'Initial setup',
      });

      try {
        // Wait to ensure initial commit timestamp is strictly before session start
        await new Promise(resolve => setTimeout(resolve, 1100));

        const sessionStart = new Date();
        context.getSessionStartTime = vi.fn().mockReturnValue(sessionStart);

        // Wait to ensure test commits are after session start
        await new Promise(resolve => setTimeout(resolve, 1100));

        // Make 3 commits after session start
        await createTestCommit(testRepoPath, {
          message: 'Commit 1',
          files: { 'file1.ts': 'content 1' },
        });
        await createTestCommit(testRepoPath, {
          message: 'Commit 2',
          files: { 'file2.ts': 'content 2' },
        });
        await createTestCommit(testRepoPath, {
          message: 'Commit 3',
          files: { 'file3.ts': 'content 3' },
        });

        context.analyzeCommitImpact = vi.fn().mockResolvedValue({
          content: [{ text: 'Analysis result' }],
        });

        const args: CloseSessionArgs = {
          summary: 'Multiple changes',
          _invoked_by_slash_command: true,
        };

        const sessionId = '2025-01-15_14-30-00';
        const monthDir = path.join(vaultPath, 'sessions/2025-01');
        await fs.mkdir(monthDir, { recursive: true });
        const sessionFile = path.join(monthDir, '2025-01-15_14-30-00.md');
        const sessionContent = '# Session content';
        const dateStr = '2025-01-15';
        const detectedRepoInfo = {
          path: testRepoPath,
          name: 'multi-commit-repo',
        };

        const result = await runPhase1Analysis(
          args,
          context,
          sessionId,
          sessionFile,
          sessionContent,
          dateStr,
          monthDir,
          detectedRepoInfo,
          ''
        );

        expect(result.content[0].text).toContain('3 commits');
        expect(context.analyzeCommitImpact).toHaveBeenCalledTimes(3);
      } finally {
        await cleanupTestGitRepo(testRepoPath);
      }
    });

    it('should use two-phase workflow even without session start time (Decision 044 fix)', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test session',
        _invoked_by_slash_command: true,
      };

      const sessionId = '2025-01-15_14-30-00';
      const monthDir = path.join(vaultPath, 'sessions/2025-01');
      await fs.mkdir(monthDir, { recursive: true });
      const sessionFile = path.join(monthDir, '2025-01-15_14-30-00.md');
      const sessionContent = '# Session content';
      const dateStr = '2025-01-15';
      const detectedRepoInfo = { path: '/test/repo', name: 'test-repo' };

      context.getSessionStartTime = vi.fn().mockReturnValue(null);

      const result = await runPhase1Analysis(
        args,
        context,
        sessionId,
        sessionFile,
        sessionContent,
        dateStr,
        monthDir,
        detectedRepoInfo,
        ''
      );

      // Decision 044 fix: Even without session start time, should use two-phase workflow
      // to ensure semantic topic enforcement (Decision 042) cannot be bypassed
      expect(result.content[0].text).toContain('Session Analysis Complete');
      expect(result.content[0].text).toContain(
        'Session start time unknown - commit analysis skipped'
      );
      // Should NOT finalize - this is Phase 1, waiting for Phase 2
      expect(result.content[0].text).not.toContain('Session created:');
    });

    it('should use two-phase workflow even with no commits (Decision 044)', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test session',
        _invoked_by_slash_command: true,
      };

      const sessionId = '2025-01-15_14-30-00';
      const monthDir = path.join(vaultPath, 'sessions/2025-01');
      await fs.mkdir(monthDir, { recursive: true });
      const sessionFile = path.join(monthDir, '2025-01-15_14-30-00.md');
      const sessionContent = '# Session content';
      const dateStr = '2025-01-15';
      const detectedRepoInfo = { path: '/test/repo', name: 'test-repo' };

      context.getSessionStartTime = vi.fn().mockReturnValue(new Date('2025-01-15T10:00:00Z'));

      const result = await runPhase1Analysis(
        args,
        {
          ...context,
          async findSessionCommits() {
            return [];
          },
        } as any,
        sessionId,
        sessionFile,
        sessionContent,
        dateStr,
        monthDir,
        detectedRepoInfo,
        ''
      );

      // Decision 044: Even with 0 commits, should use two-phase workflow
      // to ensure semantic topic enforcement (Decision 042) cannot be bypassed
      expect(result.content[0].text).toContain('Session Analysis Complete');
      expect(result.content[0].text).toContain('No commits were made during this session.');
      // Should NOT finalize - this is Phase 1, waiting for Phase 2
      expect(result.content[0].text).not.toContain('Session created:');
    });

    it('should handle commit detection errors gracefully', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test session',
        _invoked_by_slash_command: true,
      };

      const sessionId = '2025-01-15_14-30-00';
      const monthDir = path.join(vaultPath, 'sessions/2025-01');
      await fs.mkdir(monthDir, { recursive: true });
      const sessionFile = path.join(monthDir, '2025-01-15_14-30-00.md');
      const sessionContent = '# Session content';
      const dateStr = '2025-01-15';
      const detectedRepoInfo = { path: '/test/repo', name: 'test-repo' };

      context.getSessionStartTime = vi.fn().mockReturnValue(new Date('2025-01-15T10:00:00Z'));

      const result = await runPhase1Analysis(
        args,
        {
          ...context,
          async findSessionCommits() {
            throw new Error('Git error: repository not found');
          },
        } as any,
        sessionId,
        sessionFile,
        sessionContent,
        dateStr,
        monthDir,
        detectedRepoInfo,
        ''
      );

      // Decision 044: Should show error but continue with two-phase workflow
      // (no longer falls back to single-phase)
      expect(result.content[0].text).toContain('Failed to detect session commits');
      expect(result.content[0].text).toContain('Session Analysis Complete');
      // Should NOT finalize - this is Phase 1, waiting for Phase 2
      expect(result.content[0].text).not.toContain('Session created:');
    });
  });

  describe('runPhase2Finalization', () => {
    it('should save session file and run vault custodian', async () => {
      const sessionData: SessionData = {
        phase: 1, // Phase 1 output
        sessionId: '2025-01-15_14-30-00',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md'),
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: {
          path: '/test/repo',
          name: 'test-repo',
          branch: 'main',
        },
        topicsCreated: [{ slug: 'test-topic', title: 'Test Topic', file: 'topics/test-topic.md' }],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md')],
        repoDetectionMessage: '\nGit Repository Auto-Linked:\n  Name: test-repo',
      };

      const args: CloseSessionArgs = {
        summary: 'Test summary',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      const result = await runPhase2Finalization(args, context, sessionData);

      // Verify session file was written
      const fileExists = await fs
        .access(sessionData.sessionFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(sessionData.sessionFile, 'utf-8');
      expect(fileContent).toContain('## Summary');
      expect(fileContent).toContain('Test summary body.');

      // Verify result
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Session finalized:');
      expect(result.content[0].text).toContain('2025-01-15_14-30-00');
      expect(result.content[0].text).toContain('Topics linked: 1');
      expect(result.content[0].text).toContain('Test Topic');
      expect(result.content[0].text).toContain('Git Repository Auto-Linked');

      // Verify context methods were called
      expect(context.setCurrentSession).toHaveBeenCalledWith(
        '2025-01-15_14-30-00',
        sessionData.sessionFile
      );
      expect(context.vaultCustodian).toHaveBeenCalledWith({
        files_to_check: sessionData.filesToCheck,
      });
      // Note: clearSessionState is called in closeSession() after runPhase2Finalization() returns,
      // not inside runPhase2Finalization() itself
    });

    it('should handle vault custodian failures gracefully', async () => {
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const sessionData: SessionData = {
        sessionId: '2025-01-15_14-30-00',
        sessionFile,
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [sessionFile], // Must have files to check for custodian to be called
        repoDetectionMessage: '',
      };

      const args: CloseSessionArgs = {
        summary: 'Test',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      context.vaultCustodian = vi.fn().mockRejectedValue(new Error('Custodian failed'));

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      const result = await runPhase2Finalization(args, context, sessionData);

      expect(result.content[0].text).toContain('Vault custodian check failed');
      expect(result.content[0].text).toContain('Custodian failed');
    });

    it('should include all created content in summary', async () => {
      const sessionData: SessionData = {
        sessionId: '2025-01-15_14-30-00',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md'),
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [
          { slug: 'topic-1', title: 'Topic 1', file: 'topics/topic-1.md' },
          { slug: 'topic-2', title: 'Topic 2', file: 'topics/topic-2.md' },
        ],
        decisionsCreated: [{ slug: '001', title: 'Decision 1', file: 'decisions/vault/001.md' }],
        projectsCreated: [{ slug: 'project-1', name: 'Project 1', file: 'projects/project-1.md' }],
        filesAccessed: [
          { path: '/file1.ts', action: 'edit', timestamp: new Date().toISOString() },
          { path: '/file2.ts', action: 'create', timestamp: new Date().toISOString() },
        ],
        filesToCheck: [],
        repoDetectionMessage: '',
      };

      const args: CloseSessionArgs = {
        summary: 'Test',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      const result = await runPhase2Finalization(args, context, sessionData);

      expect(result.content[0].text).toContain('Topics linked: 2');
      expect(result.content[0].text).toContain('Topic 1');
      expect(result.content[0].text).toContain('Topic 2');
      expect(result.content[0].text).toContain('Decisions linked: 1');
      expect(result.content[0].text).toContain('Decision 1');
      expect(result.content[0].text).toContain('Projects linked: 1');
      expect(result.content[0].text).toContain('Project 1');
      expect(result.content[0].text).toContain('Files accessed: 2');
    });

    it('should recognize file accesses accumulated after Phase 1 for enforcement (Decision 041 fix)', async () => {
      const topicPath = path.join(vaultPath, 'topics/test-topic.md');

      // Create the topic file (simulating existing topic)
      await fs.mkdir(path.join(vaultPath, 'topics'), { recursive: true });
      await fs.writeFile(topicPath, '---\ntitle: Test Topic\n---\n# Test Topic\nContent');

      // Session data with commit-related topic that MUST be reviewed
      const sessionData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_14-30-00',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md'),
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [], // Empty at Phase 1 time
        filesToCheck: [],
        repoDetectionMessage: '',
        // Commit-related topic requiring enforcement (Decision 041)
        commitRelatedTopics: [
          {
            path: topicPath,
            title: 'Test Topic',
            relevance: 'Matched search term',
            commitHash: 'abc123',
          },
        ],
      };

      // Store Phase 1 data (simulating storePhase1SessionData being called)
      context.storePhase1SessionData!(sessionData);

      // Simulate file access AFTER Phase 1 (e.g., via get_topic_context)
      // This is what happens when Claude reads topics between Phase 1 and Phase 2
      context.accumulateFilesAccessedAfterPhase1!(topicPath, 'read');

      const args: CloseSessionArgs = {
        summary: 'Test summary',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      // Phase 2 should succeed because topic was "read" via accumulated filesAccessed
      const result = await runPhase2Finalization(args, context, sessionData);

      // Verify Phase 2 completed successfully (no enforcement error)
      expect(result.content[0].text).toContain('Session finalized:');
      expect(result.content[0].text).toContain('2025-01-15_14-30-00');
    });

    it('should still block when commit-related topics are not reviewed (enforcement working)', async () => {
      const topicPath = path.join(vaultPath, 'topics/unread-topic.md');

      // Session data with commit-related topic that MUST be reviewed
      const sessionData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_14-30-00',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md'),
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [], // Empty - topic never read
        filesToCheck: [],
        repoDetectionMessage: '',
        // Commit-related topic requiring enforcement (Decision 041)
        commitRelatedTopics: [
          {
            path: topicPath,
            title: 'Unread Topic',
            relevance: 'Matched search term',
            commitHash: 'abc123',
          },
        ],
      };

      // Store Phase 1 data
      context.storePhase1SessionData!(sessionData);

      // DO NOT accumulate file access - simulating topic was NOT read

      const args: CloseSessionArgs = {
        summary: 'Test summary',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      // Phase 2 should FAIL because topic was not read
      await expect(runPhase2Finalization(args, context, sessionData)).rejects.toThrow(
        'Commit-Related Topics Not Reviewed'
      );
    });

    it('should accept a handoff containing nested ## subheaders without triggering integrity failure', async () => {
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const sessionData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_14-30-00',
        sessionFile,
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [],
        repoDetectionMessage: '',
      };

      const handoffWithNestedH2 = [
        '## Validation Outstanding',
        '',
        'Requires restart to verify.',
        '',
        '## Known Issues',
        '',
        'None at this time.',
      ].join('\n');

      const args: CloseSessionArgs = {
        summary: 'Test summary',
        handoff: handoffWithNestedH2,
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      const result = await runPhase2Finalization(args, context, sessionData);

      expect(result.content[0].text).toContain('Session finalized:');

      const writtenContent = await fs.readFile(sessionFile, 'utf-8');
      expect(writtenContent).toContain('## Validation Outstanding');
      expect(writtenContent).toContain('Requires restart to verify.');
      expect(writtenContent).toContain('## Known Issues');
    });

    it('refreshes Files Accessed / Topics Created / Decisions Made with post-Phase-1 work', async () => {
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const phase1Snapshot = [
        '# Session: test',
        '',
        '## Summary',
        '',
        'Test summary body.',
        '',
        '## Handoff',
        '',
        '_No handoff notes_',
        '',
        '## Files Accessed',
        '',
        '- [`edit`] /tmp/test-vault/user-reference.md',
        '',
        '## Topics Created',
        '',
        '_No topics created_',
        '',
        '## Decisions Made',
        '',
        '_No decisions made_',
        '',
        '## Related Topics',
        '',
        '_None found_',
        '',
        '## Related Decisions',
        '',
        '_None found_',
        '',
        '## Related Projects',
        '',
        '_None found_',
        '',
      ].join('\n');

      const sessionData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_14-30-00',
        sessionFile,
        sessionContent: phase1Snapshot,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [
          {
            path: '/tmp/test-vault/user-reference.md',
            action: 'edit',
            timestamp: '2025-01-15T14:30:00Z',
          },
        ],
        filesToCheck: [sessionFile],
        repoDetectionMessage: '',
      };

      // Simulate post-Phase-1 work: AI created a decision, updated a topic, and edited code
      // between Phase 1 and Phase 2 in response to enforcement prompts.
      context.filesAccessed.push(
        {
          path: '/tmp/test-vault/decisions/vault/022-something.md',
          action: 'create',
          timestamp: '2025-01-15T14:32:00Z',
        },
        {
          path: '/tmp/test-vault/topics/some-topic.md',
          action: 'edit',
          timestamp: '2025-01-15T14:33:00Z',
        },
        {
          path: '/Users/test/project/src/runner.ts',
          action: 'edit',
          timestamp: '2025-01-15T14:34:00Z',
        }
      );
      context.decisionsCreated.push({
        slug: '022-something',
        title: 'Something',
        file: '/tmp/test-vault/decisions/vault/022-something.md',
      } as any);

      const args: CloseSessionArgs = {
        summary: 'Test summary',
        handoff: 'Test handoff',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      await runPhase2Finalization(args, context, sessionData);

      const writtenContent = await fs.readFile(sessionFile, 'utf-8');

      // Files Accessed must include both the Phase-1-time edit and the post-Phase-1 work
      expect(writtenContent).toContain('[`edit`] /tmp/test-vault/user-reference.md');
      expect(writtenContent).toContain(
        '[`create`] /tmp/test-vault/decisions/vault/022-something.md'
      );
      expect(writtenContent).toContain('[`edit`] /tmp/test-vault/topics/some-topic.md');
      expect(writtenContent).toContain('[`edit`] /Users/test/project/src/runner.ts');

      // Decisions Made must reflect the post-Phase-1 create_decision call
      expect(writtenContent).toContain('[[decisions/022-something|Something]]');
      expect(writtenContent).not.toMatch(/## Decisions Made\n+_No decisions made_/);

      // Topics Created stays empty (the topic was UPDATED, not created)
      expect(writtenContent).toMatch(/## Topics Created\n+_No topics created_/);
    });

    it('records commits for every qualifying repo (Decision 061 step 4)', async () => {
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      // qualifyingRepos has both repos; commitsByRepo holds hashes per repo.
      // Phase 2's recording loop should call recordCommit once per (repo, hash).
      const sessionData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_14-30-00',
        sessionFile,
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: {
          path: '/test/repo-primary',
          name: 'repo-primary',
          branch: 'main',
        },
        qualifyingRepos: [
          {
            path: '/test/repo-primary',
            name: 'repo-primary',
            branch: 'main',
            source: 'working_directories',
            score: 15,
          },
          {
            path: '/test/repo-secondary',
            name: 'repo-secondary',
            branch: 'main',
            source: 'inferred',
            score: 10,
          },
        ],
        commitsByRepo: {
          '/test/repo-primary': ['hashA', 'hashB'],
          '/test/repo-secondary': ['hashC'],
        },
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [sessionFile],
        repoDetectionMessage: '',
        sessionCommits: ['hashA', 'hashB'], // legacy field, primary repo only
      };

      const args: CloseSessionArgs = {
        summary: 'Test summary',
        handoff: 'Test handoff',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      await runPhase2Finalization(args, context, sessionData);

      // recordCommit fires once per (repo, hash) pair: 2 + 1 = 3 calls.
      expect(context.recordCommit).toHaveBeenCalledTimes(3);
      expect(context.recordCommit).toHaveBeenCalledWith({
        repo_path: '/test/repo-primary',
        commit_hash: 'hashA',
      });
      expect(context.recordCommit).toHaveBeenCalledWith({
        repo_path: '/test/repo-primary',
        commit_hash: 'hashB',
      });
      expect(context.recordCommit).toHaveBeenCalledWith({
        repo_path: '/test/repo-secondary',
        commit_hash: 'hashC',
      });
    });

    it('falls back to single-repo path when qualifyingRepos is absent (pre-061 SessionData)', async () => {
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const sessionData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_14-30-00',
        sessionFile,
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: {
          path: '/test/repo-only',
          name: 'repo-only',
          branch: 'main',
        },
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [sessionFile],
        repoDetectionMessage: '',
        sessionCommits: ['hashOnly'],
        // qualifyingRepos + commitsByRepo intentionally omitted
      };

      const args: CloseSessionArgs = {
        summary: 'Test summary',
        handoff: 'Test handoff',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      await fs.mkdir(sessionData.monthDir, { recursive: true });

      await runPhase2Finalization(args, context, sessionData);

      expect(context.recordCommit).toHaveBeenCalledTimes(1);
      expect(context.recordCommit).toHaveBeenCalledWith({
        repo_path: '/test/repo-only',
        commit_hash: 'hashOnly',
      });
    });
  });

  // Decision 044: runSinglePhaseClose tests removed - two-phase workflow is always required

  describe('closeSession - main orchestration', () => {
    it('should reject calls not from /close slash command', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test',
        _invoked_by_slash_command: false,
      };

      await expect(closeSession(args, context)).rejects.toThrow(
        'can ONLY be called via the /close slash command'
      );
    });

    it('should reject Phase 2 calls without session_data', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test',
        finalize: true,
        _invoked_by_slash_command: true,
        // Missing session_data
      };

      await expect(closeSession(args, context)).rejects.toThrow(
        'session_data is missing or incomplete'
      );
    });

    it('should reject Phase 2 when sessionContent lacks required section headers (stub fabrication)', async () => {
      const stubSessionData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_14-30-00',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md'),
        // Fabricated stub: frontmatter-only, no ## Summary / ## Handoff / ## Files Accessed
        sessionContent: '---\ncategory: session\n---\n\n# Session: stub\n',
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [],
        repoDetectionMessage: '',
      };

      const args: CloseSessionArgs = {
        summary: 'Test',
        finalize: true,
        _invoked_by_slash_command: true,
        session_data: stubSessionData,
      };

      await expect(closeSession(args, context)).rejects.toThrow('sessionContent is malformed');
    });

    it('should prefer memory-stored Phase 1 data over caller-supplied session_data', async () => {
      const authenticData: SessionData = {
        phase: 1,
        sessionId: '2025-01-15_authentic',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_authentic.md'),
        sessionContent: VALID_SESSION_CONTENT,
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [],
        repoDetectionMessage: '',
      };
      context.storePhase1SessionData!(authenticData);

      const stubCallerData: SessionData = {
        ...authenticData,
        sessionId: '2025-01-15_stub',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_stub.md'),
        sessionContent: '---\n---\n', // stub that would normally fail structural check
      };

      const args: CloseSessionArgs = {
        summary: 'Test',
        finalize: true,
        _invoked_by_slash_command: true,
        session_data: stubCallerData,
      };

      await fs.mkdir(authenticData.monthDir, { recursive: true });

      // Should succeed because authentic data from memory overrides the caller stub.
      // The stub would have failed the structural check; success = memory was preferred.
      await closeSession(args, context);

      // Authentic session file should exist, stub file should not
      const authenticExists = await fs
        .access(authenticData.sessionFile)
        .then(() => true)
        .catch(() => false);
      const stubExists = await fs
        .access(stubCallerData.sessionFile)
        .then(() => true)
        .catch(() => false);
      expect(authenticExists).toBe(true);
      expect(stubExists).toBe(false);
    });

    it('should create monthly session directory structure', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test session',
        _invoked_by_slash_command: true,
      };

      context.findGitRepos = vi.fn().mockResolvedValue([]);

      const result = await closeSession(args, context);

      // Decision 044: Always runs Phase 1 (two-phase workflow required)
      expect(result.content[0].text).toContain('Session Analysis Complete');

      // Should create YYYY-MM directory structure
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const monthDir = path.join(vaultPath, 'sessions', `${year}-${month}`);

      const dirExists = await fs
        .access(monthDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should generate session ID with topic slug', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test summary',
        topic: 'Feature X Implementation',
        _invoked_by_slash_command: true,
      };

      context.findGitRepos = vi.fn().mockResolvedValue([]);

      const result = await closeSession(args, context);

      // Decision 044: Always runs Phase 1 (two-phase workflow required)
      expect(result.content[0].text).toContain('Session Analysis Complete');
      expect(result.content[0].text).toContain('feature-x-implementation');
    });

    it('should auto-detect Git repository from CWD', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test',
        _invoked_by_slash_command: true,
      };

      const mockRepoPath = '/test/repo/path';
      context.findGitRepos = vi.fn().mockResolvedValue([mockRepoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'test-repo',
        branch: 'main',
        remote: 'https://github.com/user/test-repo.git',
      });
      context.createProjectPage = vi.fn().mockResolvedValue({ content: [] });

      const result = await closeSession(args, context);

      // Decision 044: Always runs Phase 1 (two-phase workflow required)
      expect(result.content[0].text).toContain('Session Analysis Complete');
      expect(context.createProjectPage).toHaveBeenCalledWith({ repo_path: mockRepoPath });
    });
  });

  describe('Repository Detection - Tiebreakers (tied working_directories)', () => {
    let repoA: string;
    let repoB: string;

    beforeEach(async () => {
      repoA = await createTestGitRepo({ name: 'tied-repo-a', initialCommit: 'init-a' });
      repoB = await createTestGitRepo({ name: 'tied-repo-b', initialCommit: 'init-b' });
    });

    afterEach(async () => {
      await cleanupTestGitRepo(repoA);
      await cleanupTestGitRepo(repoB);
    });

    it('breaks a working-directory tie by picking the repo with session-window commits', async () => {
      // Session start AFTER the initial commits so neither initial commit is in-window
      const sessionStart = new Date();
      context.getSessionStartTime = vi.fn().mockReturnValue(sessionStart);

      // Wait so the session-window commit gets a strictly later timestamp than sessionStart
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Only repoB gets a commit during the session window
      await createTestCommit(repoB, {
        message: 'session-window commit',
        files: { 'feature.ts': 'export {};' },
      });

      context.findGitRepos = vi.fn().mockImplementation(async (dir: string) => {
        if (dir === repoA) return [repoA];
        if (dir === repoB) return [repoB];
        return [];
      });
      context.getRepoInfo = vi.fn().mockImplementation(async (p: string) => ({
        name: path.basename(p),
        branch: 'main',
        remote: null,
      }));
      context.createProjectPage = vi.fn().mockResolvedValue({ content: [] });

      const args: CloseSessionArgs = {
        summary: 'Test tied detection',
        working_directories: [repoA, repoB], // both score 15 → tied
        _invoked_by_slash_command: true,
      };

      await closeSession(args, context);

      // repoB has the in-window commit → tiebreaker picks it
      expect(context.createProjectPage).toHaveBeenCalledWith({ repo_path: repoB });
      expect(context.createProjectPage).not.toHaveBeenCalledWith({ repo_path: repoA });
    });

    it('falls back to primary working directory when commit tiebreaker is inconclusive', async () => {
      // No sessionStartTime → findSessionCommits returns [] for everyone → CWD tiebreaker fires
      context.getSessionStartTime = vi.fn().mockReturnValue(null);

      context.findGitRepos = vi.fn().mockImplementation(async (dir: string) => {
        if (dir === repoA) return [repoA];
        if (dir === repoB) return [repoB];
        return [];
      });
      context.getRepoInfo = vi.fn().mockImplementation(async (p: string) => ({
        name: path.basename(p),
        branch: 'main',
        remote: null,
      }));
      context.createProjectPage = vi.fn().mockResolvedValue({ content: [] });

      const args: CloseSessionArgs = {
        summary: 'Test CWD fallback',
        working_directories: [repoA, repoB], // repoA is primary CWD
        _invoked_by_slash_command: true,
      };

      await closeSession(args, context);

      expect(context.createProjectPage).toHaveBeenCalledWith({ repo_path: repoA });
      expect(context.createProjectPage).not.toHaveBeenCalledWith({ repo_path: repoB });
    });

    it('does not bypass tiebreaker when one repo is a workdir and another is a workdir-subdir', async () => {
      // Reproduces the close-session bug where Claude Code's env passes both ~/.claude
      // (itself a repo) and ~/Projects (parent of the real session repos). With asymmetric
      // scoring (15 / 5), the .claude-style repo crushed the >2x clear-winner gate and
      // skipped the tiebreaker. With flat 15-point scoring, both tie and the session-window
      // commit count wins.
      const sessionStart = new Date();
      context.getSessionStartTime = vi.fn().mockReturnValue(sessionStart);
      await new Promise(resolve => setTimeout(resolve, 1100));

      // repoB is the "session repo" — it gets the only in-window commit.
      // repoA plays the role of ~/.claude — directly named in working_directories
      // but with no session activity.
      await createTestCommit(repoB, {
        message: 'session-window commit in subdir repo',
        files: { 'feature.ts': 'export {};' },
      });

      // parentDir simulates "~/Projects" — a workdir whose subdirectory IS the active repo.
      const parentDir = path.dirname(repoB);

      context.findGitRepos = vi.fn().mockImplementation(async (dir: string) => {
        if (dir === repoA) return [repoA];
        if (dir === parentDir) return [repoB];
        return [];
      });
      context.getRepoInfo = vi.fn().mockImplementation(async (p: string) => ({
        name: path.basename(p),
        branch: 'main',
        remote: null,
      }));
      context.createProjectPage = vi.fn().mockResolvedValue({ content: [] });

      const args: CloseSessionArgs = {
        summary: 'Test asymmetric-workdir tiebreaker',
        // repoA is itself a workdir (exact match → +15 pre-fix). parentDir contains repoB
        // as a subdir (was +5 pre-fix → got crushed by clear-winner gate).
        working_directories: [repoA, parentDir],
        _invoked_by_slash_command: true,
      };

      await closeSession(args, context);

      // With flat scoring: both tie at 15, primary tiebreaker (commit count) picks repoB.
      expect(context.createProjectPage).toHaveBeenCalledWith({ repo_path: repoB });
      expect(context.createProjectPage).not.toHaveBeenCalledWith({ repo_path: repoA });
    });
  });

  describe('Two-Phase Workflow Integration', () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = await createTestGitRepo({
        name: 'integration-test-repo',
        initialCommit: 'Initial commit',
      });

      // Setup context with real repo detection
      context.findGitRepos = vi.fn().mockResolvedValue([testRepoPath]);
      context.getRepoInfo = vi.fn().mockResolvedValue({
        name: 'integration-test-repo',
        branch: 'main',
        remote: null,
      });
      context.createProjectPage = vi.fn().mockResolvedValue({ content: [] });
      context.analyzeCommitImpact = vi.fn().mockResolvedValue({
        content: [{ text: 'Mock analysis' }],
      });
    });

    afterEach(async () => {
      await cleanupTestGitRepo(testRepoPath);
    });

    it('should complete full two-phase workflow', async () => {
      // Set session start time to NOW (after the initial commit was made)
      const sessionStart = new Date();
      context.getSessionStartTime = vi.fn().mockReturnValue(sessionStart);

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      // Make a commit during session (after session start)
      await createTestCommit(testRepoPath, {
        message: 'Implement feature',
        files: { 'feature.ts': 'export function feature() {}' },
      });

      // PHASE 1: Initial call (should detect commits and return analysis)
      const phase1Args: CloseSessionArgs = {
        summary: 'Implemented new feature',
        topic: 'feature-implementation',
        _invoked_by_slash_command: true,
      };

      const phase1Result = await closeSession(phase1Args, context);

      expect(phase1Result.content[0].text).toContain('Session Analysis Complete');
      // May detect 1-2 commits depending on timing (initial commit + test commit)
      expect(phase1Result.content[0].text).toMatch(
        /[12] commits? (was|were) made during this session/
      );
      expect(phase1Result.content[0].text).toContain('finalize: true');

      // Extract session_data from Phase 1 result. Anchor on the template's
      // closing `\n})` (the close_session call wrapper) rather than `}\n`,
      // because pretty-printed JSON containing arrays of objects has nested
      // `}\n` boundaries that break a naive lazy match.
      const sessionDataMatch = phase1Result.content[0].text.match(
        /session_data: ({[\s\S]+?})\n}\)/
      );
      expect(sessionDataMatch).toBeTruthy();
      const sessionData = JSON.parse(sessionDataMatch![1]);

      // Simulate documentation update between Phase 1 and Phase 2 (Decision 033 enforcement)
      // The enforcement check requires vault files to be edited after Phase 1 when commits are detected
      context.filesAccessed.push({
        path: path.join(vaultPath, 'topics', 'test-topic.md'),
        action: 'edit',
        timestamp: new Date().toISOString(),
      });

      // PHASE 2: Finalize with session_data
      const phase2Args: CloseSessionArgs = {
        summary: 'Implemented new feature',
        topic: 'feature-implementation',
        finalize: true,
        session_data: sessionData,
        _invoked_by_slash_command: true,
      };

      const phase2Result = await runPhase2Finalization(phase2Args, context, sessionData);

      expect(phase2Result.content[0].text).toContain('Session finalized:');
      expect(context.vaultCustodian).toHaveBeenCalled();
      // clearSessionState is now called in closeSession() after Phase 2 completes,
      // not within runPhase2Finalization()
    });

    it('should use two-phase workflow even with no commits (Decision 044)', async () => {
      // Set session start to way in the future so no commits are detected
      context.getSessionStartTime = vi.fn().mockReturnValue(new Date('2099-01-01T00:00:00Z'));

      // Don't make any commits

      const args: CloseSessionArgs = {
        summary: 'No commits made',
        _invoked_by_slash_command: true,
      };

      const result = await closeSession(args, context);

      // Decision 044: Even with 0 commits, should use two-phase workflow
      // to ensure semantic topic enforcement (Decision 042) cannot be bypassed
      expect(result.content[0].text).toContain('Session Analysis Complete');
      expect(result.content[0].text).toContain('No commits were made during this session.');
      // Should NOT finalize - this is Phase 1, waiting for Phase 2
      expect(result.content[0].text).not.toContain('Session created:');
      expect(context.clearSessionState).not.toHaveBeenCalled();
    });

    // Note: skip_analysis test removed per Decision 044
    // Two-phase workflow is now always required, skip_analysis parameter was removed
  });
});
