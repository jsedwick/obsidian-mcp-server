/**
 * projectSlug utility unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  generateProjectSlug,
  findExistingProjectSlug,
  getOrGenerateProjectSlug,
} from '../../../src/utils/projectSlug.js';

describe('generateProjectSlug', () => {
  describe('Remote-based slug generation', () => {
    describe('GitHub URLs', () => {
      it('should generate slug from HTTPS GitHub URL', () => {
        const slug = generateProjectSlug('/Users/test/my-repo', 'https://github.com/user/my-repo');
        expect(slug).toBe('github-user-my-repo');
      });

      it('should generate slug from SSH GitHub URL', () => {
        const slug = generateProjectSlug('/Users/test/my-repo', 'git@github.com:user/my-repo.git');
        expect(slug).toBe('github-user-my-repo');
      });

      it('should handle GitHub URLs with .git suffix', () => {
        const slug = generateProjectSlug(
          '/Users/test/my-repo',
          'https://github.com/user/my-repo.git'
        );
        expect(slug).toBe('github-user-my-repo');
      });

      it('should handle organization repositories', () => {
        const slug = generateProjectSlug(
          '/Users/test/project',
          'https://github.com/my-org/cool-project'
        );
        expect(slug).toBe('github-my-org-cool-project');
      });
    });

    describe('GitLab URLs', () => {
      it('should generate slug from HTTPS GitLab URL', () => {
        const slug = generateProjectSlug('/Users/test/my-repo', 'https://gitlab.com/user/my-repo');
        expect(slug).toBe('gitlab-user-my-repo');
      });

      it('should generate slug from SSH GitLab URL', () => {
        const slug = generateProjectSlug('/Users/test/my-repo', 'git@gitlab.com:user/my-repo.git');
        expect(slug).toBe('gitlab-user-my-repo');
      });

      it('should handle nested group paths', () => {
        const slug = generateProjectSlug(
          '/Users/test/project',
          'https://gitlab.com/company/team/my-project'
        );
        expect(slug).toBe('gitlab-company-team-my-project');
      });
    });

    describe('Enterprise Git URLs', () => {
      it('should generate slug from UO Git URL (Bitbucket/Stash)', () => {
        const slug = generateProjectSlug(
          '/Users/test/my-app',
          'https://git.uoregon.edu/projects/JSDEV/repos/my-app/browse'
        );
        expect(slug).toBe('uoregon-jsdev-my-app');
      });

      it('should handle SSH protocol URLs', () => {
        const slug = generateProjectSlug(
          '/Users/test/my-repo',
          'ssh://git@git.uoregon.edu/jsdev/my-repo.git'
        );
        expect(slug).toBe('uoregon-jsdev-my-repo');
      });

      it('should handle custom enterprise Git hosts', () => {
        const slug = generateProjectSlug(
          '/Users/test/project',
          'https://git.company.com/team/awesome-project'
        );
        expect(slug).toBe('company-team-awesome-project');
      });
    });

    describe('Edge cases', () => {
      it('should handle URLs with trailing slashes', () => {
        const slug = generateProjectSlug('/Users/test/my-repo', 'https://github.com/user/my-repo/');
        expect(slug).toBe('github-user-my-repo');
      });

      it('should normalize mixed case in URLs', () => {
        const slug = generateProjectSlug('/Users/test/MyRepo', 'https://github.com/User/MyRepo');
        expect(slug).toBe('github-user-myrepo');
      });

      it('should handle special characters in repo names', () => {
        const slug = generateProjectSlug(
          '/Users/test/my-cool-repo',
          'https://github.com/user/my.cool_repo-123'
        );
        expect(slug).toBe('github-user-my-cool-repo-123');
      });

      it('should handle URLs with /browse suffix (Bitbucket)', () => {
        const slug = generateProjectSlug(
          '/Users/test/app',
          'https://bitbucket.org/company/app/browse'
        );
        expect(slug).toBe('bitbucket-company-app');
      });

      it('should handle URLs with /tree/main suffix (GitHub)', () => {
        const slug = generateProjectSlug(
          '/Users/test/repo',
          'https://github.com/user/repo/tree/main'
        );
        expect(slug).toBe('github-user-repo');
      });
    });

    describe('Collision prevention', () => {
      it('should generate different slugs for same repo name on different hosts', () => {
        const githubSlug = generateProjectSlug(
          '/Users/test/my-repo',
          'https://github.com/user/my-repo'
        );
        const gitlabSlug = generateProjectSlug(
          '/Users/test/my-repo',
          'https://gitlab.com/user/my-repo'
        );

        expect(githubSlug).toBe('github-user-my-repo');
        expect(gitlabSlug).toBe('gitlab-user-my-repo');
        expect(githubSlug).not.toBe(gitlabSlug);
      });

      it('should generate different slugs for different users with same repo name', () => {
        const user1Slug = generateProjectSlug(
          '/Users/test/my-repo',
          'https://github.com/alice/my-repo'
        );
        const user2Slug = generateProjectSlug(
          '/Users/test/my-repo',
          'https://github.com/bob/my-repo'
        );

        expect(user1Slug).toBe('github-alice-my-repo');
        expect(user2Slug).toBe('github-bob-my-repo');
        expect(user1Slug).not.toBe(user2Slug);
      });
    });

    describe('Portability', () => {
      it('should generate same slug for same remote on different paths', () => {
        const slug1 = generateProjectSlug(
          '/Users/alice/Projects/my-repo',
          'https://github.com/user/my-repo'
        );
        const slug2 = generateProjectSlug(
          '/Users/bob/Code/my-repo',
          'https://github.com/user/my-repo'
        );

        expect(slug1).toBe(slug2);
        expect(slug1).toBe('github-user-my-repo');
      });

      it('should survive repo moves when remote is same', () => {
        const beforeMove = generateProjectSlug(
          '/Users/test/Projects/my-repo',
          'https://github.com/user/my-repo'
        );
        const afterMove = generateProjectSlug(
          '/Users/test/Work/my-repo',
          'https://github.com/user/my-repo'
        );

        expect(beforeMove).toBe(afterMove);
      });
    });
  });

  describe('Path-based slug generation (fallback)', () => {
    it('should use path hash when remote is null', () => {
      const slug = generateProjectSlug('/Users/test/my-local-repo', null);

      expect(slug).toMatch(/^my-local-repo-[a-f0-9]{6}$/);
    });

    it('should use path hash when remote is empty string', () => {
      const slug = generateProjectSlug('/Users/test/my-local-repo', '');

      expect(slug).toMatch(/^my-local-repo-[a-f0-9]{6}$/);
    });

    it('should use path hash when remote is "N/A"', () => {
      const slug = generateProjectSlug('/Users/test/my-local-repo', 'N/A');

      expect(slug).toMatch(/^my-local-repo-[a-f0-9]{6}$/);
    });

    it('should generate different hashes for different paths', () => {
      const slug1 = generateProjectSlug('/Users/alice/my-repo', null);
      const slug2 = generateProjectSlug('/Users/bob/my-repo', null);

      expect(slug1).not.toBe(slug2);
      expect(slug1).toMatch(/^my-repo-[a-f0-9]{6}$/);
      expect(slug2).toMatch(/^my-repo-[a-f0-9]{6}$/);
    });

    it('should normalize directory name in fallback slug', () => {
      const slug = generateProjectSlug('/Users/test/My Cool Repo!', null);

      expect(slug).toMatch(/^my-cool-repo-[a-f0-9]{6}$/);
    });

    it('should handle complex paths', () => {
      const slug = generateProjectSlug(
        '/Users/test/Documents/Projects/work/my-experimental-repo',
        null
      );

      expect(slug).toMatch(/^my-experimental-repo-[a-f0-9]{6}$/);
    });

    it('should generate consistent hash for same path', () => {
      const slug1 = generateProjectSlug('/Users/test/my-repo', null);
      const slug2 = generateProjectSlug('/Users/test/my-repo', null);

      expect(slug1).toBe(slug2);
    });
  });

  describe('Invalid or malformed remotes', () => {
    it('should fall back to path hash for unparseable remote URL', () => {
      const slug = generateProjectSlug('/Users/test/my-repo', 'not-a-valid-url');

      expect(slug).toMatch(/^my-repo-[a-f0-9]{6}$/);
    });

    it('should fall back to path hash for incomplete URL', () => {
      const slug = generateProjectSlug('/Users/test/my-repo', 'github.com/user');

      expect(slug).toMatch(/^my-repo-[a-f0-9]{6}$/);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle the obsidian-mcp-server repository', () => {
      const slug = generateProjectSlug(
        '/Users/jsedwick/Projects/obsidian-mcp-server',
        'https://github.com/jsedwick/obsidian-mcp-server'
      );

      expect(slug).toBe('github-jsedwick-obsidian-mcp-server');
    });

    it('should handle UO Git repositories', () => {
      const slug = generateProjectSlug(
        '/Users/jsedwick/Projects/uo-storage-finder',
        'https://git.uoregon.edu/projects/CWSA/repos/uo-storage-finder/browse'
      );

      expect(slug).toBe('uoregon-cwsa-uo-storage-finder');
    });

    it('should handle monorepo with same name in different locations', () => {
      const frontend = generateProjectSlug(
        '/Users/test/work/frontend/my-app',
        'https://github.com/company/my-app-frontend'
      );
      const backend = generateProjectSlug(
        '/Users/test/work/backend/my-app',
        'https://github.com/company/my-app-backend'
      );

      expect(frontend).toBe('github-company-my-app-frontend');
      expect(backend).toBe('github-company-my-app-backend');
      expect(frontend).not.toBe(backend);
    });
  });
});

describe('findExistingProjectSlug', () => {
  let tempDir: string;
  let projectsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-slug-test-'));
    projectsDir = path.join(tempDir, 'projects');
    await fs.mkdir(projectsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should find existing project with new frontmatter format', async () => {
    // Create a project with new format
    const projectDir = path.join(projectsDir, 'my-existing-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
title: My Project
repository:
  path: /Users/test/my-repo
  name: my-repo
  remote: https://github.com/user/my-repo
---
# Project`
    );

    const slug = await findExistingProjectSlug('/Users/test/my-repo', projectsDir);
    expect(slug).toBe('my-existing-project');
  });

  it('should find existing project with old frontmatter format', async () => {
    // Create a project with old format
    const projectDir = path.join(projectsDir, 'old-format-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
project_name: Old Project
repo_path: /Users/test/old-repo
repo_url: https://github.com/user/old-repo
---
# Project`
    );

    const slug = await findExistingProjectSlug('/Users/test/old-repo', projectsDir);
    expect(slug).toBe('old-format-project');
  });

  it('should find existing project with quoted YAML values (old format)', async () => {
    // Regression test for bug where quoted frontmatter values weren't matched
    const projectDir = path.join(projectsDir, 'quoted-format-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
project_name: "Quoted Project"
repo_path: "/Users/test/quoted-repo"
repo_url: "https://github.com/user/quoted-repo"
---
# Project`
    );

    const slug = await findExistingProjectSlug('/Users/test/quoted-repo', projectsDir);
    expect(slug).toBe('quoted-format-project');
  });

  it('should find existing project with quoted YAML values (new format)', async () => {
    // Regression test for bug where quoted frontmatter values weren't matched
    const projectDir = path.join(projectsDir, 'quoted-new-format-project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
title: "My Project"
repository:
  path: "/Users/test/my-quoted-repo"
  name: "my-quoted-repo"
  remote: "https://github.com/user/my-quoted-repo"
---
# Project`
    );

    const slug = await findExistingProjectSlug('/Users/test/my-quoted-repo', projectsDir);
    expect(slug).toBe('quoted-new-format-project');
  });

  it('should return null when no matching project exists', async () => {
    const slug = await findExistingProjectSlug('/Users/test/nonexistent', projectsDir);
    expect(slug).toBeNull();
  });

  it('should return null when projects directory does not exist', async () => {
    const slug = await findExistingProjectSlug('/Users/test/repo', '/nonexistent/path');
    expect(slug).toBeNull();
  });

  it('should handle projects without project.md', async () => {
    // Create a project directory without project.md
    const projectDir = path.join(projectsDir, 'incomplete-project');
    await fs.mkdir(projectDir, { recursive: true });

    const slug = await findExistingProjectSlug('/Users/test/repo', projectsDir);
    expect(slug).toBeNull();
  });

  it('should find correct project among multiple projects', async () => {
    // Create multiple projects
    const project1Dir = path.join(projectsDir, 'project-one');
    const project2Dir = path.join(projectsDir, 'project-two');
    const project3Dir = path.join(projectsDir, 'project-three');

    await fs.mkdir(project1Dir, { recursive: true });
    await fs.mkdir(project2Dir, { recursive: true });
    await fs.mkdir(project3Dir, { recursive: true });

    await fs.writeFile(
      path.join(project1Dir, 'project.md'),
      `---
repository:
  path: /Users/test/repo-one
---`
    );
    await fs.writeFile(
      path.join(project2Dir, 'project.md'),
      `---
repository:
  path: /Users/test/repo-two
---`
    );
    await fs.writeFile(
      path.join(project3Dir, 'project.md'),
      `---
repository:
  path: /Users/test/repo-three
---`
    );

    const slug = await findExistingProjectSlug('/Users/test/repo-two', projectsDir);
    expect(slug).toBe('project-two');
  });
});

describe('getOrGenerateProjectSlug', () => {
  let tempDir: string;
  let projectsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-slug-test-'));
    projectsDir = path.join(tempDir, 'projects');
    await fs.mkdir(projectsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return existing slug when project exists', async () => {
    // Create existing project with path-hash slug (simulating local repo)
    const existingSlug = 'my-repo-abc123';
    const projectDir = path.join(projectsDir, existingSlug);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project.md'),
      `---
repository:
  path: /Users/test/my-repo
---`
    );

    // Even though we now have a remote, should return existing slug
    const slug = await getOrGenerateProjectSlug(
      '/Users/test/my-repo',
      'https://github.com/user/my-repo',
      projectsDir
    );

    expect(slug).toBe(existingSlug);
  });

  it('should generate new slug when no existing project', async () => {
    const slug = await getOrGenerateProjectSlug(
      '/Users/test/new-repo',
      'https://github.com/user/new-repo',
      projectsDir
    );

    expect(slug).toBe('github-user-new-repo');
  });

  it('should generate path-hash slug for local repo without existing project', async () => {
    const slug = await getOrGenerateProjectSlug('/Users/test/local-repo', null, projectsDir);

    expect(slug).toMatch(/^local-repo-[a-f0-9]{6}$/);
  });

  describe('Remote added later scenario', () => {
    it('should preserve existing slug when remote is added', async () => {
      // Simulate: local repo was tracked, then remote added
      const localSlug = 'my-project-def456';
      const projectDir = path.join(projectsDir, localSlug);
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(
        path.join(projectDir, 'project.md'),
        `---
repository:
  path: /Users/test/my-project
---`
      );

      // User adds a remote: git remote add origin https://github.com/user/my-project
      // Next time createProjectPage is called, it should find the existing project
      const slug = await getOrGenerateProjectSlug(
        '/Users/test/my-project',
        'https://github.com/user/my-project', // Remote now exists
        projectsDir
      );

      // Should return existing slug, NOT generate new one
      expect(slug).toBe(localSlug);
      expect(slug).not.toBe('github-user-my-project');
    });

    it('should preserve existing slug even when remote URL changes', async () => {
      // Simulate: project was tracked with one remote, then remote changed
      const existingSlug = 'github-olduser-my-repo';
      const projectDir = path.join(projectsDir, existingSlug);
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(
        path.join(projectDir, 'project.md'),
        `---
repository:
  path: /Users/test/my-repo
  remote: https://github.com/olduser/my-repo
---`
      );

      // User changes remote: git remote set-url origin https://github.com/newuser/my-repo
      const slug = await getOrGenerateProjectSlug(
        '/Users/test/my-repo',
        'https://github.com/newuser/my-repo', // Different remote
        projectsDir
      );

      // Should return existing slug based on path, NOT new one based on changed remote
      expect(slug).toBe(existingSlug);
      expect(slug).not.toBe('github-newuser-my-repo');
    });
  });
});
