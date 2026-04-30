/**
 * Tool: vault_custodian
 *
 * Description: Verify vault integrity by checking file organization, validating links, and reorganizing/relinking
 * files as necessary. Ensures all files are in logical locations and properly connected. Can optionally be scoped
 * to only check specific files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getTodayLocal } from '../../utils/dateFormat.js';

export interface VaultCustodianArgs {
  files_to_check?: string[];
}

export interface VaultCustodianResult {
  content: Array<{ type: string; text: string }>;
}

/**
 * True when `line` starts with H1 or H2. Used as the section boundary for
 * H2-Related-section scans — H3+ subsections (e.g. per-repo `### {slug}`
 * blocks under `## Related Git Commits`) are children of their parent H2 and
 * must not terminate the parent section's bounds.
 */
function isH1OrH2Header(line: string): boolean {
  return /^##?\s/.test(line.trim());
}

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and cache directories
        if (!entry.name.startsWith('.')) {
          files.push(...(await findMarkdownFiles(fullPath)));
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (_e) {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Smart filtering for link validation to reduce false positives
 */
function shouldSkipLinkValidation(linkPath: string, content: string, matchIndex: number): boolean {
  // Skip template variables (e.g., [[sessions/${this.currentSessionId}]])
  if (linkPath.includes('${')) {
    return true;
  }

  // Skip bash conditionals (e.g., [[ "$OSTYPE" == "darwin"* ]])
  // These start with quotes or $ and aren't wiki links
  if (linkPath.startsWith('"') || linkPath.startsWith('$')) {
    return true;
  }

  // Skip common placeholder patterns used in documentation/examples
  const placeholderPatterns = [
    'topic-name',
    'note-name',
    'other-topic',
    'another-topic',
    'file',
    'path/to/note',
    'topic-slug',
    'sessions/null', // Common in project files when session_id is null
    'session-id',
    'sessions/session-id',
    '2025-11-06_...', // Truncated session IDs in examples
    'xxx',
    'example',
    'placeholder',
  ];

  if (placeholderPatterns.includes(linkPath)) {
    return true;
  }

  // Skip links with ellipsis or other obvious placeholder indicators
  if (linkPath.includes('...') || linkPath.includes('XXX')) {
    return true;
  }

  // Check if the link is inside a code block (triple backticks)
  // Find all code block boundaries before this match
  const beforeContent = content.substring(0, matchIndex);
  const codeBlockMatches = beforeContent.match(/```/g);

  // If odd number of ``` before this point, we're inside a code block
  if (codeBlockMatches && codeBlockMatches.length % 2 === 1) {
    return true;
  }

  // Skip links that look like bash conditions (contain operators)
  if (
    linkPath.includes('==') ||
    linkPath.includes('!=') ||
    linkPath.includes('||') ||
    linkPath.includes('&&')
  ) {
    return true;
  }

  return false;
}

/**
 * Find the correct link path for a potentially broken link
 */
async function findCorrectLinkPath(linkPath: string, vaultPath: string): Promise<string | null> {
  // Extract filename from path (remove any directory prefixes)
  const filename = path.basename(linkPath);

  // Check if it looks like a session file (YYYY-MM-DD_HH-MM-SS_...)
  const sessionPattern = /^(\d{4})-(\d{2})-(\d{2})_/;
  const sessionMatch = filename.match(sessionPattern);

  if (sessionMatch) {
    const year = sessionMatch[1];
    const month = sessionMatch[2];
    const sessionPath = path.join(vaultPath, 'sessions', `${year}-${month}`, `${filename}.md`);

    try {
      await fs.access(sessionPath);
      return filename; // Return just the filename for wiki-style links
    } catch {
      // File doesn't exist
      return null;
    }
  }

  // Check if it looks like an old-format session file (YYYY-MM-DD-...)
  const oldSessionPattern = /^(\d{4})-(\d{2})-(\d{2})-/;
  const oldSessionMatch = filename.match(oldSessionPattern);

  if (oldSessionMatch) {
    const year = oldSessionMatch[1];
    const month = oldSessionMatch[2];
    const sessionPath = path.join(vaultPath, 'sessions', `${year}-${month}`, `${filename}.md`);

    try {
      await fs.access(sessionPath);
      return filename; // Return just the filename for wiki-style links
    } catch {
      // File doesn't exist
      return null;
    }
  }

  // Check topics directory
  const topicPath = path.join(vaultPath, 'topics', `${filename}.md`);
  try {
    await fs.access(topicPath);
    return filename;
  } catch {
    // Continue checking
  }

  // Check decisions directory (flat and nested project subdirectories)
  const decisionsDir = path.join(vaultPath, 'decisions');

  // First check if linkPath includes a project subdirectory (e.g., "project-slug/015-decision-name")
  if (linkPath.includes('/')) {
    // Link has nested path - check if it exists as-is in decisions/
    const nestedDecisionPath = path.join(decisionsDir, `${linkPath}.md`);
    try {
      await fs.access(nestedDecisionPath);
      // Return with the decisions/ prefix so the rewritten link resolves correctly.
      // (Prior behavior returned linkPath unchanged, which left links like
      // [[vault/018-decision-slug]] still broken after a "fix" pass.)
      return linkPath.startsWith('decisions/') ? linkPath : `decisions/${linkPath}`;
    } catch {
      // Continue checking
    }
  }

  // Check flat decisions directory (exact match)
  const decisionPath = path.join(decisionsDir, `${filename}.md`);
  try {
    await fs.access(decisionPath);
    return filename;
  } catch {
    // Try fuzzy matching in flat directory
    try {
      const decisionFiles = await fs.readdir(decisionsDir);
      const match = decisionFiles.find(f => f.startsWith(filename) && f.endsWith('.md'));
      if (match) {
        return match.replace(/\.md$/, '');
      }
    } catch {
      // Continue checking
    }
  }

  // Check nested project subdirectories for matching decision filename
  try {
    const entries = await fs.readdir(decisionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subdir = entry.name;
        const nestedPath = path.join(decisionsDir, subdir, `${filename}.md`);
        try {
          await fs.access(nestedPath);
          return `decisions/${subdir}/${filename}`;
        } catch {
          // Continue checking other subdirectories
        }
      }
    }
  } catch {
    // decisions dir doesn't exist or can't be read
  }

  // Check for project files (projects/project-name/project.md)
  // Look for pattern: projects/xxx/project or just xxx
  if (linkPath.includes('projects/') || linkPath.includes('/project')) {
    const projectsDir = path.join(vaultPath, 'projects');
    try {
      const projectDirs = await fs.readdir(projectsDir);

      for (const projectDir of projectDirs) {
        const projectFile = path.join(projectsDir, projectDir, 'project.md');
        try {
          await fs.access(projectFile);
          // Check if the link mentions this project
          if (linkPath.includes(projectDir) || linkPath.includes('project')) {
            return `projects/${projectDir}/project`;
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Projects dir doesn't exist
    }
  }

  // Check for commit files (projects/project-name/commits/hash.md)
  if (linkPath.includes('commits/') || /^[a-f0-9]{7,40}$/.test(filename)) {
    const projectsDir = path.join(vaultPath, 'projects');
    try {
      const projectDirs = await fs.readdir(projectsDir);

      for (const projectDir of projectDirs) {
        const commitFile = path.join(projectsDir, projectDir, 'commits', `${filename}.md`);
        try {
          await fs.access(commitFile);
          return `projects/${projectDir}/commits/${filename}`;
        } catch {
          continue;
        }
      }
    } catch {
      // Projects dir doesn't exist
    }
  }

  return null;
}

/**
 * Extract all wiki links from markdown content with their positions
 */
function extractWikiLinks(
  content: string
): Array<{ link: string; display?: string; index: number }> {
  const links: Array<{ link: string; display?: string; index: number }> = [];
  const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    links.push({
      link: match[1],
      display: match[2],
      index: match.index,
    });
  }

  return links;
}

/**
 * Resolve a wiki link to an absolute file path
 */
async function resolveWikiLink(
  link: string,
  vaultPath: string,
  contextFile?: string,
  findSessionFile?: (filename: string) => Promise<string | null>
): Promise<string | null> {
  // Remove .md extension if present
  const linkWithoutExt = link.endsWith('.md') ? link.slice(0, -3) : link;

  // Try various possible paths
  const possiblePaths = [
    // Direct path in vault
    path.join(vaultPath, `${linkWithoutExt}.md`),
    path.join(vaultPath, link),

    // In topics directory
    path.join(vaultPath, 'topics', `${linkWithoutExt}.md`),

    // In decisions directory
    path.join(vaultPath, 'decisions', `${linkWithoutExt}.md`),

    // In projects directory (project.md files)
    path.join(vaultPath, 'projects', linkWithoutExt, 'project.md'),
  ];

  // Check for session file in monthly subdirectories
  if (findSessionFile) {
    const sessionFile = await findSessionFile(linkWithoutExt);
    if (sessionFile) {
      possiblePaths.push(sessionFile);
    }
  }

  // If context file is provided, also try relative to that file
  if (contextFile) {
    const contextDir = path.dirname(contextFile);
    possiblePaths.push(path.join(contextDir, `${linkWithoutExt}.md`), path.join(contextDir, link));
  }

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // Continue checking other paths
    }
  }

  return null;
}

/**
 * Get file type based on path
 */
function getFileType(
  filePath: string,
  vaultPath: string
): 'session' | 'topic' | 'decision' | 'project' | 'unknown' {
  const relativePath = path.relative(vaultPath, filePath);

  if (relativePath.startsWith('sessions/')) return 'session';
  if (relativePath.startsWith('topics/')) return 'topic';
  if (relativePath.startsWith('decisions/')) return 'decision';
  if (relativePath.startsWith('projects/') && filePath.endsWith('project.md')) return 'project';

  return 'unknown';
}

/**
 * Extract title from file (from frontmatter or first heading)
 */
function extractTitleFromFile(relativePath: string): string {
  // For now, use the filename as title
  // TODO: Parse frontmatter or first heading for actual title
  const filename = path.basename(relativePath, '.md');
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Determine reciprocal link format and section based on file types
 * Automatically generates obsidian:// URIs for secondary vault files
 */
function getReciprocalLinkInfo(
  _sourceFile: string,
  targetFile: string,
  vaultPath: string,
  secondaryVaults?: Array<{ path: string; name: string }>
): {
  section: string;
  link: string;
} | null {
  // Detect if target is in a secondary vault
  let secondaryVault: { path: string; name: string } | null = null;
  let targetPath = path.relative(vaultPath, targetFile);

  if (secondaryVaults) {
    for (const vault of secondaryVaults) {
      if (targetFile.startsWith(vault.path)) {
        secondaryVault = vault;
        targetPath = path.relative(vault.path, targetFile);
        break;
      }
    }
  }

  // Determine target type
  const targetType = secondaryVault
    ? 'unknown' // Secondary vaults don't follow primary vault structure
    : getFileType(targetFile, vaultPath);

  // Handle secondary vault files with obsidian:// URIs
  if (secondaryVault) {
    const title = extractTitleFromFile(targetPath);
    const relativeFile = targetPath.replace(/\.md$/, '');
    const encodedFile = encodeURIComponent(relativeFile);

    return {
      section: '## Related Topics', // Default to Related Topics for secondary vault files
      link: `- [${title}](obsidian://open?vault=${encodeURIComponent(secondaryVault.name)}&file=${encodedFile})`,
    };
  }

  // Determine appropriate section and link format for primary vault files
  if (targetType === 'session') {
    // Source file should link to session in "Related Sessions"
    const sessionId = path.basename(targetFile, '.md');
    return {
      section: '## Related Sessions',
      link: `- [[${sessionId}]]`,
    };
  } else if (targetType === 'topic') {
    // Source file should link to topic
    const topicSlug = path.basename(targetFile, '.md');
    const topicTitle = extractTitleFromFile(targetPath);

    return {
      section: '## Related Topics',
      link: `- [[topics/${topicSlug}|${topicTitle}]]`,
    };
  } else if (targetType === 'decision') {
    // Source file should link to decision in "Related Decisions"
    // Need to include the parent directory (vault/ or project-slug/)
    const decisionDir = path.basename(path.dirname(targetFile));
    const decisionSlug = path.basename(targetFile, '.md');
    const decisionTitle = extractTitleFromFile(targetPath);
    return {
      section: '## Related Decisions',
      link: `- [[decisions/${decisionDir}/${decisionSlug}|${decisionTitle}]]`,
    };
  } else if (targetType === 'project') {
    // Source file should link to project in "Related Projects"
    const projectSlug = path.basename(path.dirname(targetFile));
    const projectTitle = extractTitleFromFile(targetPath);
    return {
      section: '## Related Projects',
      link: `- [[projects/${projectSlug}/project|${projectTitle}]]`,
    };
  }

  return null;
}

/**
 * Add reciprocal link to target file
 */
async function addReciprocalLink(
  targetFile: string,
  sourceFile: string,
  vaultPath: string,
  secondaryVaults?: Array<{ path: string; name: string }>
): Promise<boolean> {
  const linkInfo = getReciprocalLinkInfo(targetFile, sourceFile, vaultPath, secondaryVaults);
  if (!linkInfo) return false;

  let content = await fs.readFile(targetFile, 'utf-8');

  // Check if link already exists
  if (content.includes(linkInfo.link)) {
    return false; // Link already exists
  }

  // Check if section exists
  const sectionRegex = new RegExp(
    `^${linkInfo.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
    'm'
  );

  if (sectionRegex.test(content)) {
    // Section exists, add link after it
    content = content.replace(sectionRegex, `${linkInfo.section}\n${linkInfo.link}`);
  } else {
    // Section doesn't exist, add it at the end
    if (!content.endsWith('\n')) content += '\n';
    content += `\n${linkInfo.section}\n${linkInfo.link}\n`;
  }

  await fs.writeFile(targetFile, content);
  return true;
}

/**
 * Validate and repair reciprocal links for given files
 */
async function validateReciprocalLinks(
  files: string[],
  vaultPath: string,
  findSessionFile: (filename: string) => Promise<string | null>,
  secondaryVaults?: Array<{ path: string; name: string }>
): Promise<string[]> {
  const fixes: string[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const links = extractWikiLinks(content);

      for (const { link, index } of links) {
        // Skip if link looks like it should be skipped (including code blocks)
        if (shouldSkipLinkValidation(link, content, index)) {
          continue;
        }

        const linkedFile = await resolveWikiLink(link, vaultPath, file, findSessionFile);
        if (!linkedFile) continue; // Can't resolve link

        // Check if it's a vault file (not external)
        if (!linkedFile.startsWith(vaultPath)) continue;

        // Check if linked file has reciprocal link back to source
        const reciprocalLinkInfo = getReciprocalLinkInfo(
          linkedFile,
          file,
          vaultPath,
          secondaryVaults
        );
        if (!reciprocalLinkInfo) continue; // No reciprocal relationship expected

        const linkedContent = await fs.readFile(linkedFile, 'utf-8');

        // Check if reciprocal link exists
        const sourceFileName = path.basename(file, '.md');
        const hasReciprocalLink =
          linkedContent.includes(sourceFileName) ||
          linkedContent.includes(path.relative(vaultPath, file));

        if (!hasReciprocalLink) {
          // Add reciprocal link
          const added = await addReciprocalLink(linkedFile, file, vaultPath, secondaryVaults);
          if (added) {
            const relativeSource = path.relative(vaultPath, file);
            const relativeTarget = path.relative(vaultPath, linkedFile);
            fixes.push(`Added reciprocal link: ${relativeTarget} ← ${relativeSource}`);
          }
        }
      }
    } catch (error) {
      // Continue on error for individual files
      console.error(
        `Error validating reciprocal links for ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return fixes;
}

/**
 * Move Related sections to the bottom of the document
 * Ensures Related Sessions, Related Topics, Related Projects, and Related Decisions
 * are always at the end, in that order
 */
async function moveRelatedSectionsToBottom(file: string): Promise<string[]> {
  const fixes: string[] = [];
  const content = await fs.readFile(file, 'utf-8');
  const lines = content.split('\n');

  const relatedHeaders = [
    '## Related Topics',
    '## Related Sessions',
    '## Related Projects',
    '## Related Decisions',
    '## Related Git Commits',
  ];

  // Find all Related sections and their content
  const sections = new Map<string, { startIndex: number; endIndex: number; content: string[] }>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (relatedHeaders.includes(line)) {
      const startIndex = i;
      const sectionContent: string[] = [lines[i]]; // Include the header

      // Collect content until next H1/H2 header or end. H3+ subsections
      // (e.g. per-repo `### {slug}` under `## Related Git Commits`) are part
      // of this section and must not terminate the bounds.
      let j = i + 1;
      while (j < lines.length && !isH1OrH2Header(lines[j])) {
        sectionContent.push(lines[j]);
        j++;
      }

      sections.set(line, {
        startIndex,
        endIndex: j - 1,
        content: sectionContent,
      });
    }
  }

  if (sections.size === 0) {
    return fixes; // No Related sections found
  }

  // Check if Related sections are already at the bottom in correct order
  const sectionIndices = Array.from(sections.values())
    .map(s => s.startIndex)
    .sort((a, b) => a - b);

  // Find the index of the last non-Related, non-empty line
  let lastContentIndex = lines.length - 1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !relatedHeaders.includes(line) && !sections.has(line)) {
      // Check if this line is part of a Related section
      let isPartOfRelated = false;
      for (const section of sections.values()) {
        if (i > section.startIndex && i <= section.endIndex) {
          isPartOfRelated = true;
          break;
        }
      }
      if (!isPartOfRelated) {
        lastContentIndex = i;
        break;
      }
    }
  }

  // Check if all Related sections are already after the last content
  const firstRelatedIndex = Math.min(...sectionIndices);
  if (firstRelatedIndex > lastContentIndex && sections.size > 0) {
    // Check if they're in the correct order
    const expectedOrder = relatedHeaders.filter(h => sections.has(h));
    const actualOrder = Array.from(sections.keys()).sort((a, b) => {
      return sections.get(a)!.startIndex - sections.get(b)!.startIndex;
    });

    if (JSON.stringify(expectedOrder) === JSON.stringify(actualOrder)) {
      return fixes; // Already at bottom in correct order
    }
  }

  // Remove Related sections from their current positions
  const linesToKeep: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let shouldKeep = true;

    for (const section of sections.values()) {
      if (i >= section.startIndex && i <= section.endIndex) {
        shouldKeep = false;
        break;
      }
    }

    if (shouldKeep) {
      linesToKeep.push(lines[i]);
    }
  }

  // Remove trailing empty lines from main content
  while (linesToKeep.length > 0 && linesToKeep[linesToKeep.length - 1].trim() === '') {
    linesToKeep.pop();
  }

  // Add Related sections at the bottom in the correct order
  for (const header of relatedHeaders) {
    if (sections.has(header)) {
      linesToKeep.push(''); // Add blank line before section
      // Filter out blank lines from section content (except the header)
      const sectionContent = sections.get(header)!.content;
      const cleanedContent = sectionContent.filter((line, index) => {
        // Always keep the header (first line)
        if (index === 0) return true;
        // Skip blank lines within the section
        return line.trim() !== '';
      });
      linesToKeep.push(...cleanedContent);
      fixes.push(`Moved "${header}" to bottom of document`);
    }
  }

  // Remove any trailing blank lines from the final content
  while (linesToKeep.length > 0 && linesToKeep[linesToKeep.length - 1].trim() === '') {
    linesToKeep.pop();
  }

  // Write the updated content
  const newContent = linesToKeep.join('\n');
  await fs.writeFile(file, newContent);

  return fixes;
}

/**
 * Remove aspirational wiki links (links to non-existent content)
 * Converts broken links to plain text while preserving the content
 */
async function removeAspirationalLinks(
  file: string,
  vaultPath: string,
  findSessionFile: (filename: string) => Promise<string | null>
): Promise<string[]> {
  const fixes: string[] = [];
  let content = await fs.readFile(file, 'utf-8');
  const originalContent = content;

  // Find all wiki links in the content
  const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  const linksToConvert: Array<{ original: string; linkPath: string; display: string }> = [];

  while ((match = linkRegex.exec(content)) !== null) {
    const linkPath = match[1];
    const display = match[2] || linkPath;
    const fullMatch = match[0];

    // Skip template variables and bash conditionals (same filters as link validation)
    if (linkPath.includes('${') || linkPath.startsWith('"') || linkPath.startsWith('$')) {
      continue;
    }

    // Skip common placeholders
    const placeholderPatterns = [
      'topic-name',
      'note-name',
      'other-topic',
      'another-topic',
      'file',
      'path/to/note',
      'topic-slug',
      'session-id',
      'sessions/session-id',
      'xxx',
      'example',
      'placeholder',
    ];
    if (placeholderPatterns.includes(linkPath)) {
      continue;
    }

    // Skip links that look like bash conditions
    if (
      linkPath.includes('==') ||
      linkPath.includes('!=') ||
      linkPath.includes('||') ||
      linkPath.includes('&&')
    ) {
      continue;
    }

    // Try to resolve the link
    const resolved = await resolveWikiLink(linkPath, vaultPath, file, findSessionFile);

    // If link cannot be resolved, it's aspirational
    if (!resolved) {
      linksToConvert.push({
        original: fullMatch,
        linkPath,
        display,
      });
    }
  }

  // Convert aspirational links to plain text
  for (const link of linksToConvert) {
    // Replace the wiki link with plain text display
    // If there was custom display text, use it; otherwise use the link path
    const plainText = link.display;
    content = content.replace(link.original, plainText);
    fixes.push(`Removed aspirational link: ${link.original} → ${plainText}`);
  }

  // Write the updated content if changes were made
  if (content !== originalContent) {
    await fs.writeFile(file, content);
  }

  return fixes;
}

/**
 * Migrate old "## Git Commit" sections to "## Related Git Commits"
 * Consolidates multiple "## Git Commit" sections into a single "## Related Git Commits" section
 */
async function migrateGitCommitSections(file: string): Promise<string[]> {
  const fixes: string[] = [];
  const content = await fs.readFile(file, 'utf-8');
  const lines = content.split('\n');

  // Find all "## Git Commit" sections and collect their content
  const gitCommitIndices: number[] = [];
  const gitCommitLinks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === '## Git Commit') {
      gitCommitIndices.push(i);

      // Collect links under this header
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith('#')) {
        const linkLine = lines[j].trim();
        if (linkLine.startsWith('- [[')) {
          gitCommitLinks.push(linkLine);
        }
        j++;
      }
    }
  }

  // If we found any "## Git Commit" sections, migrate them
  if (gitCommitIndices.length > 0) {
    // Remove all "## Git Commit" sections and their content
    const linesToRemove = new Set<number>();
    for (const index of gitCommitIndices) {
      linesToRemove.add(index);

      // Remove content lines until next header
      let j = index + 1;
      while (j < lines.length && !lines[j].trim().startsWith('#')) {
        linesToRemove.add(j);
        j++;
      }
    }

    // Rebuild content without old sections
    const newLines = lines.filter((_, index) => !linesToRemove.has(index));

    // Find or create "## Related Git Commits" section
    const relatedCommitsIndex = newLines.findIndex(
      line => line.trim() === '## Related Git Commits'
    );

    if (relatedCommitsIndex !== -1) {
      // Section exists, add links after it
      const existingLinks = new Set<string>();

      // Collect existing links to avoid duplicates. Use H1/H2 boundary so
      // multi-repo H3 subsections under `## Related Git Commits` don't cut
      // the scan short.
      let j = relatedCommitsIndex + 1;
      while (j < newLines.length && !isH1OrH2Header(newLines[j])) {
        const linkLine = newLines[j].trim();
        if (linkLine.startsWith('- [[')) {
          existingLinks.add(linkLine);
        }
        j++;
      }

      // Add new links that don't already exist
      const linksToAdd = gitCommitLinks.filter(link => !existingLinks.has(link));
      if (linksToAdd.length > 0) {
        newLines.splice(relatedCommitsIndex + 1, 0, ...linksToAdd);
      }
    } else {
      // Section doesn't exist, add it at the end with all links
      if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
        newLines.push('');
      }
      newLines.push('## Related Git Commits');
      newLines.push(...gitCommitLinks);
    }

    // Write updated content
    const newContent = newLines.join('\n');
    await fs.writeFile(file, newContent);

    fixes.push(
      `Migrated ${gitCommitIndices.length} "## Git Commit" section(s) to "## Related Git Commits"`
    );
  }

  return fixes;
}

/**
 * Deduplicate headers in a file, especially Related sections
 */
async function deduplicateHeaders(file: string): Promise<string[]> {
  const fixes: string[] = [];
  const content = await fs.readFile(file, 'utf-8');
  const lines = content.split('\n');

  // Track seen headers and their content
  const headerSections = new Map<string, { indices: number[]; content: string[] }>();
  const relatedHeaders = [
    '## Related Sessions',
    '## Related Projects',
    '## Related Topics',
    '## Related Decisions',
    '## Related Git Commits',
    '## Git Commit',
  ];

  // First pass: identify all headers and their positions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for Related headers
    if (relatedHeaders.includes(line)) {
      if (!headerSections.has(line)) {
        headerSections.set(line, { indices: [], content: [] });
      }
      headerSections.get(line)!.indices.push(i);

      // Collect content under this header until next H1/H2 header or end.
      // H3+ subsections belong to this section.
      const sectionContent: string[] = [];
      let j = i + 1;
      while (j < lines.length && !isH1OrH2Header(lines[j])) {
        if (lines[j].trim()) {
          // Only collect non-empty lines
          sectionContent.push(lines[j].trim());
        }
        j++;
      }
      headerSections.get(line)!.content.push(...sectionContent);
    }
  }

  // Second pass: check for duplicates and consecutive duplicate headers
  const linesToRemove = new Set<number>();
  let modified = false;

  // Check for consecutive duplicate headers (any header, not just Related)
  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i].trim();
    const nextLine = lines[i + 1].trim();

    if (currentLine.startsWith('#') && currentLine.toLowerCase() === nextLine.toLowerCase()) {
      linesToRemove.add(i + 1);
      fixes.push(`Removed consecutive duplicate header at line ${i + 2}: ${currentLine}`);
      modified = true;
    }
  }

  // Check for duplicate Related sections
  for (const [header, data] of headerSections.entries()) {
    if (data.indices.length > 1) {
      // Keep the first occurrence, remove others
      // Mark duplicate headers for removal
      for (let i = 1; i < data.indices.length; i++) {
        const dupIndex = data.indices[i];
        linesToRemove.add(dupIndex);

        // Also remove content lines after duplicate header (until next H1/H2).
        // H3+ subsections belong to this duplicate section and must be removed
        // with it.
        let j = dupIndex + 1;
        while (j < lines.length && !isH1OrH2Header(lines[j])) {
          if (lines[j].trim()) {
            linesToRemove.add(j);
          }
          j++;
        }
      }

      fixes.push(`Removed ${data.indices.length - 1} duplicate "${header}" section(s)`);
      modified = true;
    }
  }

  // Third pass: rebuild content without removed lines
  if (modified) {
    const newLines = lines.filter((_, index) => !linesToRemove.has(index));
    const newContent = newLines.join('\n');
    await fs.writeFile(file, newContent);
  }

  return fixes;
}

/**
 * Extract the target slug from a wiki link, normalizing different formats
 * Examples:
 *   [[claude-code-hooks]] -> "claude-code-hooks"
 *   [[topics/claude-code-hooks|Claude Code Hooks]] -> "claude-code-hooks"
 *   [[decisions/vault/009-foo|Foo]] -> "009-foo"
 *   [[projects/my-project/project|My Project]] -> "my-project/project"
 */
function extractLinkTarget(linkLine: string): string | null {
  // Match wiki link pattern: - [[path|display]] or - [[path]]
  const match = linkLine.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  if (!match) return null;

  const linkPath = match[1];

  // Extract the base name, handling various path formats
  // For topics/decisions: strip the directory prefix, keep just the slug
  // For projects: keep project-slug/project to distinguish project files
  // For commits: keep project-slug/commits/hash
  if (linkPath.startsWith('topics/')) {
    return path.basename(linkPath);
  }
  if (linkPath.startsWith('decisions/')) {
    // decisions/vault/009-foo or decisions/project-slug/009-foo
    return path.basename(linkPath);
  }
  if (linkPath.startsWith('projects/')) {
    // Keep the relative path within projects/ for uniqueness
    // e.g., "my-project/project" or "my-project/commits/abc123"
    return linkPath.replace('projects/', '');
  }
  if (linkPath.startsWith('sessions/')) {
    return path.basename(linkPath);
  }

  // For bare links, just return as-is
  return path.basename(linkPath);
}

/**
 * Deduplicate links within Related sections
 * Handles different link formats pointing to the same target
 */
async function deduplicateSectionLinks(file: string): Promise<string[]> {
  const fixes: string[] = [];
  const content = await fs.readFile(file, 'utf-8');
  const lines = content.split('\n');

  const relatedHeaders = [
    '## Related Sessions',
    '## Related Projects',
    '## Related Topics',
    '## Related Decisions',
    '## Related Git Commits',
  ];

  let modified = false;
  const newLines: string[] = [];
  let inRelatedSection = false;
  let currentSectionLinks = new Map<string, { line: string; index: number }>();
  let duplicatesRemoved = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check if we're entering a Related section
    if (relatedHeaders.includes(trimmedLine)) {
      // If we were in a previous section, flush it
      if (inRelatedSection) {
        // Already handled by the header detection below
      }
      inRelatedSection = true;
      currentSectionLinks = new Map();
      newLines.push(line);
      continue;
    }

    // Check if we're leaving a Related section (hit another H1/H2 header).
    // H3+ subsections are part of the current Related section.
    if (isH1OrH2Header(trimmedLine) && inRelatedSection) {
      inRelatedSection = false;
      currentSectionLinks = new Map();
      newLines.push(line);
      continue;
    }

    // If we're in a Related section
    if (inRelatedSection) {
      // Skip blank lines within Related sections - they shouldn't be there
      if (trimmedLine === '') {
        modified = true;
        continue;
      }

      // Process link lines
      if (trimmedLine.startsWith('- [[')) {
        const target = extractLinkTarget(trimmedLine);

        if (target) {
          if (currentSectionLinks.has(target)) {
            // Duplicate found - decide which to keep
            const existing = currentSectionLinks.get(target)!;

            // Prefer the more complete format (with display text and path)
            const existingHasDisplay = existing.line.includes('|');
            const currentHasDisplay = trimmedLine.includes('|');
            const existingHasPath = existing.line.includes('/');
            const currentHasPath = trimmedLine.includes('/');

            // Score: display text = 2 points, path = 1 point
            const existingScore = (existingHasDisplay ? 2 : 0) + (existingHasPath ? 1 : 0);
            const currentScore = (currentHasDisplay ? 2 : 0) + (currentHasPath ? 1 : 0);

            if (currentScore > existingScore) {
              // Replace the existing with current (better format)
              // Find and replace in newLines
              const existingIndex = newLines.lastIndexOf(existing.line);
              if (existingIndex !== -1) {
                newLines[existingIndex] = line;
                currentSectionLinks.set(target, { line, index: existingIndex });
              }
            }
            // Either way, skip adding this line (it's a duplicate)
            duplicatesRemoved++;
            modified = true;
            continue;
          } else {
            currentSectionLinks.set(target, { line, index: newLines.length });
          }
        }
      }
    }

    newLines.push(line);
  }

  if (modified) {
    await fs.writeFile(file, newLines.join('\n'));
    if (duplicatesRemoved > 0) {
      fixes.push(`Removed ${duplicatesRemoved} duplicate link(s) from Related sections`);
    }
  }

  return fixes;
}

/**
 * Validate Related section content structure
 * Ensures Related sections only contain proper list items with valid link formats:
 * - Wiki links: `- [[target]]` or `- [[target|Display]]`
 * - Inter-vault links: `- [Display](obsidian://open?vault=Name&file=path)`
 * Removes malformed content like headers appearing as list items, plain text, etc.
 */
async function validateRelatedSectionContent(file: string): Promise<string[]> {
  const fixes: string[] = [];
  const content = await fs.readFile(file, 'utf-8');
  const lines = content.split('\n');

  const relatedHeaders = [
    '## Related Sessions',
    '## Related Topics',
    '## Related Projects',
    '## Related Decisions',
    '## Related Git Commits',
  ];

  const newLines: string[] = [];
  let currentSection: string | null = null;
  let modified = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code block boundaries (don't validate inside code blocks)
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      newLines.push(line);
      continue;
    }

    // Skip validation inside code blocks
    if (inCodeBlock) {
      newLines.push(line);
      continue;
    }

    // Check if this is a Related section header (must not be indented)
    if (relatedHeaders.includes(trimmed) && !line.startsWith(' ') && !line.startsWith('\t')) {
      currentSection = trimmed;
      newLines.push(line);
      continue;
    }

    // Check if we've left the Related section (hit another non-indented H1/H2
    // header). H3+ subsections belong to the current Related section.
    if (
      isH1OrH2Header(trimmed) &&
      !line.startsWith(' ') &&
      !line.startsWith('\t') &&
      currentSection
    ) {
      currentSection = null;
    }

    // If we're inside a Related section, validate content
    if (currentSection) {
      // Empty lines are OK
      if (trimmed === '') {
        newLines.push(line);
        continue;
      }

      // Check for valid link formats
      const isWikiLink = /^- \[\[.+\]\]/.test(trimmed);
      const isInterVaultLink = /^- \[.+\]\(obsidian:\/\/open\?vault=.+&file=.+\)/.test(trimmed);

      if (isWikiLink || isInterVaultLink) {
        // Valid list item with link
        newLines.push(line);
      } else {
        // Invalid content in Related section
        // Check for common malformations
        if (isH1OrH2Header(trimmed)) {
          // Only H1/H2 are malformed inside a Related section. H3+ (e.g.,
          // per-repo `### {slug}` subsections under `## Related Git Commits`)
          // are valid structural children and must be preserved.
          fixes.push(`Removed malformed header inside ${currentSection}: ${trimmed}`);
          modified = true;
          continue;
        } else if (trimmed.startsWith('#')) {
          // H3+ subsection header — keep it as-is.
          newLines.push(line);
          continue;
        } else if (
          trimmed.startsWith('-') &&
          !trimmed.startsWith('- [[') &&
          !trimmed.startsWith('- [')
        ) {
          fixes.push(`Removed malformed list item in ${currentSection}: ${trimmed}`);
          modified = true;
          continue;
        } else if (!trimmed.startsWith('-')) {
          // Plain text or other content
          fixes.push(`Removed non-list content from ${currentSection}: ${trimmed}`);
          modified = true;
          continue;
        } else {
          // Other malformed list items
          fixes.push(`Removed invalid content from ${currentSection}: ${trimmed}`);
          modified = true;
          continue;
        }
      }
    } else {
      // Not in a Related section, keep line as-is
      newLines.push(line);
    }
  }

  if (modified) {
    await fs.writeFile(file, newLines.join('\n'));
  }

  return fixes;
}

/**
 * Remove empty Related sections
 * Removes Related section headers that have no links underneath them
 */
async function removeEmptyRelatedSections(file: string): Promise<string[]> {
  const fixes: string[] = [];
  const content = await fs.readFile(file, 'utf-8');
  const lines = content.split('\n');

  const relatedHeaders = [
    '## Related Sessions',
    '## Related Topics',
    '## Related Projects',
    '## Related Decisions',
    '## Related Git Commits',
  ];

  const newLines: string[] = [];
  let i = 0;
  let modified = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if this is a Related section header (must not be indented)
    if (relatedHeaders.includes(trimmed) && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Look ahead to see if there are any actual links
      let j = i + 1;
      let hasLinks = false;

      // Scan until we hit another H1/H2 header or end of file. H3+ subsections
      // (e.g. multi-repo `### {slug}` blocks under `## Related Git Commits`)
      // belong to this section, so the scan must reach into them — otherwise
      // a section that has H3 children but no direct bullets is mis-classified
      // as empty and the parent H2 gets dropped.
      while (j < lines.length && !isH1OrH2Header(lines[j])) {
        const contentLine = lines[j].trim();
        if (contentLine.startsWith('- [[') || contentLine.startsWith('- [')) {
          hasLinks = true;
          break;
        }
        j++;
      }

      if (hasLinks) {
        // Keep the section
        newLines.push(line);
        i++;
      } else {
        // Empty section - remove it and any blank lines after it
        fixes.push(`Removed empty section: ${trimmed}`);
        modified = true;

        // Skip this header line
        i++;

        // Skip any blank lines immediately following
        while (i < lines.length && lines[i].trim() === '') {
          i++;
        }
      }
    } else {
      newLines.push(line);
      i++;
    }
  }

  if (modified) {
    await fs.writeFile(file, newLines.join('\n'));
  }

  return fixes;
}

/**
 * Archive superseded decisions automatically
 * Moves decisions with status: "superseded" to archive/decisions/ while preserving frontmatter
 */
async function archiveSupersededDecisions(
  decisionsDir: string,
  vaultPath: string,
  filesToCheck?: string[]
): Promise<string[]> {
  const fixes: string[] = [];

  try {
    // Find all decision files (flat and nested)
    const allDecisionFiles = await findMarkdownFiles(decisionsDir);

    // Filter to only check specified files if provided
    const decisionFiles = filesToCheck
      ? allDecisionFiles.filter(f => filesToCheck.includes(f))
      : allDecisionFiles;

    for (const file of decisionFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

        if (!frontmatterMatch) continue;

        const frontmatter = frontmatterMatch[1];

        // Check if status is "superseded" (handle various YAML formats)
        const statusMatch = frontmatter.match(/^status:\s*["']?superseded["']?$/m);

        if (statusMatch) {
          // Decision is superseded - archive it
          const relativePath = path.relative(decisionsDir, file);
          const archiveFile = path.join(vaultPath, 'archive', 'decisions', relativePath);
          const archiveDir = path.dirname(archiveFile);

          // Create archive directory structure
          await fs.mkdir(archiveDir, { recursive: true });

          // Update frontmatter with archived date
          const today = getTodayLocal();
          let updatedFrontmatter = frontmatter;

          // Add archived date if not already present
          if (!updatedFrontmatter.includes('archived:')) {
            updatedFrontmatter += `\narchived: "${today}"`;
          }

          // Add review history entry
          const reviewHistoryEntry = `  - date: ${today}\n    action: archived\n    notes: "Automatically archived superseded decision"`;
          if (updatedFrontmatter.includes('review_history:')) {
            updatedFrontmatter = updatedFrontmatter.replace(
              /review_history:/,
              `review_history:\n${reviewHistoryEntry}`
            );
          } else {
            updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
          }

          // Reconstruct file with updated frontmatter
          const mainContent = content.substring(frontmatterMatch[0].length).trim();
          const newContent = `---\n${updatedFrontmatter}\n---\n\n${mainContent}`;

          // Move to archive
          await fs.writeFile(archiveFile, newContent);
          await fs.unlink(file);

          fixes.push(
            `Archived superseded decision: ${path.relative(vaultPath, file)} → ${path.relative(vaultPath, archiveFile)}`
          );
        }
      } catch (error) {
        console.error(
          `Error checking decision for superseded status in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } catch (_e) {
    // decisions directory doesn't exist or can't be read
  }

  return fixes;
}

export async function vaultCustodian(
  args: VaultCustodianArgs,
  context: {
    vaultPath: string;
    ensureVaultStructure: () => Promise<void>;
    findSessionFile: (filename: string) => Promise<string | null>;
    secondaryVaults?: Array<{ path: string; name: string }>;
  }
): Promise<VaultCustodianResult> {
  await context.ensureVaultStructure();

  const issues: string[] = [];
  const fixes: string[] = [];
  const warnings: string[] = [];
  const filesToCheck = args?.files_to_check;

  try {
    // Check 1: Verify sessions are in the correct directory
    const sessionsDir = path.join(context.vaultPath, 'sessions');
    let sessionFiles = await findMarkdownFiles(sessionsDir);

    // Filter to only check specified files if provided
    if (filesToCheck) {
      sessionFiles = sessionFiles.filter(f => filesToCheck.includes(f));
    }

    for (const file of sessionFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

      if (!frontmatterMatch) {
        issues.push(`Session file missing frontmatter: ${path.relative(context.vaultPath, file)}`);
        continue;
      }

      // Check if session file is in date-organized subdirectory
      const filenameDate = path.basename(file).match(/^(\d{4})-(\d{2})-(\d{2})/);

      if (filenameDate) {
        const expectedDir = path.join(sessionsDir, `${filenameDate[1]}-${filenameDate[2]}`);
        const actualDir = path.dirname(file);

        if (actualDir !== expectedDir) {
          issues.push(`Session in wrong directory: ${path.relative(context.vaultPath, file)}`);

          // Move to correct directory
          await fs.mkdir(expectedDir, { recursive: true });
          const newPath = path.join(expectedDir, path.basename(file));
          await fs.rename(file, newPath);
          fixes.push(
            `Moved ${path.relative(context.vaultPath, file)} to ${path.relative(context.vaultPath, newPath)}`
          );
        }
      }
    }

    // Check 2: Verify topics are properly formatted
    const topicsDir = path.join(context.vaultPath, 'topics');
    let topicFiles = await findMarkdownFiles(topicsDir);

    // Filter to only check specified files if provided
    if (filesToCheck) {
      topicFiles = topicFiles.filter(f => filesToCheck.includes(f));
    }

    for (const file of topicFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

      if (!frontmatterMatch) {
        issues.push(`Topic file missing frontmatter: ${path.relative(context.vaultPath, file)}`);

        // Add basic frontmatter
        const title = path.basename(file, '.md');
        const today = getTodayLocal();
        const newContent = `---
title: ${title}
created: ${today}
tags: []
---

${content}`;
        await fs.writeFile(file, newContent);
        fixes.push(`Added frontmatter to ${path.relative(context.vaultPath, file)}`);
      }
    }

    // Check 3: Verify project structure
    const projectsDir = path.join(context.vaultPath, 'projects');
    try {
      const projectDirs = await fs.readdir(projectsDir);

      for (const projectDir of projectDirs) {
        const projectPath = path.join(projectsDir, projectDir);
        const stat = await fs.stat(projectPath);

        if (!stat.isDirectory()) continue;

        const projectFile = path.join(projectPath, 'project.md');

        // Skip this project if we're filtering and this project file is not in the list
        if (filesToCheck && !filesToCheck.includes(projectFile)) {
          continue;
        }

        try {
          await fs.access(projectFile);
        } catch {
          issues.push(`Project directory missing project.md: projects/${projectDir}`);
          warnings.push(`Consider creating a project.md file in projects/${projectDir}`);
        }

        // Check for commits directory
        const commitsDir = path.join(projectPath, 'commits');
        try {
          const commitStat = await fs.stat(commitsDir);
          if (commitStat.isDirectory()) {
            const commits = await fs.readdir(commitsDir);
            if (commits.length === 0) {
              warnings.push(`Empty commits directory: projects/${projectDir}/commits`);
            }
          }
        } catch {
          // No commits directory is fine
        }
      }
    } catch (_e) {
      // No projects directory is fine
    }

    // Check 4: Validate and fix internal links
    const decisionsDir = path.join(context.vaultPath, 'decisions');
    let allFiles = [
      ...(await findMarkdownFiles(sessionsDir)),
      ...(await findMarkdownFiles(topicsDir)),
      ...(await findMarkdownFiles(decisionsDir)),
      ...(await findMarkdownFiles(projectsDir)),
    ];

    // Filter to only check specified files if provided
    if (filesToCheck) {
      allFiles = allFiles.filter(f => filesToCheck.includes(f));
    }

    for (const file of allFiles) {
      let content = await fs.readFile(file, 'utf-8');
      const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let match;
      const linksToFix: Array<{ original: string; corrected: string; fullMatch: string }> = [];

      // First pass: collect all broken links
      while ((match = linkRegex.exec(content)) !== null) {
        const linkPath = match[1];
        const matchIndex = match.index;
        const fullMatch = match[0];

        // Skip false positives
        if (shouldSkipLinkValidation(linkPath, content, matchIndex)) {
          continue;
        }

        // Check if link has directory prefix that violates wiki-link standards
        // Per Decision 002, internal links should not include directory prefixes
        // Note: projects/ and decisions/ prefixes are kept — both have project-scoped
        // subdirectories (projects/<slug>/project.md, decisions/<slug>/<file>.md) where
        // the basename is not unique across projects, so the prefix is load-bearing.
        const directoryPrefixPattern = /^(sessions|topics)\//;
        const prefixMatch = linkPath.match(directoryPrefixPattern);

        if (prefixMatch) {
          // Strip the directory prefix to get the base filename
          const strippedPath = linkPath.replace(directoryPrefixPattern, '');

          // Try to find the correct file for this stripped path
          const correctedPath = await findCorrectLinkPath(strippedPath, context.vaultPath);

          if (correctedPath) {
            // Found the file, add it to fixes
            linksToFix.push({
              original: linkPath,
              corrected: correctedPath,
              fullMatch: fullMatch,
            });
          } else {
            // File doesn't exist even after stripping prefix - it's truly broken
            warnings.push(
              `Broken link in ${path.relative(context.vaultPath, file)}: [[${linkPath}]] (file not found even after stripping prefix)`
            );
          }
          continue; // Skip to next link
        }

        // Try to resolve the link
        const possiblePaths = [
          path.join(context.vaultPath, `${linkPath}.md`),
          path.join(context.vaultPath, linkPath),
          path.join(path.dirname(file), `${linkPath}.md`),
          path.join(path.dirname(file), linkPath),
        ];

        let found = false;
        for (const p of possiblePaths) {
          try {
            await fs.access(p);
            found = true;
            break;
          } catch {
            // Continue checking
          }
        }

        if (!found) {
          // Try to find the correct path
          const correctedPath = await findCorrectLinkPath(linkPath, context.vaultPath);

          if (correctedPath) {
            linksToFix.push({
              original: linkPath,
              corrected: correctedPath,
              fullMatch: fullMatch,
            });
          } else {
            warnings.push(
              `Broken link in ${path.relative(context.vaultPath, file)}: [[${linkPath}]]`
            );
          }
        }
      }

      // Second pass: fix all broken links
      if (linksToFix.length > 0) {
        for (const link of linksToFix) {
          // Replace the link in content, preserving any |Title alias on the original
          const escapedOriginal = link.original.replace(/[.*+?^${}()|[\]\\]/g, c => `\\${c}`);
          const linkPattern = new RegExp(`\\[\\[${escapedOriginal}(\\|[^\\]]+)?\\]\\]`, 'g');
          content = content.replace(
            linkPattern,
            (_m, alias) => `[[${link.corrected}${alias ?? ''}]]`
          );
          fixes.push(
            `Fixed link in ${path.relative(context.vaultPath, file)}: [[${link.original}]] → [[${link.corrected}]]`
          );
        }

        // Write the updated content back to the file
        await fs.writeFile(file, content);
      }
    }

    // Check 5: Validate reciprocal links
    const reciprocalFixes = await validateReciprocalLinks(
      allFiles,
      context.vaultPath,
      context.findSessionFile,
      context.secondaryVaults
    );
    fixes.push(...reciprocalFixes);

    // Check 6: Remove aspirational links (links to non-existent content)
    for (const file of allFiles) {
      try {
        const aspirationalFixes = await removeAspirationalLinks(
          file,
          context.vaultPath,
          context.findSessionFile
        );
        if (aspirationalFixes.length > 0) {
          const relativeFile = path.relative(context.vaultPath, file);
          for (const fix of aspirationalFixes) {
            fixes.push(`${relativeFile}: ${fix}`);
          }
        }
      } catch (error) {
        console.error(
          `Error removing aspirational links in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check 7: Migrate old "## Git Commit" sections
    for (const file of allFiles) {
      try {
        const migrationFixes = await migrateGitCommitSections(file);
        if (migrationFixes.length > 0) {
          const relativeFile = path.relative(context.vaultPath, file);
          for (const fix of migrationFixes) {
            fixes.push(`${relativeFile}: ${fix}`);
          }
        }
      } catch (error) {
        console.error(
          `Error migrating Git Commit sections in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check 8: Deduplicate headers
    for (const file of allFiles) {
      try {
        const headerFixes = await deduplicateHeaders(file);
        if (headerFixes.length > 0) {
          const relativeFile = path.relative(context.vaultPath, file);
          for (const fix of headerFixes) {
            fixes.push(`${relativeFile}: ${fix}`);
          }
        }
      } catch (error) {
        console.error(
          `Error deduplicating headers in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check 9: Deduplicate links within Related sections
    for (const file of allFiles) {
      try {
        const linkFixes = await deduplicateSectionLinks(file);
        if (linkFixes.length > 0) {
          const relativeFile = path.relative(context.vaultPath, file);
          for (const fix of linkFixes) {
            fixes.push(`${relativeFile}: ${fix}`);
          }
        }
      } catch (error) {
        console.error(
          `Error deduplicating section links in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check 10: Move Related sections to bottom
    for (const file of allFiles) {
      try {
        const relatedFixes = await moveRelatedSectionsToBottom(file);
        if (relatedFixes.length > 0) {
          const relativeFile = path.relative(context.vaultPath, file);
          for (const fix of relatedFixes) {
            fixes.push(`${relativeFile}: ${fix}`);
          }
        }
      } catch (error) {
        console.error(
          `Error moving Related sections in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check 11: Validate Related section content structure
    for (const file of allFiles) {
      try {
        const contentFixes = await validateRelatedSectionContent(file);
        if (contentFixes.length > 0) {
          const relativeFile = path.relative(context.vaultPath, file);
          for (const fix of contentFixes) {
            fixes.push(`${relativeFile}: ${fix}`);
          }
        }
      } catch (error) {
        console.error(
          `Error validating Related section content in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check 12: Remove empty Related sections
    for (const file of allFiles) {
      try {
        const emptyFixes = await removeEmptyRelatedSections(file);
        if (emptyFixes.length > 0) {
          const relativeFile = path.relative(context.vaultPath, file);
          for (const fix of emptyFixes) {
            fixes.push(`${relativeFile}: ${fix}`);
          }
        }
      } catch (error) {
        console.error(
          `Error removing empty Related sections in ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check 13: Archive superseded decisions
    try {
      const archiveFixes = await archiveSupersededDecisions(
        decisionsDir,
        context.vaultPath,
        filesToCheck
      );
      fixes.push(...archiveFixes);
    } catch (error) {
      console.error(
        `Error archiving superseded decisions: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Generate report
    let report = '# Vault Custodian Report\n\n';

    if (issues.length === 0 && warnings.length === 0 && fixes.length === 0) {
      report += '✅ Vault integrity check passed! No issues found.\n';
    } else {
      if (issues.length > 0) {
        report += `## Issues Found (${issues.length})\n`;
        for (const issue of issues) {
          report += `- ❌ ${issue}\n`;
        }
        report += '\n';
      }

      if (fixes.length > 0) {
        report += `## Fixes Applied (${fixes.length})\n`;
        for (const fix of fixes) {
          report += `- ✅ ${fix}\n`;
        }
        report += '\n';
      }

      if (warnings.length > 0) {
        report += `## Warnings (${warnings.length})\n`;

        // Group warnings by file for a condensed summary
        const warningsByFile = new Map<string, string[]>();
        const otherWarnings: string[] = [];

        for (const warning of warnings) {
          // Parse warnings that follow the "Broken link in file: [[link]]" pattern
          const brokenLinkMatch = warning.match(/^Broken link in ([^:]+): \[\[([^\]]+)\]\]/);
          if (brokenLinkMatch) {
            const file = brokenLinkMatch[1];
            const link = brokenLinkMatch[2];
            if (!warningsByFile.has(file)) {
              warningsByFile.set(file, []);
            }
            warningsByFile.get(file)!.push(link);
          } else {
            otherWarnings.push(warning);
          }
        }

        // Output condensed broken link warnings grouped by file
        if (warningsByFile.size > 0) {
          report += '\n**Broken links by file:**\n';
          for (const [file, links] of warningsByFile.entries()) {
            report += `- \`${file}\`\n`;
            for (const link of links) {
              report += `  - [[${link}]]\n`;
            }
          }
          report += '\n';
        }

        // Output other warnings normally
        for (const warning of otherWarnings) {
          report += `- ⚠️  ${warning}\n`;
        }
        report += '\n';
      }
    }

    report += '\n---\n';
    report += `**Checked:** ${allFiles.length} files\n`;
    report += `**Issues:** ${issues.length} found, ${fixes.length} fixed\n`;
    report += `**Warnings:** ${warnings.length}\n`;

    return {
      content: [
        {
          type: 'text',
          text: report,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error during vault integrity check: ${errorMessage}`,
        },
      ],
    };
  }
}
