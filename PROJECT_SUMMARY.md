# Obsidian MCP Server - Project Summary

## What You've Got

A complete, production-ready MCP (Model Context Protocol) server that enables Claude Code to automatically manage conversation context using an Obsidian vault.

## Quick Start

```bash
cd obsidian-mcp-server
npm install
npm run build
./install-macos.sh
```

Then restart Claude Code and start chatting!

## Key Features

### 🤖 Automatic Context Management
- **Session Notes**: Every conversation is automatically saved
- **Smart Search**: Find past discussions with natural language
- **Topic Pages**: Build interconnected knowledge base
- **Decision Records**: Track architectural decisions (ADR format)

### 🔗 Obsidian Integration
- Wiki-style links between notes
- YAML frontmatter for metadata
- Graph view of relationships
- Full-text search in Obsidian

### 🧠 Semantic Search with Smart Controls
- **AI-Powered Understanding**: Uses local embeddings (Xenova/all-MiniLM-L6-v2)
- **Hybrid Ranking**: 60% semantic similarity + 40% keyword matching
- **Toggle On/Off**: Enable/disable embeddings without restart
- **Efficient Caching**: ~30s first search, <1s for cached searches
- **No API Calls**: All processing happens locally

### 📦 Multi-Vault Support
- **Primary Vault**: Write operations
- **Secondary Vaults**: Read-only search targets
- **Auto-Discovery**: Configuration file automatically discovered
- **Unified Search**: Results indicate which vault each comes from

### 🔧 Git Integration
- **Repository Detection**: Automatically detect relevant Git repos from file access
- **Commit Tracking**: Record commits with full diffs and link to sessions
- **Project Pages**: Organize code work by repository
- **File Access Tracking**: Track which files are read/edited/created
- **Auto-Detection**: Detects repos when closing sessions

### 📝 Topic Review System
- **Stale Topic Detection**: Find topics that haven't been reviewed
- **Review Workflow**: Analyze content and suggest updates
- **Review History**: Track all reviews with timestamps
- **Archive System**: Move outdated topics to archive

### 🔧 Vault Maintenance
- **Integrity Checking**: Verify vault organization and structure
- **Automatic Fixes**: Move misplaced files, add missing frontmatter
- **Link Validation**: Detect and report broken internal links
- **Health Reports**: Detailed summaries of issues and fixes

### 💾 Efficient Storage
- Text-based: Years of conversations < 50 MB
- Markdown format: Human-readable, version-controllable
- No databases: Simple file system
- Archive system for outdated content

## Project Structure

```
obsidian-mcp-server/
├── src/
│   ├── index.ts          # Main MCP server implementation
│   └── test.ts           # Test utility
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── install-macos.sh      # macOS automated installer
├── README.md             # Complete documentation
├── QUICKSTART.md         # 5-minute getting started guide
├── INSTALL.md            # Detailed installation guide
├── .gitignore           # Git ignore rules
└── LICENSE              # MIT License

After npm install & build:
├── node_modules/        # Dependencies
└── dist/                # Compiled JavaScript
    ├── index.js         # Main server
    └── test.js          # Test utility
```

## How It Works

### 1. Installation
The `install-macos.sh` installer (macOS):
- Checks prerequisites (Node.js, git, Claude Code)
- Prompts for vault configuration (primary + secondary)
- Clones configuration and hooks repositories
- Installs Claude Code settings and slash commands
- Builds the MCP server
- Creates vault directory structures
- Configures MCP integration with correct `cwd`
- Cleans up redundant configuration files
- Provides verbose explanations for every step

### 2. Integration
Claude Code connects to the MCP server via stdio:
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/vault"
      }
    }
  }
}
```

### 3. During Conversations
Claude automatically:
- **Starts sessions**: Creates timestamped session files
- **Searches context**: Finds relevant past discussions
- **Saves notes**: Records key points and decisions
- **Creates topics**: Documents significant concepts
- **Links content**: Builds relationships between notes

### 4. In Your Vault
```
obsidian-vault/
├── sessions/
│   └── 2025-10-28_14-30-00_authentication.md
├── topics/
│   ├── jwt-tokens.md
│   └── database-schema.md
├── decisions/
│   └── 001-use-postgresql.md
├── projects/
│   └── my-app/
│       ├── project.md
│       └── commits/
│           └── abc123.md
├── archive/
│   └── topics/
│       └── old-topic.md
└── index.md
```

## Available Tools (MCP Functions)

The server provides 22 tools to Claude Code:

### Session Management (4)
1. **start_session** - Begin a new conversation
2. **save_session_note** - Record information
3. **close_session** - Mark session complete
4. **list_recent_sessions** - List recent conversation sessions

### Search & Retrieval (2)
5. **search_vault** - Find past context with relevance scoring
6. **get_session_context** - Retrieve session details

### Knowledge Management (3)
7. **create_topic_page** - Document concepts
8. **update_topic_page** - Update existing topics
9. **create_decision** - Record ADRs

### Topic Review & Maintenance (4)
10. **find_stale_topics** - Find topics that need review
11. **review_topic** - Analyze topic for outdated content
12. **approve_topic_update** - Apply or dismiss review
13. **archive_topic** - Move topic to archive

### Vault Maintenance (1)
14. **vault_custodian** - Check integrity & fix organization

### Search Configuration (1)
15. **toggle_embeddings** - Enable/disable semantic search

### Git Integration (5)
16. **track_file_access** - Track files accessed during session
17. **detect_session_repositories** - Auto-detect relevant Git repos
18. **link_session_to_repository** - Link session to a repo
19. **create_project_page** - Create/update project page
20. **record_commit** - Record Git commit with diff

### AI-Powered Analysis (2)
21. **analyze_topic_content** - Auto-tag and analyze topics with AI
22. **analyze_commit_impact** - AI-powered commit analysis for documentation updates

## Example Workflow

```
You: "Start a session about building an auth system"
Claude: [Creates session, searches for past auth discussions]

You: "I think we should use JWT with refresh tokens"
Claude: [Saves decision, may create topic page for JWT]

You: "What did we discuss about database schemas?"
Claude: [Searches vault, returns relevant sessions/topics]

You: "Create a decision record for using PostgreSQL"
Claude: [Creates decisions/001-use-postgresql.md]
```

## Testing

Run the included test suite:
```bash
npm test
```

This verifies:
- ✅ MCP server starts correctly
- ✅ All 22 tools are available
- ✅ Files are created in vault
- ✅ Search finds content
- ✅ Session lifecycle works

## Configuration Options

### Single Vault
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/vault"
      }
    }
  }
}
```

### Multiple Vaults
```json
{
  "mcpServers": {
    "obsidian-work": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/work-vault"
      }
    },
    "obsidian-personal": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/personal-vault"
      }
    }
  }
}
```

## Customization

### Session Templates
Edit the `startSession` method in `src/index.ts` to customize session file format.

### Vault Structure
Modify the `ensureVaultStructure` method to add custom directories.

### Search Behavior
Adjust search logic in the `searchVault` method.

After changes:
```bash
npm run build
```

## Troubleshooting

### Server not starting
1. Check `npm run build` succeeded
2. Verify paths are absolute in config
3. Restart Claude Code

### Search not working
1. Ensure vault structure exists
2. Check files are `.md` format
3. Verify vault path is correct

### Permission errors
1. Check directory permissions
2. Ensure you own the vault directory
3. Try creating vault manually

See `INSTALL.md` for detailed troubleshooting.

## Storage Efficiency

Your 256GB drive is more than sufficient:

| Usage | Storage |
|-------|---------|
| 1,000 detailed sessions | ~5 MB |
| 500 topic pages | ~2-3 MB |
| Years of conversations | < 50 MB |
| With code snippets | < 100 MB |

Text is incredibly compact!

## Benefits

### For Development
- **Never lose context**: All discussions are saved
- **Fast retrieval**: Search finds relevant info instantly
- **Knowledge building**: Topics evolve over time
- **Decision tracking**: Know why choices were made

### For Projects
- **Documentation**: Auto-generated project history
- **Onboarding**: New team members can read past sessions
- **Architecture**: ADRs document design decisions
- **Debugging**: Find past solutions to similar issues

### For Learning
- **Progress tracking**: See how understanding evolved
- **Reference material**: Built-in knowledge base
- **Pattern recognition**: Link similar concepts
- **Review sessions**: Go back and review what you learned

## Technical Details

### Dependencies
- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `@types/node`: TypeScript definitions for Node.js
- `typescript`: TypeScript compiler

### Architecture
- **Protocol**: MCP over stdio
- **Storage**: File system (Markdown files)
- **Format**: YAML frontmatter + Markdown content
- **Links**: Obsidian wiki-style `[[file|display]]`

### Security
- **Local only**: No network access
- **File system**: Standard OS permissions
- **No cloud**: Everything stays on your machine
- **Open source**: Audit the code yourself

## Next Steps

1. **Install**: Run `./install-macos.sh`
2. **Test**: Run `npm test`
3. **Use**: Start a conversation with Claude Code
4. **Explore**: Open vault in Obsidian
5. **Customize**: Edit templates and structure as needed

## Resources

- **QUICKSTART.md**: Get started in 5 minutes
- **INSTALL.md**: Detailed installation guide
- **README.md**: Complete documentation

## Support

For issues or questions:
1. Check INSTALL.md troubleshooting section
2. Run `npm test` to diagnose issues
3. Review Claude Code logs
4. Open a GitHub issue with details

## License

MIT License - See LICENSE file

## Contributing

Contributions welcome! Ideas for improvements:
- [ ] Automatic tagging
- [ ] Session summarization
- [ ] Template customization UI
- [ ] Multi-vault support
- [ ] Graph visualization
- [ ] Export formats

---

**You're all set!** 🚀

Run `./install-macos.sh` to get started, then open Claude Code and start a conversation. Claude will automatically manage your context in the Obsidian vault.
