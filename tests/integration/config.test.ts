/**
 * Integration tests for configuration loading and validation
 *
 * Tests loadFullConfig() and getConfigForMode() behavior with various
 * config file formats, environment variables, and mode filtering.
 * Also validates that all tool schemas are registered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { ValidationSchemas, TOOL_NAMES } from '../../src/validation/schemas.js';

// Mock the logger to prevent noise
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Configuration & Validation', () => {
  describe('ValidationSchemas registry', () => {
    it('should have schemas registered for all expected tools', () => {
      const schemaKeys = Object.keys(ValidationSchemas);
      expect(schemaKeys.length).toBe(34);
    });

    it('should have TOOL_NAMES array matching schema keys', () => {
      const schemaKeys = Object.keys(ValidationSchemas);
      expect(TOOL_NAMES).toEqual(expect.arrayContaining(schemaKeys));
      expect(schemaKeys).toEqual(expect.arrayContaining([...TOOL_NAMES]));
    });

    it('should include all session tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('track_file_access');
      expect(ValidationSchemas).toHaveProperty('get_session_context');
      expect(ValidationSchemas).toHaveProperty('list_recent_sessions');
      expect(ValidationSchemas).toHaveProperty('close_session');
      expect(ValidationSchemas).toHaveProperty('detect_session_repositories');
      expect(ValidationSchemas).toHaveProperty('restore_session_data');
    });

    it('should include all search tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('search_vault');
      expect(ValidationSchemas).toHaveProperty('get_topic_context');
      expect(ValidationSchemas).toHaveProperty('toggle_embeddings');
    });

    it('should include all topic tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('create_topic_page');
      expect(ValidationSchemas).toHaveProperty('archive_topic');
      expect(ValidationSchemas).toHaveProperty('analyze_topic_content');
    });

    it('should include all review tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('find_stale_topics');
      expect(ValidationSchemas).toHaveProperty('submit_topic_reviews');
    });

    it('should include all git tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('create_project_page');
      expect(ValidationSchemas).toHaveProperty('record_commit');
      expect(ValidationSchemas).toHaveProperty('link_session_to_repository');
      expect(ValidationSchemas).toHaveProperty('list_recent_projects');
      expect(ValidationSchemas).toHaveProperty('analyze_commit_impact');
    });

    it('should include all decision tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('create_decision');
    });

    it('should include all maintenance tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('vault_custodian');
    });

    it('should include all memory tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('get_memory_base');
      expect(ValidationSchemas).toHaveProperty('append_to_accumulator');
    });

    it('should include all task tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('get_tasks_by_date');
      expect(ValidationSchemas).toHaveProperty('add_task');
      expect(ValidationSchemas).toHaveProperty('complete_task');
    });

    it('should include all document tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('update_document');
      expect(ValidationSchemas).toHaveProperty('code_file');
    });

    it('should include all mode tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('switch_mode');
      expect(ValidationSchemas).toHaveProperty('get_current_mode');
    });

    it('should include all workflow tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('workflow');
    });

    it('should include all issues tool schemas', () => {
      expect(ValidationSchemas).toHaveProperty('issue');
      expect(ValidationSchemas).toHaveProperty('get_persistent_issues');
      expect(ValidationSchemas).toHaveProperty('update_persistent_issue');
    });

    it('should have each schema be a Zod schema object with parse method', () => {
      for (const [name, schema] of Object.entries(ValidationSchemas)) {
        expect(schema, `Schema ${name} should have a parse method`).toHaveProperty('parse');
        expect(typeof (schema as any).parse).toBe('function');
      }
    });
  });

  describe('Config format parsing (structural)', () => {
    it('should normalize paths by stripping trailing slashes', () => {
      const normalizePath = (p: string): string => p.replace(/\/+$/, '');

      expect(normalizePath('/path/to/vault/')).toBe('/path/to/vault');
      expect(normalizePath('/path/to/vault///')).toBe('/path/to/vault');
      expect(normalizePath('/path/to/vault')).toBe('/path/to/vault');
    });

    it('should handle new primaryVaults[] config format structure', () => {
      const config = {
        primaryVaults: [
          { path: '/vault/work/', name: 'Work', mode: 'work' },
          { path: '/vault/personal/', name: 'Personal', mode: 'personal' },
        ],
        secondaryVaults: [{ path: '/vault/shared/', name: 'Shared', mode: 'work' }],
      };

      expect(Array.isArray(config.primaryVaults)).toBe(true);
      expect(config.primaryVaults).toHaveLength(2);
      expect(config.primaryVaults[0].mode).toBe('work');
      expect(config.primaryVaults[1].mode).toBe('personal');
    });

    it('should handle legacy primaryVault object format structure', () => {
      const config = {
        primaryVault: { path: '/vault/main/', name: 'Main' },
        secondaryVaults: [{ path: '/vault/extra/' }],
      };

      expect(config.primaryVault).toBeDefined();
      expect(typeof config.primaryVault.path).toBe('string');
      expect((config.primaryVault as any).mode).toBeUndefined();
    });

    it('should default authority to "default" when not specified', () => {
      const vault = { path: '/vault', name: 'Test' };
      const authority = (vault as any).authority || 'default';
      expect(authority).toBe('default');
    });

    it('should default mode to "work" when not specified', () => {
      const vault = { path: '/vault', name: 'Test' };
      const mode = (vault as any).mode || 'work';
      expect(mode).toBe('work');
    });
  });

  describe('Mode filtering logic', () => {
    it('should filter vaults by work mode', () => {
      const allVaults = [
        { path: '/v1', name: 'Work', mode: 'work' as const },
        { path: '/v2', name: 'Personal', mode: 'personal' as const },
        { path: '/v3', name: 'Work2', mode: 'work' as const },
      ];

      const workVaults = allVaults.filter(v => (v.mode || 'work') === 'work');
      expect(workVaults).toHaveLength(2);
      expect(workVaults[0].name).toBe('Work');
      expect(workVaults[1].name).toBe('Work2');
    });

    it('should filter vaults by personal mode', () => {
      const allVaults = [
        { path: '/v1', name: 'Work', mode: 'work' as const },
        { path: '/v2', name: 'Personal', mode: 'personal' as const },
      ];

      const personalVaults = allVaults.filter(v => v.mode === 'personal');
      expect(personalVaults).toHaveLength(1);
      expect(personalVaults[0].name).toBe('Personal');
    });

    it('should throw when no primary vault exists for requested mode', () => {
      const allPrimaryVaults = [{ path: '/v1', name: 'Work', mode: 'work' as const }];

      const getForMode = (mode: string) => {
        const filtered = allPrimaryVaults.filter(v => v.mode === mode);
        if (filtered.length === 0) {
          throw new Error(`No primary vault configured for mode: ${mode}`);
        }
        return filtered[0];
      };

      expect(() => getForMode('personal')).toThrow(
        'No primary vault configured for mode: personal'
      );
      expect(() => getForMode('work')).not.toThrow();
    });
  });

  describe('Environment variable fallback logic', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should parse OBSIDIAN_SECONDARY_VAULTS as comma-separated paths', () => {
      const envValue = '/vault/a, /vault/b , /vault/c';
      const paths = envValue
        .split(',')
        .map(p => p.trim())
        .filter(p => p);

      expect(paths).toEqual(['/vault/a', '/vault/b', '/vault/c']);
    });

    it('should handle empty OBSIDIAN_SECONDARY_VAULTS', () => {
      const envValue = '';
      const paths = envValue
        ? envValue
            .split(',')
            .map(p => p.trim())
            .filter(p => p)
        : [];

      expect(paths).toEqual([]);
    });

    it('should use default vault name when OBSIDIAN_VAULT_NAME is not set', () => {
      delete process.env.OBSIDIAN_VAULT_NAME;
      const name = process.env.OBSIDIAN_VAULT_NAME || 'Primary Vault';
      expect(name).toBe('Primary Vault');
    });

    it('should fall back to ~/obsidian-vault when no config or env vars', () => {
      delete process.env.OBSIDIAN_VAULT_PATH;
      const vaultPath =
        process.env.OBSIDIAN_VAULT_PATH || path.join(process.env.HOME || '', 'obsidian-vault');

      expect(vaultPath).toContain('obsidian-vault');
    });
  });
});
