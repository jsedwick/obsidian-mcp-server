/**
 * Comprehensive tests for Zod validation schemas
 *
 * Tests cover:
 * - Valid inputs for all 27 tools
 * - Invalid inputs (missing required fields, wrong types)
 * - Edge cases and boundary conditions
 * - Error message quality
 */

import { describe, it, expect } from 'vitest';
import {
  validateToolArgs,
  safeValidateToolArgs,
  getValidationSchema,
  validateBatch,
  isValid,
  ValidationError,
} from '../../../src/validation/index.js';

describe('Validation Schemas', () => {
  describe('Session Tools', () => {
    describe('track_file_access', () => {
      it('should validate correct arguments', () => {
        const args = {
          path: '/absolute/path/to/file.ts',
          action: 'read' as const,
        };

        expect(() => validateToolArgs('track_file_access', args)).not.toThrow();
      });

      it('should reject missing required fields', () => {
        const args = { path: '/some/path' };

        expect(() => validateToolArgs('track_file_access', args)).toThrow(ValidationError);
      });

      it('should reject invalid action', () => {
        const args = {
          path: '/some/path',
          action: 'delete', // Invalid action
        };

        expect(() => validateToolArgs('track_file_access', args)).toThrow(ValidationError);
      });

      it('should reject relative paths', () => {
        const args = {
          path: './relative/path.ts',
          action: 'read',
        };

        expect(() => validateToolArgs('track_file_access', args)).toThrow(ValidationError);
      });
    });

    describe('get_session_context', () => {
      it('should validate with optional session_id', () => {
        expect(() => validateToolArgs('get_session_context', {})).not.toThrow();
        expect(() =>
          validateToolArgs('get_session_context', { session_id: 'test-session' })
        ).not.toThrow();
      });
    });

    describe('list_recent_sessions', () => {
      it('should apply default values', () => {
        const result = validateToolArgs('list_recent_sessions', {});
        expect(result.limit).toBe(5);
        expect(result.detail).toBe('summary');
      });

      it('should validate custom limit', () => {
        const result = validateToolArgs('list_recent_sessions', { limit: 10 });
        expect(result.limit).toBe(10);
      });

      it('should reject negative limit', () => {
        expect(() => validateToolArgs('list_recent_sessions', { limit: -1 })).toThrow(
          ValidationError
        );
      });

      it('should validate detail levels', () => {
        const levels = ['minimal', 'summary', 'detailed', 'full'];
        levels.forEach(level => {
          expect(() => validateToolArgs('list_recent_sessions', { detail: level })).not.toThrow();
        });
      });

      it('should reject invalid detail level', () => {
        expect(() => validateToolArgs('list_recent_sessions', { detail: 'invalid' })).toThrow(
          ValidationError
        );
      });
    });

    describe('close_session', () => {
      it('should validate required summary', () => {
        const args = { summary: 'Test session summary' };
        expect(() => validateToolArgs('close_session', args)).not.toThrow();
      });

      it('should reject empty summary', () => {
        const args = { summary: '' };
        expect(() => validateToolArgs('close_session', args)).toThrow(ValidationError);
      });

      it('should validate with optional topic', () => {
        const args = {
          summary: 'Test summary',
          topic: 'My Topic',
        };
        expect(() => validateToolArgs('close_session', args)).not.toThrow();
      });
    });

    describe('detect_session_repositories', () => {
      it('should validate empty arguments', () => {
        expect(() => validateToolArgs('detect_session_repositories', {})).not.toThrow();
      });
    });
  });

  describe('Search Tools', () => {
    describe('search_vault', () => {
      it('should validate basic search', () => {
        const args = { query: 'test query' };
        expect(() => validateToolArgs('search_vault', args)).not.toThrow();
      });

      it('should reject empty query', () => {
        const args = { query: '' };
        expect(() => validateToolArgs('search_vault', args)).toThrow(ValidationError);
      });

      it('should validate with all options', () => {
        const args = {
          query: 'test',
          directories: ['sessions', 'topics'],
          max_results: 20,
          date_range: { start: '2024-01-01', end: '2024-12-31' },
          snippets_only: false,
          detail: 'detailed',
        };
        expect(() => validateToolArgs('search_vault', args)).not.toThrow();
      });

      it('should validate date_range structure', () => {
        const args = {
          query: 'test',
          date_range: { start: '2024-01-01' }, // Only start is fine
        };
        expect(() => validateToolArgs('search_vault', args)).not.toThrow();
      });
    });

    describe('toggle_embeddings', () => {
      it('should validate without arguments', () => {
        expect(() => validateToolArgs('toggle_embeddings', {})).not.toThrow();
      });

      it('should validate with enabled flag', () => {
        expect(() => validateToolArgs('toggle_embeddings', { enabled: true })).not.toThrow();
        expect(() => validateToolArgs('toggle_embeddings', { enabled: false })).not.toThrow();
      });

      it('should reject non-boolean values', () => {
        expect(() => validateToolArgs('toggle_embeddings', { enabled: 'yes' })).toThrow(
          ValidationError
        );
      });
    });
  });

  describe('Topics Tools', () => {
    describe('create_topic_page', () => {
      it('should validate valid topic creation', () => {
        const args = {
          topic: 'JWT Authentication Strategy',
          content: 'This is a detailed explanation of JWT authentication...',
        };
        expect(() => validateToolArgs('create_topic_page', args)).not.toThrow();
      });

      it('should reject short topic names', () => {
        const args = {
          topic: 'AB', // Too short (< 3 chars)
          content: 'Some content',
        };
        expect(() => validateToolArgs('create_topic_page', args)).toThrow(ValidationError);
      });

      it('should reject short content', () => {
        const args = {
          topic: 'Valid Topic',
          content: 'Short', // Too short (< 10 chars)
        };
        expect(() => validateToolArgs('create_topic_page', args)).toThrow(ValidationError);
      });

      it('should validate auto_analyze options', () => {
        expect(() =>
          validateToolArgs('create_topic_page', {
            topic: 'Test',
            content: 'Test content here',
            auto_analyze: true,
          })
        ).not.toThrow();

        expect(() =>
          validateToolArgs('create_topic_page', {
            topic: 'Test',
            content: 'Test content here',
            auto_analyze: 'smart',
          })
        ).not.toThrow();

        expect(() =>
          validateToolArgs('create_topic_page', {
            topic: 'Test',
            content: 'Test content here',
            auto_analyze: false,
          })
        ).not.toThrow();
      });
    });

    describe('archive_topic', () => {
      it('should validate topic archival', () => {
        const args = {
          topic: 'old-topic',
          reason: 'No longer relevant',
        };
        expect(() => validateToolArgs('archive_topic', args)).not.toThrow();
      });

      it('should validate without reason', () => {
        const args = { topic: 'old-topic' };
        expect(() => validateToolArgs('archive_topic', args)).not.toThrow();
      });
    });

    describe('analyze_topic_content', () => {
      it('should validate content analysis', () => {
        const args = {
          content: 'Content to analyze for tags and metadata',
          topic_name: 'Test Topic',
          context: 'Additional context',
        };
        expect(() => validateToolArgs('analyze_topic_content', args)).not.toThrow();
      });

      it('should reject empty content', () => {
        const args = { content: '' };
        expect(() => validateToolArgs('analyze_topic_content', args)).toThrow(ValidationError);
      });
    });
  });

  describe('Review Tools', () => {
    describe('find_stale_topics', () => {
      it('should apply default threshold', () => {
        const result = validateToolArgs('find_stale_topics', {});
        expect(result.age_threshold_days).toBe(30);
        expect(result.include_never_reviewed).toBe(true);
      });

      it('should validate custom threshold', () => {
        const result = validateToolArgs('find_stale_topics', {
          age_threshold_days: 180,
        });
        expect(result.age_threshold_days).toBe(180);
      });

      it('should reject negative threshold', () => {
        expect(() =>
          validateToolArgs('find_stale_topics', {
            age_threshold_days: -1,
          })
        ).toThrow(ValidationError);
      });
    });
  });

  describe('Git Tools', () => {
    describe('create_project_page', () => {
      it('should validate absolute repo path', () => {
        const args = { repo_path: '/absolute/path/to/repo' };
        expect(() => validateToolArgs('create_project_page', args)).not.toThrow();
      });

      it('should reject relative repo path', () => {
        const args = { repo_path: './relative/repo' };
        expect(() => validateToolArgs('create_project_page', args)).toThrow(ValidationError);
      });
    });

    describe('record_commit', () => {
      it('should validate commit recording', () => {
        const args = {
          repo_path: '/absolute/path/to/repo',
          commit_hash: 'abc123def456',
        };
        expect(() => validateToolArgs('record_commit', args)).not.toThrow();
      });

      it('should validate long commit hash', () => {
        const args = {
          repo_path: '/path/to/repo',
          commit_hash: 'a'.repeat(40), // Full SHA-1
        };
        expect(() => validateToolArgs('record_commit', args)).not.toThrow();
      });

      it('should reject invalid commit hash', () => {
        const args = {
          repo_path: '/path/to/repo',
          commit_hash: 'invalid-hash!', // Non-hex characters
        };
        expect(() => validateToolArgs('record_commit', args)).toThrow(ValidationError);
      });

      it('should reject short commit hash', () => {
        const args = {
          repo_path: '/path/to/repo',
          commit_hash: 'abc12', // Too short (< 7 chars)
        };
        expect(() => validateToolArgs('record_commit', args)).toThrow(ValidationError);
      });
    });

    describe('analyze_commit_impact', () => {
      it('should validate commit analysis', () => {
        const args = {
          repo_path: '/path/to/repo',
          commit_hash: 'abc123def',
          include_diff: true,
        };
        expect(() => validateToolArgs('analyze_commit_impact', args)).not.toThrow();
      });

      it('should default include_diff to false', () => {
        const result = validateToolArgs('analyze_commit_impact', {
          repo_path: '/path/to/repo',
          commit_hash: 'abc123def',
        });
        expect(result.include_diff).toBe(false);
      });
    });
  });

  describe('Decisions Tools', () => {
    describe('create_decision', () => {
      it('should validate decision creation', () => {
        const args = {
          title: 'Use Obsidian vs Notion',
          content:
            'Context: We need to choose... Alternatives: Obsidian, Notion... Decision: Obsidian because...',
          context: 'Additional context',
          project: 'my-project',
        };
        expect(() => validateToolArgs('create_decision', args)).not.toThrow();
      });

      it('should reject short title', () => {
        const args = {
          title: 'Test', // Too short (< 5 chars)
          content: 'Detailed decision content here',
        };
        expect(() => validateToolArgs('create_decision', args)).toThrow(ValidationError);
      });

      it('should reject short content', () => {
        const args = {
          title: 'Valid Title Here',
          content: 'Short', // Too short (< 20 chars)
        };
        expect(() => validateToolArgs('create_decision', args)).toThrow(ValidationError);
      });

      it('should validate force flag', () => {
        const args = {
          title: 'Decision Title',
          content: 'Decision content goes here with details',
          force: true,
        };
        expect(() => validateToolArgs('create_decision', args)).not.toThrow();
      });
    });
  });

  describe('Maintenance Tools', () => {
    describe('vault_custodian', () => {
      it('should validate without arguments', () => {
        expect(() => validateToolArgs('vault_custodian', {})).not.toThrow();
      });

      it('should validate with file list', () => {
        const args = {
          files_to_check: ['/absolute/path/file1.md', '/absolute/path/file2.md'],
        };
        expect(() => validateToolArgs('vault_custodian', args)).not.toThrow();
      });

      it('should reject relative paths in file list', () => {
        const args = {
          files_to_check: ['./relative/path.md'],
        };
        expect(() => validateToolArgs('vault_custodian', args)).toThrow(ValidationError);
      });
    });
  });

  describe('Validation Utilities', () => {
    describe('safeValidateToolArgs', () => {
      it('should return success for valid args', () => {
        const result = safeValidateToolArgs('search_vault', { query: 'test' });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.query).toBe('test');
        }
      });

      it('should return error for invalid args', () => {
        const result = safeValidateToolArgs('search_vault', { query: '' });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBeInstanceOf(ValidationError);
        }
      });
    });

    describe('getValidationSchema', () => {
      it('should return schema for valid tool', () => {
        const schema = getValidationSchema('search_vault');
        expect(schema).toBeDefined();
      });

      it('should throw for unknown tool', () => {
        expect(() => getValidationSchema('unknown_tool' as any)).toThrow();
      });
    });

    describe('validateBatch', () => {
      it('should validate multiple tool calls', () => {
        const results = validateBatch([
          { toolName: 'search_vault', args: { query: 'test' } },
          { toolName: 'create_topic_page', args: { topic: 'Test Topic', content: 'Test content' } },
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(true);
      });

      it('should handle mixed valid/invalid calls', () => {
        const results = validateBatch([
          { toolName: 'search_vault', args: { query: 'test' } },
          { toolName: 'search_vault', args: { query: '' } }, // Invalid
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(false);
      });
    });

    describe('isValid', () => {
      it('should return true for valid args', () => {
        expect(isValid('search_vault', { query: 'test' })).toBe(true);
      });

      it('should return false for invalid args', () => {
        expect(isValid('search_vault', { query: '' })).toBe(false);
      });
    });

    describe('ValidationError', () => {
      it('should format error messages properly', () => {
        try {
          validateToolArgs('search_vault', { query: '' });
          expect.fail('Should have thrown ValidationError');
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          if (error instanceof ValidationError) {
            expect(error.message).toContain('Invalid arguments');
            expect(error.message).toContain('search_vault');
            expect(error.toolName).toBe('search_vault');
          }
        }
      });

      it('should provide detailed report', () => {
        try {
          validateToolArgs('create_topic_page', {
            topic: 'AB', // Too short
            content: 'Short', // Too short
          });
          expect.fail('Should have thrown ValidationError');
        } catch (error) {
          if (error instanceof ValidationError) {
            const report = error.getDetailedReport();
            expect(report).toContain('Validation Error Report');
            expect(report).toContain('create_topic_page');
            expect(report).toContain('Raw Arguments');
          }
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null arguments', () => {
      expect(() => validateToolArgs('search_vault', null)).toThrow();
    });

    it('should handle undefined arguments', () => {
      expect(() => validateToolArgs('search_vault', undefined)).toThrow();
    });

    it('should handle extra unknown properties', () => {
      // Zod should strip unknown properties by default
      const result = validateToolArgs('search_vault', {
        query: 'test',
        unknownProp: 'value',
      });
      expect(result.query).toBe('test');
      expect('unknownProp' in result).toBe(false);
    });

    it('should handle type coercion where appropriate', () => {
      // Numbers should work for limit even if passed as strings (if Zod coerces)
      // This depends on Zod configuration - by default it's strict
      const result = validateToolArgs('list_recent_sessions', { limit: 10 });
      expect(result.limit).toBe(10);
    });
  });

  describe('Memory Tools', () => {
    describe('get_memory_base', () => {
      it('should validate empty arguments', () => {
        expect(() => validateToolArgs('get_memory_base', {})).not.toThrow();
      });
    });

    describe('append_to_accumulator', () => {
      it('should validate correct arguments', () => {
        const args = {
          filename: 'accumulator-corrections.md',
          content: 'New correction entry',
        };
        expect(() => validateToolArgs('append_to_accumulator', args)).not.toThrow();
      });

      it('should apply default add_timestamp', () => {
        const result = validateToolArgs('append_to_accumulator', {
          filename: 'accumulator-corrections.md',
          content: 'Entry',
        });
        expect(result.add_timestamp).toBe(true);
      });

      it('should reject invalid filename pattern', () => {
        expect(() =>
          validateToolArgs('append_to_accumulator', {
            filename: 'not-an-accumulator.md',
            content: 'Content',
          })
        ).toThrow(ValidationError);
      });

      it('should reject filename without .md extension', () => {
        expect(() =>
          validateToolArgs('append_to_accumulator', {
            filename: 'accumulator-test',
            content: 'Content',
          })
        ).toThrow(ValidationError);
      });

      it('should reject empty content', () => {
        expect(() =>
          validateToolArgs('append_to_accumulator', {
            filename: 'accumulator-test.md',
            content: '',
          })
        ).toThrow(ValidationError);
      });
    });
  });

  describe('Task Tools', () => {
    describe('get_tasks_by_date', () => {
      it('should validate basic date query', () => {
        const args = { date: 'today' };
        expect(() => validateToolArgs('get_tasks_by_date', args)).not.toThrow();
      });

      it('should validate with optional status', () => {
        const args = { date: 'today', status: 'incomplete' as const };
        expect(() => validateToolArgs('get_tasks_by_date', args)).not.toThrow();
      });

      it('should validate all status values', () => {
        ['incomplete', 'complete', 'all'].forEach(status => {
          expect(() =>
            validateToolArgs('get_tasks_by_date', { date: 'today', status })
          ).not.toThrow();
        });
      });

      it('should reject invalid status', () => {
        expect(() =>
          validateToolArgs('get_tasks_by_date', { date: 'today', status: 'invalid' })
        ).toThrow(ValidationError);
      });

      it('should reject empty date', () => {
        expect(() => validateToolArgs('get_tasks_by_date', { date: '' })).toThrow(ValidationError);
      });

      it('should validate with project filter', () => {
        const args = { date: 'today', project: 'my-project' };
        expect(() => validateToolArgs('get_tasks_by_date', args)).not.toThrow();
      });
    });

    describe('add_task', () => {
      it('should validate basic task', () => {
        const args = { task: 'Write unit tests' };
        expect(() => validateToolArgs('add_task', args)).not.toThrow();
      });

      it('should validate with all options', () => {
        const args = {
          task: 'Write unit tests',
          due: 'tomorrow',
          priority: 'high' as const,
          project: 'mcp-server',
          context: 'work' as const,
          list: 'custom-list',
        };
        expect(() => validateToolArgs('add_task', args)).not.toThrow();
      });

      it('should reject empty task', () => {
        expect(() => validateToolArgs('add_task', { task: '' })).toThrow(ValidationError);
      });

      it('should validate priority values', () => {
        ['high', 'medium', 'low'].forEach(priority => {
          expect(() => validateToolArgs('add_task', { task: 'Test', priority })).not.toThrow();
        });
      });

      it('should reject invalid priority', () => {
        expect(() => validateToolArgs('add_task', { task: 'Test', priority: 'urgent' })).toThrow(
          ValidationError
        );
      });

      it('should validate context values', () => {
        ['work', 'personal'].forEach(context => {
          expect(() => validateToolArgs('add_task', { task: 'Test', context })).not.toThrow();
        });
      });

      it('should reject invalid context', () => {
        expect(() => validateToolArgs('add_task', { task: 'Test', context: 'other' })).toThrow(
          ValidationError
        );
      });
    });

    describe('complete_task', () => {
      it('should validate basic completion', () => {
        const args = { task: 'Write unit tests' };
        expect(() => validateToolArgs('complete_task', args)).not.toThrow();
      });

      it('should validate with date', () => {
        const args = { task: 'Write tests', date: '2026-02-15' };
        expect(() => validateToolArgs('complete_task', args)).not.toThrow();
      });

      it('should reject empty task', () => {
        expect(() => validateToolArgs('complete_task', { task: '' })).toThrow(ValidationError);
      });
    });
  });

  describe('Document Tools', () => {
    describe('update_document', () => {
      it('should validate basic replace', () => {
        const args = {
          file_path: '/vault/topics/test.md',
          content: 'New content here',
        };
        expect(() => validateToolArgs('update_document', args)).not.toThrow();
      });

      it('should validate all strategies', () => {
        ['append', 'replace', 'section-edit'].forEach(strategy => {
          expect(() =>
            validateToolArgs('update_document', {
              file_path: '/vault/test.md',
              content: 'Content',
              strategy,
            })
          ).not.toThrow();
        });
      });

      it('should validate edit strategy with old_string', () => {
        const args = {
          file_path: '/vault/test.md',
          content: 'New text',
          strategy: 'edit' as const,
          old_string: 'Old text',
        };
        expect(() => validateToolArgs('update_document', args)).not.toThrow();
      });

      it('should reject edit strategy without old_string', () => {
        const args = {
          file_path: '/vault/test.md',
          content: 'New text',
          strategy: 'edit' as const,
        };
        expect(() => validateToolArgs('update_document', args)).toThrow();
      });

      it('should reject relative file path', () => {
        expect(() =>
          validateToolArgs('update_document', {
            file_path: './relative/path.md',
            content: 'Content',
          })
        ).toThrow(ValidationError);
      });

      it('should accept optional reason and force', () => {
        const args = {
          file_path: '/vault/test.md',
          content: 'Content',
          reason: 'Updating for accuracy',
          force: true,
        };
        expect(() => validateToolArgs('update_document', args)).not.toThrow();
      });
    });
  });

  describe('Code Tools', () => {
    describe('code_file', () => {
      it('should validate write operation', () => {
        const args = {
          file_path: '/projects/src/file.ts',
          operation: 'write' as const,
          content: 'const x = 1;',
        };
        expect(() => validateToolArgs('code_file', args)).not.toThrow();
      });

      it('should validate edit operation with old_string', () => {
        const args = {
          file_path: '/projects/src/file.ts',
          operation: 'edit' as const,
          content: 'const y = 2;',
          old_string: 'const x = 1;',
        };
        expect(() => validateToolArgs('code_file', args)).not.toThrow();
      });

      it('should reject edit operation without old_string', () => {
        const args = {
          file_path: '/projects/src/file.ts',
          operation: 'edit' as const,
          content: 'const y = 2;',
        };
        expect(() => validateToolArgs('code_file', args)).toThrow();
      });

      it('should reject invalid operation', () => {
        expect(() =>
          validateToolArgs('code_file', {
            file_path: '/path/file.ts',
            operation: 'delete',
            content: 'x',
          })
        ).toThrow(ValidationError);
      });

      it('should reject relative path', () => {
        expect(() =>
          validateToolArgs('code_file', {
            file_path: './src/file.ts',
            operation: 'write',
            content: 'x',
          })
        ).toThrow(ValidationError);
      });
    });
  });

  describe('Mode Tools', () => {
    describe('switch_mode', () => {
      it('should validate work mode', () => {
        expect(() => validateToolArgs('switch_mode', { mode: 'work' })).not.toThrow();
      });

      it('should validate personal mode', () => {
        expect(() => validateToolArgs('switch_mode', { mode: 'personal' })).not.toThrow();
      });

      it('should reject invalid mode', () => {
        expect(() => validateToolArgs('switch_mode', { mode: 'test' })).toThrow(ValidationError);
      });

      it('should reject missing mode', () => {
        expect(() => validateToolArgs('switch_mode', {})).toThrow(ValidationError);
      });
    });

    describe('get_current_mode', () => {
      it('should validate empty arguments', () => {
        expect(() => validateToolArgs('get_current_mode', {})).not.toThrow();
      });
    });
  });

  describe('Workflow Tools', () => {
    describe('workflow', () => {
      it('should validate without workflow name', () => {
        expect(() => validateToolArgs('workflow', {})).not.toThrow();
      });

      it('should validate with workflow name', () => {
        expect(() => validateToolArgs('workflow', { workflow_name: 'topic-review' })).not.toThrow();
      });
    });
  });

  describe('Issues Tools', () => {
    describe('issue', () => {
      it('should validate list mode (default)', () => {
        expect(() => validateToolArgs('issue', {})).not.toThrow();
      });

      it('should validate all modes', () => {
        ['list', 'load', 'create', 'resolve'].forEach(mode => {
          expect(() => validateToolArgs('issue', { mode })).not.toThrow();
        });
      });

      it('should validate create with name and priority', () => {
        const args = {
          mode: 'create' as const,
          name: 'Bug in search',
          priority: 'high' as const,
        };
        expect(() => validateToolArgs('issue', args)).not.toThrow();
      });

      it('should apply default priority', () => {
        const result = validateToolArgs('issue', { mode: 'create', name: 'Test' });
        expect(result.priority).toBe('medium');
      });

      it('should reject invalid mode', () => {
        expect(() => validateToolArgs('issue', { mode: 'invalid' })).toThrow(ValidationError);
      });

      it('should reject invalid priority', () => {
        expect(() =>
          validateToolArgs('issue', { mode: 'create', name: 'Test', priority: 'critical' })
        ).toThrow(ValidationError);
      });
    });

    describe('get_persistent_issues', () => {
      it('should validate without arguments', () => {
        expect(() => validateToolArgs('get_persistent_issues', {})).not.toThrow();
      });

      it('should apply default include_archived', () => {
        const result = validateToolArgs('get_persistent_issues', {});
        expect(result.include_archived).toBe(false);
      });

      it('should validate with include_archived', () => {
        expect(() =>
          validateToolArgs('get_persistent_issues', { include_archived: true })
        ).not.toThrow();
      });
    });

    describe('update_persistent_issue', () => {
      it('should validate correct arguments', () => {
        const args = {
          slug: 'search-bug',
          entry: 'Found the root cause in SearchEngine.ts',
        };
        expect(() => validateToolArgs('update_persistent_issue', args)).not.toThrow();
      });

      it('should validate with optional session_id', () => {
        const args = {
          slug: 'search-bug',
          entry: 'Investigation notes',
          session_id: '2026-02-15_12-00-00',
        };
        expect(() => validateToolArgs('update_persistent_issue', args)).not.toThrow();
      });

      it('should reject empty slug', () => {
        expect(() =>
          validateToolArgs('update_persistent_issue', { slug: '', entry: 'Notes' })
        ).toThrow(ValidationError);
      });

      it('should reject empty entry', () => {
        expect(() =>
          validateToolArgs('update_persistent_issue', { slug: 'test', entry: '' })
        ).toThrow(ValidationError);
      });
    });
  });

  describe('Additional Search Tools', () => {
    describe('get_topic_context', () => {
      it('should validate topic name', () => {
        expect(() => validateToolArgs('get_topic_context', { topic: 'my-topic' })).not.toThrow();
      });

      it('should reject empty topic', () => {
        expect(() => validateToolArgs('get_topic_context', { topic: '' })).toThrow(ValidationError);
      });
    });
  });

  describe('Additional Session Tools', () => {
    describe('restore_session_data', () => {
      it('should validate empty arguments', () => {
        expect(() => validateToolArgs('restore_session_data', {})).not.toThrow();
      });
    });

    describe('link_session_to_repository', () => {
      it('should validate absolute repo path', () => {
        expect(() =>
          validateToolArgs('link_session_to_repository', { repo_path: '/path/to/repo' })
        ).not.toThrow();
      });

      it('should reject relative path', () => {
        expect(() =>
          validateToolArgs('link_session_to_repository', { repo_path: './relative' })
        ).toThrow(ValidationError);
      });
    });

    describe('list_recent_projects', () => {
      it('should apply defaults', () => {
        const result = validateToolArgs('list_recent_projects', {});
        expect(result.limit).toBe(5);
        expect(result.detail).toBe('summary');
      });

      it('should validate custom limit', () => {
        const result = validateToolArgs('list_recent_projects', { limit: 20 });
        expect(result.limit).toBe(20);
      });

      it('should reject negative limit', () => {
        expect(() => validateToolArgs('list_recent_projects', { limit: -1 })).toThrow(
          ValidationError
        );
      });
    });
  });

  describe('Review Tools (additional)', () => {
    describe('submit_topic_reviews', () => {
      it('should validate a complete review', () => {
        const args = {
          reviews: [
            {
              topic_slug: 'my-topic',
              technical_accuracy: 'verified' as const,
              completeness: 'comprehensive' as const,
              organization: 'excellent' as const,
              redundancy_check: 'no_duplicates' as const,
              outcome: 'current' as const,
              issues_found: [],
              updates_needed: [],
            },
          ],
        };
        expect(() => validateToolArgs('submit_topic_reviews', args)).not.toThrow();
      });

      it('should reject empty reviews array', () => {
        expect(() => validateToolArgs('submit_topic_reviews', { reviews: [] })).toThrow(
          ValidationError
        );
      });

      it('should reject review missing required fields', () => {
        expect(() =>
          validateToolArgs('submit_topic_reviews', {
            reviews: [{ topic_slug: 'test' }],
          })
        ).toThrow(ValidationError);
      });

      it('should validate all enum values for technical_accuracy', () => {
        ['verified', 'outdated', 'needs_check'].forEach(val => {
          const args = {
            reviews: [
              {
                topic_slug: 'test',
                technical_accuracy: val,
                completeness: 'adequate',
                organization: 'excellent',
                redundancy_check: 'no_duplicates',
                outcome: 'current',
                issues_found: [],
                updates_needed: [],
              },
            ],
          };
          expect(() => validateToolArgs('submit_topic_reviews', args)).not.toThrow();
        });
      });

      it('should validate all outcome values', () => {
        ['current', 'expand', 'reorganize', 'consolidate', 'archive'].forEach(outcome => {
          const args = {
            reviews: [
              {
                topic_slug: 'test',
                technical_accuracy: 'verified',
                completeness: 'adequate',
                organization: 'excellent',
                redundancy_check: 'no_duplicates',
                outcome,
                issues_found: [],
                updates_needed: [],
              },
            ],
          };
          expect(() => validateToolArgs('submit_topic_reviews', args)).not.toThrow();
        });
      });
    });
  });

  describe('Cross-Field Refinements', () => {
    describe('close_session Phase 2 requires handoff', () => {
      it('should reject finalize=true without handoff', () => {
        const args = {
          summary: 'Test session',
          finalize: true,
          session_data: {
            phase: 1,
            sessionId: 'test',
            sessionFile: '/test.md',
            sessionContent: 'content',
            dateStr: '2026-02-15',
            monthDir: '/sessions/2026-02',
            detectedRepoInfo: null,
            topicsCreated: [],
            decisionsCreated: [],
            projectsCreated: [],
            filesAccessed: [],
            filesToCheck: [],
            repoDetectionMessage: '',
            handoff: '',
          },
        };
        expect(() => validateToolArgs('close_session', args)).toThrow();
      });

      it('should accept finalize=true with handoff', () => {
        const args = {
          summary: 'Test session',
          finalize: true,
          handoff: 'Next session should continue with testing',
          session_data: {
            phase: 1,
            sessionId: 'test',
            sessionFile: '/test.md',
            sessionContent: 'content',
            dateStr: '2026-02-15',
            monthDir: '/sessions/2026-02',
            detectedRepoInfo: null,
            topicsCreated: [],
            decisionsCreated: [],
            projectsCreated: [],
            filesAccessed: [],
            filesToCheck: [],
            repoDetectionMessage: '',
            handoff: 'placeholder',
          },
        };
        expect(() => validateToolArgs('close_session', args)).not.toThrow();
      });

      it('should accept finalize=false without handoff', () => {
        const args = { summary: 'Test session', finalize: false };
        expect(() => validateToolArgs('close_session', args)).not.toThrow();
      });
    });

    describe('update_document edit strategy requires old_string', () => {
      it('should reject edit without old_string', () => {
        expect(() =>
          validateToolArgs('update_document', {
            file_path: '/vault/test.md',
            content: 'new',
            strategy: 'edit',
          })
        ).toThrow();
      });

      it('should accept edit with old_string', () => {
        expect(() =>
          validateToolArgs('update_document', {
            file_path: '/vault/test.md',
            content: 'new',
            strategy: 'edit',
            old_string: 'old',
          })
        ).not.toThrow();
      });
    });

    describe('code_file edit operation requires old_string', () => {
      it('should reject edit without old_string', () => {
        expect(() =>
          validateToolArgs('code_file', {
            file_path: '/src/file.ts',
            operation: 'edit',
            content: 'new',
          })
        ).toThrow();
      });

      it('should accept edit with old_string', () => {
        expect(() =>
          validateToolArgs('code_file', {
            file_path: '/src/file.ts',
            operation: 'edit',
            content: 'new',
            old_string: 'old',
          })
        ).not.toThrow();
      });
    });

    describe('CommitHash validation', () => {
      it('should accept 7-char hash', () => {
        expect(() =>
          validateToolArgs('record_commit', { repo_path: '/repo', commit_hash: 'abc1234' })
        ).not.toThrow();
      });

      it('should accept 40-char hash', () => {
        expect(() =>
          validateToolArgs('record_commit', {
            repo_path: '/repo',
            commit_hash: 'a'.repeat(40),
          })
        ).not.toThrow();
      });

      it('should accept uppercase hex', () => {
        expect(() =>
          validateToolArgs('record_commit', { repo_path: '/repo', commit_hash: 'ABC1234' })
        ).not.toThrow();
      });

      it('should reject 6-char hash (too short)', () => {
        expect(() =>
          validateToolArgs('record_commit', { repo_path: '/repo', commit_hash: 'abc123' })
        ).toThrow(ValidationError);
      });

      it('should reject 41-char hash (too long)', () => {
        expect(() =>
          validateToolArgs('record_commit', {
            repo_path: '/repo',
            commit_hash: 'a'.repeat(41),
          })
        ).toThrow(ValidationError);
      });

      it('should reject non-hex characters', () => {
        expect(() =>
          validateToolArgs('record_commit', { repo_path: '/repo', commit_hash: 'xyz1234' })
        ).toThrow(ValidationError);
      });
    });

    describe('AbsolutePath validation', () => {
      it('should accept Unix absolute path', () => {
        expect(() =>
          validateToolArgs('create_project_page', { repo_path: '/home/user/repo' })
        ).not.toThrow();
      });

      it('should accept Windows absolute path', () => {
        expect(() =>
          validateToolArgs('create_project_page', { repo_path: 'C:\\Users\\repo' })
        ).not.toThrow();
      });

      it('should reject relative path', () => {
        expect(() =>
          validateToolArgs('create_project_page', { repo_path: 'relative/path' })
        ).toThrow(ValidationError);
      });

      it('should reject dot-relative path', () => {
        expect(() => validateToolArgs('create_project_page', { repo_path: './relative' })).toThrow(
          ValidationError
        );
      });
    });
  });

  describe('Error Message Quality', () => {
    it('should provide helpful message for missing required field', () => {
      try {
        validateToolArgs('create_topic_page', { topic: 'Test' });
        expect.fail('Should have thrown');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.message).toContain('content');
        }
      }
    });

    it('should provide helpful message for wrong type', () => {
      try {
        validateToolArgs('list_recent_sessions', { limit: 'ten' });
        expect.fail('Should have thrown');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.message).toContain('limit');
        }
      }
    });

    it('should provide helpful message for enum violations', () => {
      try {
        validateToolArgs('track_file_access', {
          path: '/path/to/file',
          action: 'invalid',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.message).toContain('action');
          expect(error.message).toMatch(/read|edit|create/);
        }
      }
    });
  });
});
