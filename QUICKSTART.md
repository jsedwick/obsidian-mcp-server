> [!warning] STALE — pending Phase 2 installer
> This document predates the claude-chat-bridge + obsidian-claude-plugin refactor and the multi-vault `.obsidian-mcp.json` schema. Install steps here are **no longer accurate** (references retired `claude-code-config`/`claude-code-hooks` repos and `install-macos.sh`). It will be replaced by output from the `npx create-claude-setup` installer. Do not follow these steps.

# Quick Start Guide

Get your Obsidian MCP server running in 10 minutes!

## Prerequisites

You'll need to clone two essential repositories before starting:

### 1. Clone the Claude Code Configuration Repository

This repository contains your `settings.json`, slash commands, and global `CLAUDE.md` instructions:

```bash
# Clone the configuration repository to your home directory
git clone https://git.uoregon.edu/projects/JSDEV/repos/claude-code-config/browse ~/claude-code-config

# Or if you prefer a different location:
git clone https://git.uoregon.edu/projects/JSDEV/repos/claude-code-config/browse /path/to/config

# The repository should contain:
# - settings.json (Claude Code settings)
# - commands/ (slash commands for Claude Code)
# - CLAUDE.md (global instructions)
```

### 2. Clone the Hooks Repository

This repository contains hook configurations that extend Claude Code functionality:

```bash
# Clone the hooks repository to your home directory or config directory
git clone https://git.uoregon.edu/projects/JSDEV/repos/claude-code-hooks/browse ~/claude-code-hooks

# Or if you prefer a different location:
git clone https://git.uoregon.edu/projects/JSDEV/repos/claude-code-hooks/browse /path/to/hooks

# The repository should contain:
# - Hook configurations for Claude Code
# - Integration scripts
# - Documentation on hook usage
```

**Note:** Both repositories should be cloned to a stable location on your system that won't be moved, as Claude Code may reference them by path.

## Installation Steps

## 1. Install Dependencies

```bash
npm install
```

## 2. Build the Server

```bash
npm run build
```

## 3. Run the Setup Script

```bash
./install-macos.sh
```

The setup script will:
- ✅ Detect your OS and Claude Code config location
- ✅ Prompt you for your Obsidian vault path
- ✅ Create the vault structure
- ✅ Generate the Claude Code configuration
- ✅ Initialize the vault with an index file

## 4. Restart Claude Code

If Claude Code is running, restart it to load the new MCP server.

## 5. Test It Out!

Start a conversation with Claude Code and try:

```
Create a topic page about testing the Obsidian integration
```

Claude will automatically:
- Create the topic page
- Track the content created
- Link related concepts

When you're done, run `/close` to create the session file:
```
/close
```

This will:
- Create a session file with a summary of your work
- Link all topics and decisions created
- Run vault custodian to validate files
- Detect relevant Git repositories

## Example Conversation

**You:** "Create a topic page about JWT authentication"

**Claude:** *Calls `create_topic_page`*
- Creates `topics/jwt-authentication.md`
- Tracks that this topic was created in the conversation
- Topic will be linked when session is closed

**You:** "I think we should use JWT tokens with refresh token rotation. Let's make this a decision."

**Claude:** *Calls `create_decision`*
- Creates decision record in `decisions/`
- Documents the decision with context and rationale
- Decision will be linked when session is closed

**You:** "What have we discussed about database schemas in the past?"

**Claude:** *Calls `search_vault`*
- Searches all sessions, topics, and decisions
- Uses hybrid keyword + semantic search
- Returns relevant context with citations
- Shows you exactly where the information came from

**You:** "/close"

**Claude:** *Calls `close_session`*
- Creates `sessions/2025-11/2025-11-09_jwt-authentication.md`
- Links all topics and decisions created during conversation
- Runs vault custodian to validate files
- Detects relevant Git repositories from file access
- Session is now saved for future reference

## Manual Configuration (Alternative to install-macos.sh)

If you prefer to configure manually:

### 1. Find your Claude Code config file:

- **macOS**: `~/Library/Application Support/Claude/config.json`
- **Linux**: `~/.config/claude-code/config.json`
- **Windows**: `%APPDATA%\Claude\config.json`

### 2. Add this configuration:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault"
      }
    }
  }
}
```

### 3. Create vault structure:

```bash
mkdir -p ~/obsidian-vault/{sessions,topics,decisions}
```

## Verification

To verify the server is working:

1. Check Claude Code logs for MCP server connection messages
2. Ask Claude Code: "Can you search my Obsidian vault?"
3. If Claude responds with search results, it's working!
4. Create some content: "Create a topic page about testing"
5. Close the session: `/close`
6. Check `sessions/YYYY-MM/` (current month) for a new session file
7. List sessions: `/sessions` to see your closed session

## Troubleshooting

### "MCP server not found"

1. Check that `dist/index.js` exists (run `npm run build`)
2. Verify the path in config.json is absolute
3. Restart Claude Code

### "Cannot write to vault"

1. Check the OBSIDIAN_VAULT_PATH is correct
2. Verify directory permissions
3. Try creating the directories manually first

### "Search returns no results"

1. Ensure vault structure exists (sessions/, topics/, decisions/)
2. Check that files have .md extension
3. Verify vault path is correct

## Advanced Features

Once you have the basics running, explore these powerful capabilities:

### Semantic Search with Smart Controls
Find past discussions with AI-powered understanding:
- **Embedding-Based Search**: Uses local AI (Xenova/all-MiniLM) for semantic understanding
- **Hybrid Ranking**: Combines semantic similarity with keyword matching
- **Fast Performance**: ~30s first search, <1s for cached searches
- **No API Calls**: All processing happens locally
- **Toggle On/Off**: Use `toggle_embeddings` to enable/disable without restart
  - Useful for testing, troubleshooting, or reducing system overhead
  - State persists across restarts

### Git Integration
Your sessions automatically track code changes and detect relevant Git repositories:
- **File Tracking**: Records which files you edited during a session
- **Repository Detection**: Automatically finds repos related to your work
- **Commit Linking**: Links sessions to Git commits with full context
- **Project Pages**: Creates organized project documentation in Obsidian
- **Auto-Detection**: `close_session` automatically detects repositories

### Multi-Vault Search
Search across multiple Obsidian vaults while keeping one as primary:
- **Primary Vault**: Write operations go here
- **Secondary Vaults**: Read-only search targets
- **Config File**: Automatically discovered (no restart needed)
- **Unified Results**: Search indicates which vault each result comes from

### Session Organization
Sessions are automatically organized by month:
- **Monthly Folders**: `sessions/2025-10/`, `sessions/2025-11/`, etc.
- **Easy Navigation**: Find sessions from specific time periods instantly
- **Scalable**: Keeps vault organized even with hundreds of conversations

## Next Steps

Once running, explore the full capabilities:

- **Context Persistence**: Every conversation is saved automatically
- **Smart Search**: Find past discussions with semantic understanding
- **Knowledge Building**: Create interconnected topic pages and decisions
- **Git Integration**: Track code changes and link to commits
- **Project Management**: Organize work by repository

Check out `README.md` for complete documentation and `ARCHITECTURE.md` for system design!

## Tips for Best Results

1. **Be specific**: When starting sessions, mention the topic
2. **Ask for context**: Say "search my vault for X" to pull in relevant history
3. **Let Claude manage**: It will automatically save important information
4. **Review in Obsidian**: Open your vault to see the knowledge graph
5. **Customize templates**: Edit session/topic templates in the code if desired

## Project Status: Phase 1 Refactoring Complete ✅

The Obsidian MCP Server has completed Phase 1 Architectural Refactoring, which includes:

- ✅ **Modular Architecture**: Core code refactored from 6,000-line monolith to focused modules
- ✅ **Comprehensive Testing**: 80%+ test coverage with unit and integration tests
- ✅ **Type Safety**: Full TypeScript strict mode compliance
- ✅ **Performance Optimizations**: 3-5x faster search, better scalability
- ✅ **Error Handling**: Structured logging and custom error types
- ✅ **Code Quality**: Linting, formatting, and automated code quality checks

All existing functionality is preserved and enhanced. The refactoring ensures the codebase is maintainable, testable, and ready for future development.

**Repository Links:**
- **Main Repository**: https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse
- **Configuration Repository**: https://git.uoregon.edu/projects/JSDEV/repos/claude-code-config/browse
- **Hooks Repository**: https://git.uoregon.edu/projects/JSDEV/repos/claude-code-hooks/browse

Happy coding! 🚀
