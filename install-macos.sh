#!/usr/bin/env bash

#############################################################################
# Obsidian MCP Server - macOS Installer
#############################################################################
#
# This script installs and configures the Obsidian MCP Server for Claude Code
# on macOS. It builds the server and creates the necessary configuration.
#
# Usage: ./install-macos.sh [options]
#
# Options:
#   --vault PATH              Primary vault path (enables non-interactive)
#   --vault-name NAME         Primary vault name (default: basename of path)
#   --mode MODE               Vault mode: work or personal (default: work)
#   --skip-build              Skip npm install and build (use existing dist/)
#   --non-interactive         Run without prompts (requires --vault)
#   --dry-run                 Show what would be done without making changes
#   --help                    Show this help message
#
# Examples:
#   ./install-macos.sh                                    # Interactive mode
#   ./install-macos.sh --vault ~/Documents/Obsidian/Main  # Non-interactive
#   ./install-macos.sh --dry-run                          # Preview changes
#
#############################################################################

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get the directory where this script lives (the repo root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Configuration defaults
PRIMARY_VAULT_PATH=""
PRIMARY_VAULT_NAME=""
PRIMARY_VAULT_MODE="work"
SECONDARY_VAULTS=()
SKIP_BUILD=false
DRY_RUN=false
INTERACTIVE=true

#############################################################################
# Helper Functions
#############################################################################

print_header() {
    echo -e "\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${MAGENTA}$1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_step() {
    echo -e "${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

execute_or_dry_run() {
    if [ "$DRY_RUN" = true ]; then
        echo -e "${CYAN}[DRY RUN]${NC} Would execute: $*"
    else
        "$@"
    fi
}

#############################################################################
# Parse Command Line Arguments
#############################################################################

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --vault)
                PRIMARY_VAULT_PATH="$2"
                INTERACTIVE=false
                shift 2
                ;;
            --vault-name)
                PRIMARY_VAULT_NAME="$2"
                shift 2
                ;;
            --mode)
                PRIMARY_VAULT_MODE="$2"
                if [[ ! "$PRIMARY_VAULT_MODE" =~ ^(work|personal)$ ]]; then
                    print_error "Invalid mode: $PRIMARY_VAULT_MODE (must be 'work' or 'personal')"
                    exit 1
                fi
                shift 2
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --non-interactive)
                INTERACTIVE=false
                shift
                ;;
            --help)
                sed -n '3,24p' "$0" | sed 's/^# //' | sed 's/^#//'
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

#############################################################################
# Prerequisite Checks
#############################################################################

check_prerequisites() {
    print_header "Checking Prerequisites"

    local ERRORS=0

    # Check for Node.js
    print_step "Checking for Node.js..."
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js found: $NODE_VERSION"

        # Verify version is 20+
        MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
        if [ "$MAJOR_VERSION" -lt 20 ]; then
            print_error "Node.js version 20+ required (found $NODE_VERSION)"
            print_info "Install with: brew install node"
            ((ERRORS++))
        fi
    else
        print_error "Node.js not found"
        print_info "Install with: brew install node"
        ((ERRORS++))
    fi

    # Check for npm
    print_step "Checking for npm..."
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        print_success "npm found: $NPM_VERSION"
    else
        print_error "npm not found (should come with Node.js)"
        ((ERRORS++))
    fi

    # Check for git
    print_step "Checking for git..."
    if command -v git &> /dev/null; then
        GIT_VERSION=$(git --version)
        print_success "Git found: $GIT_VERSION"
    else
        print_warning "Git not found (optional but recommended)"
        print_info "Install with: brew install git"
    fi

    # Check for Claude Code
    print_step "Checking for Claude Code..."
    CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
    if [ -d "$CLAUDE_CONFIG_DIR" ]; then
        print_success "Claude Code config directory found"
    else
        print_warning "Claude Code config directory not found"
        print_info "This is OK if Claude Code hasn't been run yet"
        print_info "The directory will be created during configuration"
    fi

    if [ $ERRORS -gt 0 ]; then
        print_error "Prerequisites check failed with $ERRORS error(s)"
        exit 1
    fi
}

#############################################################################
# Prompt for Vault Configuration
#############################################################################

prompt_vault_config() {
    if [ "$INTERACTIVE" = false ]; then
        if [ -z "$PRIMARY_VAULT_PATH" ]; then
            print_error "Non-interactive mode requires --vault PATH"
            exit 1
        fi
        print_info "Non-interactive mode - using provided configuration"
        # Expand tilde
        PRIMARY_VAULT_PATH="${PRIMARY_VAULT_PATH/#\~/$HOME}"
        if [ -z "$PRIMARY_VAULT_NAME" ]; then
            PRIMARY_VAULT_NAME=$(basename "$PRIMARY_VAULT_PATH")
        fi
        return
    fi

    print_header "Vault Configuration"

    print_info "The MCP server needs to know where your Obsidian vault is located."
    print_info "This will be your primary vault for Claude Code context management."
    echo ""

    # Primary vault path
    print_step "Primary vault configuration:"
    echo ""

    while true; do
        read -p "$(echo -e "${BLUE}Vault path${NC} (e.g., ~/Documents/Obsidian/MyVault): ")" PRIMARY_VAULT_PATH

        # Expand tilde
        PRIMARY_VAULT_PATH="${PRIMARY_VAULT_PATH/#\~/$HOME}"

        # Validate path
        if [ -z "$PRIMARY_VAULT_PATH" ]; then
            print_error "Vault path cannot be empty"
            continue
        fi

        # Check if directory exists
        if [ -d "$PRIMARY_VAULT_PATH" ]; then
            print_success "Found existing directory: $PRIMARY_VAULT_PATH"
            break
        else
            print_warning "Directory does not exist: $PRIMARY_VAULT_PATH"
            read -p "$(echo -e "${YELLOW}Create this directory?${NC} (y/n): ")" CREATE_DIR
            if [[ "$CREATE_DIR" =~ ^[Yy]$ ]]; then
                if [ "$DRY_RUN" = false ]; then
                    mkdir -p "$PRIMARY_VAULT_PATH"
                    print_success "Created directory: $PRIMARY_VAULT_PATH"
                else
                    print_info "[DRY RUN] Would create: $PRIMARY_VAULT_PATH"
                fi
                break
            fi
        fi
    done

    # Primary vault name
    DEFAULT_NAME=$(basename "$PRIMARY_VAULT_PATH")
    read -p "$(echo -e "${BLUE}Vault name${NC} (default: $DEFAULT_NAME): ")" PRIMARY_VAULT_NAME
    if [ -z "$PRIMARY_VAULT_NAME" ]; then
        PRIMARY_VAULT_NAME="$DEFAULT_NAME"
    fi
    print_success "Vault name: $PRIMARY_VAULT_NAME"

    # Vault mode
    echo ""
    print_info "Vault modes allow separation between work and personal contexts."
    print_info "Choose 'work' for professional/project documentation, 'personal' for personal notes."
    echo ""
    read -p "$(echo -e "${BLUE}Vault mode${NC} (work/personal) [work]: ")" PRIMARY_VAULT_MODE
    if [ -z "$PRIMARY_VAULT_MODE" ]; then
        PRIMARY_VAULT_MODE="work"
    fi
    if [[ ! "$PRIMARY_VAULT_MODE" =~ ^(work|personal)$ ]]; then
        print_warning "Invalid mode, using 'work'"
        PRIMARY_VAULT_MODE="work"
    fi
    print_success "Vault mode: $PRIMARY_VAULT_MODE"

    # Secondary vaults (optional)
    echo ""
    print_step "Secondary vaults (optional):"
    print_info "Secondary vaults are searched but not written to."
    print_info "Use them for reference documentation or shared knowledge bases."
    echo ""

    while true; do
        read -p "$(echo -e "${BLUE}Add a secondary vault?${NC} (y/n): ")" ADD_SECONDARY

        if [[ ! "$ADD_SECONDARY" =~ ^[Yy]$ ]]; then
            break
        fi

        # Get secondary vault path
        while true; do
            read -p "$(echo -e "${BLUE}Secondary vault path${NC}: ")" SEC_PATH
            SEC_PATH="${SEC_PATH/#\~/$HOME}"

            if [ -z "$SEC_PATH" ]; then
                print_error "Path cannot be empty"
                continue
            fi

            if [ ! -d "$SEC_PATH" ]; then
                print_warning "Directory does not exist: $SEC_PATH"
                read -p "$(echo -e "${YELLOW}Create this directory?${NC} (y/n): ")" CREATE_SEC
                if [[ "$CREATE_SEC" =~ ^[Yy]$ ]]; then
                    if [ "$DRY_RUN" = false ]; then
                        mkdir -p "$SEC_PATH"
                        print_success "Created directory: $SEC_PATH"
                    else
                        print_info "[DRY RUN] Would create: $SEC_PATH"
                    fi
                    break
                fi
            else
                break
            fi
        done

        # Get secondary vault name
        DEFAULT_SEC_NAME=$(basename "$SEC_PATH")
        read -p "$(echo -e "${BLUE}Secondary vault name${NC} (default: $DEFAULT_SEC_NAME): ")" SEC_NAME
        if [ -z "$SEC_NAME" ]; then
            SEC_NAME="$DEFAULT_SEC_NAME"
        fi

        # Get authority level
        echo ""
        print_info "Authority levels control search ranking:"
        echo -e "  ${GREEN}curated${NC}  - High-quality content (recommended for most)"
        echo -e "  ${YELLOW}default${NC}  - Standard ranking based on directory structure"
        echo -e "  ${CYAN}reference${NC} - Lower priority reference material"
        echo ""
        read -p "$(echo -e "${BLUE}Authority level${NC} (curated/default/reference) [curated]: ")" AUTHORITY
        if [ -z "$AUTHORITY" ]; then
            AUTHORITY="curated"
        fi
        if [[ ! "$AUTHORITY" =~ ^(curated|default|reference)$ ]]; then
            print_warning "Invalid authority level, using 'curated'"
            AUTHORITY="curated"
        fi

        # Get mode
        read -p "$(echo -e "${BLUE}Vault mode${NC} (work/personal) [$PRIMARY_VAULT_MODE]: ")" SEC_MODE
        if [ -z "$SEC_MODE" ]; then
            SEC_MODE="$PRIMARY_VAULT_MODE"
        fi
        if [[ ! "$SEC_MODE" =~ ^(work|personal)$ ]]; then
            print_warning "Invalid mode, using '$PRIMARY_VAULT_MODE'"
            SEC_MODE="$PRIMARY_VAULT_MODE"
        fi

        # Store secondary vault info (format: path|name|authority|mode)
        SECONDARY_VAULTS+=("$SEC_PATH|$SEC_NAME|$AUTHORITY|$SEC_MODE")
        print_success "Added secondary vault: $SEC_NAME"
        echo ""
    done

    # Summary
    echo ""
    print_info "Configuration summary:"
    echo -e "  ${GREEN}Primary vault:${NC} $PRIMARY_VAULT_NAME"
    echo -e "    Path: $PRIMARY_VAULT_PATH"
    echo -e "    Mode: $PRIMARY_VAULT_MODE"

    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        echo -e "  ${GREEN}Secondary vaults:${NC}"
        for vault in "${SECONDARY_VAULTS[@]}"; do
            IFS='|' read -r path name authority mode <<< "$vault"
            echo -e "    - $name ($authority, $mode)"
            echo -e "      Path: $path"
        done
    fi
    echo ""
}

#############################################################################
# Build MCP Server
#############################################################################

build_mcp_server() {
    if [ "$SKIP_BUILD" = true ]; then
        print_header "Skipping Build (--skip-build flag set)"
        if [ ! -f "$SCRIPT_DIR/dist/index.js" ]; then
            print_error "dist/index.js not found - cannot skip build"
            print_info "Run without --skip-build or run 'npm run build' first"
            exit 1
        fi
        print_success "Using existing build: $SCRIPT_DIR/dist/index.js"
        return
    fi

    print_header "Building MCP Server"

    print_step "Installing npm dependencies..."
    cd "$SCRIPT_DIR"

    if [ "$DRY_RUN" = false ]; then
        npm install
        print_success "Dependencies installed"
    else
        print_info "[DRY RUN] Would execute: npm install"
    fi

    print_step "Building TypeScript..."
    if [ "$DRY_RUN" = false ]; then
        npm run build
        print_success "Build completed"

        if [ -f "$SCRIPT_DIR/dist/index.js" ]; then
            print_success "Server binary: $SCRIPT_DIR/dist/index.js"
        else
            print_error "Build failed - dist/index.js not created"
            exit 1
        fi
    else
        print_info "[DRY RUN] Would execute: npm run build"
    fi
}

#############################################################################
# Create Vault Configuration File
#############################################################################

create_vault_config() {
    print_header "Creating Vault Configuration"

    VAULT_CONFIG="$SCRIPT_DIR/.obsidian-mcp.json"

    print_step "Creating .obsidian-mcp.json..."

    # Backup existing config
    if [ -f "$VAULT_CONFIG" ] && [ "$DRY_RUN" = false ]; then
        BACKUP_FILE="$VAULT_CONFIG.backup.$(date +%s)"
        cp "$VAULT_CONFIG" "$BACKUP_FILE"
        print_warning "Backed up existing config to: $BACKUP_FILE"
    fi

    # Build secondary vaults JSON
    SECONDARY_JSON=""
    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        SECONDARY_JSON='"secondaryVaults": ['
        FIRST=true
        for vault in "${SECONDARY_VAULTS[@]}"; do
            IFS='|' read -r path name authority mode <<< "$vault"

            if [ "$FIRST" = true ]; then
                FIRST=false
            else
                SECONDARY_JSON+=","
            fi

            SECONDARY_JSON+="
    {
      \"path\": \"$path\",
      \"name\": \"$name\",
      \"authority\": \"$authority\",
      \"mode\": \"$mode\"
    }"
        done
        SECONDARY_JSON+="
  ]"
    else
        SECONDARY_JSON='"secondaryVaults": []'
    fi

    # Create config file with new format (primaryVaults array)
    if [ "$DRY_RUN" = false ]; then
        cat > "$VAULT_CONFIG" << EOF
{
  "primaryVaults": [
    {
      "path": "$PRIMARY_VAULT_PATH",
      "name": "$PRIMARY_VAULT_NAME",
      "mode": "$PRIMARY_VAULT_MODE"
    }
  ],
  $SECONDARY_JSON
}
EOF
        print_success "Created: $VAULT_CONFIG"
    else
        print_info "[DRY RUN] Would create: $VAULT_CONFIG"
        echo -e "${CYAN}Content preview:${NC}"
        echo "{"
        echo "  \"primaryVaults\": ["
        echo "    {"
        echo "      \"path\": \"$PRIMARY_VAULT_PATH\","
        echo "      \"name\": \"$PRIMARY_VAULT_NAME\","
        echo "      \"mode\": \"$PRIMARY_VAULT_MODE\""
        echo "    }"
        echo "  ],"
        echo "  $SECONDARY_JSON"
        echo "}"
    fi

    echo ""
    print_info "This config enables mode switching (work/personal)"
    print_info "Add more vaults by editing: $VAULT_CONFIG"
}

#############################################################################
# Create Vault Structure
#############################################################################

create_vault_structure() {
    print_header "Creating Vault Structure"

    print_step "Creating directories in: $PRIMARY_VAULT_PATH"

    # Create subdirectories
    DIRS=(
        "sessions"
        "topics"
        "decisions"
        "decisions/vault"
        "projects"
        "archive"
        "archive/topics"
    )

    for dir in "${DIRS[@]}"; do
        FULL_PATH="$PRIMARY_VAULT_PATH/$dir"
        if [ -d "$FULL_PATH" ]; then
            echo -e "  ${YELLOW}exists${NC}: $dir/"
        else
            if [ "$DRY_RUN" = false ]; then
                mkdir -p "$FULL_PATH"
                echo -e "  ${GREEN}created${NC}: $dir/"
            else
                echo -e "  ${CYAN}[would create]${NC}: $dir/"
            fi
        fi
    done

    # Create index.md if it doesn't exist
    INDEX_FILE="$PRIMARY_VAULT_PATH/index.md"
    if [ ! -f "$INDEX_FILE" ]; then
        if [ "$DRY_RUN" = false ]; then
            cat > "$INDEX_FILE" << EOF
# Knowledge Vault: $PRIMARY_VAULT_NAME

Welcome to your Obsidian MCP knowledge vault! This vault is managed by Claude Code.

## Structure

- **sessions/** - Conversation logs organized by month
- **topics/** - Technical documentation and how-to guides
- **decisions/** - Architectural Decision Records (ADRs)
- **projects/** - Git repository tracking and commit history
- **archive/** - Archived or deprecated content

## Getting Started

Use Claude Code to interact with this vault:

- Create topics: "Create a topic about..."
- Search: "Search my vault for..."
- Create decisions: "Document the decision to..."
- Close session: \`/close\`

The vault grows with your conversations!

## Useful Commands

- \`/mb\` - Load memory base (recent work summary)
- \`/sessions\` - View recent sessions
- \`/projects\` - View tracked repositories
- \`/close\` - Save session and update vault
EOF
            echo -e "  ${GREEN}created${NC}: index.md"
        else
            echo -e "  ${CYAN}[would create]${NC}: index.md"
        fi
    else
        echo -e "  ${YELLOW}exists${NC}: index.md"
    fi

    echo ""
}

#############################################################################
# Configure Claude Code MCP Integration
#############################################################################

configure_claude_mcp() {
    print_header "Configuring Claude Code MCP Integration"

    CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
    CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/config.json"

    print_step "Setting up Claude Code MCP configuration..."

    # Create directory if needed
    if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
        if [ "$DRY_RUN" = false ]; then
            mkdir -p "$CLAUDE_CONFIG_DIR"
            print_success "Created directory: $CLAUDE_CONFIG_DIR"
        else
            print_info "[DRY RUN] Would create: $CLAUDE_CONFIG_DIR"
        fi
    fi

    # Check for existing config
    if [ -f "$CLAUDE_CONFIG_FILE" ]; then
        print_warning "Claude config file already exists"

        # Check if obsidian-context-manager is already configured
        if grep -q "obsidian-context-manager" "$CLAUDE_CONFIG_FILE" 2>/dev/null; then
            print_info "MCP server already configured in Claude Code"

            if [ "$INTERACTIVE" = true ]; then
                read -p "$(echo -e "${YELLOW}Update existing configuration?${NC} (y/n): ")" UPDATE_CONFIG
                if [[ ! "$UPDATE_CONFIG" =~ ^[Yy]$ ]]; then
                    print_info "Skipping MCP configuration update"
                    return 0
                fi
            fi
        fi

        # Backup existing config
        BACKUP_FILE="$CLAUDE_CONFIG_FILE.backup.$(date +%s)"
        if [ "$DRY_RUN" = false ]; then
            cp "$CLAUDE_CONFIG_FILE" "$BACKUP_FILE"
            print_info "Backed up to: $BACKUP_FILE"
        fi

        # Merge configuration using Python
        if [ "$DRY_RUN" = false ]; then
            python3 << PYTHON_EOF
import json
import sys

config_file = "$CLAUDE_CONFIG_FILE"

try:
    with open(config_file, 'r') as f:
        config = json.load(f)
except:
    config = {}

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['obsidian-context-manager'] = {
    "command": "node",
    "args": ["$SCRIPT_DIR/dist/index.js"],
    "cwd": "$SCRIPT_DIR",
    "env": {}
}

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')

print("Configuration updated successfully")
PYTHON_EOF
            if [ $? -eq 0 ]; then
                print_success "Updated Claude Code MCP configuration"
            else
                print_error "Failed to update configuration"
                return 1
            fi
        else
            print_info "[DRY RUN] Would update existing config with MCP server"
        fi
    else
        # Create new config file
        if [ "$DRY_RUN" = false ]; then
            cat > "$CLAUDE_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "obsidian-context-manager": {
      "command": "node",
      "args": ["$SCRIPT_DIR/dist/index.js"],
      "cwd": "$SCRIPT_DIR",
      "env": {}
    }
  }
}
EOF
            print_success "Created Claude Code MCP configuration"
        else
            print_info "[DRY RUN] Would create: $CLAUDE_CONFIG_FILE"
        fi
    fi

    echo ""
    print_info "MCP Server Configuration:"
    echo -e "  ${CYAN}Server name:${NC} obsidian-context-manager"
    echo -e "  ${CYAN}Command:${NC} node $SCRIPT_DIR/dist/index.js"
    echo -e "  ${CYAN}Vault config:${NC} $SCRIPT_DIR/.obsidian-mcp.json"
    echo ""
}

#############################################################################
# Configure User-Scoped MCP (~/.claude.json)
#############################################################################

configure_user_scoped_mcp() {
    print_header "Configuring User-Scoped MCP"

    USER_CONFIG="$HOME/.claude.json"

    print_step "Setting up user-scoped MCP configuration..."
    print_info "This makes the MCP server available globally from any directory"

    if [ -f "$USER_CONFIG" ]; then
        # Check if already configured
        if grep -q "obsidian-context-manager" "$USER_CONFIG" 2>/dev/null; then
            print_info "MCP server already in user config"

            if [ "$INTERACTIVE" = true ]; then
                read -p "$(echo -e "${YELLOW}Update existing configuration?${NC} (y/n): ")" UPDATE_USER
                if [[ ! "$UPDATE_USER" =~ ^[Yy]$ ]]; then
                    print_info "Skipping user-scoped MCP update"
                    return 0
                fi
            fi
        fi

        # Backup and merge
        BACKUP_FILE="$USER_CONFIG.backup.$(date +%s)"
        if [ "$DRY_RUN" = false ]; then
            cp "$USER_CONFIG" "$BACKUP_FILE"
            print_info "Backed up to: $BACKUP_FILE"

            python3 << PYTHON_EOF
import json

config_file = "$USER_CONFIG"

try:
    with open(config_file, 'r') as f:
        config = json.load(f)
except:
    config = {}

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['obsidian-context-manager'] = {
    "command": "node",
    "args": ["$SCRIPT_DIR/dist/index.js"],
    "cwd": "$SCRIPT_DIR",
    "env": {}
}

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
PYTHON_EOF
            print_success "Updated user-scoped MCP configuration"
        else
            print_info "[DRY RUN] Would update: $USER_CONFIG"
        fi
    else
        # Create new user config
        if [ "$DRY_RUN" = false ]; then
            cat > "$USER_CONFIG" << EOF
{
  "mcpServers": {
    "obsidian-context-manager": {
      "command": "node",
      "args": ["$SCRIPT_DIR/dist/index.js"],
      "cwd": "$SCRIPT_DIR",
      "env": {}
    }
  }
}
EOF
            print_success "Created user-scoped MCP configuration"
        else
            print_info "[DRY RUN] Would create: $USER_CONFIG"
        fi
    fi

    echo ""
    print_success "MCP server will be available globally from any directory"
}

#############################################################################
# Verification
#############################################################################

verify_installation() {
    print_header "Verifying Installation"

    local ERRORS=0

    # Check MCP server build
    print_step "Checking MCP server build..."
    if [ -f "$SCRIPT_DIR/dist/index.js" ]; then
        print_success "Server binary exists"
    else
        print_error "Server binary not found: $SCRIPT_DIR/dist/index.js"
        ((ERRORS++))
    fi

    # Check vault config
    print_step "Checking vault configuration..."
    if [ -f "$SCRIPT_DIR/.obsidian-mcp.json" ]; then
        print_success "Vault config exists"

        # Validate JSON
        if python3 -m json.tool "$SCRIPT_DIR/.obsidian-mcp.json" > /dev/null 2>&1; then
            print_success "Vault config is valid JSON"
        else
            print_error "Vault config has invalid JSON"
            ((ERRORS++))
        fi
    else
        print_error "Vault config not found"
        ((ERRORS++))
    fi

    # Check vault directory
    print_step "Checking vault structure..."
    if [ -d "$PRIMARY_VAULT_PATH" ]; then
        print_success "Vault directory exists"

        EXPECTED_DIRS=("sessions" "topics" "decisions" "projects")
        for dir in "${EXPECTED_DIRS[@]}"; do
            if [ -d "$PRIMARY_VAULT_PATH/$dir" ]; then
                echo -e "  ${GREEN}✓${NC} $dir/"
            else
                echo -e "  ${RED}✗${NC} $dir/ missing"
                ((ERRORS++))
            fi
        done
    else
        print_error "Vault directory not found"
        ((ERRORS++))
    fi

    # Check Claude MCP config
    print_step "Checking Claude Code MCP configuration..."
    CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/config.json"
    if [ -f "$CLAUDE_CONFIG" ]; then
        if grep -q "obsidian-context-manager" "$CLAUDE_CONFIG"; then
            print_success "MCP server configured in Claude Code"
        else
            print_warning "MCP server not found in Claude config"
            ((ERRORS++))
        fi
    else
        print_warning "Claude config not found (may be created on first run)"
    fi

    echo ""
    if [ $ERRORS -eq 0 ]; then
        print_success "All verification checks passed!"
        return 0
    else
        print_error "Verification found $ERRORS error(s)"
        return 1
    fi
}

#############################################################################
# Print Next Steps
#############################################################################

print_next_steps() {
    print_header "Installation Complete!"

    echo -e "${GREEN}✓ Installation successful!${NC}\n"

    echo -e "${CYAN}What was installed:${NC}\n"

    echo -e "  ${GREEN}1. MCP Server${NC}"
    echo -e "     Binary: $SCRIPT_DIR/dist/index.js"
    echo ""

    echo -e "  ${GREEN}2. Vault Configuration${NC}"
    echo -e "     Config: $SCRIPT_DIR/.obsidian-mcp.json"
    echo -e "     Vault: $PRIMARY_VAULT_PATH"
    echo ""

    echo -e "  ${GREEN}3. Claude Code Integration${NC}"
    echo -e "     App config: ~/Library/Application Support/Claude/config.json"
    echo -e "     User config: ~/.claude.json"
    echo ""

    echo -e "${CYAN}Next Steps:${NC}\n"

    echo -e "  ${YELLOW}1. Restart Claude Code${NC}"
    echo -e "     Close any running sessions and start fresh"
    echo ""

    echo -e "  ${YELLOW}2. Test the integration${NC}"
    echo -e "     Ask Claude: \"Search my vault for testing\""
    echo -e "     Or: \"Create a topic about testing the MCP integration\""
    echo ""

    echo -e "  ${YELLOW}3. Optional: Set up CLAUDE.md${NC}"
    echo -e "     Create ~/.claude/CLAUDE.md for custom instructions"
    echo -e "     See templates/CLAUDE.md.template for an example"
    echo ""

    echo -e "  ${YELLOW}4. Close your first session${NC}"
    echo -e "     Type: /close"
    echo ""

    echo -e "${CYAN}Useful Commands:${NC}\n"
    echo -e "  ${BLUE}/mb${NC}        - Load memory base (recent work summary)"
    echo -e "  ${BLUE}/sessions${NC}  - View recent sessions"
    echo -e "  ${BLUE}/projects${NC}  - View tracked repositories"
    echo -e "  ${BLUE}/close${NC}     - Save session and update vault"
    echo ""

    echo -e "${CYAN}Documentation:${NC}\n"
    echo -e "  README.md        - Full feature documentation"
    echo -e "  INSTALL.md       - Detailed installation guide"
    echo -e "  QUICKSTART.md    - Quick start guide"
    echo ""

    echo -e "${GREEN}Happy coding with Claude! 🚀${NC}\n"
}

#############################################################################
# Main Installation Flow
#############################################################################

main() {
    # Parse command line arguments
    parse_args "$@"

    # Print banner
    echo ""
    echo -e "${MAGENTA}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}║                                                            ║${NC}"
    echo -e "${MAGENTA}║         Obsidian MCP Server - macOS Installer              ║${NC}"
    echo -e "${MAGENTA}║                                                            ║${NC}"
    echo -e "${MAGENTA}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [ "$DRY_RUN" = true ]; then
        print_warning "DRY RUN MODE - No changes will be made"
        echo ""
    fi

    # Run installation steps
    check_prerequisites
    prompt_vault_config
    build_mcp_server
    create_vault_config
    create_vault_structure
    configure_claude_mcp
    configure_user_scoped_mcp
    verify_installation

    # Print next steps
    print_next_steps
}

# Run main function with all arguments
main "$@"
