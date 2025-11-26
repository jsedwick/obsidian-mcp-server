/**
 * Tool: generate_vault_index
 *
 * Description: Generate a procedural index of vault files sorted by modification time.
 * This replaces the session-summary based memory with a file index that helps
 * Claude understand what content exists in the vault.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { FileScanner, ScannedFile } from '../../services/search/index/FileScanner.js';
import { FileManager } from '../../services/vault/FileManager.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('generateVaultIndex');

// Default limits - aim for ~10KB similar to current memory base
const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024;

export interface GenerateVaultIndexArgs {
  max_files?: number;
  max_size_bytes?: number;
  include_tags?: boolean;
  include_description?: boolean;
}

export interface GenerateVaultIndexResult {
  content: Array<{ type: string; text: string }>;
}

interface IndexEntry {
  relativePath: string;
  category: string;
  title: string;
  tags: string[];
  description?: string;
  modified: Date;
  vault: string;
  // Commit-specific fields
  commitBranch?: string;
  commitMessage?: string;
}

/**
 * Extract title from filename (convert slug to readable)
 */
function extractTitle(relativePath: string): string {
  const filename = path.basename(relativePath, '.md');
  // Convert slug to title: kebab-case -> Title Case
  return filename
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format a single index entry as markdown
 */
function formatEntry(
  entry: IndexEntry,
  includeTags: boolean,
  includeDescription: boolean,
  primaryVault: string
): string {
  const parts: string[] = [];

  // Special formatting for commits: include branch and message
  if (entry.category === 'projects' && entry.commitBranch && entry.commitMessage) {
    const shortHash = path.basename(entry.relativePath, '.md');
    parts.push(`- **${shortHash}** [${entry.commitBranch}] "${entry.commitMessage}"`);
  } else {
    // Path and title for other categories
    parts.push(`- **${entry.relativePath}**`);

    // Vault indicator for non-primary vaults
    if (entry.vault !== primaryVault) {
      parts.push(` [${entry.vault}]`);
    }
    // Tags (if any and requested) - only show if no vault indicator or append after
    else if (includeTags && entry.tags.length > 0) {
      parts.push(` [${entry.tags.join(', ')}]`);
    }
  }

  // Modified date
  const dateStr = entry.modified.toISOString().split('T')[0];
  parts.push(` (${dateStr})`);

  // Description on next line if present and requested
  if (includeDescription && entry.description) {
    parts.push(`\n  ${entry.description}`);
  }

  return parts.join('');
}

/**
 * Generate the vault index
 */
export async function generateVaultIndex(
  args: GenerateVaultIndexArgs,
  vaultPath: string,
  additionalVaults: Array<{ path: string; name: string }> = []
): Promise<GenerateVaultIndexResult> {
  const {
    max_files: maxFiles = DEFAULT_MAX_FILES,
    max_size_bytes: maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
    include_tags: includeTags = true,
    include_description: includeDescription = false,
  } = args;

  logger.info('Generating vault index', { maxFiles, maxSizeBytes, includeTags });

  const scanner = new FileScanner({ computeHashes: false });
  const fileManager = new FileManager();

  // Collect vaults to scan - primary vault first
  const primaryVaultName = 'Claude';
  const vaults = [{ path: vaultPath, name: primaryVaultName }, ...additionalVaults];

  // Scan all vaults
  const allFiles: ScannedFile[] = [];
  for (const vault of vaults) {
    try {
      const files = await scanner.scanVault(vault.path, vault.name);
      allFiles.push(...files);
    } catch (error) {
      logger.warn('Failed to scan vault', { vault: vault.name, error });
    }
  }

  // Sort by modification time (most recent first)
  allFiles.sort((a, b) => b.lastModified - a.lastModified);

  // Process files into index entries
  const entries: IndexEntry[] = [];

  for (const file of allFiles) {
    if (entries.length >= maxFiles) break;

    // Skip memory-base.md itself
    if (file.relativePath === 'memory-base.md') continue;

    // Skip archive directory
    if (file.relativePath.startsWith('archive/')) continue;

    try {
      let tags: string[] = [];
      let description: string | undefined;
      let commitBranch: string | undefined;
      let commitMessage: string | undefined;

      // Check if this is a commit file (in projects/*/commits/)
      const isCommitFile = file.relativePath.match(/^projects\/[^/]+\/commits\/[^/]+\.md$/);

      // Parse frontmatter for tags, description, or commit info
      if (includeTags || includeDescription || isCommitFile) {
        const content = await fs.readFile(file.absolutePath, 'utf-8');
        const parsed = fileManager.parseFrontmatter(content);

        if (includeTags && parsed.frontmatter.tags) {
          const rawTags = parsed.frontmatter.tags as unknown;
          if (Array.isArray(rawTags)) {
            // Clean each tag - remove brackets if present
            tags = rawTags
              .map(t =>
                (typeof t === 'string' ? t : JSON.stringify(t)).replace(/^\[+|\]+$/g, '').trim()
              )
              .filter(t => t);
          } else if (typeof rawTags === 'string') {
            // Single tag or string that looks like an array
            const tagStr = rawTags.replace(/^\[+|\]+$/g, '').trim();
            tags = tagStr
              .split(',')
              .map(t => t.trim())
              .filter(t => t);
          }
          // Skip if rawTags is an object (shouldn't happen but prevents [object Object])
        }

        if (includeDescription && parsed.frontmatter.description) {
          const rawDesc = parsed.frontmatter.description as unknown;
          description = (typeof rawDesc === 'string' ? rawDesc : JSON.stringify(rawDesc)).slice(
            0,
            100
          );
        }

        // Extract commit-specific fields for commit files
        if (isCommitFile) {
          const fm = parsed.frontmatter;
          if (typeof fm.branch === 'string') {
            commitBranch = fm.branch;
          }
          // Extract message from H1 header: "# Commit: message"
          const h1Match = parsed.body.match(/^#\s+Commit:\s*(.+)$/m);
          if (h1Match) {
            commitMessage = h1Match[1].trim();
          }
        }
      }

      entries.push({
        relativePath: file.relativePath,
        category: file.category,
        title: extractTitle(file.relativePath),
        tags,
        description,
        modified: new Date(file.lastModified),
        vault: file.vault,
        commitBranch,
        commitMessage,
      });
    } catch (error) {
      // Skip files we can't read
      logger.debug('Failed to process file for index', {
        path: file.relativePath,
        error: (error as Error).message,
      });
    }
  }

  // Group by category
  const categories = ['topics', 'decisions', 'sessions', 'projects', 'document'];
  const grouped = new Map<string, IndexEntry[]>();

  for (const category of categories) {
    grouped.set(
      category,
      entries.filter(e => e.category === category)
    );
  }

  // Build markdown output
  const sections: string[] = [];
  sections.push('# Vault Index');
  sections.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
  sections.push(`Files indexed: ${entries.length} (sorted by modification date)`);

  // Add vault legend if there are multiple vaults
  if (vaults.length > 1) {
    sections.push('');
    sections.push('**Vaults:**');
    for (const vault of vaults) {
      const isPrimary = vault.name === primaryVaultName;
      sections.push(`- ${vault.name}: ${vault.path}${isPrimary ? ' (primary)' : ''}`);
    }
  }
  sections.push('');

  for (const category of categories) {
    const categoryEntries = grouped.get(category) || [];
    if (categoryEntries.length === 0) continue;

    const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
    sections.push(`## ${categoryTitle} (${categoryEntries.length})`);

    for (const entry of categoryEntries) {
      sections.push(formatEntry(entry, includeTags, includeDescription, primaryVaultName));
    }
    sections.push('');
  }

  let indexContent = sections.join('\n');

  // Trim if over size limit
  if (Buffer.byteLength(indexContent, 'utf-8') > maxSizeBytes) {
    // Remove entries from the end until under limit
    while (entries.length > 1 && Buffer.byteLength(indexContent, 'utf-8') > maxSizeBytes) {
      entries.pop();

      // Rebuild grouped and content
      for (const category of categories) {
        grouped.set(
          category,
          entries.filter(e => e.category === category)
        );
      }

      const newSections: string[] = [];
      newSections.push('# Vault Index');
      newSections.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
      newSections.push(`Files indexed: ${entries.length} (sorted by modification date)`);

      // Add vault legend if there are multiple vaults
      if (vaults.length > 1) {
        newSections.push('');
        newSections.push('**Vaults:**');
        for (const vault of vaults) {
          const isPrimary = vault.name === primaryVaultName;
          newSections.push(`- ${vault.name}: ${vault.path}${isPrimary ? ' (primary)' : ''}`);
        }
      }
      newSections.push('');

      for (const category of categories) {
        const categoryEntries = grouped.get(category) || [];
        if (categoryEntries.length === 0) continue;

        const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
        newSections.push(`## ${categoryTitle} (${categoryEntries.length})`);

        for (const entry of categoryEntries) {
          newSections.push(formatEntry(entry, includeTags, includeDescription, primaryVaultName));
        }
        newSections.push('');
      }

      indexContent = newSections.join('\n');
    }
  }

  const finalSize = Buffer.byteLength(indexContent, 'utf-8');

  logger.info('Vault index generated', {
    entriesCount: entries.length,
    sizeBytes: finalSize,
  });

  return {
    content: [
      {
        type: 'text',
        text: indexContent,
      },
    ],
  };
}

/**
 * Write the vault index to the memory-base.md file
 */
export async function writeVaultIndex(
  args: GenerateVaultIndexArgs,
  vaultPath: string,
  additionalVaults: Array<{ path: string; name: string }> = []
): Promise<GenerateVaultIndexResult> {
  const result = await generateVaultIndex(args, vaultPath, additionalVaults);

  const memoryFilePath = path.join(vaultPath, 'memory-base.md');
  const content = result.content[0].text;

  await fs.writeFile(memoryFilePath, content, 'utf-8');

  const sizeBytes = Buffer.byteLength(content, 'utf-8');

  return {
    content: [
      {
        type: 'text',
        text: `✅ Vault index written to memory-base.md\n\nMetadata:\n- Size: ${sizeBytes} bytes\n- File count: ${content.match(/^- \*\*/gm)?.length || 0} entries\n\n${content}`,
      },
    ],
  };
}
