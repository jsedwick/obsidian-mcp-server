> [!warning] STALE — pending Phase 2 installer
> This document predates the claude-chat-bridge + obsidian-claude-plugin refactor and the multi-vault `.obsidian-mcp.json` schema. Install steps here are **no longer accurate**. It will be replaced by output from the `npx create-claude-setup` installer. Do not follow these steps.

# Installation Guide

Complete guide to installing and configuring the Obsidian MCP Server for Claude Code.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation Methods](#installation-methods)
3. [Configuration](#configuration)
4. [Verification](#verification)
5. [Troubleshooting](#troubleshooting)

## Prerequisites

Before installing, ensure you have:

- **Node.js**: Version 18.0.0 or higher
  - Check: `node --version`
  - Install: [nodejs.org](https://nodejs.org/)

- **Claude Code**: Installed and configured
  - Check: `claude-code --version`
  - Install: See [Anthropic documentation](https://docs.claude.com/)

- **Obsidian** (Optional but recommended): For viewing your vault
  - Download: [obsidian.md](https://obsidian.md/)

## Installation Methods

### Method 1: Automated Setup (Recommended)

This is the easiest method using the provided setup script:

```bash
# 1. Navigate to the project directory
cd obsidian-mcp-server

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Run the automated setup
./install-macos.sh
```

The setup script will:
- Detect your operating system
- Locate your Claude Code configuration directory
- Prompt you for your Obsidian vault location
- Create the vault structure if needed
- Generate the proper configuration
- Initialize the vault with an index file

### Method 2: Manual Setup

If you prefer more control or the automated setup doesn't work:

#### Step 1: Install Dependencies

```bash
npm install
```

#### Step 2: Build the Project

```bash
npm run build
```

Verify the build succeeded:
```bash
ls dist/index.js
```

#### Step 3: Create Your Vault Directory

Choose or create a directory for your Obsidian vault:

```bash
# Example: Create a vault in your home directory
mkdir -p ~/obsidian-vault/{sessions,topics,decisions}
```

#### Step 4: Configure Claude Code

Locate your Claude Code configuration file:

- **macOS**: `~/Library/Application Support/Claude/config.json`
- **Linux**: `~/.config/claude-code/config.json`  
- **Windows**: `%APPDATA%\Claude\config.json`

Create or edit this file:

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

**Important**: 
- Use **absolute paths** (not relative paths like `./` or `~/`)
- On macOS/Linux, expand `~` to your full home directory path
- On Windows, use forward slashes or escaped backslashes

#### Step 5: Initialize the Vault

Create an index.md file in your vault:

```bash
cat > ~/obsidian-vault/index.md << 'EOF'
# Obsidian Vault Index

This vault contains context from Claude Code conversations.

## Structure
- **sessions/**: Individual conversation sessions
- **topics/**: Technical topics and concepts
- **decisions/**: Architectural decision records

## Getting Started

Start a conversation with Claude Code and it will automatically
manage session notes, topic pages, and decision records.
EOF
```

## Configuration

### Multi-Vault Support (Recommended)

The server supports searching across multiple vaults while keeping one as the primary write location.

#### Configuration File Method (Automatic Discovery)

Create a `.obsidian-mcp.json` file in one of these locations (checked in order):
1. Project directory: `./obsidian-mcp-server/.obsidian-mcp.json`
2. Home directory: `~/.obsidian-mcp.json`
3. Config directory: `~/.config/.obsidian-mcp.json`

Example:
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
    }
  ]
}
```

Benefits:
- ✅ Automatically discovered (no restart needed)
- ✅ Works from any directory
- ✅ Persists configuration

#### Environment Variable Method

Alternatively, set environment variables in Claude Code config:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/primary/vault",
        "OBSIDIAN_VAULT_NAME": "Main Vault",
        "OBSIDIAN_SECONDARY_VAULTS": "/path/to/vault2,/path/to/vault3"
      }
    }
  }
}
```

### Environment Variables

The server supports these optional environment variables:

- `OBSIDIAN_VAULT_PATH`: Absolute path to your primary Obsidian vault (required if no config file)
- `OBSIDIAN_VAULT_NAME`: Display name for primary vault
- `OBSIDIAN_SECONDARY_VAULTS`: Comma-separated list of secondary vault paths
- `ENABLE_EMBEDDINGS`: Enable semantic search (default: `true`)
  - Set to `false` to use keyword-only search
  - Can be toggled at runtime with `toggle_embeddings` tool

Note: Configuration file takes precedence over environment variables.

### Multiple Claude Code Profiles

If you use multiple Claude Code configurations, you can add the Obsidian MCP server to each:

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

## Verification

### Test the Installation

Run the included test utility:

```bash
npm test
```

This will:
1. Start the MCP server
2. Run through all available tools
3. Create test files in your vault
4. Report any errors

Expected output:
```
🧪 Testing Obsidian MCP Server
================================

Vault path: /path/to/your/vault

🔧 Test 1: Initialize MCP
📥 Response: {...}

🔧 Test 2: List available tools
📥 Response: {...}

[... more tests ...]

✅ All tests completed!
```

### Manual Verification

1. **Check the server binary exists**:
   ```bash
   ls dist/index.js
   ```

2. **Verify vault structure**:
   ```bash
   ls -la ~/obsidian-vault
   # Should show: sessions/, topics/, decisions/, index.md
   ```

3. **Test with Claude Code**:

   Start Claude Code and have a conversation:
   ```
   Can you create a topic page about testing the Obsidian integration?
   ```

   Claude should create the topic page.

4. **Close the session**:
   ```
   /close
   ```

   Claude will create a session file retroactively with a summary.

5. **Check session was created**:
   ```bash
   ls ~/obsidian-vault/sessions/$(date +%Y-%m)/
   ```

### Verify in Claude Code

Ask Claude Code these test questions:

1. **"Create a topic page about JWT authentication"**
   - Should create topics/jwt-authentication.md
   - Topic will be linked when you run /close

2. **"Search my vault for past discussions about databases"**
   - Should use the search_vault tool
   - Should return relevant results (or none if vault is new)

3. **Run "/close" to end the session**
   - Should create a session file in sessions/YYYY-MM/
   - Should link all topics created during conversation
   - Should run vault custodian to validate files
   - Should detect any Git repositories you worked with

## Troubleshooting

### Server Not Starting

**Symptom**: Claude Code doesn't recognize the MCP server

**Solutions**:

1. **Check the build**:
   ```bash
   npm run build
   ls dist/index.js  # Should exist
   ```

2. **Verify config path**:
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Claude/config.json
   
   # Linux
   cat ~/.config/claude-code/config.json
   ```

3. **Check for syntax errors**:
   ```bash
   # Validate JSON
   node -e "console.log(JSON.parse(require('fs').readFileSync('path/to/config.json', 'utf8')))"
   ```

4. **Use absolute paths**:
   ```bash
   # Get absolute path
   cd /path/to/obsidian-mcp-server
   pwd  # Use this path in config
   ```

### Permission Errors

**Symptom**: "Cannot write to vault" or "EACCES" errors

**Solutions**:

1. **Check directory permissions**:
   ```bash
   ls -ld ~/obsidian-vault
   # Should show write permissions for your user
   ```

2. **Create directories with proper permissions**:
   ```bash
   mkdir -p ~/obsidian-vault/{sessions,topics,decisions}
   chmod 755 ~/obsidian-vault
   ```

3. **Verify you own the directory**:
   ```bash
   stat ~/obsidian-vault
   # Owner should be your username
   ```

### Search Not Finding Results

**Symptom**: search_vault returns "No results found"

**Solutions**:

1. **Verify files exist**:
   ```bash
   find ~/obsidian-vault -name "*.md" -type f
   ```

2. **Check file contents**:
   ```bash
   cat ~/obsidian-vault/sessions/*.md
   ```

3. **Test with keyword-only search**:
   If semantic search seems broken, disable embeddings:
   ```
   Ask Claude: "Disable embeddings"
   Or call: toggle_embeddings(enabled: false)
   ```
   Then retry your search. If it works with keyword-only, embeddings cache may be corrupted.

4. **Reset embedding cache**:
   ```bash
   rm -rf ~/obsidian-vault/.embedding-cache
   rm ~/obsidian-vault/.embedding-toggle.json
   ```
   Then re-enable embeddings: `toggle_embeddings(enabled: true)`

5. **Test with known content**:
   Create a test file and search for it:
   ```bash
   echo "test content xyz123" > ~/obsidian-vault/topics/test.md
   ```
   Then ask Claude: "search my vault for xyz123"

### MCP Server Crashes

**Symptom**: Server stops responding or exits unexpectedly

**Solutions**:

1. **Check Node.js version**:
   ```bash
   node --version
   # Should be >= 18.0.0
   ```

2. **Run with debugging**:
   ```bash
   NODE_OPTIONS='--trace-warnings' npm start
   ```

3. **Check disk space**:
   ```bash
   df -h ~/obsidian-vault
   ```

4. **Review server logs**:
   Claude Code logs will show server errors

### Path Issues on Windows

**Symptom**: Config paths not working on Windows

**Solutions**:

Use forward slashes or double backslashes:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["C:/Users/YourName/obsidian-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "C:/Users/YourName/obsidian-vault"
      }
    }
  }
}
```

Or with escaped backslashes:

```json
"args": ["C:\\Users\\YourName\\obsidian-mcp-server\\dist\\index.js"]
```

## Advanced Configuration

### Custom Vault Structure

You can modify the vault structure in `src/index.ts`:

```typescript
private async ensureVaultStructure(): Promise<void> {
  const dirs = ['sessions', 'topics', 'decisions', 'custom-dir'];
  // ... rest of method
}
```

Then rebuild:
```bash
npm run build
```

### Custom Session Templates

Edit the session template in the `startSession` method in `src/index.ts`:

```typescript
const content = `---
date: ${metadata.date}
session_id: ${metadata.session_id}
topics: ${JSON.stringify(metadata.topics)}
decisions: []
status: ongoing
custom_field: value
---

# Session: ${args.topic || 'New Session'}

## Your Custom Sections
...
`;
```

### Development Mode

For development with auto-rebuild:

```bash
npm run watch
```

In another terminal:
```bash
npm start
```

## Getting Help

If you're still having issues:

1. Check the [README.md](Use-case.md) for usage examples
2. Review the [QUICKSTART.md](QUICKSTART.md) guide
3. Run the test utility: `npm test`
4. Check Claude Code logs for error messages
5. Open an issue on GitHub with:
   - Your OS and Node.js version
   - Contents of your config.json (remove sensitive paths)
   - Error messages from logs
   - Output from `npm test`

## Next Steps

Once installed and verified:

1. Read [QUICKSTART.md](QUICKSTART.md) for usage examples
2. Review [README.md](Use-case.md) for complete documentation
3. Open your vault in Obsidian to see the knowledge graph
4. Start a conversation with Claude Code!

Happy coding! 🚀
