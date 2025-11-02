# Quick Start Guide

Get your Obsidian MCP server running in 5 minutes!

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
./setup.sh
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
Start a new session about testing the Obsidian integration
```

Claude will automatically:
- Create a session file
- Search for relevant context
- Save key information
- Create topic pages and decision records as needed

## Example Conversation

**You:** "Start a new session about building an authentication system"

**Claude:** *Automatically calls `start_session` with topic "authentication system"*
- Creates `sessions/2025-11/2025-11-01_authentication-system.md` (organized by month)
- Searches for past sessions about authentication using semantic search
- References relevant topic pages and decisions

**You:** "I think we should use JWT tokens with refresh token rotation"

**Claude:** *Automatically calls `save_session_note`*
- Records this decision in the session file
- May create a topic page for JWT tokens
- Links related concepts

**You:** "What have we discussed about database schemas in the past?"

**Claude:** *Automatically calls `search_vault`*
- Searches all sessions, topics, and decisions
- Returns relevant context with citations
- Shows you exactly where the information came from

## Manual Configuration (Alternative to setup.sh)

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
3. If Claude responds with tool information, it's working!
4. Start a conversation and check `sessions/2025-11/` (or current month) for a new session file
5. Ask Claude: "What sessions have we worked on?" to test the `/sessions` slash command

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

### Git Integration
Your sessions automatically track code changes and detect relevant Git repositories:
- **File Tracking**: Records which files you edited during a session
- **Repository Detection**: Automatically finds repos related to your work
- **Commit Linking**: Links sessions to Git commits with full context
- **Project Pages**: Creates organized project documentation in Obsidian

### Semantic Search
Find past discussions with AI-powered understanding:
- **Embedding-Based Search**: Uses local AI (Xenova/all-MiniLM) for semantic understanding
- **Hybrid Ranking**: Combines semantic similarity with keyword matching
- **Fast Performance**: ~30s first search, <1s for cached searches
- **No API Calls**: All processing happens locally

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

Happy coding! 🚀
