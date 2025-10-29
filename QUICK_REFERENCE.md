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

| Tool | Purpose |
|------|---------|
| `start_session` | Begin new conversation |
| `save_session_note` | Record information |
| `search_vault` | Find past context |
| `create_topic_page` | Document concept |
| `create_decision` | Record ADR |
| `update_topic_page` | Update topic |
| `get_session_context` | Retrieve session |
| `link_to_topic` | Create wiki link |
| `close_session` | Mark complete |

## 📂 Vault Structure

```
obsidian-vault/
├── sessions/      # Conversation sessions
├── topics/        # Technical topics
├── decisions/     # Architecture decisions
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
- [ ] Vault directories created
- [ ] Config.json has correct paths
- [ ] `npm test` passes
- [ ] Claude Code recognizes server
- [ ] Session files being created
- [ ] Search finds content

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
