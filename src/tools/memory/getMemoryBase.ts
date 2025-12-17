/**
 * Tool: get_memory_base
 *
 * Description: Load session context including system directives, user reference,
 * and vault index. Provides layered context at session start:
 * 1. MCP directives (system philosophy and values)
 * 2. User reference (user identity and preferences)
 * 3. Vault index (recently modified files for orientation)
 *
 * Used for session initialization and establishing timing for commit detection
 * in the two-phase close workflow.
 *
 * Note: The vault index provides file existence awareness, not semantic content.
 * Claude still needs search_vault for substantive questions about content.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GetMemoryBaseArgs {
  // No arguments needed - reads from fixed location
}

/**
 * Default template for mcp-directives.md
 * Created automatically when /mb is run in a vault without this file
 */
const MCP_DIRECTIVES_TEMPLATE = `# MCP System Directives

*Last updated: ${new Date().toISOString().split('T')[0]}*

## Persona

You are a technical personal assistant and programmer whose primary role is to maintain high-quality documentation, continuity, and structural integrity of project knowledge over time.

You prioritize clarity, consistency, and long-term maintainability over short-term convenience.

## Core Values

### 1. Living Documentation, Not Historical Logs

The vault is a single evolving knowledge base, not a chat log or append-only archive.

Documentation should read as if written today, not as a timeline of changes. Integrate new information seamlessly rather than adding chronological updates.

**Anti-pattern:** "Update as of December 2025: Now using JWT rotation..."
**Correct pattern:** Rewrite the authentication section to reflect current implementation.

### 2. Prevent Documentation Drift

Code and documentation must stay synchronized. When code changes, documentation must be updated immediately—not later, not eventually.

Drift accumulates quickly and destroys trust in the vault as the authoritative source.

This is enforced through the two-phase \`/close\` workflow, which automatically analyzes commits and prompts for documentation updates before finalizing the session.

### 3. Prefer Evolution Over Creation

Before creating new topics, search exhaustively for existing documentation to update.

Every new topic adds overhead. Enriching existing documentation maintains cohesion and reduces fragmentation.

**Workflow:** Always \`search_vault\` before \`create_topic_page\`. If related content exists, update it rather than creating parallel documentation.

### 4. Quality Over Quantity

Topics are the gold standard. They must be:

- **Authoritative** - The definitive reference, not a partial view
- **Current** - Reflecting reality, not history
- **Integrated** - Seamlessly woven together, not accumulated patches
- **Concise** - Dense with value, free of redundancy

Never add content just to "document that something happened." Add content to improve understanding.

**Anti-pattern:** Appending session notes verbatim to topics
**Correct pattern:** Extract insights, integrate into existing structure, remove redundancy

### 5. Analyze Before Acting

Read existing content fully before updating. Never assume what's there.

Choose the right update strategy:

- **Append** when structure is good and new info fits naturally
- **Refactor** when organization is poor or content is redundant
- **Consolidate** when multiple sections say the same thing

Intelligent integration beats mechanical appending.

**Reference:** [[decisions/uoregon-jsdev-obsidian-mcp-server/011-topic-update-policy-append-only-vs-full-replacement|Decision 011: Topic Update Policy]]

## System Goals

- **Continuity** - Build on previous work across all sessions
- **Accuracy** - Documentation reflects reality, not aspirations or outdated states
- **Simplicity** - Minimal complexity, maximum clarity
- **Trust** - The vault is the single source of truth

## Critical Anti-Patterns to Avoid

1. **Temporal markers in content** - "As of [date]...", "Updated [month]..." indicates append-without-integration
2. **Creating topics without searching first** - Leads to fragmentation and duplicate documentation
3. **Blind appending** - Adding content without reading existing structure
4. **Stale references** - Leaving outdated information alongside new information
5. **Historical narratives** - Documentation should explain "what is," not "what changed when"

## Relationship to CLAUDE.md

**mcp-directives.md** defines the philosophy and values (WHY and WHAT the system values)
**CLAUDE.md** defines the procedures and workflows (HOW to use tools and follow processes)

This file reinforces the principles that guide all procedural decisions in CLAUDE.md.
`;

export interface GetMemoryBaseResult {
  content: Array<{ type: string; text: string }>;
}

export async function getMemoryBase(
  _args: GetMemoryBaseArgs,
  vaultPath: string
): Promise<GetMemoryBaseResult> {
  const memoryFilePath = path.join(vaultPath, 'memory-base.md');
  const userRefPath = path.join(vaultPath, 'user-reference.md');
  const mcpDirectivesPath = path.join(vaultPath, 'mcp-directives.md');

  // Try to load MCP directives, creating from template if they don't exist
  let mcpDirectivesContent = '';
  let mcpDirectivesCreated = false;
  try {
    mcpDirectivesContent = await fs.readFile(mcpDirectivesPath, 'utf-8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      // File doesn't exist - create it from template
      mcpDirectivesContent = MCP_DIRECTIVES_TEMPLATE;
      try {
        await fs.writeFile(mcpDirectivesPath, mcpDirectivesContent, 'utf-8');
        mcpDirectivesCreated = true;
      } catch (writeError) {
        console.warn('Failed to create mcp-directives.md:', (writeError as Error).message);
        // Continue without directives if creation fails
        mcpDirectivesContent = '';
      }
    } else {
      console.warn('Failed to read mcp-directives.md:', (error as Error).message);
    }
  }

  // Try to load user reference if it exists
  let userRefContent = '';
  try {
    userRefContent = await fs.readFile(userRefPath, 'utf-8');
  } catch (error) {
    // File doesn't exist - that's fine
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.warn('Failed to read user-reference.md:', (error as Error).message);
    }
  }

  try {
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    const stats = await fs.stat(memoryFilePath);

    // Count session boundaries
    const sessionCount = (content.match(/### --- SESSION BOUNDARY/g) || []).length;
    const sizeBytes = Buffer.byteLength(content, 'utf-8');

    const memoryInfo = `Rolling memory base contents:\n\n${content}\n\n---\nMetadata:\n- Size: ${sizeBytes} bytes\n- Last modified: ${stats.mtime.toISOString()}\n- Session count: ${sessionCount}`;

    // Build layered context: System directives -> User context -> Vault index
    const sections = [];

    // Add creation notice if mcp-directives was just created
    if (mcpDirectivesCreated) {
      sections.push(
        `✨ Created mcp-directives.md in vault root\n\nThis file contains the MCP system philosophy and core values. It will be loaded automatically with every \`/mb\` command.`
      );
    }

    if (mcpDirectivesContent) {
      sections.push(mcpDirectivesContent);
    }
    if (userRefContent) {
      sections.push(userRefContent);
    }
    sections.push(memoryInfo);

    const fullContent = sections.join('\n\n---\n\n');

    return {
      content: [
        {
          type: 'text',
          text: fullContent,
        },
      ],
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      // Memory base doesn't exist, return available context
      const sections = [];

      // Add creation notice if mcp-directives was just created
      if (mcpDirectivesCreated) {
        sections.push(
          `✨ Created mcp-directives.md in vault root\n\nThis file contains the MCP system philosophy and core values. It will be loaded automatically with every \`/mb\` command.`
        );
      }

      if (mcpDirectivesContent) {
        sections.push(mcpDirectivesContent);
      }
      if (userRefContent) {
        sections.push(userRefContent);
      }

      return {
        content: [
          {
            type: 'text',
            text:
              sections.length > 0
                ? sections.join('\n\n---\n\n')
                : 'Rolling memory base is empty. No previous session context available.',
          },
        ],
      };
    }
    throw error;
  }
}
