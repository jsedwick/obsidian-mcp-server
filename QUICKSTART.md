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
- Creates `sessions/2025-10-28_14-30-00_authentication-system.md`
- Searches for past sessions about authentication
- References relevant topic pages

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

## Next Steps

Once running, explore the full capabilities:

- **Context Persistence**: Every conversation is saved
- **Smart Search**: Find past discussions instantly  
- **Knowledge Building**: Create interconnected topic pages
- **Decision Tracking**: Maintain ADRs automatically
- **Obsidian Integration**: Open vault in Obsidian anytime

Check out `README.md` for complete documentation!

## Tips for Best Results

1. **Be specific**: When starting sessions, mention the topic
2. **Ask for context**: Say "search my vault for X" to pull in relevant history
3. **Let Claude manage**: It will automatically save important information
4. **Review in Obsidian**: Open your vault to see the knowledge graph
5. **Customize templates**: Edit session/topic templates in the code if desired

Happy coding! 🚀
