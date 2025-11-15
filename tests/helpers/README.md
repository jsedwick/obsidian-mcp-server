# Test Helpers

Comprehensive test utilities for testing the Obsidian MCP Server tools.

## Overview

This directory contains helper modules for creating test fixtures, mock contexts, and temporary environments for testing the 27 modularized tools.

## Modules

### `context.ts` - Mock Context Builders

Factory functions for creating mock contexts for different tool categories.

#### Available Context Builders

- `createSessionToolsContext()` - For session management tools
- `createSearchToolsContext()` - For search and retrieval tools
- `createTopicsToolsContext()` - For topic creation/management tools
- `createReviewToolsContext()` - For topic review tools
- `createGitToolsContext()` - For Git integration tools
- `createDecisionsToolsContext()` - For decision creation tools
- `createMaintenanceToolsContext()` - For vault maintenance tools

#### Example Usage

```typescript
import { createSessionToolsContext } from '../helpers/context.js';

describe('myTool', () => {
  it('should work', async () => {
    const context = createSessionToolsContext({
      vaultPath: '/tmp/test-vault',
      currentSessionId: 'test-session',
    });

    const result = await myTool(args, context);
    expect(result).toBeDefined();
  });
});
```

#### Utilities

- `slugify(text)` - Convert text to URL-safe slug
- `createFileAccess(path, action, timestamp?)` - Create a file access record
- `createFileAccesses(paths, action)` - Create multiple file access records

### `vault.ts` - Vault Utilities

Utilities for creating and managing temporary test vaults.

#### Core Functions

##### `createTestVault(name?, structure?)`

Create a temporary test vault with proper directory structure.

```typescript
import { createTestVault, cleanupTestVault } from '../helpers/vault.js';

const vaultPath = await createTestVault('my-test', {
  sessions: true,
  topics: true,
  decisions: true,
  projects: true,
});

// Use vault in tests...

await cleanupTestVault(vaultPath);
```

##### `populateTestVault(vaultPath)`

Populate a vault with sample content including sessions, topics, decisions, and projects.

```typescript
const { sessions, topics, decisions, projects } = await populateTestVault(vaultPath);
// Returns paths to all created files
```

#### Content Creation Functions

- `createSessionFile(vaultPath, sessionId, content, metadata?)` - Create a session file
- `createTopicFile(vaultPath, slug, title, content, metadata?)` - Create a topic file
- `createDecisionFile(vaultPath, number, title, content, projectSlug?, metadata?)` - Create a decision file
- `createProjectFile(vaultPath, slug, name, content, metadata?)` - Create a project page
- `createCommitFile(vaultPath, projectSlug, hash, content, metadata?)` - Create a commit file

#### File Operations

- `readVaultFile(vaultPath, relativePath)` - Read a file from vault
- `vaultFileExists(vaultPath, relativePath)` - Check if file exists
- `listVaultFiles(vaultPath, directory)` - List all markdown files in a directory
- `getVaultStats(vaultPath)` - Get statistics about vault contents

#### Example

```typescript
import {
  createTestVault,
  createTopicFile,
  readVaultFile,
  cleanupTestVault,
} from '../helpers/vault.js';

describe('topic creation', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTestVault('topic-test');
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  it('should create a topic file', async () => {
    const topicFile = await createTopicFile(
      vaultPath,
      'test-topic',
      'Test Topic',
      'Topic content here',
      { tags: ['test', 'example'] }
    );

    const content = await readVaultFile(vaultPath, 'topics/test-topic.md');
    expect(content).toContain('Test Topic');
    expect(content).toContain('Topic content here');
  });
});
```

### `git.ts` - Git Utilities

Utilities for creating and managing temporary Git repositories.

#### Core Functions

##### `createTestGitRepo(config?)`

Create a temporary Git repository with optional configuration.

```typescript
import { createTestGitRepo, cleanupTestGitRepo } from '../helpers/git.js';

const repoPath = await createTestGitRepo({
  name: 'test-repo',
  branch: 'main',
  remoteUrl: 'https://github.com/user/test-repo.git',
});

// Use repository in tests...

await cleanupTestGitRepo(repoPath);
```

##### `createTestCommit(repoPath, config)`

Create a test commit with specified files and metadata.

```typescript
const hash = await createTestCommit(repoPath, {
  message: 'Add feature X',
  files: {
    'src/feature.ts': 'export function feature() {}',
    'src/feature.test.ts': 'test("works", () => {})',
  },
  author: 'Test Author',
  email: 'test@example.com',
});
```

##### `createTestCommits(repoPath, commits)`

Create multiple commits in sequence.

```typescript
const hashes = await createTestCommits(repoPath, [
  { message: 'First commit', files: { 'file1.ts': 'content' } },
  { message: 'Second commit', files: { 'file2.ts': 'content' } },
]);
```

#### Branch Operations

- `createTestBranch(repoPath, branchName, fromBranch?)` - Create a new branch
- `checkoutTestBranch(repoPath, branchName)` - Checkout a branch
- `listTestBranches(repoPath)` - List all branches
- `getBranchesContainingCommit(repoPath, hash)` - Get branches containing a commit

#### Repository Information

- `getTestRepoBranch(repoPath)` - Get current branch
- `getTestRepoHead(repoPath)` - Get HEAD commit hash
- `getTestRepoShortHead(repoPath)` - Get short HEAD commit hash
- `getTestCommitInfo(repoPath, hash?)` - Get detailed commit information
- `getTestCommitDiffStats(repoPath, hash?)` - Get diff statistics
- `getTestCommitDiff(repoPath, hash?)` - Get full diff

#### Realistic Test Repository

`createRealisticTestRepo(name?)` - Create a repository with realistic commit history including:
- Initial commit
- Multiple commits on main branch
- Feature branch with commits
- Returns repository path and commit information

```typescript
const { repoPath, commits } = await createRealisticTestRepo('my-project');
// commits: Array<{ hash, message, branch }>
```

#### Example

```typescript
import {
  createTestGitRepo,
  createTestCommit,
  getTestCommitInfo,
  cleanupTestGitRepo,
} from '../helpers/git.js';

describe('git integration', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await createTestGitRepo({ name: 'test-repo' });
  });

  afterEach(async () => {
    await cleanupTestGitRepo(repoPath);
  });

  it('should create and read commits', async () => {
    const hash = await createTestCommit(repoPath, {
      message: 'Test commit',
      files: { 'test.ts': 'content' },
    });

    const info = await getTestCommitInfo(repoPath, hash);
    expect(info.message).toBe('Test commit');
    expect(info.hash).toBe(hash);
  });
});
```

## Best Practices

### 1. Clean Up Resources

Always clean up temporary vaults and repositories in `afterEach` or `afterAll` hooks:

```typescript
let vaultPath: string;

beforeEach(async () => {
  vaultPath = await createTestVault('my-test');
});

afterEach(async () => {
  await cleanupTestVault(vaultPath);
});
```

### 2. Use Specific Context Builders

Use the context builder that matches your tool category:

```typescript
// For session tools
const context = createSessionToolsContext();

// For search tools
const context = createSearchToolsContext();

// For Git tools
const context = createGitToolsContext();
```

### 3. Override Defaults When Needed

Context builders accept partial overrides:

```typescript
const context = createTopicsToolsContext({
  vaultPath: '/custom/path',
  currentSessionId: 'custom-session',
  findRelatedProjects: vi.fn().mockResolvedValue([
    { link: 'projects/my-project', name: 'My Project' },
  ]),
});
```

### 4. Use Sample Fixtures for Integration Tests

The `tests/fixtures/sample-vault/` directory contains sample content for integration testing:

```typescript
import { readVaultFile } from '../helpers/vault.js';

const sampleVaultPath = '/path/to/tests/fixtures/sample-vault';
const sessionContent = await readVaultFile(
  sampleVaultPath,
  'sessions/2025-01/example-session.md'
);
```

### 5. Test Context Isolation

Ensure each test has its own isolated context:

```typescript
describe('parallel tests', () => {
  it('test 1', async () => {
    const context = createSessionToolsContext(); // Fresh context
    // Test logic...
  });

  it('test 2', async () => {
    const context = createSessionToolsContext(); // Fresh context
    // Test logic...
  });
});
```

## Common Patterns

### Testing File Access Tracking

```typescript
import { createSessionToolsContext, createFileAccess } from '../helpers/index.js';

const context = createSessionToolsContext();
await trackFileAccess({ path: '/file.ts', action: 'read' }, context);

expect(context.filesAccessed).toHaveLength(1);
expect(context.filesAccessed[0]).toMatchObject({
  path: '/file.ts',
  action: 'read',
});
```

### Testing Topic Creation

```typescript
import { createTopicsToolsContext, createTestVault } from '../helpers/index.js';

const vaultPath = await createTestVault('topic-test');
const context = createTopicsToolsContext({ vaultPath });

const result = await createTopicPage(
  { topic: 'Test Topic', content: 'Content' },
  context
);

expect(result.content[0].text).toContain('Topic page created');
```

### Testing Git Operations

```typescript
import { createGitToolsContext, createTestGitRepo } from '../helpers/index.js';

const repoPath = await createTestGitRepo();
const context = createGitToolsContext();

const result = await createProjectPage({ repo_path: repoPath }, context);

expect(context.trackProjectCreation).toHaveBeenCalled();
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- trackFileAccess.test.ts

# Run with coverage
npm test -- --coverage
```

## See Also

- `/tests/unit/tools/` - Example tool tests using these helpers
- `/tests/fixtures/sample-vault/` - Sample vault content for testing
- `/vitest.config.ts` - Vitest configuration
