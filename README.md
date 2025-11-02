# Obsidian MCP Server for Claude Code

An MCP (Model Context Protocol) server that enables Claude Code to automatically manage and persist conversation context in an Obsidian vault.

## Features

- **Automatic Session Management**: Creates session notes for each conversation, organized by month
- **Intelligent Search with Semantic Understanding**: Hybrid keyword + embedding-based search using local AI models (no API calls)
- **Topic Pages**: Create and maintain pages for technical concepts
- **Topic Review System**: Find stale topics, review them, and keep knowledge fresh
- **Decision Records**: Track architectural decisions with ADR format
- **Git Integration**: Automatically detect repos, track commits, link code changes to sessions with smart repository detection
- **Project Tracking**: Create project pages for repositories with commit history
- **Smart Linking**: Automatic Obsidian-style wiki links between content
- **Recent Sessions Command**: List the 5 most recent sessions for quick context access
- **Zero Storage Overhead**: Text-based storage uses minimal disk space

## Installation

### Prerequisites

- Node.js >= 18.0.0
- Claude Code installed
- An Obsidian vault (or directory to use as one)

### Setup

1. **Clone or create the project directory:**

```bash
mkdir obsidian-mcp-server
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

Create or edit `~/.config/claude-code/config.json` (or equivalent for your OS):

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

**Important**: Replace `/path/to/obsidian-mcp-server` with the actual path to this project, and `/path/to/your/obsidian-vault` with your Obsidian vault location.

## Multi-Vault Configuration

The MCP server supports multiple vaults for search operations while maintaining a single primary vault for write operations.

### Option 1: Configuration File (Recommended)

Create a `.obsidian-mcp.json` file in the obsidian-mcp-server directory:

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

This config file is automatically discovered by the MCP server regardless of which directory Claude Code is launched from. See `.obsidian-mcp.json.example` for a template.

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

**start_session** - Start a new conversation session
```
Topic: "API Authentication Implementation"
Creates: sessions/2025-10-28_14-30-00_api-authentication-implementation.md
```

**save_session_note** - Save context during conversation
```
Content: "Decided to use JWT with refresh tokens"
Updates: Current session file with key information
```

**close_session** - Mark session as completed
```
Updates session status to 'completed'
```

**list_recent_sessions** - List recent conversation sessions
```
Limit: 5 (default)
Returns: Session metadata including ID, topic, date, and status
Note: Available via /sessions slash command in Claude Code
```

### Search and Retrieval

**search_vault** - Find relevant past context
```
Query: "authentication database schema"
Directories: ["sessions", "topics", "decisions"]
Max results: 10 (default)
Snippets only: true (default)
Returns: Matching notes with context snippets and relevance scores
```

**get_session_context** - Retrieve full session content
```
Session ID: "2025-10-28_14-30-00_api-auth"
Returns: Complete session file content
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
- Disable with: `ENABLE_EMBEDDINGS=false`
- Cache location: `.embedding-cache/embeddings.json` in your vault
- Gracefully falls back to keyword-only search if embeddings fail

**Benefits:**
- Find relevant content even with different wording
- Understand semantic relationships between concepts
- Faster, more accurate context retrieval

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
- `/sessions` - List the 5 most recent conversation sessions
  - Returns session metadata including topic, date, and status
  - Quick way to jump back into previous conversations
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

**link_to_topic** - Create Obsidian wiki link
```
Topic: "Authentication System"
Returns: [[topics/authentication-system|Authentication System]]
Creates topic page if it doesn't exist
```

### Topic Review & Maintenance

**find_stale_topics** - Find topics that need review
```
Age threshold days: 365 (default)
Include never reviewed: true (default)
Returns: List of topics older than threshold
```

**review_topic** - Analyze a topic for outdated content
```
Topic: "JWT Authentication Flow"
Analysis prompt: (optional custom instructions)
Returns: Review analysis with concerns and suggested updates
```

**approve_topic_update** - Apply or dismiss a pending review
```
Review ID: "review_1730123456789_jwt-authentication-flow"
Action: "update" | "keep" | "archive" | "dismiss"
Modified content: (optional edited content)
Updates: Topic with new content and review history
```

**archive_topic** - Move topic to archive
```
Topic: "Legacy API v1"
Reason: "API deprecated and removed"
Moves: topics/legacy-api-v1.md to archive/topics/
```

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

When you start a conversation with Claude Code:

1. **Automatic Context Loading**:
   - Claude Code calls `start_session` with your topic
   - Creates a timestamped session file in `sessions/YYYY-MM/` directory
   - Searches vault for related past context using semantic + keyword search
   - Automatically detects projects you're working on

2. **During Conversation**:
   - Claude automatically saves key points with `save_session_note`
   - Creates topic pages for new concepts with `create_topic_page`
   - Records decisions with `create_decision`
   - Links related concepts together
   - Tracks file access for repository detection

3. **Context Retrieval**:
   - When you ask "what did we discuss about X?"
   - Claude uses `search_vault` with semantic understanding to find relevant notes
   - Hybrid search combines keyword matching with AI-powered concept matching
   - Cites specific sessions and topics with relevance scores

4. **Session Close**:
   - At conversation end, `close_session` is called
   - Session marked as completed
   - Automatically detects Git repositories you accessed
   - Optionally links session to relevant project pages
   - All context preserved for future reference

## Example Session File

```markdown
---
date: 2025-11-01
session_id: 2025-11-01_14-30-00_api-authentication
topics: ["authentication", "jwt", "security"]
decisions: [[002-api-structure]]
status: completed
repository:
  path: /home/user/projects/my-api
  name: my-api
  commits: [abc123, def456]
---

# Session: API Authentication Implementation

## Context
Working on implementing user authentication system for the API.

## Key Points
- Decided to use JWT tokens with refresh token rotation
- Need to implement token blacklisting for logout
- Related to [[topics/authentication-system|Authentication System]]
- Semantic search found 3 related past sessions

## Outcomes
- [[decisions/002-api-structure|Decision 002]]: REST API structure finalized
- Created topic page: [[topics/jwt-tokens|JWT Tokens]]
- Linked session to [[projects/my-api|my-api]] project
- Recorded 2 commits to project
- Next session: Implement token refresh logic

## Code References
- File: `src/auth/jwt.ts`
- Changes: Added token validation and refresh logic
- Related commits: [[projects/my-api/commits/abc123|abc123]], [[projects/my-api/commits/def456|def456]]
```

**File location:** `sessions/2025-11/2025-11-01_14-30-00_api-authentication.md`

**Notable features in this session file:**
- Sessions are stored in monthly subdirectories (`sessions/YYYY-MM/`)
- Repository information automatically populated at session close
- Git commits linked and tracked
- Semantic search results referenced
- Cross-references to projects and commits

## Environment Variables

- `OBSIDIAN_VAULT_PATH`: Path to your Obsidian vault (required)
- `ENABLE_EMBEDDINGS`: Enable semantic search with embeddings (default: `true`)
  - Set to `false` to disable and use keyword-only search
  - Useful if you prefer faster searches or have limited system resources

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

## Roadmap

- [ ] Automatic tagging based on content
- [ ] Session summarization
- [ ] Export to different formats
- [ ] Integration with other note-taking apps
- [ ] Automatic graph relationship extraction
- [ ] Template customization
- [ ] Multi-vault support
