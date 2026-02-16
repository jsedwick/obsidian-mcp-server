/**
 * Unit tests for createDecision tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createDecision } from '../../../../src/tools/decisions/createDecision.js';
import type { CreateDecisionContext } from '../../../../src/tools/decisions/createDecision.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';
import { slugify } from '../../../helpers/context.js';

describe('createDecision', () => {
  let vaultPath: string;
  let context: CreateDecisionContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('create-decision');
    context = {
      vaultPath,
      currentSessionId: 'test-session-2026-02-16',
      slugify,
      ensureVaultStructure: vi.fn().mockResolvedValue(undefined),
      findRelatedContentInText: vi
        .fn()
        .mockResolvedValue({ topics: [], decisions: [], projects: [] }),
      trackDecisionCreation: vi.fn(),
      getRemoteUrl: vi.fn().mockResolvedValue(null),
      trackFileAccess: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should create vault-level decision', async () => {
    const result = await createDecision(
      {
        title: 'Use Redis vs Memcached for Caching',
        content:
          'We chose Redis over Memcached because it supports data structures. The alternative was Memcached.',
        force: true,
      },
      context
    );

    expect(result.content[0].text).toContain('vault-level');
    expect(result.content[0].text).toContain('001');

    // Check file was created
    const files = await fs.readdir(path.join(vaultPath, 'decisions', 'vault'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^001-/);

    const content = await fs.readFile(
      path.join(vaultPath, 'decisions', 'vault', files[0]),
      'utf-8'
    );
    expect(content).toContain('Use Redis vs Memcached for Caching');
  });

  it('should create project-specific decision with project slug', async () => {
    const result = await createDecision(
      {
        title: 'Flat vs Hierarchical File Organization',
        content: 'We chose flat over hierarchical. The alternative was nested directories.',
        project: 'my-project',
      },
      context
    );

    expect(result.content[0].text).toContain('my-project');

    const files = await fs.readdir(path.join(vaultPath, 'decisions', 'my-project'));
    expect(files.length).toBe(1);
  });

  it('should auto-number decisions sequentially', async () => {
    // Create first decision
    await createDecision(
      {
        title: 'First Choice vs Alternative',
        content: 'Chose first approach over alternative.',
        force: true,
      },
      context
    );

    // Create second decision
    await createDecision(
      {
        title: 'Second Option vs Third Option',
        content: 'Chose second option as alternative to third.',
        force: true,
      },
      context
    );

    const files = await fs.readdir(path.join(vaultPath, 'decisions', 'vault'));
    expect(files.length).toBe(2);
    expect(files.some(f => f.startsWith('001-'))).toBe(true);
    expect(files.some(f => f.startsWith('002-'))).toBe(true);
  });

  it('should warn about topic keywords in title (without force)', async () => {
    const result = await createDecision(
      {
        title: 'Fix the authentication bug',
        content: 'We need to fix the auth bug.',
      },
      context
    );

    expect(result.content[0].text).toContain('topic page');
    expect(result.content[0].text).toContain('fix');

    // No file should be created
    const vaultDir = path.join(vaultPath, 'decisions', 'vault');
    try {
      const files = await fs.readdir(vaultDir);
      expect(files.length).toBe(0);
    } catch {
      // Directory might not exist - that's fine
    }
  });

  it('should bypass topic keyword warning with force: true', async () => {
    const result = await createDecision(
      {
        title: 'Fix Architecture: Monolith vs Microservices',
        content:
          'We chose to fix the architecture by switching to microservices as an alternative to monolith.',
        force: true,
      },
      context
    );

    expect(result.content[0].text).toContain('Decision record created');
  });

  it('should warn when no decision indicators found (without force)', async () => {
    const result = await createDecision(
      {
        title: 'Use TypeScript',
        content: 'We decided to use TypeScript for type safety.',
      },
      context
    );

    expect(result.content[0].text).toContain('alternatives');
  });

  it('should track decision creation', async () => {
    await createDecision(
      {
        title: 'Redis vs Memcached',
        content: 'Chose Redis over Memcached alternative.',
        force: true,
      },
      context
    );

    expect(context.trackDecisionCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Redis vs Memcached',
      })
    );
  });
});
