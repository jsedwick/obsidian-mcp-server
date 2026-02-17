/**
 * Unit tests for listRecentProjects tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listRecentProjects } from '../../../../src/tools/git/listRecentProjects.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('listRecentProjects', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'list-projects-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should return message when no projects directory exists', async () => {
    const result = await listRecentProjects({}, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('No projects directory found');
  });

  it('should return message when projects directory is empty', async () => {
    await fs.mkdir(path.join(tmpDir, 'projects'));
    const result = await listRecentProjects({}, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('No projects found');
  });

  it('should list projects with summary detail (default)', async () => {
    const projectDir = path.join(tmpDir, 'projects', 'test-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
title: Test Project
project_slug: test-project
created: 2025-01-15
repository:
  path: /tmp/test-repo
  name: test-repo
---

# Test Project`
    );

    const result = await listRecentProjects({ detail: 'summary' }, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('1 recent project(s)');
    expect(result.content[0].text).toContain('Test Project');
    expect(result.content[0].text).toContain('/tmp/test-repo');
    expect(result.content[0].text).toContain('2025-01-15');
  });

  it('should list projects with minimal detail', async () => {
    const projectDir = path.join(tmpDir, 'projects', 'test-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
title: Test Project
repository:
  path: /tmp/test-repo
  name: test-repo
---

# Test Project`
    );

    const result = await listRecentProjects({ detail: 'minimal' }, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('Test Project');
    expect(result.content[0].text).not.toContain('Repository:');
  });

  it('should respect limit parameter', async () => {
    for (let i = 1; i <= 3; i++) {
      const projectDir = path.join(tmpDir, 'projects', `project-${i}`);
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(
        path.join(projectDir, 'project.md'),
        `---\ntitle: Project ${i}\n---\n\n# Project ${i}`
      );
      // Small delay for different mtimes
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const result = await listRecentProjects({ limit: 2, detail: 'minimal' }, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('2 recent project(s)');
  });

  it('should include recent activity in detailed view', async () => {
    const projectDir = path.join(tmpDir, 'projects', 'test-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
title: Test Project
repository:
  path: /tmp/test-repo
  name: test-repo
created: 2025-01-15
---

# Test Project

## Recent Activity
- abc123: Initial commit
- def456: Add feature X`
    );

    const result = await listRecentProjects({ detail: 'detailed' }, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('Recent commits:');
    expect(result.content[0].text).toContain('abc123: Initial commit');
  });

  it('should include full project page content in full view', async () => {
    const projectDir = path.join(tmpDir, 'projects', 'test-project');
    await fs.mkdir(projectDir, { recursive: true });
    const fullContent = `---
title: Test Project
---

# Test Project

## Overview
Full project description here.`;
    await fs.writeFile(path.join(projectDir, 'project.md'), fullContent);

    const result = await listRecentProjects({ detail: 'full' }, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('Full project description here');
  });

  it('should skip directories without project.md', async () => {
    // Empty project dir (no project.md)
    await fs.mkdir(path.join(tmpDir, 'projects', 'empty-project'), { recursive: true });

    // Proper project dir
    const projectDir = path.join(tmpDir, 'projects', 'real-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---\ntitle: Real Project\n---\n\n# Real Project`
    );

    const result = await listRecentProjects({}, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('1 recent project(s)');
    expect(result.content[0].text).toContain('Real Project');
  });

  it('should use directory name as title when frontmatter has no title', async () => {
    const projectDir = path.join(tmpDir, 'projects', 'my-cool-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---\nstatus: active\n---\n\n# My Cool Project`
    );

    const result = await listRecentProjects({ detail: 'minimal' }, { vaultPath: tmpDir });
    expect(result.content[0].text).toContain('my-cool-project');
  });

  it('should sort projects by modification time (most recent first)', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) {
      const projectDir = path.join(tmpDir, 'projects', name);
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(
        path.join(projectDir, 'project.md'),
        `---\ntitle: ${name}\n---\n\n# ${name}`
      );
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const result = await listRecentProjects({ detail: 'minimal' }, { vaultPath: tmpDir });
    const text = result.content[0].text;
    const gammaIdx = text.indexOf('gamma');
    const betaIdx = text.indexOf('beta');
    const alphaIdx = text.indexOf('alpha');

    // Most recently modified should appear first
    expect(gammaIdx).toBeLessThan(betaIdx);
    expect(betaIdx).toBeLessThan(alphaIdx);
  });
});
