/**
 * Tool: list_vault_monitors
 *
 * Discovers monitor definitions stored in the vault's monitors/ directory.
 * Each monitor is a .md file with frontmatter (description, persistent, timeout_ms)
 * and either:
 *   - A companion .sh script (same basename) for complex monitors
 *   - An inline shell command in the markdown body for simple monitors
 *
 * Returns monitor definitions ready to arm via Claude Code's Monitor tool.
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

export type ListVaultMonitorsArgs = Record<string, never>;

export interface MonitorDefinition {
  name: string;
  description: string;
  command: string;
  persistent: boolean;
  timeout_ms: number;
}

export interface ListVaultMonitorsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface MonitorContext {
  vaultPath: string;
}

export async function listVaultMonitors(
  _args: ListVaultMonitorsArgs,
  context: MonitorContext
): Promise<ListVaultMonitorsResult> {
  const monitorsDir = path.join(context.vaultPath, 'monitors');

  // Check if monitors directory exists
  try {
    await fs.access(monitorsDir);
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ monitors: [], message: 'No monitors/ directory found in vault.' }),
        },
      ],
    };
  }

  const monitors = await collectMonitorFiles(monitorsDir);

  if (monitors.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            monitors: [],
            message:
              'No monitor definitions found in monitors/ directory. Create .md files to define monitors.',
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ monitors }),
      },
    ],
  };
}

/**
 * Collect all monitor definitions from .md files in the monitors directory.
 */
async function collectMonitorFiles(monitorsDir: string): Promise<MonitorDefinition[]> {
  const results: MonitorDefinition[] = [];
  let entries;

  try {
    entries = await fs.readdir(monitorsDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const fullPath = path.join(monitorsDir, entry.name);
    const name = entry.name.replace(/\.md$/, '');

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const monitor = parseMonitorFile(name, content, monitorsDir);
      if (monitor) {
        results.push(monitor);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

/**
 * Parse a monitor .md file into a MonitorDefinition.
 *
 * Frontmatter fields:
 *   - description (required): Human-readable description for notifications
 *   - persistent (optional, default: false): Run for session lifetime
 *   - timeout_ms (optional, default: 300000): Timeout for non-persistent monitors
 *
 * Command resolution (in priority order):
 *   1. Companion .sh file: monitors/{name}.sh (used as `bash /path/to/script.sh`)
 *   2. Inline command: First code block (```bash or ```) in the markdown body
 *   3. Raw body: Entire body after stripping frontmatter and markdown headers
 */
function parseMonitorFile(
  name: string,
  content: string,
  monitorsDir: string
): MonitorDefinition | null {
  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null; // Frontmatter is required for monitors
  }

  const frontmatter = frontmatterMatch[1];

  // Extract description (required)
  const descMatch = frontmatter.match(/description:\s*["']?(.+?)["']?\s*$/m);
  if (!descMatch) {
    return null; // Description is required
  }
  const description = descMatch[1].trim();

  // Extract persistent (optional, default: false)
  const persistentMatch = frontmatter.match(/persistent:\s*(true|false)/);
  const persistent = persistentMatch ? persistentMatch[1] === 'true' : false;

  // Extract timeout_ms (optional, default: 300000)
  const timeoutMatch = frontmatter.match(/timeout_ms:\s*(\d+)/);
  const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) : 300000;

  // Resolve command
  const command = resolveCommand(name, content, monitorsDir);
  if (!command) {
    return null; // No command found
  }

  return { name, description, command, persistent, timeout_ms: timeoutMs };
}

/**
 * Resolve the shell command for a monitor definition.
 *
 * Priority:
 *   1. Companion .sh script (monitors/{name}.sh)
 *   2. First fenced code block (```bash or ```)
 *   3. Raw body text (headers and blanks stripped)
 */
function resolveCommand(name: string, content: string, monitorsDir: string): string | null {
  // Priority 1: Companion .sh script
  const scriptPath = path.join(monitorsDir, `${name}.sh`);
  if (existsSync(scriptPath)) {
    return `bash "${scriptPath}"`;
  }

  // Strip frontmatter
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

  // Priority 2: First code block (```bash or ```)
  const codeBlockMatch = body.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Priority 3: Raw body (strip markdown headers and empty lines)
  const rawCommand = body
    .replace(/^#+\s+.*$/gm, '') // Strip markdown headers
    .replace(/^\s*\n/gm, '') // Strip empty lines
    .trim();

  return rawCommand || null;
}
