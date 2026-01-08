# Obsidian MCP Server for Claude Code

An MCP (Model Context Protocol) server that enables Claude Code to automatically manage and persist conversation context in an Obsidian vault.

## Features

- **Two-Phase Close Workflow**: Automatic commit impact analysis when closing sessions - detects code changes, suggests documentation updates, keeps docs in sync with codebase
- **Lazy Session Management**: Creates session notes retroactively when you run `/close`, organized by month
- **Inverted Index Search**: BM25-based indexed search for 20-50x faster queries on large vaults (10k+ files), with automatic fallback to linear search
- **Intelligent Search with Semantic Understanding**: Hybrid keyword + embedding-based search using local AI models (no API calls)
- **Tiered Response Levels**: Control verbosity with minimal/summary/detailed/full response modes for efficient token usage
- **AI-Powered Analysis**: Sub-agent integration for topic analysis and auto-tagging
- **Git Commit Impact Analysis**: Automatic analysis of commits to identify documentation updates and architectural implications
- **Topic Pages**: Create and maintain pages for technical concepts with review tracking
- **Topic Maintenance**: Find stale topics and archive outdated content
- **Decision Records**: Track architectural decisions with ADR format, supporting vault-level and project-specific scoping
- **Vault Maintenance**: Automatic integrity checking and file organization with vault custodian (runs automatically on session close)
- **Git Integration**: Automatically detect repos, track commits, link code changes to sessions with smart repository detection
- **Project Tracking**: Create project pages for repositories with commit history and branch information
- **Smart Linking**: Automatic Obsidian-style wiki links between content
- **Recent Sessions Command**: List recent sessions via `/sessions` slash command with configurable detail levels
- **Recent Projects Command**: List recent projects via `/projects` slash command with configurable detail levels
- **Memory Continuity**: Memory base loading via `/mb` command for session start (directives, user reference, handoffs, corrections)
- **Zero Storage Overhead**: Text-based storage uses minimal disk space

## Installation

### Quick Install (macOS)

**Automated installer** - Sets up everything in one command:

```bash
git clone https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse obsidian-mcp-server
cd obsidian-mcp-server
./install-macos.sh
```

The installer will:
- ✅ Clone configuration and hooks repositories
- ✅ Install Claude Code settings and slash commands
- ✅ Set up hooks for extended functionality
- ✅ Build the MCP server
- ✅ Create vault directory structure
- ✅ Configure Claude Code MCP integration
- ✅ Provide detailed explanations for every file created

**Options:**
```bash
./install-macos.sh --help              # Show help
./install-macos.sh --dry-run           # Preview without making changes
./install-macos.sh --vault-path PATH   # Custom vault location
./install-macos.sh --skip-clone        # Skip cloning repos (if already done)
```

**Note:** The installer provides verbose output explaining every file created and its purpose. Perfect for understanding the system architecture!

---

### Manual Installation

For Linux/Windows or if you prefer manual setup:

#### Prerequisites

- Node.js >= 18.0.0
- Claude Code installed
- An Obsidian vault (or directory to use as one)

#### Essential Repositories to Clone

Before setting up the MCP server, clone these two repositories:

#### 1. Configuration Repository

Contains your Claude Code settings, slash commands, and global instructions:

```bash
git clone https://git.uoregon.edu/projects/JSDEV/repos/claude-code-config/browse ~/claude-code-config
```

This repository includes:
- `settings.json` - Claude Code settings and preferences
- `commands/` - Custom slash commands for Claude Code
- `CLAUDE.md` - Global instructions for Claude Code

#### 2. Hooks Repository

Contains hook configurations that extend Claude Code functionality:

```bash
git clone https://git.uoregon.edu/projects/JSDEV/repos/claude-code-hooks/browse ~/claude-code-hooks
```

This repository enables advanced features like:
- Pre-commit hooks for validation
- Integration scripts
- Custom Claude Code behaviors

### Setup

1. **Clone the MCP Server repository:**

```bash
git clone https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse obsidian-mcp-server
cd obsidian-mcp-server
```

2. **Install dependencies:**

```bash
npm install
```

3. **Build the project:**

```bash
npm run build
```

4. **Configure Claude Code to use the MCP server:**

Create or edit your Claude Code config file:
- **macOS**: `~/Library/Application Support/Claude/config.json`
- **Linux**: `~/.config/claude-code/config.json`
- **Windows**: `%APPDATA%\Claude\config.json`

Add this configuration (replace paths with your actual paths):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/obsidian-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/your/obsidian-vault"
      }
    }
  }
}
```

**Important**:
- Replace `/path/to/obsidian-mcp-server` with the actual path to the MCP server repository
- Replace `/path/to/your/obsidian-vault` with your Obsidian vault location
- Use absolute paths, not relative paths

## Multi-Vault Configuration

The MCP server supports multiple vaults for search operations while maintaining a single primary vault for write operations.

### Option 1: Configuration File (Recommended)

Create a `.obsidian-mcp.json` file in any of these locations (checked in order):

1. **Project directory**: `./obsidian-mcp-server/.obsidian-mcp.json`
2. **User home directory**: `~/.obsidian-mcp.json`
3. **User config directory**: `~/.config/.obsidian-mcp.json` (Linux/macOS)

Example configuration:

```json
{
  "primaryVault": {
    "path": "/Users/yourusername/Documents/Obsidian/MainVault",
    "name": "Main Vault"
  },
  "secondaryVaults": [
    {
      "path": "/Users/yourusername/Documents/Obsidian/WorkVault",
      "name": "Work Vault"
    },
    {
      "path": "/Users/yourusername/Documents/Obsidian/PersonalVault",
      "name": "Personal Vault"
    }
  ]
}
```

**Benefits of config file:**
- ✅ Works from any directory (automatically discovered)
- ✅ Persisted across Claude Code restarts
- ✅ Easy to share or version control
- ✅ Overrides environment variables

See `.obsidian-mcp.json.example` for a template.

### Option 2: Environment Variables

Alternatively, you can configure multiple vaults via environment variables in your Claude Code config:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/obsidian-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/primary/vault",
        "OBSIDIAN_VAULT_NAME": "Main Vault",
        "OBSIDIAN_SECONDARY_VAULTS": "/path/to/vault2,/path/to/vault3"
      }
    }
  }
}
```

### Multi-Vault Behavior

- **Primary Vault**: Used for all write operations (sessions, topics, decisions, projects)
- **Secondary Vaults**: Read-only, used for search operations only
- **Search Results**: Will indicate which vault each result comes from
- **Automatic Detection**: The config file is checked first, then falls back to environment variables

## Usage

Once configured, Claude Code will automatically have access to these tools:

### Session Management

**close_session** - Create a session retroactively with automatic commit impact analysis
```
Summary: "Implemented JWT authentication with refresh token rotation"
Topic: "API Authentication" (optional)
Creates: sessions/2025-11/2025-11-09_api-authentication.md
Links: All topics, decisions, and projects created during conversation
Runs: Vault custodian to validate created/edited files
Detects: Git repositories based on files accessed

Two-Phase Workflow (automatic):
  Phase 1 - Commit Analysis (if commits detected since session start):
    1. Detects commits made during session using session start time
    2. Analyzes each commit's impact using analyze_commit_impact
    3. Suggests topic updates based on code changes
    4. Returns session_data and waits for topic updates

  Phase 2 - Finalization (after topic updates or if no commits):
    1. Writes session file to sessions/YYYY-MM/
    2. Runs vault_custodian on all created/edited files
    3. Clears session state for next conversation

  Benefits:
    - Documentation stays current with codebase
    - No race conditions (custodian runs AFTER edits)
    - Prompts for doc updates (prevents drift)

Note: ONLY callable via /close slash command
Sessions are created lazily - no session file until you explicitly run /close
```

**list_recent_sessions** - List recent conversation sessions
```
Limit: 5 (default)
Detail: 'summary' (default) | 'minimal' | 'detailed' | 'full'
Returns: Session metadata including ID, topic, date, and status
  - minimal: IDs only
  - summary: + date/status (default)
  - detailed: + files/commits
  - full: + summaries

Note: Available via /sessions slash command in Claude Code
```

### Search and Retrieval

**search_vault** - Find relevant past context
```
Query: "authentication database schema"
Directories: ["sessions", "topics", "decisions"] (optional)
Max results: 10 (default)
Detail: 'summary' (default) | 'minimal' | 'detailed' | 'full'
Snippets only: true (default, legacy parameter)
Returns: Matching notes with context snippets and relevance scores
  - minimal: Files only
  - summary: + snippets (default)
  - detailed: + extended context
  - full: Complete matches

Note: Uses hybrid keyword + semantic search with local embeddings
```

**get_session_context** - Retrieve full session content
```
Session ID: "2025-10-28_14-30-00_api-auth"
Returns: Complete session file content
```

**get_topic_context** - Load full authoritative topic content
```
Topic: "authentication-system" or "Authentication System"
Returns: Complete topic file content with frontmatter

Use when:
  - You need comprehensive understanding of a concept
  - Search snippets are insufficient
  - Multiple follow-up questions expected
  - User asks for in-depth explanation

Best practice: Search first to identify relevant topics, then load full content
```

### Memory & Continuity

**get_memory_base** - Load session context at startup
```
Parameters: None
Returns: System directives, user reference, recent handoffs, and corrections

Side effects:
  - Sets explicit session start time (used for commit detection)
  - Clears session state for fresh tracking

Usage: Automatically invoked via /mb slash command at session start
Provides: Recent files by category (topics, decisions, sessions, projects)
```

**generate_vault_index** - Generate procedural file index for memory base
```
Max files: 100 (default)
Max size bytes: 10240 (default)
Include tags: true (default)
Include description: false (default)

Creates: Index in memory-base.md organized by:
  - Topics, decisions, sessions, projects
  - Sorted by modification date (most recent first)
  - Tags and descriptions for context

Usage: Automatically run after session close to update index
```

## Advanced Features

### Semantic Search with Local Embeddings

The `search_vault` tool uses a hybrid approach combining keyword matching with semantic understanding:

**How it works:**
- Generates embeddings using a local transformer model (Xenova/all-MiniLM-L6-v2)
- No external API calls - everything runs locally
- Scoring: 60% semantic similarity + 40% keyword relevance
- Intelligent caching of embeddings for performance

**Performance:**
- First search in a session: ~30 seconds (model initialization)
- Subsequent searches: <1 second (embeddings cached)
- Cache size: ~3.2 KB per document (~320 KB for 100-document vault)

**Configuration:**
- Enabled by default
- Disable with: `ENABLE_EMBEDDINGS=false` environment variable
- Cache location: `.embedding-cache/embeddings.json` in your vault
- Gracefully falls back to keyword-only search if embeddings fail

**Benefits:**
- Find relevant content even with different wording
- Understand semantic relationships between concepts
- Faster, more accurate context retrieval

**Toggle Embeddings On/Off:**

Use the `toggle_embeddings` tool to easily enable or disable semantic search without restarting:

```
toggle_embeddings - Enable/disable semantic search
Enabled: true/false (toggle current state if not provided)
Saves configuration to: .embedding-toggle.json in your vault
Effect: Immediate - no server restart needed
```

**Parameters:**
- `enabled` (optional boolean)
  - `true`: Enable semantic search with embeddings
  - `false`: Disable embeddings, use keyword-only search
  - `undefined`: Toggle current state

**Use Cases:**
- **Troubleshooting**: If embeddings are causing issues, disable them instantly
- **Testing**: Compare keyword-only vs semantic search quality
- **Performance**: Reduce overhead on slower systems
- **First-run**: Speed up initial searches before embeddings cache builds

**Storage:**
The toggle state is persisted in `.embedding-toggle.json`:
```json
{
  "enabled": true,
  "lastModified": "2025-11-02T14:30:00.000Z"
}
```

The toggle state is remembered across restarts, so your preference persists. You can also manually edit this file if needed.

### Inverted Index Search (BM25)

The MCP server uses an inverted index with BM25 scoring for dramatically faster search on large vaults:

**How it works:**
- Builds a Trie-based inverted index mapping terms → documents
- Uses industry-standard BM25 ranking algorithm
- Applies field boosting (title 2x, tags 1.5x, frontmatter 1.2x, content 1x)
- Adds exact phrase matching bonus (+15) to match linear search behavior
- Integrates recency scoring for recently modified/reviewed documents
- Automatic fallback to linear search if index unavailable

**Performance:**
- Index build: ~2.2ms per file (646ms for 292 docs)
- First query: ~240ms (loads index from disk)
- Subsequent queries: ~120ms average (in-memory cache)
- Scalability: O(log n) for 10k+ files vs O(n) for linear search
- Expected speedup: 20-50x on large vaults

**Storage:**
- Index location: `.search-index/` in your vault
- Size: ~1.5-2KB per document
- Format: JSONL for human readability
- Includes: inverted index, document store, metadata

**Configuration:**
- Enabled by default (as of Phase 6)
- Index builds lazily on first search
- Automatically detects changes and rebuilds incrementally
- Gracefully falls back to linear search on errors

**Rebuild Index:**
The index rebuilds automatically, but you can force a rebuild if needed:
- Delete `.search-index/` directory
- Next search will trigger full rebuild

**How It's Different from Linear Search:**
- Linear search: reads every file, scores in memory (slower for 1000+ files)
- Indexed search: pre-built index, BM25 scoring, phrase matching (faster for large vaults)
- Both methods produce highly overlapping results (85-95% top-5 match rate)

**Technical Details:**
See [[inverted-index-phase-5-6-implementation-summary]] in topics/ for complete implementation details.

### Improved Search Ranking

The search algorithm ranks results by:
1. **Exact phrase matches** - Highest priority
2. **Semantic similarity** - AI-powered concept matching
3. **Term frequency** - How often search terms appear
4. **Positional weight** - Earlier matches score higher
5. **Filename relevance** - Matching in filenames scores well
6. **Recency** - More recent files score higher
7. **Review status** - Recently reviewed topics prioritized

### Monthly Session Organization

Sessions are automatically organized into monthly directories:
- Sessions from October 2025: `sessions/2025-10/`
- Sessions from November 2025: `sessions/2025-11/`
- Easy to navigate large session collections
- Supports automatic archival of old months

### Automatic Git Repository Detection

When you end a session, the server automatically:
1. Detects which Git repositories you worked with based on file access
2. Scores repositories by relevance (number of files accessed, file types, etc.)
3. Prompts you to link the session to the most relevant repository
4. Creates project pages if needed

The detection algorithm considers:
- Files accessed during the session
- Repository proximity (nearest `.git` directory)
- File types and naming patterns
- Repository metadata

### Slash Command Integration

The MCP server supports Claude Code slash commands for quick access to common features:

**Available slash commands:**
- `/sessions` - List recent conversation sessions (calls list_recent_sessions)
  - Returns session metadata including topic, date, and status
  - Quick way to jump back into previous conversations
  - Only available within Claude Code, not directly as an MCP tool

- `/projects` - List recent projects (calls list_recent_projects)
  - Returns project metadata including name, repo path, and activity
  - Quick way to see tracked repositories
  - Only available within Claude Code, not directly as an MCP tool

- `/close` - Close current session (calls close_session)
  - Creates session file retroactively with summary of work done
  - Automatically links all topics, decisions, and projects created
  - Runs vault custodian to validate files
  - Detects and links relevant Git repositories
  - Only available within Claude Code, not directly as an MCP tool

### Knowledge Management

**create_topic_page** - Document technical concepts
```
Topic: "JWT Authentication Flow"
Content: "Overview of JWT implementation..."
Creates: topics/jwt-authentication-flow.md with metadata and review tracking
```

**update_topic_page** - Add to existing topics
```
Topic: "Database Schema"
Content: "Added user_sessions table..."
Append: true
```

**create_decision** - Record architectural decisions
```
Title: "Use PostgreSQL for primary database"
Content: "Rationale: ACID compliance, JSON support..."
Creates: decisions/001-use-postgresql.md
```

### Topic Review & Maintenance

**list_recent_projects** - List recent projects tracked in vault
```
Limit: 5 (default)
Detail: 'summary' (default) | 'minimal' | 'detailed' | 'full'
Returns: Project metadata including name, repository path, creation date, and activity
  - minimal: Names only
  - summary: + paths/dates (default)
  - detailed: + recent commits
  - full: + full project pages

Note: Available via /projects slash command in Claude Code
```

**find_stale_topics** - Find topics that need review
```
Age threshold days: 365 (default)
Include never reviewed: true (default)
Returns: List of topics older than threshold
```

**archive_topic** - Move topic to archive
```
Topic: "Legacy API v1"
Reason: "API deprecated and removed"
Moves: topics/legacy-api-v1.md to archive/topics/
```

**toggle_embeddings** - Enable/disable semantic search on the fly
```
Enabled: true/false (toggle if not specified)
Effect: Immediate without server restart
Saves: Configuration to .embedding-toggle.json in vault
```

### Vault Maintenance

**vault_custodian** - Verify and maintain vault integrity
```
Files to check: (optional) Array of absolute file paths
  - If not provided: Checks all vault files
  - If provided: Only checks specified files

Checks:
  - Sessions are in date-organized subdirectories (sessions/YYYY-MM/)
  - Session files have proper frontmatter
  - Topics have required metadata (title, created, tags)
  - Project structure is valid (project.md exists)
  - Internal Obsidian links are not broken

Actions:
  - Automatically moves misplaced session files to correct directories
  - Adds missing frontmatter to topic files
  - Reports broken links for manual review

Returns: Detailed report showing issues found, fixes applied, and warnings

Auto-run: Automatically runs during close_session to validate files created/edited in the session
```

The vault custodian runs comprehensive integrity checks and automatically fixes organizational issues. It's automatically invoked when you run `/close` to validate files created or edited during the session, ensuring your vault stays well-organized.

### AI-Powered Analysis

**analyze_topic_content** - Analyze topic content with AI for auto-tagging and insights
```
Content: "Topic content to analyze..."
Topic name: (optional) "Authentication System"
Context: (optional) "Additional context about the topic"

Returns:
  - Structured analysis including:
    * Suggested tags based on content
    * Content summary
    * Key concepts identified
    * Related topics found in vault
    * Potential duplicate topics
    * Content type categorization

Usage:
  - Called automatically by create_topic_page when auto_analyze is enabled
  - Can be called manually to analyze content before creating a topic
  - Helps maintain consistent tagging and discover existing related content
```

This AI-powered tool enhances the vault's intelligence by providing automatic content analysis, helping maintain consistent tagging and discovering related content.

### Git Integration

**track_file_access** - Track files accessed during session
```
Path: "/path/to/project/src/auth.ts"
Action: "read" | "edit" | "create"
Tracks: File access for repository detection
```

**detect_session_repositories** - Auto-detect relevant Git repos
```
Returns: Scored list of Git repositories based on file access and context
```

**link_session_to_repository** - Link session to a Git repo
```
Repo path: "/path/to/project"
Creates: Repository link in session metadata
Updates: Project page with session reference
```

**create_project_page** - Create/update project page for repo
```
Repo path: "/path/to/project"
Creates: projects/[project-name]/project.md with repo info
Structure: Project directory with commits/ subdirectory
```

**record_commit** - Record a Git commit with full details
```
Repo path: "/path/to/project"
Commit hash: "abc123"
Creates: projects/[project-name]/commits/abc123.md with diff
Links: Commit to session and project page
```

**analyze_commit_impact** - AI-powered commit analysis for documentation updates
```
Repo path: "/path/to/project"
Commit hash: "abc123" or "HEAD"
Include diff: (optional) false (default: uses stat summary only)

Returns:
  - Commit summary (hash, author, date, message)
  - Files changed with statistics
  - Related topics/decisions found in vault (automatic search)
  - Impact analysis including:
    * Documentation impact level (1-5)
    * Affected topics that should be updated
    * New topics that should be created
    * Architectural implications
    * Suggested actions for maintaining documentation

Workflow:
  1. Call analyze_commit_impact after making a commit
  2. Review related content automatically found in vault
  3. Review the suggested documentation updates
  4. Follow suggested actions:
     - Update affected topics with new implementation details
     - Create new topics for significant features
     - Link decisions to implementation commits
  5. Use record_commit to persist the commit details

Benefits:
  - Automatic documentation trigger detection
  - Links code changes to conceptual documentation
  - Identifies architectural implications
  - Suggests specific update actions
  - Builds knowledge graph between commits and topics

Impact Levels:
  1 = Minor fix/tweak (no docs needed)
  2 = Small feature/bug fix (update existing docs)
  3 = Notable feature/refactoring (update multiple docs)
  4 = Major feature/architectural change (create new docs)
  5 = Fundamental system redesign (major doc overhaul)
```

**migrate_commit_branches** - Migrate existing commit files to add branch information
```
Project slug: (optional) "obsidian-mcp-server"
Dry run: (optional) false

Adds branch information to commit frontmatter for existing recorded commits.
If project slug is provided, only migrates that project.
If omitted, migrates all projects.

Use dry_run: true to see what would be changed without making changes.
```

## Vault Structure

The MCP server automatically creates and maintains this structure:

```
obsidian-vault/
├── sessions/              # Individual conversation sessions organized by month
│   ├── 2025-10/          # Monthly subdirectories
│   │   ├── 2025-10-28_14-30-00_api-auth.md
│   │   └── 2025-10-28_15-45-00_database-design.md
│   └── 2025-11/          # Current month
│       └── 2025-11-01_09-20-00_feature-discussion.md
├── topics/                # Technical concepts and areas
│   ├── authentication-system.md
│   ├── database-schema.md
│   └── jwt-tokens.md
├── decisions/             # Architectural decision records
│   ├── 001-use-postgresql.md
│   ├── 002-api-structure.md
│   └── 003-deployment-strategy.md
├── projects/              # Git repository tracking
│   └── [project-slug]/
│       ├── project.md     # Project overview and metadata
│       └── commits/       # Individual commit records
│           ├── abc123.md
│           └── def456.md
├── archive/               # Archived content
│   └── topics/           # Archived topics
│       └── deprecated-api.md
├── .embedding-cache/      # Local embedding cache for semantic search
│   └── embeddings.json   # Cached embeddings (regenerated as needed)
└── index.md              # Vault overview
```

## Example Session Workflow

When you have a conversation with Claude Code:

1. **During Conversation**:
   - Work on your task naturally without worrying about sessions
   - Claude creates topic pages for new concepts with `create_topic_page`
   - Records decisions with `create_decision`
   - Links related concepts together
   - Tracks file access for repository detection
   - All content is tracked but no session file created yet

2. **Context Retrieval**:
   - When you ask "what did we discuss about X?"
   - Claude uses `search_vault` with semantic understanding to find relevant notes
   - Hybrid search combines keyword matching with AI-powered concept matching
   - Cites specific sessions and topics with relevance scores
   - Uses tiered response levels for efficient token usage

3. **Session Close** (via `/close` command):
   - When conversation ends, run `/close` to persist the session
   - **Two-Phase Workflow** (if commits were made):
     - **Phase 1**: Detects commits since session start, analyzes impact, suggests topic updates
     - **Claude updates topics** based on code changes
     - **Phase 2**: Finalizes session after topic updates complete
   - **Single-Phase Mode** (if no commits):
     - Creates session file immediately
   - Automatically links all topics, decisions, and projects created during conversation
   - Runs vault custodian to validate files created/edited (after Claude's edits)
   - Automatically detects Git repositories you accessed based on tracked files
   - Optionally links session to relevant project pages
   - All context preserved for future reference

4. **Lazy Session Creation Benefits**:
   - No upfront session overhead for quick questions
   - Only create sessions for conversations worth saving
   - Vault stays clean without dozens of trivial session files
   - Session file includes complete summary of what was accomplished

## Example Session File

```markdown
---
date: 2025-11-01
session_id: 2025-11-01_14-30-00_api-authentication
topics:
  - [[topics/jwt-authentication]]
  - [[topics/token-rotation]]
decisions:
  - [[decisions/vault/002-use-jwt-with-refresh-tokens]]
status: completed
repository:
  path: /home/user/projects/my-api
  name: my-api
  commits: [abc123, def456]
files_accessed:
  - path: /home/user/projects/my-api/src/auth/jwt.ts
    action: edit
    timestamp: 2025-11-01T14:45:00Z
  - path: /home/user/projects/my-api/tests/auth.test.ts
    action: create
    timestamp: 2025-11-01T15:00:00Z
---

# Session: API Authentication Implementation

Created via /close command on 2025-11-01 at 14:30

## Summary

Implemented JWT authentication with refresh token rotation for the API.
Created a secure token management system with automatic token blacklisting
for logout functionality.

## Topics Created

- [[topics/jwt-authentication|JWT Authentication]] - Overview of JWT implementation
- [[topics/token-rotation|Token Rotation]] - Refresh token rotation strategy

## Decisions Made

- [[decisions/vault/002-use-jwt-with-refresh-tokens|Decision 002]]: Use JWT with refresh tokens
  - Considered: Session-based auth vs JWT vs OAuth
  - Chose JWT for scalability and stateless architecture
  - Implemented refresh token rotation for security

## Work Completed

- Implemented JWT token generation and validation
- Added refresh token rotation mechanism
- Created token blacklist for logout
- Wrote comprehensive tests for auth flow
- Documented authentication flow in topics

## Repository Activity

Linked to [[projects/my-api|my-api]] project:
- Commits: [[projects/my-api/commits/abc123|abc123]], [[projects/my-api/commits/def456|def456]]
- Files edited: `src/auth/jwt.ts`, `tests/auth.test.ts`
- Repository auto-detected based on file access patterns

## Vault Maintenance

Vault custodian ran automatically:
- Validated 2 topic pages created
- Validated 1 decision record
- All files properly organized
- No broken links detected
```

**File location:** `sessions/2025-11/2025-11-01_14-30-00_api-authentication.md`

**Notable features in this session file:**
- Created retroactively via `/close` command with a summary
- Sessions are stored in monthly subdirectories (`sessions/YYYY-MM/`)
- Repository information automatically detected from tracked file access
- Git commits linked and tracked
- All topics and decisions created during conversation are linked
- Files accessed during session are tracked
- Vault custodian validation results included
- Cross-references use Obsidian wiki-link format

## Configuration

### Environment Variables

- `OBSIDIAN_VAULT_PATH`: Path to your Obsidian vault (required)
- `ENABLE_EMBEDDINGS`: Enable semantic search with embeddings (default: `true`)
  - Set to `false` to disable and use keyword-only search
  - Useful if you prefer faster searches or have limited system resources
  - Note: `toggle_embeddings` tool overrides this setting at runtime

### Embedding Toggle Configuration

The embedding toggle state is saved to `.embedding-toggle.json` in your vault:

```json
{
  "enabled": true,
  "lastModified": "2025-11-02T14:30:00.000Z"
}
```

This file is automatically created and updated by the `toggle_embeddings` tool. You can also manually edit it to change the embedding state without restarting the server.

## Development

### Watch mode for development:

```bash
npm run watch
```

### Clean build artifacts:

```bash
npm run clean
```

## Storage Considerations

Text-based storage is extremely efficient:

- Average session: 2-5 KB
- 1000 detailed sessions: ~5 MB
- 500 topic pages: ~2-3 MB
- Years of use: < 50 MB

**Tips for optimization:**
- Store code as links to repo files, not inline
- Keep code snippets to relevant excerpts
- Use references rather than duplication

## Integration with Obsidian

All notes are valid Markdown and work seamlessly in Obsidian:

- Wiki-style links: `[[topics/authentication]]`
- YAML frontmatter for metadata
- Tags for organization
- Graph view shows relationships
- Full-text search in Obsidian

## Troubleshooting

### MCP server not starting

1. Check Claude Code config path:
   - macOS: `~/Library/Application Support/Claude/config.json`
   - Linux: `~/.config/claude-code/config.json`
   - Windows: `%APPDATA%\Claude\config.json`

2. Verify paths in config are absolute
3. Ensure the build completed: `npm run build`
4. Check permissions on vault directory

### Session not saving

1. Verify `OBSIDIAN_VAULT_PATH` is set correctly
2. Check directory permissions
3. Ensure session was started with `start_session`

### Search not finding content

1. Verify vault structure exists
2. Check file extensions are `.md`
3. Ensure content is saved in vault directories

### Semantic search issues

**Embeddings taking too long:**
- First search generates the model (~30 seconds) - this is normal
- Subsequent searches use cache (<1 second)
- Model is only initialized once per session

**Embeddings failing or causing errors:**
- Check if transformers.js is installed: `npm list @xenova/transformers`
- Verify network (model downloads on first use)
- Disable embeddings: `ENABLE_EMBEDDINGS=false` environment variable
- Server will gracefully fall back to keyword-only search

**Embedding cache growing too large:**
- Cache is automatically maintained at ~3.2 KB per document
- Safe to manually delete `.embedding-cache/embeddings.json` - it will regenerate
- Cache rebuilds automatically as needed

### Session directory organization

If sessions aren't appearing in monthly directories:
- Ensure `npm run build` has been run recently
- Check that session files have proper frontmatter with date
- Older sessions won't be automatically moved to monthly dirs (only new sessions use this structure)

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Project Status: Phase 1 Refactoring Complete ✅

The Obsidian MCP Server has undergone a comprehensive Phase 1 Architectural Refactoring to ensure production-grade quality and maintainability:

### Completed Improvements

- ✅ **Modular Architecture** (100%): Refactored from 6,000-line monolith into focused, single-responsibility modules
- ✅ **Comprehensive Testing** (80%+ coverage): Unit tests, integration tests, and performance benchmarks
- ✅ **Type Safety** (100%): Full TypeScript strict mode, zero `any` types, runtime validation
- ✅ **Performance Optimization** (3-5x faster): Parallel file operations, intelligent search limiting, optimized caching
- ✅ **Error Handling**: Structured logging with custom error types, graceful degradation
- ✅ **Code Quality**: ESLint, Prettier, pre-commit hooks, automated quality checks

### What This Means for Users

- **Faster**: Search is 3-5x faster, better scalability for large vaults (10,000+ files)
- **Reliable**: Comprehensive tests catch regressions automatically
- **Maintainable**: Clear structure makes it easy to add features and fix bugs
- **Type-Safe**: TypeScript catches errors at compile time, not runtime
- **Professional**: Production-grade codebase with automated quality assurance

### Backward Compatibility

All existing functionality is preserved and enhanced:
- ✅ All 24 MCP tools available (some deprecated tools removed: enhanced_search, link_to_topic, review_topic, approve_topic_update, extract_decisions_from_session)
- ✅ Vault files remain compatible
- ✅ Frontmatter format unchanged
- ✅ Core MCP tool APIs unchanged
- ✅ Automatic migration for existing vaults
- ✅ New two-phase close workflow backward compatible (gracefully handles sessions without commits)

### Future Roadmap

**Phase 2 (Advanced Features):**
- [ ] Session summarization with AI
- [ ] Automatic tagging based on content
- [ ] Export to different formats (JSON, PDF, HTML)
- [ ] Graph visualization API
- [ ] Advanced analytics and insights

**Phase 3 (Integration & Ecosystem):**
- [ ] Integration with other note-taking apps
- [ ] Plugin system for custom tools
- [ ] Cloud sync options
- [ ] Real-time collaboration features
- [ ] Web interface for vault browsing

**Phase 4 (Enterprise):**
- [ ] Team vaults with role-based permissions
- [ ] Audit logging and compliance
- [ ] Advanced search DSL
- [ ] High availability and replication
- [ ] SSO/SAML authentication

## Repository Links

- **Main Server**: https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse
- **Configuration**: https://git.uoregon.edu/projects/JSDEV/repos/claude-code-config/browse (settings, commands, instructions)
- **Hooks**: https://git.uoregon.edu/projects/JSDEV/repos/claude-code-hooks/browse (hook configurations)
