---
title: "TypeScript Configuration"
created: "2025-01-15"
last_reviewed: "2025-01-15"
tags:
  - "typescript"
  - "configuration"
  - "tooling"
session: "sessions/2025-01/example-session-2025-01-15"
---

# TypeScript Configuration

Comprehensive guide to TypeScript configuration in Node.js projects.

## Overview

TypeScript provides static type checking for JavaScript projects. Proper configuration is essential for maximizing its benefits.

## Configuration Options

### Compiler Options

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### Key Settings

- **target**: Specify ECMAScript target version
- **module**: Specify module code generation
- **strict**: Enable all strict type-checking options
- **esModuleInterop**: Enables emit interoperability between CommonJS and ES Modules

## Best Practices

1. Always enable `strict` mode
2. Use `skipLibCheck` to speed up compilation
3. Set appropriate `target` based on runtime environment
4. Use path mapping for cleaner imports

## Common Issues

### Module Resolution Errors

If you encounter "Cannot find module" errors, check:
- `moduleResolution` is set to "node"
- File extensions are correct (.ts vs .js)
- Paths are configured correctly

## Related Topics

- [[topics/git-workflow|Git Workflow]]

## Related Projects

- [[projects/obsidian-mcp-server/project|Obsidian MCP Server]]
