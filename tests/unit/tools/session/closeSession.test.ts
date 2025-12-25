/**
 * Unit tests for closeSession tool - Two-Phase Workflow (Decision 022)
 *
 * Tests cover:
 * - findSessionCommits: Detect commits made during session
 * - runPhase1Analysis: Analyze commits and provide suggestions
 * - runPhase2Finalization: Save session after user updates
 * - runSinglePhaseClose: Legacy fallback when no commits detected
 * - closeSession: Main orchestration function
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  closeSession,
  findSessionCommits,
  runPhase1Analysis,
  runPhase2Finalization,
  runSinglePhaseClose,
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
    it.skip('should analyze commits and return suggestions', async () => {
      const args: CloseSessionArgs = {
        summary: 'Implemented feature X',
        topic: 'feature-x',
        _invoked_by_slash_command: true,
      };

      const sessionId = '2025-01-15_14-30-00_feature-x';
      const monthDir = path.join(vaultPath, 'sessions/2025-01');
      await fs.mkdir(monthDir, { recursive: true });
      const sessionFile = path.join(monthDir, '2025-01-15_14-30-00_feature-x.md');
      const sessionContent = '# Session content';
      const dateStr = '2025-01-15';
      const detectedRepoInfo = {
        path: '/test/repo',
        name: 'test-repo',
        branch: 'main',
        remote: 'origin',
      };
      const autoCommitMessage = '';

      // Mock commit analysis
      context.analyzeCommitImpact = vi.fn().mockResolvedValue({
        content: [
          {
            text: '**Commit abc123**\n\nChanged files:\n- src/feature.ts\n\nSuggested topic updates:\n- Update "Feature X Implementation" topic',
          },
        ],
      });

      // Mock session start time and commits
      context.getSessionStartTime = vi.fn().mockReturnValue(new Date('2025-01-15T10:00:00Z'));

      // Create a wrapped context that intercepts the call to findSessionCommits
      const wrappedContext = {
        ...context,
        getSessionStartTime: vi.fn().mockReturnValue(new Date('2025-01-15T10:00:00Z')),
      };

      // We need to actually call findSessionCommits since it's used directly in runPhase1Analysis
      // But we need to mock it to return our test commit
      // Monkey-patch the module - since we can't directly mock the imported function,
      // we'll test with actual git operations in the integration tests instead
      // For this unit test, let's mock at the context level
      const result = await runPhase1Analysis(
        args,
        wrappedContext,
        sessionId,
        sessionFile,
        sessionContent,
        dateStr,
        monthDir,
        detectedRepoInfo,
        autoCommitMessage
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Phase 1 Complete: Commit Analysis');
      expect(result.content[0].text).toContain('1 commit was made during this session');
      expect(result.content[0].text).toContain('finalize: true');
      expect(result.content[0].text).toContain('session_data:');
      expect(context.analyzeCommitImpact).toHaveBeenCalledWith({
        repo_path: '/test/repo',
        commit_hash: 'abc123def456',
        include_diff: false,
      });
    });

    it.skip('should handle multiple commits', async () => {
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
        path: '/test/repo',
        name: 'test-repo',
      };

      context.analyzeCommitImpact = vi.fn().mockResolvedValue({
        content: [{ text: 'Analysis result' }],
      });
      context.getSessionStartTime = vi.fn().mockReturnValue(new Date('2025-01-15T10:00:00Z'));

      const result = await runPhase1Analysis(
        args,
        {
          ...context,
          async findSessionCommits() {
            return ['abc123', 'def456', 'ghi789'];
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

      expect(result.content[0].text).toContain('3 commits were made during this session');
      expect(context.analyzeCommitImpact).toHaveBeenCalledTimes(3);
    });

    it('should fall back to single-phase when no session start time', async () => {
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

      // Should run single-phase close instead
      expect(result.content[0].text).toContain('Session created:');
      expect(result.content[0].text).not.toContain('Phase 1 Complete');
    });

    it('should fall back to single-phase when no commits detected', async () => {
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

      // Should run single-phase close instead
      expect(result.content[0].text).toContain('Session created:');
      expect(result.content[0].text).not.toContain('Phase 1 Complete');
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

      // Should show error but continue with single-phase
      expect(result.content[0].text).toContain('Failed to detect session commits');
      expect(result.content[0].text).toContain('Session created:');
    });
  });

  describe('runPhase2Finalization', () => {
    it('should save session file and run vault custodian', async () => {
      const sessionData: SessionData = {
        phase: 1, // Phase 1 output
        sessionId: '2025-01-15_14-30-00',
        sessionFile: path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md'),
        sessionContent: '# Test session content',
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
        autoCommitMessage: '',
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
      expect(fileContent).toBe('# Test session content');

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
      expect(context.clearSessionState).toHaveBeenCalled();
    });

    it('should handle vault custodian failures gracefully', async () => {
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const sessionData: SessionData = {
        sessionId: '2025-01-15_14-30-00',
        sessionFile,
        sessionContent: '# Test session',
        dateStr: '2025-01-15',
        monthDir: path.join(vaultPath, 'sessions/2025-01'),
        detectedRepoInfo: null,
        topicsCreated: [],
        decisionsCreated: [],
        projectsCreated: [],
        filesAccessed: [],
        filesToCheck: [sessionFile], // Must have files to check for custodian to be called
        repoDetectionMessage: '',
        autoCommitMessage: '',
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
        sessionContent: '# Test',
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
        autoCommitMessage: '',
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
  });

  describe('runSinglePhaseClose', () => {
    it('should save session and run custodian in one phase', async () => {
      const args: CloseSessionArgs = {
        summary: 'Simple session',
        _invoked_by_slash_command: true,
      };

      const sessionId = '2025-01-15_14-30-00';
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const sessionContent = '# Simple session content';
      const dateStr = '2025-01-15';
      const monthDir = path.join(vaultPath, 'sessions/2025-01');
      const detectedRepoInfo = null;
      const autoCommitMessage = '';

      await fs.mkdir(monthDir, { recursive: true });

      const result = await runSinglePhaseClose(
        args,
        context,
        sessionId,
        sessionFile,
        sessionContent,
        dateStr,
        monthDir,
        detectedRepoInfo,
        autoCommitMessage
      );

      // Verify file was written
      const fileExists = await fs
        .access(sessionFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify result
      expect(result.content[0].text).toContain('Session created:');
      expect(result.content[0].text).toContain(sessionId);
      expect(context.setCurrentSession).toHaveBeenCalled();
      expect(context.vaultCustodian).toHaveBeenCalled();
      expect(context.clearSessionState).toHaveBeenCalled();
    });

    it('should include repo detection message when repo is detected', async () => {
      const args: CloseSessionArgs = {
        summary: 'Session with repo',
        _invoked_by_slash_command: true,
      };

      const sessionId = '2025-01-15_14-30-00';
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const sessionContent = '# Content';
      const dateStr = '2025-01-15';
      const monthDir = path.join(vaultPath, 'sessions/2025-01');
      const detectedRepoInfo = {
        path: '/test/repo',
        name: 'test-repo',
        branch: 'main',
      };

      await fs.mkdir(monthDir, { recursive: true });

      const result = await runSinglePhaseClose(
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

      expect(result.content[0].text).toContain('Git Repository Auto-Linked');
      expect(result.content[0].text).toContain('test-repo');
      expect(result.content[0].text).toContain('/test/repo');
      expect(result.content[0].text).toContain('Branch: main');
    });

    it('should include auto-commit message when provided', async () => {
      const args: CloseSessionArgs = {
        summary: 'Session',
        _invoked_by_slash_command: true,
      };

      const sessionId = '2025-01-15_14-30-00';
      const sessionFile = path.join(vaultPath, 'sessions/2025-01/2025-01-15_14-30-00.md');
      const sessionContent = '# Content';
      const dateStr = '2025-01-15';
      const monthDir = path.join(vaultPath, 'sessions/2025-01');
      const autoCommitMessage = '\n✅ Automatically committed uncommitted changes.';

      await fs.mkdir(monthDir, { recursive: true });

      const result = await runSinglePhaseClose(
        args,
        context,
        sessionId,
        sessionFile,
        sessionContent,
        dateStr,
        monthDir,
        null,
        autoCommitMessage
      );

      expect(result.content[0].text).toContain('Automatically committed uncommitted changes');
    });
  });

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
        'finalize=true requires session_data from Phase 1'
      );
    });

    it('should create monthly session directory structure', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test session',
        skip_analysis: true,
        _invoked_by_slash_command: true,
      };

      context.findGitRepos = vi.fn().mockResolvedValue([]);

      await closeSession(args, context);

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
        skip_analysis: true,
        _invoked_by_slash_command: true,
      };

      context.findGitRepos = vi.fn().mockResolvedValue([]);

      const result = await closeSession(args, context);

      expect(result.content[0].text).toContain('feature-x-implementation');
    });

    it('should auto-detect Git repository from CWD', async () => {
      const args: CloseSessionArgs = {
        summary: 'Test',
        skip_analysis: true,
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

      await closeSession(args, context);

      expect(context.createProjectPage).toHaveBeenCalledWith({ repo_path: mockRepoPath });
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

      expect(phase1Result.content[0].text).toContain('Phase 1 Complete: Commit Analysis');
      // May detect 1-2 commits depending on timing (initial commit + test commit)
      expect(phase1Result.content[0].text).toMatch(
        /[12] commits? (was|were) made during this session/
      );
      // Phase 1 output should indicate automatic finalization
      expect(phase1Result.content[0].text).toContain('the session finalizes automatically');

      // Extract session_data from Phase 1 result (now in HTML comment format)
      const sessionDataMatch = phase1Result.content[0].text.match(
        /<!-- SESSION_DATA: ({[\s\S]*?}) -->/
      );
      expect(sessionDataMatch).toBeTruthy();
      const sessionData = JSON.parse(sessionDataMatch![1]);

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
      expect(context.clearSessionState).toHaveBeenCalled();
    });

    it('should fall back to single-phase when no commits detected', async () => {
      // Set session start to way in the future so no commits are detected
      context.getSessionStartTime = vi.fn().mockReturnValue(new Date('2099-01-01T00:00:00Z'));

      // Don't make any commits

      const args: CloseSessionArgs = {
        summary: 'No commits made',
        _invoked_by_slash_command: true,
      };

      const result = await closeSession(args, context);

      // Should use single-phase (no Phase 1 analysis message)
      expect(result.content[0].text).not.toContain('Phase 1 Complete');
      expect(result.content[0].text).toContain('Session created:');
      expect(context.clearSessionState).toHaveBeenCalled();
    });

    it('should handle skip_analysis flag', async () => {
      context.getSessionStartTime = vi.fn().mockReturnValue(new Date('2025-01-15T10:00:00Z'));

      await createTestCommit(testRepoPath, {
        message: 'Quick fix',
        files: { 'fix.ts': 'fixed' },
      });

      const args: CloseSessionArgs = {
        summary: 'Quick fix',
        skip_analysis: true,
        _invoked_by_slash_command: true,
      };

      const result = await closeSession(args, context);

      // Should skip Phase 1 analysis even though commits exist
      expect(result.content[0].text).not.toContain('Phase 1 Complete');
      expect(result.content[0].text).toContain('Session created:');
    });
  });
});
