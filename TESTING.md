# Testing Guide

Comprehensive testing infrastructure for the Obsidian MCP Server.

## Overview

This project uses [Vitest](https://vitest.dev/) for testing all 27 modularized tools. The test infrastructure includes:

- **Test Helpers** - Reusable utilities for creating mocks and test fixtures
- **Sample Fixtures** - Pre-populated vault content for integration testing
- **Context Builders** - Type-safe mock contexts for different tool categories

## Quick Start

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- trackFileAccess.test.ts

# Run with coverage
npm test -- --coverage

# Run tests for a specific tool category
npm test -- tests/unit/tools/session/
```

## Test Structure

```
tests/
├── helpers/              # Test utilities and context builders
│   ├── context.ts        # Mock context factories
│   ├── vault.ts          # Vault creation and management
│   ├── git.ts            # Git repository utilities
│   └── index.ts          # Re-exports all helpers
├── fixtures/             # Sample content for testing
│   ├── sample-vault/     # Pre-populated vault
│   └── git-repos/        # Sample Git repositories
└── unit/
    ├── tools/            # Tool tests (27 tools)
    │   ├── session/      # Session management tools
    │   ├── search/       # Search and retrieval tools
    │   ├── topics/       # Topic management tools
    │   ├── review/       # Review tools
    │   ├── git/          # Git integration tools
    │   ├── decisions/    # Decision creation tools
    │   └── maintenance/  # Vault maintenance tools
    └── services/         # Service layer tests
```

## Test Helpers

### Context Builders (`tests/helpers/context.ts`)

Create mock contexts for different tool types:

```typescript
import { createSessionToolsContext } from '../helpers/context.js';

const context = createSessionToolsContext({
  vaultPath: '/tmp/test-vault',
  currentSessionId: 'test-session',
  // Override any other properties as needed
});
```

**Available Context Builders:**

- `createSessionToolsContext()` - Session tools (trackFileAccess, closeSession, etc.)
- `createSearchToolsContext()` - Search tools (searchVault, getTopicContext, etc.)
- `createTopicsToolsContext()` - Topics tools (createTopicPage, updateTopicPage, etc.)
- `createReviewToolsContext()` - Review tools (findStaleTopics, reviewTopic, etc.)
- `createGitToolsContext()` - Git tools (createProjectPage, recordCommit, etc.)
- `createDecisionsToolsContext()` - Decision tools (createDecision, etc.)
- `createMaintenanceToolsContext()` - Maintenance tools (vaultCustodian, etc.)

### Vault Utilities (`tests/helpers/vault.ts`)

Manage temporary test vaults:

```typescript
import {
  createTestVault,
  cleanupTestVault,
  createTopicFile,
  readVaultFile,
} from '../helpers/vault.js';

describe('my test', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('my-test');
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  it('should work', async () => {
    await createTopicFile(vaultPath, 'test-topic', 'Test', 'Content');
    const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
    expect(content).toContain('Test');
  });
});
```

**Available Functions:**

- `createTestVault(name?, structure?)` - Create temporary vault
- `cleanupTestVault(vaultPath)` - Remove temporary vault
- `populateTestVault(vaultPath)` - Add sample content
- `createSessionFile(...)` - Create session file
- `createTopicFile(...)` - Create topic file
- `createDecisionFile(...)` - Create decision file
- `createProjectFile(...)` - Create project file
- `createCommitFile(...)` - Create commit file
- `readVaultFile(vaultPath, path)` - Read vault file
- `vaultFileExists(vaultPath, path)` - Check file existence
- `listVaultFiles(vaultPath, dir)` - List files in directory
- `getVaultStats(vaultPath)` - Get vault statistics

### Git Utilities (`tests/helpers/git.ts`)

Manage temporary Git repositories:

```typescript
import {
  createTestGitRepo,
  createTestCommit,
  cleanupTestGitRepo,
} from '../helpers/git.js';

describe('git test', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await createTestGitRepo({
      name: 'test-repo',
      branch: 'main',
    });
  });

  afterEach(async () => {
    await cleanupTestGitRepo(repoPath);
  });

  it('should create commits', async () => {
    const hash = await createTestCommit(repoPath, {
      message: 'Test commit',
      files: { 'test.ts': 'content' },
    });

    expect(hash).toBeDefined();
  });
});
```

**Available Functions:**

- `createTestGitRepo(config?)` - Create temporary Git repo
- `createTestCommit(repoPath, config)` - Make a commit
- `createTestCommits(repoPath, commits)` - Make multiple commits
- `cleanupTestGitRepo(repoPath)` - Remove temporary repo
- `createTestBranch(...)` - Create branch
- `getTestCommitInfo(...)` - Get commit details
- `getTestCommitDiffStats(...)` - Get diff statistics
- `createRealisticTestRepo(name?)` - Create repo with realistic history

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { myTool } from '../../../src/tools/category/myTool.js';
import { createMyToolContext, createTestVault } from '../../helpers/index.js';

describe('myTool', () => {
  let vaultPath: string;
  let context: MyToolContext;

  beforeEach(async () => {
    vaultPath = await createTestVault('my-tool-test');
    context = createMyToolContext({ vaultPath });
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  it('should work correctly', async () => {
    const result = await myTool({ arg: 'value' }, context);
    expect(result).toBeDefined();
  });
});
```

### Example: Testing Session Tools

```typescript
import { trackFileAccess } from '../../../../src/tools/session/trackFileAccess.js';
import { createSessionToolsContext } from '../../../helpers/index.js';

describe('trackFileAccess', () => {
  it('should track file access', async () => {
    const context = createSessionToolsContext();

    await trackFileAccess(
      { path: '/file.ts', action: 'read' },
      context
    );

    expect(context.filesAccessed).toHaveLength(1);
    expect(context.filesAccessed[0]).toMatchObject({
      path: '/file.ts',
      action: 'read',
    });
  });
});
```

### Example: Testing Topics Tools

```typescript
import { createTopicPage } from '../../../../src/tools/topics/createTopicPage.js';
import {
  createTopicsToolsContext,
  createTestVault,
  readVaultFile,
} from '../../../helpers/index.js';

describe('createTopicPage', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('topic-test');
  });

  it('should create topic file', async () => {
    const context = createTopicsToolsContext({ vaultPath });

    await createTopicPage(
      { topic: 'Test Topic', content: 'Content' },
      context
    );

    const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
    expect(content).toContain('Test Topic');
  });
});
```

### Example: Testing Git Tools

```typescript
import { createProjectPage } from '../../../../src/tools/git/createProjectPage.js';
import {
  createGitToolsContext,
  createTestGitRepo,
} from '../../../helpers/index.js';

describe('createProjectPage', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await createTestGitRepo();
  });

  it('should create project page', async () => {
    const context = createGitToolsContext();

    await createProjectPage(
      { repo_path: repoPath },
      context
    );

    expect(context.trackProjectCreation).toHaveBeenCalled();
  });
});
```

## Sample Fixtures

The `tests/fixtures/sample-vault/` directory contains pre-populated content for integration testing:

- **Sessions**: Example session files with frontmatter and links
- **Topics**: Technical documentation examples
- **Decisions**: ADR examples with full structure
- **Projects**: Project page examples with commits

Use these fixtures for integration tests that need realistic vault content:

```typescript
const sampleVaultPath = '/path/to/tests/fixtures/sample-vault';
const content = await readVaultFile(
  sampleVaultPath,
  'sessions/2025-01/example-session.md'
);
```

## Best Practices

### 1. Clean Up Resources

Always clean up temporary vaults and repositories:

```typescript
afterEach(async () => {
  await cleanupTestVault(vaultPath);
  await cleanupTestGitRepo(repoPath);
});
```

### 2. Use Context Isolation

Create fresh contexts for each test to avoid state pollution:

```typescript
beforeEach(() => {
  context = createSessionToolsContext(); // Fresh context per test
});
```

### 3. Test Both Success and Error Cases

```typescript
describe('myTool', () => {
  it('should work with valid input', async () => {
    // Test success case
  });

  it('should reject invalid input', async () => {
    await expect(myTool({ invalid: 'args' }, context))
      .rejects.toThrow('Expected error message');
  });
});
```

### 4. Test Edge Cases

```typescript
it('should handle empty arrays', async () => {
  // Test with empty input
});

it('should handle very long strings', async () => {
  const longString = 'x'.repeat(10000);
  // Test with large input
});

it('should handle special characters', async () => {
  const special = 'path/with spaces/file@123.ts';
  // Test with special characters
});
```

### 5. Use Descriptive Test Names

```typescript
// Good
it('should track file access with read action', async () => {});
it('should reject investigation-style topic titles', async () => {});

// Bad
it('works', async () => {});
it('test 1', async () => {});
```

## Coverage Goals

Target test coverage thresholds (configured in `vitest.config.ts`):

- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 80%
- **Statements**: 80%

View coverage report:

```bash
npm test -- --coverage
```

## Continuous Integration

Tests run automatically on:

- Pull requests
- Commits to main branch
- Pre-commit hooks (if configured)

## Troubleshooting

### Tests Fail Due to Leftover Temp Files

Clean up manually:

```bash
rm -rf /tmp/test-vault-*
rm -rf /tmp/git-repo-*
```

### Mock Functions Not Working

Ensure you're using Vitest's `vi.fn()`:

```typescript
import { vi } from 'vitest';

const mockFn = vi.fn().mockResolvedValue('result');
```

### File Permission Errors

Ensure temp directories are writable:

```bash
chmod -R 755 /tmp/test-vault-*
```

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Test Helpers README](./tests/helpers/README.md)
- [Example Tests](./tests/unit/tools/)

## Contributing

When adding new tools:

1. Create corresponding test file in `tests/unit/tools/[category]/`
2. Use appropriate context builder from `tests/helpers/context.ts`
3. Add test coverage for all public functions
4. Include edge case tests
5. Ensure cleanup in `afterEach` hooks
