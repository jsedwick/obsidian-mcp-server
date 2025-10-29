#!/bin/bash

# Obsidian MCP Server Setup Script
# This script helps configure Claude Code to use the Obsidian MCP server

set -e

echo "🗂️  Obsidian MCP Server Setup"
echo "================================"
echo ""

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    CONFIG_DIR="$HOME/Library/Application Support/Claude"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CONFIG_DIR="$HOME/.config/claude-code"
else
    CONFIG_DIR="$APPDATA/Claude"
fi

CONFIG_FILE="$CONFIG_DIR/config.json"

echo "Detected configuration directory: $CONFIG_DIR"
echo ""

# Get current directory (where the MCP server is)
MCP_SERVER_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "MCP Server path: $MCP_SERVER_PATH"
echo ""

# Check if built
if [ ! -f "$MCP_SERVER_PATH/dist/index.js" ]; then
    echo "❌ MCP server not built yet."
    echo "Building now..."
    npm run build
    echo "✅ Build complete!"
    echo ""
fi

# Get vault path from user
read -p "Enter the path to your Obsidian vault (or where you want to create it): " VAULT_PATH

# Expand tilde if present
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

# Create vault if it doesn't exist
if [ ! -d "$VAULT_PATH" ]; then
    read -p "Vault directory doesn't exist. Create it? (y/n): " CREATE_VAULT
    if [[ "$CREATE_VAULT" == "y" || "$CREATE_VAULT" == "Y" ]]; then
        mkdir -p "$VAULT_PATH"
        echo "✅ Created vault directory: $VAULT_PATH"
    else
        echo "❌ Vault directory required. Exiting."
        exit 1
    fi
fi

echo ""
echo "Creating Claude Code configuration..."

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Create or update config.json
if [ -f "$CONFIG_FILE" ]; then
    echo "⚠️  Config file already exists: $CONFIG_FILE"
    read -p "Backup existing config? (y/n): " BACKUP_CONFIG
    if [[ "$BACKUP_CONFIG" == "y" || "$BACKUP_CONFIG" == "Y" ]]; then
        cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"
        echo "✅ Backed up existing config"
    fi
fi

# Generate config
cat > "$CONFIG_FILE" << EOF
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["$MCP_SERVER_PATH/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "$VAULT_PATH"
      }
    }
  }
}
EOF

echo "✅ Configuration written to: $CONFIG_FILE"
echo ""

# Create .env file for local reference
cat > "$MCP_SERVER_PATH/.env" << EOF
OBSIDIAN_VAULT_PATH=$VAULT_PATH
EOF

echo "✅ Created .env file for reference"
echo ""

# Initialize vault structure
echo "Initializing vault structure..."
node -e "
const fs = require('fs');
const path = require('path');

const vaultPath = '$VAULT_PATH';
const dirs = ['sessions', 'topics', 'decisions'];

dirs.forEach(dir => {
  const dirPath = path.join(vaultPath, dir);
  fs.mkdirSync(dirPath, { recursive: true });
});

const indexPath = path.join(vaultPath, 'index.md');
if (!fs.existsSync(indexPath)) {
  fs.writeFileSync(indexPath, \`# Obsidian Vault Index

This vault contains context from Claude Code conversations.

## Structure
- **sessions/**: Individual conversation sessions
- **topics/**: Technical topics and concepts
- **decisions/**: Architectural decision records

## Getting Started

This vault is managed automatically by the Obsidian MCP Server for Claude Code.

Start a conversation with Claude Code, and it will automatically:
- Create session notes
- Search for relevant context
- Create topic pages
- Record decisions

## Recent Sessions
Check the sessions/ directory for recent conversations.
\`);
  console.log('✅ Created index.md');
}

console.log('✅ Vault structure initialized');
"

echo ""
echo "================================"
echo "✅ Setup Complete!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Restart Claude Code if it's running"
echo "2. Start a new conversation"
echo "3. Claude will automatically use the Obsidian MCP server"
echo ""
echo "Configuration location: $CONFIG_FILE"
echo "Vault location: $VAULT_PATH"
echo ""
echo "To test the setup, you can ask Claude Code:"
echo '  "Start a new session about testing the Obsidian integration"'
echo ""
echo "For more information, see README.md"
