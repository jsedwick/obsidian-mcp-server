import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getMemoryBase } from '../../../../src/tools/memory/getMemoryBase.js';
import { createTestVault, cleanupTestVault } from '../../../helpers/vault.js';

describe('getMemoryBase', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('memory-base');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestVault(vaultPath);
  });

  it('should load user reference content', async () => {
    await fs.writeFile(
      path.join(vaultPath, 'user-reference.md'),
      '---\n---\n# User Reference\n\n**Name:** Test User\n',
      'utf-8'
    );

    const result = await getMemoryBase({}, vaultPath);
    expect(result.content[0].text).toContain('Test User');
  });

  it('should handle missing user reference gracefully', async () => {
    const result = await getMemoryBase({}, vaultPath);
    // Should not throw, just return without user ref
    expect(result.content[0].text).toBeDefined();
  });

  it('should include session start time when context provided', async () => {
    const startTime = new Date('2026-02-16T10:00:00-08:00');
    const result = await getMemoryBase({}, vaultPath, { sessionStartTime: startTime });

    expect(result.content[0].text).toContain('SESSION_START_TIME');
  });

  it('should extract recent handoffs from session files', async () => {
    // Create session with handoff section
    const monthDir = path.join(vaultPath, 'sessions', '2026-02');
    await fs.mkdir(monthDir, { recursive: true });
    await fs.writeFile(
      path.join(monthDir, '2026-02-15_10-00-00_test-session.md'),
      `---
date: 2026-02-15
session_id: "2026-02-15_10-00-00_test-session"
---

# Session: test-session

Did some work.

## Handoff

Next: finish Phase 4 tests
`,
      'utf-8'
    );

    const result = await getMemoryBase({}, vaultPath);
    expect(result.content[0].text).toContain('Recent Handoffs');
    expect(result.content[0].text).toContain('finish Phase 4 tests');
  });

  it('should load condensed correction rules from accumulator', async () => {
    await fs.writeFile(
      path.join(vaultPath, 'accumulator-corrections.md'),
      `# Accumulator: Corrections

## 🚫 Test Correction - 2026-02-15

**What I did wrong:**
- Made a mistake

**How to prevent:**
- Don't do that
- Always check first
`,
      'utf-8'
    );

    const result = await getMemoryBase({}, vaultPath);
    expect(result.content[0].text).toContain('Correction Rules');
    expect(result.content[0].text).toContain('**Test Correction:**');
    expect(result.content[0].text).toContain("- Don't do that");
    expect(result.content[0].text).not.toContain('Made a mistake');
  });

  it('should load active persistent issues', async () => {
    const issuesDir = path.join(vaultPath, 'persistent-issues');
    await fs.mkdir(issuesDir, { recursive: true });
    await fs.writeFile(
      path.join(issuesDir, 'test-bug.md'),
      `---
title: "test-bug"
category: persistent-issue
status: "active"
created: "2026-01-15"
priority: "high"
sessions: []
---

# test-bug
`,
      'utf-8'
    );

    const result = await getMemoryBase({}, vaultPath);
    expect(result.content[0].text).toContain('Active Persistent Issues');
    expect(result.content[0].text).toContain('test-bug');
    expect(result.content[0].text).toContain('high');
  });

  it('should combine all sections with separators', async () => {
    await fs.writeFile(
      path.join(vaultPath, 'user-reference.md'),
      '---\n---\n# User Reference\n\n**Name:** Jesse\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(vaultPath, 'accumulator-corrections.md'),
      `# Accumulator: Corrections

## 🚫 Fix - 2026-02-15

**What I did wrong:**
- Something

**How to prevent:**
- Do better
`,
      'utf-8'
    );

    const startTime = new Date('2026-02-16T09:00:00-08:00');
    const result = await getMemoryBase({}, vaultPath, { sessionStartTime: startTime });

    const text = result.content[0].text;
    expect(text).toContain('SESSION_START_TIME');
    expect(text).toContain('Jesse');
    expect(text).toContain('Correction Rules');
    // Sections separated by ---
    expect(text).toContain('---');
  });
});
