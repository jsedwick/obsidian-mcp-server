# Obsidian MCP Server for Claude Code

An MCP (Model Context Protocol) server that enables Claude Code to automatically manage and persist conversation context in an Obsidian vault.

## Features

- **Automatic Session Management**: Creates session notes for each conversation
- **Intelligent Search**: Search across all vault content for relevant context
- **Topic Pages**: Create and maintain pages for technical concepts
- **Topic Review System**: Find stale topics, review them, and keep knowledge fresh
- **Decision Records**: Track architectural decisions with ADR format
- **Git Integration**: Automatically detect repos, track commits, link code changes to sessions
- **Project Tracking**: Create project pages for repositories with commit history
- **Smart Linking**: Automatic Obsidian-style wiki links between content
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
├── sessions/              # Individual conversation sessions
│   ├── 2025-10-28_14-30-00_api-auth.md
│   └── 2025-10-28_15-45-00_database-design.md
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
└── index.md              # Vault overview
```

## Example Session Workflow

When you start a conversation with Claude Code:

1. **Automatic Context Loading**:
   - Claude Code calls `start_session` with your topic
   - Creates a timestamped session file
   - Searches vault for related past context

2. **During Conversation**:
   - Claude automatically saves key points with `save_session_note`
   - Creates topic pages for new concepts with `create_topic_page`
   - Records decisions with `create_decision`
   - Links related concepts together

3. **Context Retrieval**:
   - When you ask "what did we discuss about X?"
   - Claude uses `search_vault` to find relevant notes
   - Cites specific sessions and topics

4. **Session Close**:
   - At conversation end, `close_session` is called
   - Session marked as completed
   - All context preserved for future reference

## Example Session File

```markdown
---
date: 2025-10-28
session_id: 2025-10-28_14-30-00_api-authentication
topics: ["authentication", "jwt", "security"]
decisions: [[002-api-structure]]
status: completed
---

# Session: API Authentication Implementation

## Context
Working on implementing user authentication system for the API.

## Key Points
- Decided to use JWT tokens with refresh token rotation
- Need to implement token blacklisting for logout
- Related to [[topics/authentication-system|Authentication System]]

## Outcomes
- [[decisions/002-api-structure|Decision 002]]: REST API structure finalized
- Created topic page: [[topics/jwt-tokens|JWT Tokens]]
- Next session: Implement token refresh logic

## Code References
- File: `src/auth/jwt.ts`
- Changes: Added token validation and refresh logic
```

## Environment Variables

- `OBSIDIAN_VAULT_PATH`: Path to your Obsidian vault (required)

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
