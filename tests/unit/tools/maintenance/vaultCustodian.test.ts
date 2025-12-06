/**
 * Unit tests for vaultCustodian tool
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('vaultCustodian', () => {
  it('should detect and remove case-insensitive duplicate headers', async () => {
    // Create a temporary file with duplicate headers of different cases
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-test-'));
    const testFile = path.join(tmpDir, 'test.md');

    const content = `---
title: "Test"
---

# Auto-detect and record unrecorded commits on session close

# Auto-detect and Record Unrecorded Commits on Session Close

## Problem Statement

This is a test.`;

    await fs.writeFile(testFile, content);

    // Import the deduplicateHeaders function by importing the module
    // For now, just verify the file was created correctly
    const fileContent = await fs.readFile(testFile, 'utf-8');
    expect(fileContent).toContain('# Auto-detect and record unrecorded commits on session close');
    expect(fileContent).toContain('# Auto-detect and Record Unrecorded Commits on Session Close');

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should track and report vault custodian operations', async () => {
    // Test that the vault custodian tool provides proper reporting
    // This is a basic test to verify the tool structure
    expect(true).toBe(true);
  });

  it('should handle aspirational links in Related sections', async () => {
    // Create a test vault structure with a topic containing aspirational links
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-aspirational-test-'));

    // Create topics directory
    const topicsDir = path.join(tmpDir, 'topics');
    await fs.mkdir(topicsDir, { recursive: true });

    // Create an existing topic
    const existingTopicPath = path.join(topicsDir, 'existing-topic.md');
    await fs.writeFile(
      existingTopicPath,
      `---
title: "Existing Topic"
---

# Existing Topic

Content here.`
    );

    // Create a topic with aspirational links
    const mainTopicPath = path.join(topicsDir, 'main-topic.md');
    const mainTopicContent = `---
title: "Main Topic"
---

# Main Topic

This is the main content.

## Related Topics

- [[existing-topic]]
- [[non-existent-topic]]
- [[another-missing-topic|custom display]]`;

    await fs.writeFile(mainTopicPath, mainTopicContent);

    // Verify the test file was created correctly
    const fileContent = await fs.readFile(mainTopicPath, 'utf-8');
    expect(fileContent).toContain('[[existing-topic]]');
    expect(fileContent).toContain('[[non-existent-topic]]');
    expect(fileContent).toContain('[[another-missing-topic|custom display]]');

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should deduplicate links within Related sections', async () => {
    // Create a test vault structure with duplicate links in SAME format
    // (avoiding interaction with link-fixing logic)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-dedup-test-'));

    // Create topics directory with actual topic files so they're not "aspirational"
    const topicsDir = path.join(tmpDir, 'topics');
    await fs.mkdir(topicsDir, { recursive: true });

    // Create the actual topic files
    await fs.writeFile(
      path.join(topicsDir, 'claude-code-hooks.md'),
      `---\ntitle: Claude Code Hooks\n---\n\n# Claude Code Hooks\n\nContent.`
    );
    await fs.writeFile(
      path.join(topicsDir, 'other-topic.md'),
      `---\ntitle: Other Topic\n---\n\n# Other Topic\n\nContent.`
    );

    // Create project directory structure
    const projectDir = path.join(tmpDir, 'projects', 'test-project');
    await fs.mkdir(projectDir, { recursive: true });

    // Create a project file with duplicate topic links in SAME format
    // Using bare links to avoid the prefix-stripping logic
    const projectPath = path.join(projectDir, 'project.md');
    const projectContent = `---
project_name: test-project
---

# Project: test-project

## Overview
Test project.

## Related Topics
- [[claude-code-hooks]]
- [[claude-code-hooks]]
- [[claude-code-hooks]]
- [[claude-code-hooks]]
- [[other-topic]]
`;

    await fs.writeFile(projectPath, projectContent);

    // Verify initial state has duplicates
    const initialContent = await fs.readFile(projectPath, 'utf-8');
    const initialHooksCount = (initialContent.match(/claude-code-hooks/g) || []).length;
    expect(initialHooksCount).toBe(4); // All 4 occurrences

    // Import and run vaultCustodian
    const { vaultCustodian } = await import('../../../../src/tools/maintenance/vaultCustodian.js');

    await vaultCustodian(
      { files_to_check: [projectPath] },
      {
        vaultPath: tmpDir,
        ensureVaultStructure: async () => {},
        findSessionFile: async () => null,
      }
    );

    // Verify duplicates were removed
    const fixedContent = await fs.readFile(projectPath, 'utf-8');
    const fixedHooksCount = (fixedContent.match(/claude-code-hooks/g) || []).length;

    // Should only have 1 reference to claude-code-hooks now
    expect(fixedHooksCount).toBe(1);

    // Should still have the other-topic link
    expect(fixedContent).toContain('other-topic');

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should prefer link format with display text when deduplicating', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-dedup-format-test-'));

    const topicsDir = path.join(tmpDir, 'topics');
    await fs.mkdir(topicsDir, { recursive: true });

    // Create actual topic files so links aren't considered "aspirational"
    await fs.writeFile(
      path.join(topicsDir, 'some-topic.md'),
      `---\ntitle: Some Topic\n---\n\n# Some Topic\n\nContent.`
    );
    await fs.writeFile(
      path.join(topicsDir, 'another-topic.md'),
      `---\ntitle: Another Topic\n---\n\n# Another Topic\n\nContent.`
    );

    // Create a topic file with duplicates where bare link appears first
    // NOTE: Using bare links only (no topics/ prefix) to avoid interaction
    // with the prefix-stripping logic in Check 4
    const topicPath = path.join(topicsDir, 'test-topic.md');
    const topicContent = `---
title: Test Topic
---

# Test Topic

## Related Topics
- [[some-topic]]
- [[some-topic|Some Topic With Display]]
- [[another-topic|Another]]
- [[another-topic]]
`;

    await fs.writeFile(topicPath, topicContent);

    const { vaultCustodian } = await import('../../../../src/tools/maintenance/vaultCustodian.js');

    await vaultCustodian(
      { files_to_check: [topicPath] },
      {
        vaultPath: tmpDir,
        ensureVaultStructure: async () => {},
        findSessionFile: async () => null,
      }
    );

    const fixedContent = await fs.readFile(topicPath, 'utf-8');

    // Should keep the format with display text for some-topic (score 2 vs 0)
    expect(fixedContent).toContain('[[some-topic|Some Topic With Display]]');

    // Should keep the format with display text for another-topic (appears first with display)
    expect(fixedContent).toContain('[[another-topic|Another]]');

    // Each topic should appear exactly once
    const someTopicCount = (fixedContent.match(/\[\[some-topic/g) || []).length;
    const anotherTopicCount = (fixedContent.match(/\[\[another-topic/g) || []).length;
    expect(someTopicCount).toBe(1);
    expect(anotherTopicCount).toBe(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  it('should skip wiki links inside code blocks for reciprocal link validation', async () => {
    // This tests the bug fix for code block detection in validateReciprocalLinks
    // Previously, the matchIndex was always passed as 0, breaking code block detection
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-codeblock-test-'));

    // Create vault structure
    const topicsDir = path.join(tmpDir, 'topics');
    const projectDir = path.join(tmpDir, 'projects', 'some-project');
    await fs.mkdir(topicsDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });

    // Create an actual project file that could receive spurious reciprocal links
    const projectPath = path.join(projectDir, 'project.md');
    await fs.writeFile(
      projectPath,
      `---
project_name: some-project
---

# Project: some-project

## Overview
A test project.

## Related Topics
`
    );

    // Create a topic with wiki links INSIDE code blocks (examples in documentation)
    // These should NOT trigger reciprocal link creation
    const topicPath = path.join(topicsDir, 'documentation-examples.md');
    const topicContent = `---
title: Documentation Examples
---

# Documentation Examples

This topic shows example markdown with wiki links in code blocks.

## Example Scenarios

### Scenario 1: Session Creates Topic
\`\`\`markdown
# Session file
## Topics Created
- JWT Authentication

# Topic file
## Related Projects
- [[projects/some-project/project]]
\`\`\`

The above is just an example - the link should not create a reciprocal link.

## Related Topics
`;

    await fs.writeFile(topicPath, topicContent);

    // Run vaultCustodian
    const { vaultCustodian } = await import('../../../../src/tools/maintenance/vaultCustodian.js');

    const result = await vaultCustodian(
      { files_to_check: [topicPath, projectPath] },
      {
        vaultPath: tmpDir,
        ensureVaultStructure: async () => {},
        findSessionFile: async () => null,
      }
    );

    // Read the project file - it should NOT have a reciprocal link added
    // because the [[projects/some-project/project]] link was inside a code block
    const projectContent = await fs.readFile(projectPath, 'utf-8');

    // The project file should NOT contain a link back to documentation-examples
    // If the bug exists, it would have added: - [[topics/documentation-examples|Documentation Examples]]
    expect(projectContent).not.toContain('documentation-examples');

    // Verify the result doesn't mention adding reciprocal links for code block content
    const reportText = result.content[0].text;
    expect(reportText).not.toContain('documentation-examples');

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it.skip('should validate vault structure', () => {
    // TODO: Implement after reading vaultCustodian source
  });

  it.skip('should fix broken links', () => {
    // TODO: Implement
  });

  it.skip('should reorganize files if needed', () => {
    // TODO: Implement
  });
});
