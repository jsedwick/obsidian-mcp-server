# Quick Reference Card

## 🚀 Installation (5 minutes)
```bash
cd obsidian-mcp-server
npm install
npm run build
./setup.sh
# Restart Claude Code
```

## 📁 File Locations

| OS | Config File |
|----|-------------|
| macOS | `~/Library/Application Support/Claude/config.json` |
| Linux | `~/.config/claude-code/config.json` |
| Windows | `%APPDATA%\Claude\config.json` |

## 🔧 Common Commands

| Task | Command |
|------|---------|
| Install | `npm install` |
| Build | `npm run build` |
| Test | `npm test` |
| Setup | `./setup.sh` |
| Dev Mode | `npm run watch` |
| Clean | `npm run clean` |

## 🛠️ Available MCP Tools

### Session Management
| Tool | Purpose |
|------|---------|
| `start_session` | Begin new conversation |
| `save_session_note` | Record information |
| `close_session` | Mark complete |
| `list_recent_sessions` | List recent conversations |

### Search & Retrieval
| Tool | Purpose |
|------|---------|
| `search_vault` | Find past context with scoring |
| `get_session_context` | Retrieve full session |

### Knowledge Management
| Tool | Purpose |
|------|---------|
| `create_topic_page` | Document new concept |
| `update_topic_page` | Update existing topic |
| `create_decision` | Record ADR |
| `link_to_topic` | Create wiki link |

### Topic Review & Maintenance
| Tool | Purpose |
|------|---------|
| `find_stale_topics` | Find topics needing review |
| `review_topic` | Analyze for outdated content |
| `approve_topic_update` | Apply/dismiss review |
| `archive_topic` | Move to archive |

### Vault Maintenance
| Tool | Purpose |
|------|---------|
| `vault_custodian` | Check integrity & fix organization |

### Search Configuration
| Tool | Purpose |
|------|---------|
| `toggle_embeddings` | Enable/disable semantic search |

### AI-Powered Analysis
| Tool | Purpose |
|------|---------|
| `analyze_topic_content` | Auto-tag and analyze topics with AI |
| `extract_decisions_from_session` | Extract ADRs from sessions |
| `enhanced_search` | Query expansion and understanding |
| `analyze_commit_impact` | AI commit analysis for docs |

### Git Integration
| Tool | Purpose |
|------|---------|
| `track_file_access` | Track file read/edit/create |
| `detect_session_repositories` | Auto-detect Git repos |
| `link_session_to_repository` | Link session to repo |
| `create_project_page` | Create/update project page |
| `record_commit` | Record commit with diff |

## 📂 Vault Structure

```
obsidian-vault/
├── sessions/      # Conversation sessions
├── topics/        # Technical topics
├── decisions/     # Architecture decisions
├── projects/      # Git repository tracking
│   └── [slug]/
│       ├── project.md
│       └── commits/
├── archive/       # Archived content
│   └── topics/
└── index.md       # Vault overview
```

## ❓ Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Server not starting | Run `npm run build`, check paths |
| Files not created | Verify vault path, check permissions |
| Search no results | Ensure .md files exist in vault |
| Config not found | Check OS-specific location above |
| Permission errors | `chmod 755` vault directory |

## 📖 Documentation Map

| Need | Read |
|------|------|
| Quick setup | QUICKSTART.md |
| Detailed setup | INSTALL.md |
| Full docs | README.md |
| Diagrams | ARCHITECTURE.md |
| Checklist | CHECKLIST.md |
| Overview | PROJECT_SUMMARY.md |

## 💡 Testing

```bash
# Run full test suite
npm test

# Manual test
echo "test" > ~/obsidian-vault/topics/test.md
# Ask Claude: "search my vault for test"
```

## 🎯 First Use

```
You: "Start a new session about testing"
Claude: [Creates session file]

You: "Search my vault for past discussions"
Claude: [Uses search_vault tool]

You: "Create a topic page about MCP servers"
Claude: [Creates topics/mcp-servers.md]
```

## 🔍 Verification Checklist

- [ ] `dist/index.js` exists
- [ ] Vault directories created (sessions, topics, decisions, projects, archive)
- [ ] Config.json has correct paths
- [ ] `npm test` passes
- [ ] Claude Code recognizes server (25 tools available)
- [ ] Session files being created
- [ ] Search finds content
- [ ] Git integration works (if applicable)
- [ ] Embeddings toggle works

## 📊 Storage

| Usage | Size |
|-------|------|
| 1,000 sessions | ~5 MB |
| 500 topics | ~2-3 MB |
| Years of use | < 50 MB |

## ⚙️ Config Template

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/full/path/to/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/full/path/to/vault"
      }
    }
  }
}
```

## 🎓 Learning Path

1. Read 00-START-HERE.md
2. Run `./setup.sh`
3. Start using Claude Code
4. Review CHECKLIST.md
5. Explore in Obsidian

## 🆘 Get Help

1. Check INSTALL.md troubleshooting
2. Run `npm test`
3. Review Claude Code logs
4. Check this Quick Reference
5. Open GitHub issue

## 🎉 Success Indicators

✅ Session files in `vault/sessions/`
✅ Claude cites past context
✅ Search finds discussions
✅ Topic pages accumulate
✅ Knowledge graph grows

---

**Ready?** Run `./setup.sh` now! 🚀
