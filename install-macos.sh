#!/usr/bin/env bash

#############################################################################
# Obsidian MCP Server - macOS Installer
#############################################################################
#
# This script installs the Obsidian MCP Server and all required components
# for Claude Code on macOS. It provides verbose output explaining every step.
#
# Usage: ./install-macos.sh [options]
#
# Options:
#   --primary-vault PATH      Specify primary vault path (enables non-interactive mode)
#   --primary-vault-name NAME Specify primary vault name
#   --skip-clone              Skip cloning config/hooks repos (use if already cloned)
#   --non-interactive         Run without prompts (requires --primary-vault)
#   --dry-run                 Show what would be done without making changes
#   --help                    Show this help message
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

# Configuration
PRIMARY_VAULT_PATH=""
PRIMARY_VAULT_NAME=""
SECONDARY_VAULTS=()
SKIP_CLONE=false
DRY_RUN=false
INTERACTIVE=true
USERNAME=$(whoami)

# Repository URL (update this if using different hosting)
CONFIG_REPO="${CONFIG_REPO:-ssh://git@git.uoregon.edu/jsdev/claude-code-config.git}"

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

print_file_created() {
    echo -e "${GREEN}  Created:${NC} $1"
    echo -e "${CYAN}  Purpose:${NC} $2"
}

print_file_exists() {
    echo -e "${YELLOW}  Exists:${NC} $1"
    echo -e "${CYAN}  Purpose:${NC} $2"
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
            --primary-vault)
                PRIMARY_VAULT_PATH="$2"
                INTERACTIVE=false
                shift 2
                ;;
            --primary-vault-name)
                PRIMARY_VAULT_NAME="$2"
                shift 2
                ;;
            --skip-clone)
                SKIP_CLONE=true
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
                sed -n '3,18p' "$0" | sed 's/^# //' | sed 's/^#//'
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
# Prompt for Vault Configuration
#############################################################################

prompt_vault_config() {
    if [ "$INTERACTIVE" = false ]; then
        print_info "Non-interactive mode - using provided configuration"
        return
    fi

    print_header "Vault Configuration"

    print_info "The MCP server needs to know where your Obsidian vault(s) are located."
    print_info "You can configure one primary vault and optionally add secondary vaults."
    echo ""

    # Primary vault path
    if [ -z "$PRIMARY_VAULT_PATH" ]; then
        print_step "Primary vault configuration:"
        echo ""

        while true; do
            read -p "$(echo -e "${BLUE}Primary vault path${NC} (e.g., ~/Documents/ObsidianVault): ")" PRIMARY_VAULT_PATH

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
    fi

    # Primary vault name
    if [ -z "$PRIMARY_VAULT_NAME" ]; then
        DEFAULT_NAME=$(basename "$PRIMARY_VAULT_PATH")
        read -p "$(echo -e "${BLUE}Primary vault name${NC} (default: $DEFAULT_NAME): ")" PRIMARY_VAULT_NAME

        if [ -z "$PRIMARY_VAULT_NAME" ]; then
            PRIMARY_VAULT_NAME="$DEFAULT_NAME"
        fi

        print_success "Primary vault name: $PRIMARY_VAULT_NAME"
    fi

    echo ""

    # Secondary vaults
    print_step "Secondary vault configuration (optional):"
    print_info "Secondary vaults allow you to search multiple Obsidian vaults simultaneously."
    print_info "You can add as many secondary vaults as you like (or none)."
    echo ""

    while true; do
        read -p "$(echo -e "${BLUE}Add a secondary vault?${NC} (y/n): ")" ADD_SECONDARY

        if [[ ! "$ADD_SECONDARY" =~ ^[Yy]$ ]]; then
            break
        fi

        # Get secondary vault path
        while true; do
            read -p "$(echo -e "${BLUE}Secondary vault path${NC}: ")" SEC_PATH

            # Expand tilde
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
        print_info "Authority level controls how this vault's content ranks in search results:"
        echo ""
        print_info "  ${GREEN}'curated'${NC} (recommended for most secondary vaults)"
        print_info "    → All content ranks as high-quality documentation (+5 boost)"
        print_info "    → Use for: Work documentation, technical notes, professional content"
        echo ""
        print_info "  ${YELLOW}'default'${NC} (intelligent directory-based ranking)"
        print_info "    → Ranks based on directory structure (topics/ high, sessions/ low)"
        print_info "    → Use for: Vaults with Claude-style structure (topics/, sessions/, etc.)"
        echo ""
        print_info "  ${CYAN}'reference'${NC} (lower priority reference material)"
        print_info "    → Content ranks lower, like session logs (+1 boost)"
        print_info "    → Use for: Archives, personal brainstorming, draft content"
        echo ""
        read -p "$(echo -e "${BLUE}Authority level${NC} (curated/default/reference) [curated]: ")" AUTHORITY

        if [ -z "$AUTHORITY" ]; then
            AUTHORITY="curated"
        fi

        # Validate authority
        if [[ ! "$AUTHORITY" =~ ^(curated|default|reference)$ ]]; then
            print_warning "Invalid authority level, using 'curated'"
            AUTHORITY="curated"
        fi

        # Store secondary vault info (format: path|name|authority)
        SECONDARY_VAULTS+=("$SEC_PATH|$SEC_NAME|$AUTHORITY")
        print_success "Added secondary vault: $SEC_NAME ($AUTHORITY)"
        echo ""
    done

    # Summary
    echo ""
    print_info "Vault configuration summary:"
    echo -e "  ${GREEN}Primary:${NC} $PRIMARY_VAULT_NAME"
    echo -e "    Path: $PRIMARY_VAULT_PATH"

    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        echo -e "  ${GREEN}Secondary vaults:${NC}"
        for vault in "${SECONDARY_VAULTS[@]}"; do
            IFS='|' read -r path name authority <<< "$vault"
            echo -e "    - $name ($authority)"
            echo -e "      Path: $path"
        done
    else
        echo -e "  ${YELLOW}No secondary vaults${NC}"
    fi
    echo ""
}

#############################################################################
# Prerequisite Checks
#############################################################################

check_prerequisites() {
    print_header "Checking Prerequisites"

    # Check for Node.js
    print_step "Checking for Node.js..."
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js found: $NODE_VERSION"

        # Verify version is 18+
        MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
        if [ "$MAJOR_VERSION" -lt 18 ]; then
            print_error "Node.js version 18+ required (found $NODE_VERSION)"
            exit 1
        fi
    else
        print_error "Node.js not found. Install with: brew install node"
        exit 1
    fi

    # Check for git
    print_step "Checking for git..."
    if command -v git &> /dev/null; then
        GIT_VERSION=$(git --version)
        print_success "Git found: $GIT_VERSION"
    else
        print_error "Git not found. Please install git first."
        exit 1
    fi

    # Check for Claude Code config directory
    print_step "Checking for Claude Code installation..."
    CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
    if [ -d "$CLAUDE_CONFIG_DIR" ]; then
        print_success "Claude Code installation detected"
        print_info "Config directory: $CLAUDE_CONFIG_DIR"
    else
        print_warning "Claude Code config directory not found"
        print_info "Claude Code may not be installed or hasn't been run yet"
        print_info "Download from: https://claude.com/claude-code"
    fi
}

#############################################################################
# Clone Configuration Repositories
#############################################################################

clone_config_repository() {
    if [ "$SKIP_CLONE" = true ]; then
        print_header "Skipping Repository Clone (--skip-clone flag set)"
        return
    fi

    print_header "Cloning Configuration Repository"

    # Clone claude-code-config (now includes hooks)
    print_step "Cloning claude-code-config repository..."
    if [ -d "$HOME/claude-code-config" ]; then
        print_warning "Directory already exists: $HOME/claude-code-config"
        print_info "Using existing directory (update manually if needed)"
    else
        print_info "Repository: $CONFIG_REPO"
        print_info "Destination: $HOME/claude-code-config"
        execute_or_dry_run git clone "$CONFIG_REPO" "$HOME/claude-code-config"
        print_success "Configuration repository cloned"
        print_info "Contains: CLAUDE.md, settings.json, slash commands, and hooks"
    fi
}

#############################################################################
# Install Claude Code Configuration
#############################################################################

install_claude_config() {
    print_header "Installing Claude Code Configuration"

    CLAUDE_USER_CONFIG="$HOME/.claude"

    print_step "Setting up ~/.claude/ directory..."

    if [ -d "$CLAUDE_USER_CONFIG" ]; then
        print_warning "Configuration directory already exists: $CLAUDE_USER_CONFIG"
        print_info "Backing up to: $CLAUDE_USER_CONFIG.backup.$(date +%s)"
        execute_or_dry_run mv "$CLAUDE_USER_CONFIG" "$CLAUDE_USER_CONFIG.backup.$(date +%s)"
    fi

    if [ "$DRY_RUN" = false ]; then
        cp -R "$HOME/claude-code-config" "$CLAUDE_USER_CONFIG"
        print_success "Configuration directory created"
    else
        print_info "[DRY RUN] Would copy: $HOME/claude-code-config → $CLAUDE_USER_CONFIG"
    fi

    # Describe what was installed
    print_info "Installed configuration files:"
    echo ""

    if [ -f "$CLAUDE_USER_CONFIG/CLAUDE.md" ]; then
        print_file_created "$CLAUDE_USER_CONFIG/CLAUDE.md" \
            "Global instructions Claude reads at every session start"
    fi

    if [ -f "$CLAUDE_USER_CONFIG/settings.json" ]; then
        print_file_created "$CLAUDE_USER_CONFIG/settings.json" \
            "User-scope settings: file permissions, hooks, model preferences"
    fi

    if [ -d "$CLAUDE_USER_CONFIG/commands" ]; then
        print_file_created "$CLAUDE_USER_CONFIG/commands/" \
            "Custom slash commands directory"

        # List individual commands
        for cmd in "$CLAUDE_USER_CONFIG/commands"/*.md; do
            if [ -f "$cmd" ]; then
                CMD_NAME=$(basename "$cmd" .md)
                echo -e "    ${GREEN}/${CMD_NAME}${NC}"
            fi
        done
    fi

    if [ -d "$CLAUDE_USER_CONFIG/hooks" ]; then
        print_file_created "$CLAUDE_USER_CONFIG/hooks/" \
            "Claude Code hooks directory"

        # Make all hooks executable
        if [ "$DRY_RUN" = false ]; then
            chmod +x "$CLAUDE_USER_CONFIG/hooks"/*.sh 2>/dev/null || true
        fi

        # List individual hooks
        for hook in "$CLAUDE_USER_CONFIG/hooks"/*.sh; do
            if [ -f "$hook" ]; then
                HOOK_NAME=$(basename "$hook")
                case "$HOOK_NAME" in
                    session-start.sh)
                        echo -e "    ${GREEN}$HOOK_NAME${NC} - Runs when session starts"
                        ;;
                    user-prompt-vault-search.sh)
                        echo -e "    ${GREEN}$HOOK_NAME${NC} - Enforces vault search before tool use"
                        ;;
                    pretooluse-*.sh)
                        echo -e "    ${GREEN}$HOOK_NAME${NC} - Validates tool usage"
                        ;;
                    *)
                        echo -e "    ${GREEN}$HOOK_NAME${NC}"
                        ;;
                esac
            fi
        done
    fi
}

#############################################################################
# Process CLAUDE.md Template
#############################################################################

process_claude_md_template() {
    print_header "Processing CLAUDE.md Template"

    local TEMPLATE_FILE="$SCRIPT_DIR/templates/CLAUDE.md.template"
    local OUTPUT_FILE="$HOME/.claude/CLAUDE.md"

    if [ ! -f "$TEMPLATE_FILE" ]; then
        print_error "Template file not found: $TEMPLATE_FILE"
        return 1
    fi

    print_step "Generating CLAUDE.md from template..."

    # Create backup if file exists
    if [ -f "$OUTPUT_FILE" ] && [ "$DRY_RUN" = false ]; then
        cp "$OUTPUT_FILE" "$OUTPUT_FILE.backup.$(date +%s)"
        print_info "Created backup: $OUTPUT_FILE.backup.$(date +%s)"
    fi

    # Replace placeholders in template
    if [ "$DRY_RUN" = false ]; then
        sed "s|{{PRIMARY_VAULT_PATH}}|$PRIMARY_VAULT_PATH|g" "$TEMPLATE_FILE" > "$OUTPUT_FILE"
        print_success "Generated CLAUDE.md with your vault path"
    else
        print_info "[DRY RUN] Would generate CLAUDE.md from template with:"
    fi

    # Show what was configured
    echo -e "${CYAN}Configuration:${NC}"
    echo -e "  ${CYAN}Primary Vault:${NC} $PRIMARY_VAULT_PATH"
    echo -e "  ${CYAN}Output File:${NC} $OUTPUT_FILE"
    echo -e "  ${CYAN}Memory File:${NC} $PRIMARY_VAULT_PATH/memory-base.md"
}

#############################################################################
# Update Settings.json with User-Specific Paths
#############################################################################

update_settings_json() {
    print_header "Configuring User-Specific Paths"

    SETTINGS_FILE="$HOME/.claude/settings.json"

    if [ ! -f "$SETTINGS_FILE" ]; then
        print_error "Settings file not found: $SETTINGS_FILE"
        return 1
    fi

    print_step "Updating settings.json with your vault and system paths..."

    # Create backup
    if [ "$DRY_RUN" = false ]; then
        cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup.$(date +%s)"
        print_info "Created backup: $SETTINGS_FILE.backup.$(date +%s)"
    fi

    # Build permissions array for all vaults
    VAULT_PERMISSIONS=""

    # Add primary vault permissions
    VAULT_PERMISSIONS+="Read($PRIMARY_VAULT_PATH/**)
"
    VAULT_PERMISSIONS+="Write($PRIMARY_VAULT_PATH/**)
"
    VAULT_PERMISSIONS+="Edit($PRIMARY_VAULT_PATH/**)
"

    # Add secondary vault permissions
    for VAULT_KEY in "${!SECONDARY_VAULTS[@]}"; do
        VAULT_DATA="${SECONDARY_VAULTS[$VAULT_KEY]}"
        VAULT_PATH=$(echo "$VAULT_DATA" | cut -d'|' -f1)

        VAULT_PERMISSIONS+="Read($VAULT_PATH/**)
"
        VAULT_PERMISSIONS+="Write($VAULT_PATH/**)
"
        VAULT_PERMISSIONS+="Edit($VAULT_PATH/**)
"
    done

    # Add MCP server directory permissions
    VAULT_PERMISSIONS+="Read($SCRIPT_DIR/**)
"
    VAULT_PERMISSIONS+="Write($SCRIPT_DIR/**)
"
    VAULT_PERMISSIONS+="Edit($SCRIPT_DIR/**)
"

    # Build additionalDirectories array
    ADDITIONAL_DIRS=""

    # Add primary vault
    ADDITIONAL_DIRS+="$PRIMARY_VAULT_PATH
"

    # Add secondary vaults
    for VAULT_KEY in "${!SECONDARY_VAULTS[@]}"; do
        VAULT_DATA="${SECONDARY_VAULTS[$VAULT_KEY]}"
        VAULT_PATH=$(echo "$VAULT_DATA" | cut -d'|' -f1)
        ADDITIONAL_DIRS+="$VAULT_PATH
"
    done

    # Add current directory (as user suggested)
    ADDITIONAL_DIRS+="."

    # Replace hook paths with actual user paths
    HOOK_DIR="$HOME/.claude/hooks"

    if [ "$DRY_RUN" = false ]; then
        # Export variables for Python script
        export PRIMARY_VAULT_PATH
        export SCRIPT_DIR
        export HOOK_DIR
        export ADDITIONAL_DIRS
        export VAULT_PERMISSIONS

        # Use python for JSON manipulation to preserve structure
        # We'll load existing permissions and update only the vault paths
        python3 << 'EOF'
import json
import re
import os
import sys

SETTINGS_FILE = os.path.expanduser('~/.claude/settings.json')
PRIMARY_VAULT_PATH = os.getenv('PRIMARY_VAULT_PATH', '')
SCRIPT_DIR = os.getenv('SCRIPT_DIR', '')
HOOK_DIR = os.getenv('HOOK_DIR', '')
ADDITIONAL_DIRS = os.getenv('ADDITIONAL_DIRS', '')
VAULT_PERMISSIONS = os.getenv('VAULT_PERMISSIONS', '')

# Read current settings
try:
    with open(SETTINGS_FILE, 'r') as f:
        settings = json.load(f)
except Exception as e:
    print(f"Error reading settings file: {e}", file=sys.stderr)
    sys.exit(1)

# Parse vault permissions from environment variable
vault_perms = []
if VAULT_PERMISSIONS:
    # Split by newline and clean up
    for line in VAULT_PERMISSIONS.strip().split('\n'):
        line = line.strip()
        if line:
            # Remove leading/trailing quotes and commas
            line = line.strip(',').strip().strip('"')
            if line:
                vault_perms.append(line)

# Get existing permissions and filter out old vault paths
existing_perms = settings.get('permissions', {}).get('allow', [])
filtered_perms = []

# Keep all permissions that don't start with Read/Write/Edit of /Users paths
for perm in existing_perms:
    # Check if this is a vault-related permission we need to replace
    if perm.startswith(('Read(/Users/', 'Write(/Users/', 'Edit(/Users/')):
        # Skip - we'll add the new vault permissions
        continue
    filtered_perms.append(perm)

# Add new vault permissions at the beginning
new_perms = vault_perms + filtered_perms

# Update permissions
if 'permissions' not in settings:
    settings['permissions'] = {}
settings['permissions']['allow'] = new_perms

# Update additionalDirectories
if ADDITIONAL_DIRS:
    add_dirs = []
    for line in ADDITIONAL_DIRS.strip().split('\n'):
        line = line.strip().strip(',').strip().strip('"')
        if line:
            add_dirs.append(line)
    settings['permissions']['additionalDirectories'] = add_dirs

# Update hook paths
if HOOK_DIR:
    for hook_type in ['SessionStart', 'UserPromptSubmit', 'PreToolUse']:
        if hook_type in settings.get('hooks', {}):
            for hook_group in settings['hooks'][hook_type]:
                if 'hooks' in hook_group:
                    for hook in hook_group['hooks']:
                        if 'command' in hook:
                            # Replace hardcoded hook paths
                            hook['command'] = re.sub(
                                r'/Users/[^/]+/\.claude/hooks/',
                                HOOK_DIR + '/',
                                hook['command']
                            )

# Write updated settings
try:
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(settings, f, indent=2)
        f.write('\n')
    print("Settings updated successfully")
except Exception as e:
    print(f"Error writing settings file: {e}", file=sys.stderr)
    sys.exit(1)
EOF

        if [ $? -eq 0 ]; then
            print_success "Updated settings.json with your paths"
        else
            print_error "Failed to update settings.json"
            print_info "Restoring from backup..."
            mv "$SETTINGS_FILE.backup.$(date +%s)" "$SETTINGS_FILE"
            return 1
        fi
    else
        print_info "[DRY RUN] Would update settings.json with:"
        echo -e "${CYAN}  - Vault permissions for all configured vaults${NC}"
        echo -e "${CYAN}  - additionalDirectories: vaults + '.'${NC}"
        echo -e "${CYAN}  - Hook paths: $HOOK_DIR${NC}"
    fi

    echo ""
    print_info "Configuration details:"
    echo -e "  ${CYAN}Primary vault:${NC} $PRIMARY_VAULT_PATH"

    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        echo -e "  ${CYAN}Secondary vaults:${NC}"
        for VAULT_KEY in "${!SECONDARY_VAULTS[@]}"; do
            VAULT_DATA="${SECONDARY_VAULTS[$VAULT_KEY]}"
            VAULT_PATH=$(echo "$VAULT_DATA" | cut -d'|' -f1)
            echo -e "    - $VAULT_PATH"
        done
    fi

    echo -e "  ${CYAN}Hooks directory:${NC} $HOOK_DIR"
    echo -e "  ${CYAN}Additional directories:${NC} Includes '.'"
    echo ""
}

#############################################################################
# Update Hook Files with User-Specific Paths
#############################################################################

update_hook_paths() {
    print_header "Configuring Hook File Paths"

    HOOKS_DIR="$HOME/.claude/hooks"
    SESSION_START_HOOK="$HOOKS_DIR/session-start.sh"

    if [ ! -f "$SESSION_START_HOOK" ]; then
        print_error "session-start.sh not found: $SESSION_START_HOOK"
        return 1
    fi

    print_step "Updating session-start.sh with your vault path..."

    # Create backup
    if [ "$DRY_RUN" = false ]; then
        cp "$SESSION_START_HOOK" "$SESSION_START_HOOK.backup.$(date +%s)"
        print_info "Created backup: $SESSION_START_HOOK.backup.$(date +%s)"
    fi

    if [ "$DRY_RUN" = false ]; then
        # Use sed to replace hardcoded vault path
        # Note: No Python script paths to update - hook now just instructs Claude to call get_memory_base
        sed -i.tmp \
            -e "s|^VAULT_PATH=\"/Users/[^/]*/Documents/Obsidian/Claude/Claude\"|VAULT_PATH=\"$PRIMARY_VAULT_PATH\"|" \
            "$SESSION_START_HOOK"

        # Remove sed backup file
        rm -f "$SESSION_START_HOOK.tmp"

        print_success "Updated session-start.sh hook"
    else
        print_info "[DRY RUN] Would update session-start.sh with:"
        echo -e "${CYAN}  - VAULT_PATH: $PRIMARY_VAULT_PATH${NC}"
    fi

    echo ""
    print_info "Hook configuration:"
    echo -e "  ${CYAN}Primary vault:${NC} $PRIMARY_VAULT_PATH"
    echo -e "  ${CYAN}Memory file:${NC} $PRIMARY_VAULT_PATH/memory-base.md"
    echo -e "  ${CYAN}CLAUDE.md:${NC} $HOME/.claude/CLAUDE.md"
    echo ""
}

#############################################################################
# Build MCP Server
#############################################################################

build_mcp_server() {
    print_header "Building Obsidian MCP Server"

    print_step "Installing npm dependencies..."
    print_info "Location: $SCRIPT_DIR"

    cd "$SCRIPT_DIR"

    if [ "$DRY_RUN" = false ]; then
        npm install
        print_success "Dependencies installed"
    else
        print_info "[DRY RUN] Would execute: npm install"
    fi

    print_step "Building TypeScript to JavaScript..."
    if [ "$DRY_RUN" = false ]; then
        npm run build
        print_success "Build completed"

        if [ -f "$SCRIPT_DIR/dist/index.js" ]; then
            print_file_created "$SCRIPT_DIR/dist/index.js" \
                "MCP server entry point (executed by Claude Code)"
        fi
    else
        print_info "[DRY RUN] Would execute: npm run build"
    fi
}

#############################################################################
# Create Vault Structure
#############################################################################

create_vault_structure() {
    print_header "Creating Vault Directory Structure"

    # Create primary vault structure
    create_single_vault_structure "$PRIMARY_VAULT_PATH" "$PRIMARY_VAULT_NAME"

    # Create secondary vault structures
    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        for vault in "${SECONDARY_VAULTS[@]}"; do
            IFS='|' read -r path name authority <<< "$vault"
            create_single_vault_structure "$path" "$name"
        done
    fi
}

create_single_vault_structure() {
    local VAULT_PATH="$1"
    local VAULT_NAME="$2"

    print_step "Creating vault structure: $VAULT_NAME"
    print_info "Location: $VAULT_PATH"

    # Create main vault directory (should already exist from prompt)
    if [ ! -d "$VAULT_PATH" ] && [ "$DRY_RUN" = false ]; then
        mkdir -p "$VAULT_PATH"
    fi

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
        FULL_PATH="$VAULT_PATH/$dir"
        if [ -d "$FULL_PATH" ]; then
            print_file_exists "$FULL_PATH" \
                "$(get_dir_purpose "$dir")"
        else
            execute_or_dry_run mkdir -p "$FULL_PATH"
            print_file_created "$FULL_PATH" \
                "$(get_dir_purpose "$dir")"
        fi
    done

    # Create index.md if it doesn't exist
    if [ ! -f "$VAULT_PATH/index.md" ] && [ "$DRY_RUN" = false ]; then
        cat > "$VAULT_PATH/index.md" << EOF
# Knowledge Vault: $VAULT_NAME

Welcome to your Obsidian MCP knowledge vault! This vault is managed by Claude Code and contains:

## Structure

- **sessions/** - Conversation logs organized by month
- **topics/** - Technical documentation and how-to guides
- **decisions/** - Architectural Decision Records (ADRs)
- **projects/** - Git repository tracking and commit history
- **archive/** - Stale or deprecated content

## Getting Started

Use Claude Code to interact with this vault:

- Create topics: "Create a topic about..."
- Search: "Search my vault for..."
- Create decisions: "Document the decision to..."
- Close session: \`/close\`

The vault grows with your conversations!
EOF
        print_file_created "$VAULT_PATH/index.md" \
            "Vault overview and navigation guide"
    elif [ "$DRY_RUN" = true ]; then
        print_info "[DRY RUN] Would create: $VAULT_PATH/index.md"
    fi

    echo ""
}

get_dir_purpose() {
    case "$1" in
        "sessions")
            echo "Conversation logs organized by year-month"
            ;;
        "topics")
            echo "Technical documentation and implementation guides"
            ;;
        "decisions")
            echo "Architectural Decision Records (ADRs)"
            ;;
        "decisions/vault")
            echo "Vault-level ADRs (MCP system decisions)"
            ;;
        "projects")
            echo "Git repository tracking and metadata"
            ;;
        "archive")
            echo "Deprecated or stale content"
            ;;
        "archive/topics")
            echo "Archived topic pages"
            ;;
        *)
            echo "Vault subdirectory"
            ;;
    esac
}

#############################################################################
# Configure Claude Code MCP Integration
#############################################################################

configure_claude_mcp() {
    print_header "Configuring Claude Code MCP Integration"

    CLAUDE_CONFIG_FILE="$HOME/Library/Application Support/Claude/config.json"
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

    print_step "Configuring MCP server in Claude Code..."
    print_info "Config file: $CLAUDE_CONFIG_FILE"

    # Create directory if it doesn't exist
    CLAUDE_CONFIG_DIR="$(dirname "$CLAUDE_CONFIG_FILE")"

    if [ "$DRY_RUN" = false ]; then
        if ! mkdir -p "$CLAUDE_CONFIG_DIR" 2>/dev/null; then
            print_error "Failed to create directory: $CLAUDE_CONFIG_DIR"
            print_error "Permission denied - you need to create this config file manually"
            echo ""
            print_warning "MANUAL STEP REQUIRED"
            echo ""
            print_info "Please run the following commands in a ${YELLOW}new terminal window${NC}:"
            echo ""
            echo -e "${CYAN}# Step 1: Create the directory${NC}"
            echo -e "${BLUE}mkdir -p \"$CLAUDE_CONFIG_DIR\"${NC}"
            echo ""
            echo -e "${CYAN}# Step 2: Create the config file${NC}"
            # Use a non-quoted heredoc so variables are expanded in the output
            cat << EOF
${BLUE}cat > "$CLAUDE_CONFIG_FILE" << 'CONFIGEOF'
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
CONFIGEOF${NC}
EOF
            echo ""
            echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${YELLOW}After running those commands, press ENTER to continue...${NC}"
            echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            read -r

            # Verify the file was created
            if [ ! -f "$CLAUDE_CONFIG_FILE" ]; then
                print_error "Config file not found at: $CLAUDE_CONFIG_FILE"
                print_error "Installation cannot continue. Please create the file and re-run the installer."
                return 1
            fi

            print_success "Config file verified: $CLAUDE_CONFIG_FILE"
            # File was created manually, skip the rest of the config creation
            echo ""
            print_info "MCP Server Configuration:"
            echo -e "  ${CYAN}Server name:${NC} obsidian-context-manager"
            echo -e "  ${CYAN}Config file:${NC} $CLAUDE_CONFIG_FILE"
            return 0
        else
            print_success "Created directory: $CLAUDE_CONFIG_DIR"
        fi
    else
        print_info "[DRY RUN] Would create directory: $CLAUDE_CONFIG_DIR"
    fi

    # Check if config file exists
    if [ -f "$CLAUDE_CONFIG_FILE" ]; then
        print_warning "Claude config file already exists"
        print_info "Backing up to: $CLAUDE_CONFIG_FILE.backup.$(date +%s)"
        execute_or_dry_run cp "$CLAUDE_CONFIG_FILE" "$CLAUDE_CONFIG_FILE.backup.$(date +%s)"
    fi

    # Generate new config
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
        print_success "Claude Code configuration updated"
    else
        print_info "[DRY RUN] Would create config at: $CLAUDE_CONFIG_FILE"
    fi

    echo ""
    print_info "MCP Server Configuration:"
    echo -e "  ${CYAN}Server name:${NC} obsidian-context-manager"
    echo -e "  ${CYAN}Command:${NC} node"
    echo -e "  ${CYAN}Entry point:${NC} $SCRIPT_DIR/dist/index.js"
    echo -e "  ${CYAN}Working directory (cwd):${NC} $SCRIPT_DIR"
    echo -e "  ${CYAN}Environment variables:${NC} none (vault config in .obsidian-mcp.json)"
    echo ""
    print_info "The MCP server will read vault configuration from:"
    echo -e "  ${CYAN}$SCRIPT_DIR/.obsidian-mcp.json${NC}"
}

#############################################################################
# Configure User-Scoped MCP (~/.claude.json)
#############################################################################

configure_user_scoped_mcp() {
    print_header "Configuring User-Scoped MCP Integration"

    USER_CLAUDE_CONFIG="$HOME/.claude.json"
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

    print_step "Configuring user-scoped MCP server..."
    print_info "Config file: $USER_CLAUDE_CONFIG"
    echo ""
    print_info "This makes the MCP server available globally from any directory"

    # Check if config file exists
    if [ -f "$USER_CLAUDE_CONFIG" ]; then
        print_warning "User config file already exists"

        # Check if it already has our MCP server configured
        if grep -q "obsidian-context-manager" "$USER_CLAUDE_CONFIG" 2>/dev/null; then
            print_info "MCP server already configured in user scope"

            # Ask if they want to update it
            if [ "$NON_INTERACTIVE" = false ]; then
                echo ""
                read -p "Update existing configuration? (y/N): " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    print_info "Skipping user-scoped MCP configuration"
                    return 0
                fi
            fi
        fi

        # Backup existing config
        BACKUP_FILE="$USER_CLAUDE_CONFIG.backup.$(date +%s)"
        print_info "Backing up to: $BACKUP_FILE"
        execute_or_dry_run cp "$USER_CLAUDE_CONFIG" "$BACKUP_FILE"

        # Use Python to merge the MCP server config
        if [ "$DRY_RUN" = false ]; then
            python3 << PYTHON_EOF
import json
import sys

config_file = "$USER_CLAUDE_CONFIG"
backup_file = "$BACKUP_FILE"

try:
    # Read existing config
    with open(config_file, 'r') as f:
        config = json.load(f)

    # Ensure mcpServers exists
    if 'mcpServers' not in config:
        config['mcpServers'] = {}

    # Add or update obsidian-context-manager
    config['mcpServers']['obsidian-context-manager'] = {
        "command": "node",
        "args": ["$SCRIPT_DIR/dist/index.js"],
        "cwd": "$SCRIPT_DIR",
        "env": {}
    }

    # Write updated config
    with open(config_file, 'w') as f:
        json.dump(config, f, indent=2)

    print("Successfully updated user-scoped MCP configuration")
    sys.exit(0)

except Exception as e:
    print(f"Error updating config: {e}", file=sys.stderr)
    # Restore backup on error
    import shutil
    try:
        shutil.copy2(backup_file, config_file)
        print(f"Restored backup from: {backup_file}", file=sys.stderr)
    except:
        pass
    sys.exit(1)
PYTHON_EOF

            if [ $? -eq 0 ]; then
                print_success "User-scoped MCP configuration updated"
            else
                print_error "Failed to update user-scoped MCP configuration"
                return 1
            fi
        else
            print_info "[DRY RUN] Would update existing config with MCP server"
        fi
    else
        # Create new config file
        if [ "$DRY_RUN" = false ]; then
            cat > "$USER_CLAUDE_CONFIG" << EOF
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
            print_info "[DRY RUN] Would create new config at: $USER_CLAUDE_CONFIG"
        fi
    fi

    echo ""
    print_info "User-Scoped MCP Configuration:"
    echo -e "  ${CYAN}Server name:${NC} obsidian-context-manager"
    echo -e "  ${CYAN}Command:${NC} node"
    echo -e "  ${CYAN}Entry point:${NC} $SCRIPT_DIR/dist/index.js"
    echo -e "  ${CYAN}Working directory (cwd):${NC} $SCRIPT_DIR"
    echo -e "  ${CYAN}Scope:${NC} User (available globally from any directory)"
    echo ""
    print_success "The MCP server will now be available in all Claude Code sessions"
}

#############################################################################
# Create Multi-Vault Config (Optional)
#############################################################################

create_multi_vault_config() {
    print_header "Creating Vault Configuration"

    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    VAULT_CONFIG="$SCRIPT_DIR/.obsidian-mcp.json"

    print_step "Creating .obsidian-mcp.json in MCP server directory..."
    print_info "Location: $VAULT_CONFIG"

    # Backup existing config
    if [ -f "$VAULT_CONFIG" ] && [ "$DRY_RUN" = false ]; then
        BACKUP_FILE="$VAULT_CONFIG.backup.$(date +%s)"
        cp "$VAULT_CONFIG" "$BACKUP_FILE"
        print_warning "Backed up existing config to: $BACKUP_FILE"
    fi

    # Build secondary vaults JSON array
    SECONDARY_JSON="[]"
    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        SECONDARY_JSON="["
        FIRST=true
        for vault in "${SECONDARY_VAULTS[@]}"; do
            IFS='|' read -r path name authority <<< "$vault"

            if [ "$FIRST" = true ]; then
                FIRST=false
            else
                SECONDARY_JSON+=","
            fi

            SECONDARY_JSON+="
    {
      \"path\": \"$path\",
      \"name\": \"$name\",
      \"authority\": \"$authority\"
    }"
        done
        SECONDARY_JSON+="
  ]"
    fi

    # Create config file
    if [ "$DRY_RUN" = false ]; then
        cat > "$VAULT_CONFIG" << EOF
{
  "primaryVault": {
    "path": "$PRIMARY_VAULT_PATH",
    "name": "$PRIMARY_VAULT_NAME",
    "authority": "default"
  },
  "secondaryVaults": $SECONDARY_JSON
}
EOF
        print_file_created "$VAULT_CONFIG" \
            "Vault configuration (primary + secondary vaults)"

        # Copy to dist/ directory if it exists
        if [ -d "$SCRIPT_DIR/dist" ]; then
            cp "$VAULT_CONFIG" "$SCRIPT_DIR/dist/" 2>/dev/null || true
            if [ -f "$SCRIPT_DIR/dist/.obsidian-mcp.json" ]; then
                print_file_created "$SCRIPT_DIR/dist/.obsidian-mcp.json" \
                    "Vault configuration copied to build directory"
            fi
        fi
    else
        print_info "[DRY RUN] Would create: $VAULT_CONFIG"
        print_info "[DRY RUN] Content preview:"
        echo -e "${CYAN}{"
        echo -e "  \"primaryVault\": {"
        echo -e "    \"path\": \"$PRIMARY_VAULT_PATH\","
        echo -e "    \"name\": \"$PRIMARY_VAULT_NAME\","
        echo -e "    \"authority\": \"default\""
        echo -e "  },"
        echo -e "  \"secondaryVaults\": $SECONDARY_JSON"
        echo -e "}${NC}"

        if [ -d "$SCRIPT_DIR/dist" ]; then
            print_info "[DRY RUN] Would copy to: $SCRIPT_DIR/dist/.obsidian-mcp.json"
        fi
    fi

    echo ""
    print_info "Vault configuration details:"
    echo -e "  ${CYAN}Primary vault:${NC} $PRIMARY_VAULT_NAME"
    echo -e "    Path: $PRIMARY_VAULT_PATH"
    echo -e "    Authority: default"

    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        echo -e "  ${CYAN}Secondary vaults:${NC}"
        for vault in "${SECONDARY_VAULTS[@]}"; do
            IFS='|' read -r path name authority <<< "$vault"
            echo -e "    - $name (authority: $authority)"
            echo -e "      Path: $path"
        done
    fi
}

#############################################################################
# Verification
#############################################################################

verify_installation() {
    print_header "Verifying Installation"

    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    ERRORS=0

    # Check MCP server build
    print_step "Checking MCP server build..."
    if [ -f "$SCRIPT_DIR/dist/index.js" ]; then
        print_success "MCP server built successfully"
    else
        print_error "MCP server build not found: $SCRIPT_DIR/dist/index.js"
        ((ERRORS++))
    fi

    # Check Claude config
    print_step "Checking Claude Code configuration..."
    if [ -d "$HOME/.claude" ]; then
        print_success "Claude config directory exists: ~/.claude/"

        if [ -f "$HOME/.claude/CLAUDE.md" ]; then
            print_success "Global instructions found: ~/.claude/CLAUDE.md"
        else
            print_error "CLAUDE.md not found"
            ((ERRORS++))
        fi

        if [ -f "$HOME/.claude/settings.json" ]; then
            print_success "Settings file found: ~/.claude/settings.json"
        else
            print_error "settings.json not found"
            ((ERRORS++))
        fi
    else
        print_error "Claude config directory not found: ~/.claude/"
        ((ERRORS++))
    fi

    # Check hooks
    print_step "Checking hooks installation..."
    if [ -d "$HOME/.claude/hooks" ]; then
        print_success "Hooks directory exists: ~/.claude/hooks/"

        HOOK_COUNT=$(find "$HOME/.claude/hooks" -name "*.sh" -type f | wc -l | tr -d ' ')
        print_success "Found $HOOK_COUNT hook script(s)"

        # Check if hooks are executable
        NON_EXEC=$(find "$HOME/.claude/hooks" -name "*.sh" -type f ! -perm +111 | wc -l | tr -d ' ')
        if [ "$NON_EXEC" -gt 0 ]; then
            print_warning "$NON_EXEC hook(s) are not executable"
        else
            print_success "All hooks are executable"
        fi
    else
        print_error "Hooks directory not found: ~/.claude/hooks/"
        ((ERRORS++))
    fi

    # Check vault
    print_step "Checking vault structure..."
    if [ -d "$PRIMARY_VAULT_PATH" ]; then
        print_success "Primary vault directory exists: $PRIMARY_VAULT_PATH"

        # Count expected subdirectories
        EXPECTED_DIRS=("sessions" "topics" "decisions" "projects" "archive")
        for dir in "${EXPECTED_DIRS[@]}"; do
            if [ -d "$PRIMARY_VAULT_PATH/$dir" ]; then
                print_success "  ✓ $dir/"
            else
                print_error "  ✗ $dir/ not found"
                ((ERRORS++))
            fi
        done
    else
        print_error "Primary vault directory not found: $PRIMARY_VAULT_PATH"
        ((ERRORS++))
    fi

    # Check secondary vaults if any
    if [ ${#SECONDARY_VAULTS[@]} -gt 0 ]; then
        print_step "Checking secondary vaults..."
        for vault in "${SECONDARY_VAULTS[@]}"; do
            IFS='|' read -r path name authority <<< "$vault"
            if [ -d "$path" ]; then
                print_success "  ✓ $name: $path"
            else
                print_error "  ✗ $name not found: $path"
                ((ERRORS++))
            fi
        done
    fi

    # Check Claude MCP config
    print_step "Checking Claude MCP configuration..."
    CLAUDE_MCP_CONFIG="$HOME/Library/Application Support/Claude/config.json"
    if [ -f "$CLAUDE_MCP_CONFIG" ]; then
        print_success "Claude MCP config exists: $CLAUDE_MCP_CONFIG"

        # Validate JSON
        if command -v python3 &> /dev/null; then
            if python3 -m json.tool "$CLAUDE_MCP_CONFIG" > /dev/null 2>&1; then
                print_success "Config JSON is valid"
            else
                print_error "Config JSON is invalid"
                ((ERRORS++))
            fi
        fi
    else
        print_error "Claude MCP config not found: $CLAUDE_MCP_CONFIG"
        ((ERRORS++))
    fi

    echo ""
    if [ $ERRORS -eq 0 ]; then
        print_success "All verification checks passed!"
    else
        print_error "Verification found $ERRORS error(s)"
        return 1
    fi
}

#############################################################################
# Cleanup Redundant Files
#############################################################################

cleanup_redundant_files() {
    print_header "Cleaning Up Redundant Configuration Files"

    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    CLEANUP_COUNT=0

    print_info "Checking for unnecessary configuration files..."
    echo ""

    # Check for .mcp.json (redundant - should only be in ~/Library/Application Support/Claude/config.json)
    if [ -f "$SCRIPT_DIR/.mcp.json" ]; then
        print_warning "Found redundant file: .mcp.json"
        print_info "This duplicates the MCP config in ~/Library/Application Support/Claude/config.json"
        print_info "Reason: Claude Code doesn't check project directory for MCP config"

        if [ "$DRY_RUN" = false ]; then
            read -p "$(echo -e "${YELLOW}Delete .mcp.json?${NC} (y/n): ")" DELETE_MCP
            if [[ "$DELETE_MCP" =~ ^[Yy]$ ]]; then
                mv "$SCRIPT_DIR/.mcp.json" "$SCRIPT_DIR/.mcp.json.backup"
                print_success "Moved to .mcp.json.backup"
                ((CLEANUP_COUNT++))
            fi
        else
            print_info "[DRY RUN] Would move: .mcp.json → .mcp.json.backup"
            ((CLEANUP_COUNT++))
        fi
        echo ""
    fi

    # Check for .env (redundant - vault path should be in .obsidian-mcp.json)
    if [ -f "$SCRIPT_DIR/.env" ]; then
        print_warning "Found .env file"
        print_info "Vault configuration should be in .obsidian-mcp.json, not .env"
        print_info "Reason: .env is not the primary config mechanism for this MCP server"

        if [ "$DRY_RUN" = false ]; then
            read -p "$(echo -e "${YELLOW}Delete .env?${NC} (y/n): ")" DELETE_ENV
            if [[ "$DELETE_ENV" =~ ^[Yy]$ ]]; then
                mv "$SCRIPT_DIR/.env" "$SCRIPT_DIR/.env.backup"
                print_success "Moved to .env.backup"
                ((CLEANUP_COUNT++))
            fi
        else
            print_info "[DRY RUN] Would move: .env → .env.backup"
            ((CLEANUP_COUNT++))
        fi
        echo ""
    fi

    # Check for old setup.sh (superseded by install-macos.sh)
    if [ -f "$SCRIPT_DIR/setup.sh" ]; then
        print_warning "Found old setup script: setup.sh"
        print_info "Superseded by install-macos.sh"

        if [ "$DRY_RUN" = false ]; then
            read -p "$(echo -e "${YELLOW}Archive setup.sh?${NC} (y/n): ")" ARCHIVE_SETUP
            if [[ "$ARCHIVE_SETUP" =~ ^[Yy]$ ]]; then
                mv "$SCRIPT_DIR/setup.sh" "$SCRIPT_DIR/setup.sh.old"
                print_success "Moved to setup.sh.old"
                ((CLEANUP_COUNT++))
            fi
        else
            print_info "[DRY RUN] Would move: setup.sh → setup.sh.old"
            ((CLEANUP_COUNT++))
        fi
        echo ""
    fi

    if [ $CLEANUP_COUNT -eq 0 ]; then
        print_success "No redundant files found - configuration is clean!"
    else
        print_success "Cleaned up $CLEANUP_COUNT redundant file(s)"
    fi
}

#############################################################################
# Print Next Steps
#############################################################################

print_next_steps() {
    print_header "Installation Complete!"

    echo -e "${GREEN}✓ Installation successful!${NC}\n"

    echo -e "${CYAN}What was installed:${NC}\n"

    echo -e "  ${GREEN}1. Claude Code Configuration${NC}"
    echo -e "     Location: ~/.claude/"
    echo -e "     Files: CLAUDE.md, settings.json, commands/*.md"
    echo ""

    echo -e "  ${GREEN}2. Claude Code Hooks${NC}"
    echo -e "     Location: ~/.claude/hooks/"
    echo -e "     Purpose: Extend Claude Code functionality"
    echo ""

    echo -e "  ${GREEN}3. Obsidian MCP Server${NC}"
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    echo -e "     Location: $SCRIPT_DIR/dist/index.js"
    echo -e "     Purpose: Provides vault management tools to Claude"
    echo ""

    echo -e "  ${GREEN}4. Knowledge Vault${NC}"
    echo -e "     Location: $VAULT_PATH"
    echo -e "     Structure: sessions/, topics/, decisions/, projects/"
    echo ""

    echo -e "  ${GREEN}5. MCP Integration Config${NC}"
    echo -e "     Location: ~/Library/Application Support/Claude/config.json"
    echo -e "     Purpose: Connects Claude Code to the MCP server"
    echo ""

    echo -e "${CYAN}Next Steps:${NC}\n"

    echo -e "  ${YELLOW}1. Restart Claude Code${NC}"
    echo -e "     Close and start a new Claude Code session"
    echo ""

    echo -e "  ${YELLOW}2. Test the Installation${NC}"
    echo -e "     In Claude Code, try:"
    echo -e "     ${BLUE}\"Can you create a topic page about testing the MCP integration?\"${NC}"
    echo ""

    echo -e "  ${YELLOW}3. Search Your Vault${NC}"
    echo -e "     ${BLUE}\"Search my vault for testing\"${NC}"
    echo ""

    echo -e "  ${YELLOW}4. Close Your First Session${NC}"
    echo -e "     ${BLUE}/close${NC}"
    echo ""

    echo -e "  ${YELLOW}5. View Your Vault${NC}"
    echo -e "     ${BLUE}ls -la $VAULT_PATH${NC}"
    echo ""

    echo -e "${CYAN}Useful Commands:${NC}\n"
    echo -e "  ${BLUE}/sessions${NC}     - View recent conversation sessions"
    echo -e "  ${BLUE}/projects${NC}     - View tracked Git repositories"
    echo -e "  ${BLUE}/close${NC}        - Save session and update vault"
    echo ""

    echo -e "${CYAN}Documentation:${NC}\n"
    echo -e "  README.md         - Full feature documentation"
    echo -e "  MACOS_QUICKSTART.md - Quick start guide"
    echo -e "  INSTALL.md        - Detailed installation guide"
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
    clone_config_repository
    install_claude_config
    process_claude_md_template
    update_settings_json
    update_hook_paths
    create_multi_vault_config  # Create config BEFORE building so it can be copied to dist/
    build_mcp_server
    create_vault_structure
    configure_claude_mcp || {
        print_error "Claude MCP configuration failed. Please fix the error and re-run the installer."
        exit 1
    }
    configure_user_scoped_mcp || {
        print_warning "User-scoped MCP configuration failed, but project-scoped config succeeded."
        print_info "You can continue, but the MCP server will only work in this project directory."
    }
    cleanup_redundant_files
    verify_installation

    # Print next steps
    print_next_steps
}

# Run main function with all arguments
main "$@"
