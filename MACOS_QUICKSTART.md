# Quick Start Guide for macOS

Get the Obsidian MCP Server running on your Mac in 10 minutes!

## Prerequisites

Before starting, ensure you have:

- **macOS** (any recent version)
- **Node.js 18+** installed
  - Check: `node --version`
  - Install via Homebrew: `brew install node`
  - Or download from: https://nodejs.org/
- **Claude Code** installed and working
  - Install from: https://claude.com/claude-code
- **Terminal** access

## Step-by-Step Installation

### 1. Clone or Download This Repository

```bash
# Option A: Clone with git
git clone <repository-url> obsidian-mcp-server
cd obsidian-mcp-server

# Option B: If you already have the files
cd /path/to/obsidian-mcp-server
```

### 2. Install Dependencies

```bash
npm install
```

This installs the required packages:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@xenova/transformers` - Local AI for semantic search (no API calls!)

### 3. Build the Server

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

Verify the build:
```bash
ls dist/index.js
# Should show: dist/index.js
```

### 4. Create Your Obsidian Vault Directory

Choose where you want your vault (or use an existing Obsidian vault):

```bash
# Option A: Create a new vault in Documents
mkdir -p ~/Documents/ObsidianVault

# Option B: Use an existing Obsidian vault
# Just note the path, e.g., ~/Documents/Obsidian/MyVault
```

### 5. Configure Claude Code

Find your Claude Code configuration file:

```bash
# macOS location:
~/Library/Application Support/Claude/config.json
```

**Create or edit** this file with your favorite editor:

```bash
# Using nano:
nano ~/Library/Application\ Support/Claude/config.json

# Or using VS Code:
code ~/Library/Application\ Support/Claude/config.json

# Or using vim:
vim ~/Library/Application\ Support/Claude/config.json
```

**Add this configuration** (replace paths with your actual paths):

```json
{
  "mcpServers": {
    "obsidian-context-manager": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/obsidian-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/Users/YOUR_USERNAME/Documents/ObsidianVault"
      }
    }
  }
}
```

**Important:** Replace `YOUR_USERNAME` with your actual macOS username!

To find your username:
```bash
whoami
```

To get full paths automatically:
```bash
# Get path to this project:
cd /path/to/obsidian-mcp-server
pwd
# Copy this path for the "args" field

# Get path to your vault:
cd ~/Documents/ObsidianVault
pwd
# Copy this path for OBSIDIAN_VAULT_PATH
```

### 6. Restart Claude Code

Quit and restart Claude Code to load the new MCP server.

```bash
# Force quit Claude Code if needed
killall "Claude"

# Then relaunch from Applications folder
open -a "Claude"
```

### 7. Test the Installation

Start a conversation with Claude Code and try:

```
Can you create a topic page about testing the Obsidian MCP integration?
```

Claude should respond by creating the topic. Then try:

```
Search my vault for "testing"
```

Claude should find and return the topic you just created.

### 8. Close Your First Session

When you're done testing, run:

```
/close
```

Claude will create a retroactive session file summarizing everything you did!

## Verify It's Working

Check that your vault has the correct structure:

```bash
ls -la ~/Documents/ObsidianVault/
```

You should see:
```
drwxr-xr-x  sessions/      # Your conversation sessions (organized by month)
drwxr-xr-x  topics/        # Technical documentation
drwxr-xr-x  decisions/     # Architectural decisions
drwxr-xr-x  projects/      # Git repository tracking
drwxr-xr-x  archive/       # Archived content
-rw-r--r--  index.md       # Vault overview
```

Check your first session:

```bash
# Find current month's sessions
ls ~/Documents/ObsidianVault/sessions/$(date +%Y-%m)/

# View your first session
cat ~/Documents/ObsidianVault/sessions/$(date +%Y-%m)/*.md | head -50
```

## Advanced Configuration (Optional)

### Multi-Vault Support

To search across multiple Obsidian vaults, create a `.obsidian-mcp.json` file:

```bash
nano ~/.obsidian-mcp.json
```

Add:
```json
{
  "primaryVault": {
    "path": "/Users/YOUR_USERNAME/Documents/ObsidianVault",
    "name": "Main Vault"
  },
  "secondaryVaults": [
    {
      "path": "/Users/YOUR_USERNAME/Documents/WorkVault",
      "name": "Work Vault"
    }
  ]
}
```

This lets you search across multiple vaults while keeping one as the primary for writing.

### Disable Semantic Search (Optional)

If you want faster searches without AI-powered semantic understanding:

Edit your Claude Code config and add:
```json
{
  "mcpServers": {
    "obsidian-context-manager": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/obsidian-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/Users/YOUR_USERNAME/Documents/ObsidianVault",
        "ENABLE_EMBEDDINGS": "false"
      }
    }
  }
}
```

You can also toggle this on/off at runtime:
- Ask Claude: "Disable embeddings"
- Or ask: "Enable embeddings"

## Using with Obsidian App (Optional)

Want to view your vault in the Obsidian app?

1. **Download Obsidian**: https://obsidian.md/
2. **Open your vault**: File → Open Vault → Choose your vault directory
3. **Explore the graph**: View → Graph View

The vault is just Markdown files, so you can use any editor!

## Troubleshooting

### "MCP server not found"

**Check the build:**
```bash
cd /path/to/obsidian-mcp-server
npm run build
ls dist/index.js  # Should exist
```

**Check config paths are absolute:**
```bash
# Wrong (relative path):
"args": ["./dist/index.js"]

# Correct (absolute path):
"args": ["/Users/yourname/obsidian-mcp-server/dist/index.js"]
```

**Verify JSON syntax:**
```bash
cat ~/Library/Application\ Support/Claude/config.json | python3 -m json.tool
# Should print formatted JSON without errors
```

### "Cannot write to vault"

**Check vault directory exists:**
```bash
ls -la ~/Documents/ObsidianVault
```

**Check permissions:**
```bash
# You should own the directory
stat ~/Documents/ObsidianVault

# If needed, fix permissions:
chmod 755 ~/Documents/ObsidianVault
```

**Create directories manually:**
```bash
mkdir -p ~/Documents/ObsidianVault/{sessions,topics,decisions,projects,archive/topics}
```

### "Search returns no results"

**Verify files exist:**
```bash
find ~/Documents/ObsidianVault -name "*.md" -type f
```

**Check semantic search is working:**
```bash
# First search will be slow (~30s) as the AI model loads
# Subsequent searches should be < 1 second
```

**Try disabling embeddings temporarily:**
Ask Claude: "Disable embeddings and search for testing"

### "Semantic search is slow"

**First search only:** The local AI model takes ~30 seconds to load the first time in each session. This is normal!

**Every search is slow:**
- Check your Mac's CPU usage
- Try disabling embeddings: `ENABLE_EMBEDDINGS=false`
- Clear the cache: `rm -rf ~/Documents/ObsidianVault/.embedding-cache`

### Config file location on older macOS

If `~/Library/Application Support/Claude/` doesn't exist, try:
```bash
# Check these locations:
ls ~/.config/claude-code/config.json
ls ~/.claude/config.json
```

## Common Tasks

### View Recent Sessions

Ask Claude:
```
/sessions
```

### View Recent Projects

Ask Claude:
```
/projects
```

### Search for Past Work

Ask Claude:
```
Search my vault for authentication
```

### Create Documentation

Ask Claude:
```
Create a topic page about JWT token rotation with code examples
```

### Close and Save Session

```
/close
```

## Next Steps

Now that you're set up:

1. **Use Claude Code naturally** - it tracks everything automatically
2. **Close sessions with `/close`** when you're done with a conversation
3. **Search your vault** to find past discussions
4. **Review in Obsidian** (optional) to see your knowledge graph grow

## File Locations Quick Reference

| Item | Path |
|------|------|
| Claude Code Config | `~/Library/Application Support/Claude/config.json` |
| MCP Server Code | `~/obsidian-mcp-server/` (or wherever you cloned it) |
| Built Server | `~/obsidian-mcp-server/dist/index.js` |
| Your Vault | `~/Documents/ObsidianVault/` (or your custom path) |
| Sessions | `~/Documents/ObsidianVault/sessions/YYYY-MM/` |
| Topics | `~/Documents/ObsidianVault/topics/` |
| Decisions | `~/Documents/ObsidianVault/decisions/` |
| Multi-Vault Config | `~/.obsidian-mcp.json` (optional) |

## Getting Help

**Still stuck?**

1. Run the test utility: `npm test`
2. Check Claude Code logs (ask Claude: "Show me the MCP server logs")
3. Review [INSTALL.md](INSTALL.md) for detailed troubleshooting
4. Review [README.md](README.md) for complete feature documentation

## Features to Explore

Once you're comfortable with basics:

- **Semantic Search** - AI-powered understanding of your queries
- **Git Integration** - Link sessions to commits and track code changes
- **Decision Records** - Track architectural decisions in ADR format
- **Topic Review** - Find and update stale documentation
- **Multi-Vault** - Search across multiple Obsidian vaults
- **Vault Custodian** - Automatic file organization and link validation

## Performance Tips

**Typical performance:**
- Session creation: < 100ms
- Keyword search: < 100ms
- Semantic search (cached): < 1s
- Semantic search (first time): ~30s
- Creating topics: < 50ms

**Storage:**
- 100 detailed sessions: ~500 KB
- 100 topics: ~400 KB
- Embedding cache: ~320 KB
- Total for a year: < 10 MB

Text is incredibly efficient!

---

**You're all set!** 🎉

Start using Claude Code and let it build your personal knowledge base automatically.

**Pro Tips:**
- Run `/close` at the end of meaningful conversations
- Search your vault before asking questions (Claude will do this automatically)
- Review your vault weekly in Obsidian to see patterns emerge
- Let the system work - it remembers everything!

Happy coding! 🚀
