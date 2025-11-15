---
title: "Git Workflow"
created: "2025-01-15"
last_reviewed: "2025-01-15"
tags:
  - "git"
  - "workflow"
  - "version-control"
session: "sessions/2025-01/example-session-2025-01-15"
---

# Git Workflow

Standard Git workflow for development projects.

## Overview

A well-defined Git workflow helps teams collaborate effectively and maintain code quality.

## Branch Strategy

### Main Branches

- **main**: Production-ready code
- **develop**: Integration branch for features

### Supporting Branches

- **feature/***: New features
- **bugfix/***: Bug fixes
- **hotfix/***: Critical production fixes

## Commit Guidelines

### Commit Message Format

```
<type>: <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **refactor**: Code refactoring
- **test**: Adding/updating tests
- **chore**: Maintenance tasks

## Best Practices

1. Commit early and often
2. Write descriptive commit messages
3. Keep commits focused and atomic
4. Use branches for all changes
5. Review code before merging

## Common Commands

```bash
# Create feature branch
git checkout -b feature/new-feature

# Stage changes
git add .

# Commit changes
git commit -m "feat: add new feature"

# Push to remote
git push origin feature/new-feature
```

## Related Topics

- [[topics/typescript-configuration|TypeScript Configuration]]

## Related Projects

- [[projects/obsidian-mcp-server/project|Obsidian MCP Server]]
