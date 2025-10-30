# Git Integration with Obsidian MCP Server

This document describes the Git integration features that link Claude Code sessions with Git commits and maintain a comprehensive knowledge base in Obsidian.

## Overview

The MCP server now tracks file access during sessions, detects relevant Git repositories, and creates bidirectional links between sessions, commits, and projects in your Obsidian vault.

## New MCP Tools

### 1. track_file_access

Tracks files accessed during a session to help detect relevant repositories.

```typescript
// Called automatically by Claude Code after file operations
track_file_access({
  path: "/absolute/path/to/file.ts",
  action: "edit" | "read" | "create"
})
```

### 2. detect_session_repositories

Analyzes the current session and detects relevant Git repositories based on:
- Files accessed (read/edit/create)
- Session topic matching repo names
- Proximity to working directory

```typescript
detect_session_repositories()
```

**Returns:**
- List of repository candidates with scores
- Recommendation for auto-selection
- Branch and remote information

**Scoring Algorithm:**
- Files modified: +10 points each
- Files read: +5 points each
- Session topic matches repo name: +20 points
- Repo is CWD: +15 points
- CWD within repo: +8 points
- Repo is subdirectory: +5 points

### 3. link_session_to_repository

Links the current session to a specific Git repository.

```typescript
link_session_to_repository({
  repo_path: "/absolute/path/to/repo"
})
```

**Actions:**
- Updates session metadata with repo info
- Records all files accessed during session
- Creates/updates project page in Obsidian
- Establishes bidirectional links

### 4. create_project_page

Creates or updates a project tracking page in Obsidian for a Git repository.

```typescript
create_project_page({
  repo_path: "/absolute/path/to/repo"
})
```

**Creates:**
```
/projects/
  /[repo-slug]/
    project.md         # Project overview with metadata
    /commits/          # Individual commit records
```

### 5. record_commit

Records a Git commit in the Obsidian vault with full context.

```typescript
record_commit({
  repo_path: "/absolute/path/to/repo",
  commit_hash: "abc123def456"
})
```

**Creates:**
- Commit page with full diff
- Links to session and project
- Updates project activity timeline
- Adds commit reference to session

## Workflow

### Typical Session with Git Integration

1. **Start Session**
   ```typescript
   start_session({ topic: "Add authentication feature" })
   ```

2. **Work on Code** (file access tracked automatically)
   - Claude reads/edits files
   - File paths and actions recorded

3. **Close Session** (auto-detects repositories)
   ```typescript
   close_session()
   // Automatically detects Git repos and shows recommendations
   ```

   **Output Example:**
   ```
   Session closed: 2025-10-30_11-40-22_add-auth-feature

   📦 Git Repository Detected:
      api-server (score: 85)
      Path: /Users/name/project/api-server
      Branch: main
      Reasons: 3 file(s) modified, Session topic matches repo name

   💡 Recommendation: Create a commit for this work
      To link and commit:
      1. link_session_to_repository (path: /Users/name/project/api-server)
      2. Create your git commit
      3. record_commit (with the commit hash)
   ```

4. **Link to Repository** (if you want to commit)
   ```typescript
   link_session_to_repository({
     repo_path: "/Users/name/project/api-server"
   })
   // Creates project page, updates session metadata
   ```

5. **Create Git Commit** (via Claude Code)
   ```bash
   git add .
   git commit -m "feat(auth): Add authentication feature

   Session: 2025-10-30_exploring-auth
   ..."
   ```

6. **Record Commit in Obsidian**
   ```typescript
   record_commit({
     repo_path: "/Users/name/project/api-server",
     commit_hash: "abc123def"
   })
   // Creates commit page with diff, links everything
   ```

### Alternative: Manual Detection

If you want to detect repositories before closing:

```typescript
detect_session_repositories()
// Returns detailed list of all repository candidates
```

## Obsidian Vault Structure

```
/sessions/
  2025-10-30_exploring-auth.md      # Session file
    ├─ metadata with repo link
    └─ files_accessed list

/projects/
  /api-server/
    project.md                       # Project overview
      ├─ Repository info
      ├─ Recent activity
      └─ Related sessions
    /commits/
      abc123d.md                     # Commit record
        ├─ Full diff
        ├─ Session link
        └─ Stats

/topics/
  authentication.md                  # Technical topics
    └─ Links to related sessions/commits
```

## Session Metadata Format

After linking to a repository, sessions include:

```yaml
---
date: 2025-10-30
session_id: 2025-10-30_exploring-auth
topics: [authentication]
status: ongoing
repository:
  path: /Users/name/project/api-server
  name: api-server
  commits: [abc123def]
files_accessed:
  - path: /Users/name/project/api-server/src/auth.ts
    action: edit
    timestamp: 2025-10-30T15:23:45Z
  - path: /Users/name/project/api-server/src/index.ts
    action: edit
    timestamp: 2025-10-30T15:24:12Z
---
```

## Commit Message Format

Recommended format for commits with session links:

```
<type>(<scope>): <short description>

<detailed description>

Session: 2025-10-30_exploring-auth
  Obsidian: obsidian://vault/Claude/sessions/2025-10-30_exploring-auth
  File: file:///path/to/vault/sessions/2025-10-30_exploring-auth.md

Files modified (3 files, +156, -23):
- src/auth.ts (+89, -12)
- src/middleware.ts (+52, -0)
- package.json (+15, -11)

Co-authored-by: Claude <noreply@anthropic.com>
Generated via Claude Code Session
```

## Benefits

### For Users
- Complete audit trail of all development work
- Easy to find "why" changes were made
- Searchable history across sessions
- Persistent context even if repos are deleted

### For Claude
- Awareness of iterative changes across sessions
- Can reference past decisions and patterns
- Learns project structure over time
- Better context for future sessions

## Next Steps

1. **Restart MCP Server** to enable new tools
2. **Test with a session** involving code changes
3. **Create first commit** with session links
4. **Explore** the generated Obsidian pages

## Troubleshooting

### "No Git repositories found"
- Ensure you're running in a directory containing or near a Git repo
- Check that `.git` directories are accessible
- Try running from project root

### "Not a valid Git repository"
- Verify the path is correct
- Ensure `.git` directory exists
- Check repository isn't corrupted

### Tools not available
- Restart the MCP server after building
- Check Claude Code MCP configuration
- Verify the server built successfully with `npm run build`

## Configuration

The MCP server uses these environment variables:

```bash
OBSIDIAN_VAULT_PATH=/path/to/your/vault  # Required
PWD=/current/working/directory           # Auto-detected
```

## Auto-Detection on Session Close

**NEW:** As of the latest update, `close_session` automatically detects Git repositories and provides recommendations.

### How It Works

When you close a session:

1. **Checks for file access** - If no files were accessed, no detection runs
2. **Scans for Git repositories** - Searches current directory and subdirectories
3. **Scores repositories** - Uses the same algorithm as `detect_session_repositories`
4. **Shows top recommendation** - Displays the highest-scored repo with next steps

### When Detection Appears

- ✅ **Shows detection:** Files were read/edited during the session
- ❌ **Skips detection:** Session had no file access (research/planning session)
- 🔕 **Silent failure:** Detection errors don't break session close

### Example Output

**Single clear winner:**
```
Session closed: 2025-10-30_11-40-22_implementing-auth

📦 Git Repository Detected:
   api-server (score: 85)
   Path: /Users/name/project/api-server
   Branch: main
   Reasons: 3 file(s) modified, Session topic matches repo name

💡 Recommendation: Create a commit for this work
   To link and commit:
   1. link_session_to_repository (path: /Users/name/project/api-server)
   2. Create your git commit
   3. record_commit (with the commit hash)
```

**Multiple candidates:**
```
Session closed: 2025-10-30_11-40-22_exploring-monorepo

📦 Git Repository Detected:
   monorepo (score: 35)
   Path: /Users/name/monorepo
   Branch: main
   Reasons: 2 file(s) read, CWD is within this repo

💡 Multiple repositories detected (3)
   Run detect_session_repositories to see all options
```

## Future Enhancements

- ~~Automatic file tracking (hook into Claude Code file operations)~~ ✅ **Implemented**
- ~~Auto-detect repositories on session close~~ ✅ **Implemented**
- Smart commit message generation from session content
- Pull request integration
- Branch tracking and visualization
- Conflict detection across sessions
- Team collaboration features
