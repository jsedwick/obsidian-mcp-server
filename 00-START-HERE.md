# 🚀 Obsidian MCP Server - START HERE

Welcome! This is your complete MCP server implementation for managing Claude Code conversation context in an Obsidian vault.

## What This Does

Enables Claude Code to:
- 📝 Save conversations retroactively as structured notes (via `/close`)
- 🔍 Search past discussions instantly with semantic understanding
- 📚 Build a knowledge base of technical topics
- 🔄 Review and maintain topic freshness
- 🎯 Track architectural decisions with ADR format
- 🔗 Link related concepts together automatically
- 🐙 Integrate with Git repositories and track commits
- 📦 Create project pages for code repositories
- 🎛️ Control response verbosity with tiered detail levels

All stored locally in plain Markdown files you can view in Obsidian.

## Quick Start (15 minutes)

**macOS - Automated Installation:**

```bash
# Clone and run the installer
git clone https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse obsidian-mcp-server
cd obsidian-mcp-server
./install-macos.sh

# The installer will:
# - Clone configuration and hooks repositories
# - Install Claude Code settings and slash commands
# - Build the MCP server
# - Configure your vault(s)
# - Clean up redundant config files
# - Provide detailed explanations for everything

# Restart Claude Code when prompted
# Start chatting!
```

That's it! Claude will now automatically manage your conversation context.

**For manual installation or other platforms,** see [INSTALL.md](INSTALL.md).

## 📖 Documentation Guide

Choose your path:

### 🏃‍♂️ I want to get started NOW (macOS)
→ Read **MACOS_QUICKSTART.md** (10 minutes)
→ Step-by-step guide specifically for Mac users
→ Includes troubleshooting and verification

### 🏃‍♂️ I want to get started NOW (Any Platform)
→ Read **QUICKSTART.md** (5 minutes)
→ Run `./install-macos.sh` (macOS) or see INSTALL.md for other platforms
→ Start using Claude Code

### 🔧 I want detailed installation instructions
→ Read **INSTALL.md** (20 minutes)
→ Covers all platforms, troubleshooting, advanced config
→ Perfect if you want to understand everything

### 📚 I want to understand how it works
→ Read **README.md** (15 minutes)
→ Complete feature documentation
→ All available tools explained
→ Usage examples

### 🏗️ I want to see the architecture
→ Read **ARCHITECTURE.md** (10 minutes)
→ Visual diagrams of how everything connects
→ Data flow explanations
→ System interactions

### ✅ I want a step-by-step checklist
→ Read **CHECKLIST.md** (ongoing)
→ Track your implementation progress
→ Verify everything is working
→ Troubleshooting reference

### 📊 I want a project overview
→ Read **PROJECT_SUMMARY.md** (10 minutes)
→ High-level overview
→ Key features and benefits
→ Technical details

## 🎯 Your First Steps

1. **Right now**: Run `./install-macos.sh` (see Quick Start above)
2. **Follow prompts**: Configure your vault locations
3. **Restart Claude Code**: When prompted by the installer
4. **Have a conversation**: "Create a topic page about testing the Obsidian integration"
5. **Close the session**: Run `/close` command
6. **Verify**: Check your vault's `sessions/YYYY-MM/` directory for a new session file
7. **Celebrate**: You have automatic context management! 🎉

## 📁 Project Structure

```
obsidian-mcp-server/
├── 00-START-HERE.md      ← You are here
├── MACOS_QUICKSTART.md    ← macOS quick start guide
├── QUICKSTART.md          ← General quick start guide
├── INSTALL.md             ← Detailed installation
├── README.md              ← Complete documentation
├── ARCHITECTURE.md        ← System diagrams
├── CHECKLIST.md           ← Implementation tracker
├── PROJECT_SUMMARY.md     ← High-level overview
├── install-macos.sh       ← macOS automated installer
├── src/
│   ├── index.ts          ← Main MCP server
│   └── tools/            ← MCP tool implementations
├── package.json           ← Dependencies
└── tsconfig.json          ← TypeScript config
```

## 🛠️ Common Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run automated installer (macOS)
./install-macos.sh

# Test the MCP server
npm test

# Development mode (auto-rebuild)
npm run watch

# Clean build artifacts
npm run clean
```

## ❓ Quick FAQ

**Q: What is MCP?**
A: Model Context Protocol - lets Claude Code use external tools. This server provides tools for managing conversation context.

**Q: Do I need Obsidian installed?**
A: No! The vault is just Markdown files. Obsidian is optional for viewing/editing, but not required.

**Q: Will this work on my OS?**
A: Yes! Supports macOS, Linux, and Windows.

**Q: How much storage does it use?**
A: Minimal! Years of conversations < 50 MB. Text is extremely compact.

**Q: Can I customize it?**
A: Yes! Edit templates in `src/index.ts`, rebuild with `npm run build`.

**Q: What if something breaks?**
A: Check INSTALL.md troubleshooting section, run `npm test`, or open an issue.

**Q: Can I use multiple vaults?**
A: Yes! Configure multiple MCP servers in Claude Code config.

## 🎓 Learning Path

### Beginner (First Time Setup)
1. Read this file (you're doing it!)
2. Read MACOS_QUICKSTART.md (macOS) or QUICKSTART.md (other platforms)
3. Run `./install-macos.sh` (macOS) or follow INSTALL.md
4. Use Claude Code
5. Check CHECKLIST.md

### Intermediate (Understanding the System)
1. Read README.md
2. Read ARCHITECTURE.md
3. Review generated files in vault
4. Explore Obsidian integration
5. Try advanced features

### Advanced (Customization)
1. Read src/index.ts
2. Modify templates
3. Add custom tools
4. Adjust vault structure
5. Contribute improvements

## 🏆 Success Metrics

You'll know it's working when:

✅ Session files appear in `vault/sessions/YYYY-MM/` after running `/close`
✅ Claude cites past conversations when relevant
✅ Topic pages build up over time
✅ Searching finds your past discussions with semantic understanding
✅ Knowledge base grows automatically
✅ Git repositories are detected and linked
✅ Vault custodian keeps everything organized

## 🚨 Troubleshooting Quick Reference

**Server not starting?**
- Check `npm run build` completed
- Verify absolute paths in config
- Restart Claude Code

**Files not being created?**
- Check vault path is correct
- Verify directory permissions
- Ensure vault structure exists

**Search not finding anything?**
- Confirm files exist in vault
- Check files have .md extension
- Verify content is text

**Still stuck?**
→ See INSTALL.md troubleshooting section
→ Run `npm test` for diagnostics
→ Check Claude Code logs

## 🎯 What to Do Next

### Right Now
```bash
./install-macos.sh
```

### In 5 Minutes
- Restart Claude Code
- Have a conversation
- Create topics and decisions
- Run `/close` to save the session

### Tomorrow
- Review your first session file
- Open vault in Obsidian (optional)
- See how context is linked together

### This Week
- Let it accumulate some sessions
- Try searching for past topics with `/sessions`
- Explore the knowledge graph
- Use tiered detail levels for efficient searching

### This Month
- Review all your sessions with `/sessions`
- See patterns emerge
- Appreciate never losing context again!

## 📞 Getting Help

1. **Documentation**: Check the relevant .md file
2. **Testing**: Run `npm test` to diagnose
3. **Logs**: Check Claude Code logs for errors
4. **Community**: Open a GitHub issue

## ✅ Project Status: Phase 1 Refactoring Complete

The Obsidian MCP Server has completed Phase 1 Architectural Refactoring with significant improvements:

- ✅ **Modular Architecture**: Refactored from 6,000-line monolith to focused, maintainable modules
- ✅ **Comprehensive Testing**: 80%+ code coverage with unit and integration tests
- ✅ **Type Safety**: Full TypeScript strict mode compliance, zero `any` types
- ✅ **Performance**: 3-5x faster search, better scalability for large vaults
- ✅ **Error Handling**: Structured logging with custom error types for better debugging
- ✅ **Code Quality**: ESLint, Prettier, and automated code quality checks

All existing functionality is preserved and enhanced. The codebase is now production-grade and ready for future development.

**Repository Links:**
- **Main Server**: https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse
- **Configuration**: https://git.uoregon.edu/projects/JSDEV/repos/claude-code-config/browse
- **Hooks**: https://git.uoregon.edu/projects/JSDEV/repos/claude-code-hooks/browse

## 🎉 You're Ready!

Everything you need is in this folder. Start with MACOS_QUICKSTART.md (macOS) or QUICKSTART.md (other platforms), or just run:

```bash
# Clone the repo and run the installer (macOS):
git clone https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse obsidian-mcp-server
cd obsidian-mcp-server
./install-macos.sh

# The installer handles everything:
# - Cloning config and hooks repositories
# - Installing Claude Code settings
# - Building the MCP server
# - Configuring your vaults
# - Cleaning up redundant files
```

Then start using Claude Code. It will automatically manage your conversation context from now on.

**Happy coding!** 🚀

---

**Pro Tips:**

💡 Use the automated installer for easiest setup
💡 Start every coding session with Claude Code
💡 Let it manage context automatically
💡 Review your vault in Obsidian weekly
💡 Trust the system - it remembers everything
💡 Share your vault with git for backup

**Questions?** → Check README.md or INSTALL.md
**Issues?** → See CHECKLIST.md or INSTALL.md troubleshooting
**Ready?** → Run `./install-macos.sh` now!
