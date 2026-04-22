/**
 * Tool: update_document
 *
 * Unified type-aware document update tool that handles all vault file modifications
 * with automatic tracking, type validation, and frontmatter maintenance.
 *
 * This tool replaces fragmented update tools (update_topic_page, update_user_reference,
 * append_to_accumulator) with a single interface that:
 * - Always tracks file access (no way to bypass)
 * - Enforces type-specific rules (read-only, append-only, etc.)
 * - Updates frontmatter automatically (Decision 011 compliance)
 * - Works for all document types
 * - Automatically archives obsolete topics (Decision 038)
 *
 * Related: Decision 028 - Unified update_document Tool for Type-Aware Vault File Updates
 * Related: Decision 038 - Automatic Topic Relevance Assessment Before Updates
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { archiveTopic } from '../topics/archiveTopic.js';
import { getTodayLocal } from '../../utils/dateFormat.js';

export interface UpdateDocumentArgs {
  file_path: string;
  content: string;
  strategy?: 'append' | 'replace' | 'section-edit' | 'edit';
  reason?: string;
  force?: boolean;
  old_string?: string;
}

export interface UpdateDocumentResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface UpdateDocumentContext {
  vaultPath: string;
  slugify: (text: string) => string;
  trackFileAccess: (path: string, action: 'read' | 'edit' | 'create') => void;
  secondaryVaults?: Array<{ path: string; name: string }>;
  ensureVaultStructure: () => Promise<void>;
}

type DocumentType =
  | 'topic'
  | 'decision'
  | 'session'
  | 'project'
  | 'commit'
  | 'user-reference'
  | 'accumulator'
  | 'task-list'
  | 'workflow'
  | 'persistent-issue';

interface TypeRules {
  readonly: boolean;
  appendOnly: boolean;
  frontmatterUpdates: (
    frontmatter: Record<string, unknown>,
    reason?: string
  ) => Record<string, unknown>;
  validate: (args: UpdateDocumentArgs) => void;
}

/**
 * Valid document types
 */
const VALID_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'topic',
  'decision',
  'session',
  'project',
  'commit',
  'user-reference',
  'accumulator',
  'task-list',
  'workflow',
  'persistent-issue',
]);

/**
 * Detect document type from file path and frontmatter
 */
function detectDocumentType(filePath: string, frontmatter: Record<string, unknown>): DocumentType {
  // Check frontmatter category first (authoritative) - but validate it!
  if (frontmatter?.category && typeof frontmatter.category === 'string') {
    if (VALID_DOCUMENT_TYPES.has(frontmatter.category)) {
      return frontmatter.category as DocumentType;
    }
    // Invalid category in frontmatter - fall through to path-based detection
  }

  // Fallback to path-based detection
  if (filePath.includes('/topics/')) return 'topic';
  if (filePath.includes('/decisions/')) return 'decision';
  if (filePath.includes('/sessions/')) return 'session';
  if (filePath.includes('/projects/') && filePath.includes('/commits/')) return 'commit';
  if (filePath.includes('/projects/') && filePath.endsWith('/project.md')) return 'project';
  if (filePath.includes('/tasks/')) return 'task-list';
  if (filePath.includes('/workflows/')) return 'workflow';
  if (filePath.endsWith('user-reference.md')) return 'user-reference';
  if (path.basename(filePath).startsWith('accumulator-')) return 'accumulator';
  if (filePath.includes('/persistent-issues/')) return 'persistent-issue';

  throw new Error(`Unknown document type for: ${filePath}`);
}

/**
 * Type-specific behavior rules
 */
const TYPE_RULES: Record<DocumentType, TypeRules> = {
  topic: {
    readonly: false,
    appendOnly: false,
    frontmatterUpdates: (fm, _reason): Record<string, unknown> => {
      const today = getTodayLocal();
      const reviewCount = typeof fm.review_count === 'number' ? fm.review_count : 0;

      // Decision 043: review_history deprecated, use Git commit history instead
      return {
        ...fm,
        last_reviewed: today,
        review_count: reviewCount + 1,
        // review_history no longer updated (Decision 043)
      };
    },
    validate: args => {
      // Enforce Decision 011: must analyze before updating
      if (!args.reason) {
        throw new Error('Topic updates require a reason parameter (Decision 011 compliance)');
      }
    },
  },

  decision: {
    readonly: false,
    appendOnly: false, // Allow full replacement for restructuring (Decision 039)
    frontmatterUpdates: (fm): Record<string, unknown> => ({
      ...fm,
      // Preserve immutable fields: number, status, date
    }),
    validate: () => {}, // No restrictions (Decision 039)
  },

  session: {
    readonly: true,
    appendOnly: false,
    frontmatterUpdates: (fm): Record<string, unknown> => fm, // No updates
    validate: () => {
      throw new Error('Session files are read-only. They cannot be edited after creation.');
    },
  },

  commit: {
    readonly: true,
    appendOnly: false,
    frontmatterUpdates: (fm): Record<string, unknown> => fm,
    validate: () => {
      throw new Error('Commit files are read-only. They cannot be edited after creation.');
    },
  },

  project: {
    readonly: false,
    appendOnly: false,
    frontmatterUpdates: (fm): Record<string, unknown> => ({
      ...fm,
      last_updated: getTodayLocal(),
    }),
    validate: () => {}, // No special validation
  },

  'user-reference': {
    readonly: false,
    appendOnly: false,
    frontmatterUpdates: (fm): Record<string, unknown> => fm, // Uses inline timestamp instead
    validate: () => {}, // Section-aware editing handled by content logic
  },

  accumulator: {
    readonly: false,
    appendOnly: false, // Allow full replacement for consolidation/reorganization
    frontmatterUpdates: (fm): Record<string, unknown> => fm,
    validate: () => {}, // No restrictions
  },

  'task-list': {
    readonly: false,
    appendOnly: false,
    frontmatterUpdates: (fm): Record<string, unknown> => ({
      ...fm,
      category: 'task-list', // Ensure category is always present
    }),
    validate: () => {},
  },

  workflow: {
    readonly: false,
    appendOnly: false,
    frontmatterUpdates: (fm): Record<string, unknown> => fm, // Preserve frontmatter as-is
    validate: () => {}, // No special validation
  },

  'persistent-issue': {
    readonly: false,
    appendOnly: false,
    frontmatterUpdates: (fm): Record<string, unknown> => fm, // Preserve frontmatter as-is
    validate: () => {}, // No special validation
  },
};

/**
 * Relevance assessment result
 */
interface RelevanceAssessment {
  should_archive: boolean;
  confidence: 'certain' | 'likely' | 'uncertain';
  reasoning: string;
  evidence: string[];
}

/**
 * Assess whether a topic should be archived instead of updated.
 *
 * This function implements Decision 038's automatic relevance detection.
 * Only archives with "certain" confidence (multiple evidence points required).
 *
 * Detection criteria:
 * - Code-based: Implementation files mentioned in topic don't exist
 * - Content-based: Explicit deprecation markers, "ISSUE RESOLVED" markers
 * - Conservative threshold: false negatives OK, false positives NOT OK
 */
async function assessTopicRelevance(content: string): Promise<RelevanceAssessment> {
  const evidence: string[] = [];

  // Strip code fences — paths and markers inside examples are not real signals
  const strippedContent = content.replace(/```[^\n]*\n[\s\S]*?```/g, '');

  // 1. Check for hook/script files mentioned in content
  const hookFilePattern = /\/\.(?:config|claude)\/[^\s]+\.sh/g;
  const hookFiles = strippedContent.match(hookFilePattern) || [];

  for (const hookFile of hookFiles) {
    try {
      await fs.access(hookFile);
    } catch {
      evidence.push(`Hook file ${hookFile} does not exist`);
    }
  }

  // 2. Check for deprecation/superseded markers in content
  if (/deprecated|superseded|abandoned|no longer (?:used|exists?)/i.test(strippedContent)) {
    evidence.push('Content explicitly mentions deprecation or abandonment');
  }

  // 3. Check for "resolved" markers indicating final state
  if (/(?:ISSUE|CRITICAL ISSUE).*(?:RESOLVED|resolved)/i.test(strippedContent)) {
    evidence.push('Content indicates issue was resolved (final state)');
  }

  // 4. Check for experiment conclusion markers
  if (/Lessons Learned|experiment concluded/i.test(strippedContent)) {
    evidence.push('Content indicates experiment or approach concluded');
  }

  // 5. Check for explicit "no longer" language
  if (/no longer (?:relevant|applicable|needed|necessary)/i.test(strippedContent)) {
    evidence.push('Content states it is no longer relevant');
  }

  // Conservative decision: need multiple evidence points for certainty
  const shouldArchive = evidence.length >= 2;
  const confidence: 'certain' | 'likely' | 'uncertain' =
    evidence.length >= 3 ? 'certain' : evidence.length >= 2 ? 'likely' : 'uncertain';

  return {
    should_archive: shouldArchive,
    confidence,
    reasoning: shouldArchive
      ? `Topic appears obsolete: ${evidence.join('; ')}`
      : 'Topic appears current',
    evidence,
  };
}

/**
 * Detect duplicate content between existing and new text.
 * Compares normalized lines to find overlap. Used to prevent
 * repetitive entries when appending to topics.
 */
function detectDuplicateContent(
  existingBody: string,
  newBody: string
): { overlapPercentage: number; duplicateLines: string[] } {
  const normalize = (line: string): string =>
    line
      .trim()
      .toLowerCase()
      .replace(/[*_`[\]()#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const extractLines = (text: string): string[] =>
    text
      .split('\n')
      .map(normalize)
      .filter(l => l.length > 25);

  const existingLines = extractLines(existingBody);
  const newLines = extractLines(newBody);

  if (newLines.length === 0) {
    return { overlapPercentage: 0, duplicateLines: [] };
  }

  const existingSet = new Set(existingLines);
  const duplicates = newLines.filter(line => existingSet.has(line));

  return {
    overlapPercentage: (duplicates.length / newLines.length) * 100,
    duplicateLines: [...new Set(duplicates)],
  };
}

/**
 * Extract document structure (section headers) for topic update responses.
 * Gives the caller visibility into the full document layout after updates.
 */
function extractDocumentStructure(body: string): string {
  const headers = body
    .split('\n')
    .filter(line => /^#{1,4}\s+/.test(line))
    .map(line => {
      const match = line.match(/^(#{1,4})\s+(.+)/);
      if (!match) return line;
      const indent = '  '.repeat(match[1].length - 1);
      return `${indent}${match[2]}`;
    });

  if (headers.length === 0) return '';
  return '\nDocument sections:\n' + headers.join('\n');
}

/**
 * Describe a character for diagnostic output — "U+00A0 (NO-BREAK SPACE)" when
 * the code point has a well-known name, otherwise the bare hex.
 */
function describeChar(code: number): string {
  const hex = code.toString(16).padStart(4, '0').toUpperCase();
  const names: Record<number, string> = {
    0x20: 'SPACE',
    0xa0: 'NO-BREAK SPACE',
    0x09: 'TAB',
    0x0a: 'LF',
    0x0d: 'CR',
    0x2028: 'LINE SEPARATOR',
    0x2029: 'PARAGRAPH SEPARATOR',
    0x200b: 'ZERO WIDTH SPACE',
  };
  const name = names[code];
  if (name) return `U+${hex} (${name})`;
  if (code >= 0x20 && code < 0x7f) return `'${String.fromCharCode(code)}' (U+${hex})`;
  return `U+${hex}`;
}

/**
 * When edit-strategy's exact old_string search fails, check for a near-match
 * caused by invisible-whitespace drift (non-breaking spaces, line-separator
 * variants). Returns a human-readable diagnostic or null if no near-match
 * exists. Uses a 1:1 normalization so the match index in normalized space is
 * also the byte offset in the original file.
 */
function diagnoseNearMatch(body: string, needle: string): string | null {
  const normalize = (s: string): string =>
    s
      .replace(/\u00a0/g, ' ')
      .replace(/\u2028/g, '\n')
      .replace(/\u2029/g, '\n');

  const normBody = normalize(body);
  const normNeedle = normalize(needle);
  const matchIdx = normBody.indexOf(normNeedle);
  if (matchIdx === -1) return null;

  let candidates = 0;
  let pos = 0;
  while ((pos = normBody.indexOf(normNeedle, pos)) !== -1) {
    candidates++;
    pos += normNeedle.length;
  }

  const originalSlice = body.slice(matchIdx, matchIdx + needle.length);
  let firstDiff = -1;
  for (let i = 0; i < needle.length; i++) {
    if (needle.charCodeAt(i) !== originalSlice.charCodeAt(i)) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff === -1) return null;

  const qChar = describeChar(needle.charCodeAt(firstDiff));
  const fChar = describeChar(originalSlice.charCodeAt(firstDiff));
  const candidateWord = candidates === 1 ? 'candidate' : 'candidates';
  return (
    `Near-match found at file offset ${matchIdx} ` +
    `(${candidates} ${candidateWord} after whitespace normalization). ` +
    `First byte mismatch at old_string offset ${firstDiff}: query has ${qChar}, file has ${fChar}. ` +
    `This often indicates non-breaking spaces (U+00A0) or other invisible whitespace in the file ` +
    `that got normalized to regular spaces when your old_string was serialized.`
  );
}

/**
 * Main update_document tool implementation
 */
export async function updateDocument(
  args: UpdateDocumentArgs,
  context: UpdateDocumentContext
): Promise<UpdateDocumentResult> {
  const { file_path: filePath, content, strategy = 'replace', reason } = args;

  // 1. Validate file is in a vault (primary or secondary)
  let isSecondaryVault = false;
  let secondaryVault: { path: string; name: string } | null = null;

  if (!filePath.startsWith(context.vaultPath)) {
    // Check if it's in a secondary vault
    if (context.secondaryVaults) {
      for (const vault of context.secondaryVaults) {
        if (filePath.startsWith(vault.path)) {
          isSecondaryVault = true;
          secondaryVault = vault;
          break;
        }
      }
    }

    if (!isSecondaryVault) {
      throw new Error(`File must be in vault: ${filePath}`);
    }
  }

  // 2. Read existing file (if exists) and parse frontmatter
  let existingContent = '';
  let frontmatter: Record<string, unknown> = {};
  let fileExists = false;
  let frontmatterWasCorrupted = false;

  try {
    existingContent = await fs.readFile(filePath, 'utf-8');
    fileExists = true;

    const fmMatch = existingContent.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      try {
        frontmatter = yaml.parse(fmMatch[1]) as Record<string, unknown>;
      } catch (parseError) {
        // YAML parsing failed - check if force mode allows recovery
        if (args.force && strategy === 'replace') {
          // Try to extract frontmatter from new content instead
          const newFmMatch = args.content.match(/^---\n([\s\S]*?)\n---/);
          if (newFmMatch) {
            try {
              frontmatter = yaml.parse(newFmMatch[1]) as Record<string, unknown>;
              frontmatterWasCorrupted = true;
              // Continue with replacement using new content's frontmatter
            } catch (newParseError) {
              throw new Error(
                `force: true requires new content to have valid YAML frontmatter.\n` +
                  `Existing frontmatter is corrupted:\n${fmMatch[1]}\n\n` +
                  `New content frontmatter also failed to parse:\n` +
                  `${newParseError instanceof Error ? newParseError.message : String(newParseError)}`
              );
            }
          } else {
            throw new Error(
              `force: true requires new content to have YAML frontmatter (---\\n...\\n---).\n` +
                `Existing frontmatter is corrupted and cannot be preserved.`
            );
          }
        } else {
          // Not in force mode - throw descriptive error
          const forceHint =
            strategy === 'replace'
              ? `\n\nTip: Use force: true with strategy: 'replace' to fix corrupted frontmatter by providing new content with valid frontmatter.`
              : `\n\nNote: To fix corrupted frontmatter, use strategy: 'replace' with force: true and provide new content with valid frontmatter.`;
          throw new Error(
            `Failed to parse YAML frontmatter in ${path.basename(filePath)}:\n` +
              `${parseError instanceof Error ? parseError.message : String(parseError)}\n\n` +
              `Frontmatter content:\n${fmMatch[1]}` +
              forceHint
          );
        }
      }
    }
  } catch (error) {
    // If file doesn't exist, that's fine - will create
    // But if it's a YAML parse error, rethrow it
    if (fileExists) {
      throw error;
    }
  }

  // 3. Detect document type (only validate for primary vault files)
  let docType: DocumentType | 'secondary-vault' = 'secondary-vault';
  let rules: TypeRules | null = null;

  if (!isSecondaryVault) {
    docType = detectDocumentType(filePath, frontmatter);
    rules = TYPE_RULES[docType];

    // 3a. Auto-assess topic relevance (Decision 038)
    if (docType === 'topic' && fileExists) {
      const assessment = await assessTopicRelevance(existingContent);

      if (assessment.should_archive && assessment.confidence === 'certain') {
        // Archive instead of update
        // Use filename slug, not frontmatter title (titles may not match slugs)
        const topicSlug = path.basename(filePath, '.md');

        return await archiveTopic(
          {
            topic: topicSlug,
            reason: assessment.reasoning,
          },
          {
            vaultPath: context.vaultPath,
            slugify: context.slugify,
            ensureVaultStructure: context.ensureVaultStructure,
          }
        );
      }
    }

    // 4. Validate operation (primary vault only)
    rules.validate(args);

    if (rules.readonly) {
      throw new Error(`${docType} files are read-only and cannot be modified`);
    }

    if (rules.appendOnly && strategy === 'replace') {
      throw new Error(`${docType} files are append-only. Use strategy: "append"`);
    }
  }

  // 5. Build new content based on strategy
  let newContent: string;
  const verificationWarnings: string[] = [];

  if (strategy === 'append') {
    // Append new content to existing (strip frontmatter from both)
    const existingWithoutFm = existingContent.replace(/^---\n[\s\S]*?\n---\n/, '');
    const contentWithoutFm = content.replace(/^---\n[\s\S]*?\n---\n/, '');

    // Duplicate content detection for topic appends
    if (docType === 'topic' && fileExists) {
      const overlap = detectDuplicateContent(existingWithoutFm, contentWithoutFm);
      if (overlap.overlapPercentage > 50) {
        throw new Error(
          `DUPLICATE CONTENT BLOCKED: ${Math.round(overlap.overlapPercentage)}% of content being appended already exists in ${path.basename(filePath)}. ` +
            `Read the full document with get_topic_context before appending, and only add genuinely new information.\n` +
            `Duplicate lines (first 3): ${overlap.duplicateLines.slice(0, 3).join(' | ')}${overlap.duplicateLines.length > 3 ? ' ...' : ''}`
        );
      }
      if (overlap.overlapPercentage > 25) {
        verificationWarnings.push(
          `⚠️ DUPLICATE CONTENT WARNING: ${Math.round(overlap.overlapPercentage)}% of appended content already exists in document. ` +
            `${overlap.duplicateLines.length} line(s) are duplicates. ` +
            `Read the full document before appending to avoid repetition.`
        );
      }
    }

    newContent = existingWithoutFm.trim() + '\n\n' + contentWithoutFm.trim();
  } else if (strategy === 'edit') {
    // Search-and-replace: find old_string in existing content and replace with content
    if (!args.old_string) {
      throw new Error('edit strategy requires old_string parameter (text to find and replace)');
    }
    if (!fileExists) {
      throw new Error(
        'edit strategy requires an existing file. Use strategy: "replace" for new files.'
      );
    }

    const existingWithoutFm = existingContent.replace(/^---\n[\s\S]*?\n---\n/, '');
    const occurrences = existingWithoutFm.split(args.old_string).length - 1;

    if (occurrences === 0) {
      const existsInFrontmatter =
        existingContent.includes(args.old_string) && !existingWithoutFm.includes(args.old_string);
      if (existsInFrontmatter) {
        throw new Error(
          `old_string matches text in the frontmatter of ${path.basename(filePath)}, but the 'edit' strategy only modifies body content. ` +
            `Use strategy: 'replace' with the complete file content to update frontmatter fields.`
        );
      }
      const baseMsg = `old_string not found in ${path.basename(filePath)}. Ensure the text matches exactly (including whitespace and newlines).`;
      const diagnostic = diagnoseNearMatch(existingWithoutFm, args.old_string);
      throw new Error(diagnostic ? `${baseMsg}\nDiagnostic: ${diagnostic}` : baseMsg);
    }
    if (occurrences > 1) {
      throw new Error(
        `old_string found ${occurrences} times in ${path.basename(filePath)}. Provide a larger string with more context to make it unique.`
      );
    }

    newContent = existingWithoutFm.replace(args.old_string, content);
  } else if (strategy === 'replace') {
    // Merge frontmatter from new content for both new and existing files.
    // Per-type `frontmatterUpdates` rules still run afterward and can override
    // fields they consider tool-managed (e.g., topic `last_reviewed`).
    const newFmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (newFmMatch) {
      try {
        const newFm = yaml.parse(newFmMatch[1]) as Record<string, unknown>;
        frontmatter = { ...frontmatter, ...newFm };
      } catch {
        // Invalid YAML in new content frontmatter — ignore, use defaults
      }
    }
    // Strip frontmatter from content body
    newContent = content.replace(/^---\n[\s\S]*?\n---\n/, '');
  } else {
    // section-edit: replace only the specified section
    const contentWithoutFm = content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

    if (!fileExists) {
      throw new Error(
        'section-edit strategy requires an existing file. Use strategy: "replace" for new files.'
      );
    }

    // Extract the header from the new content (must be at start)
    const headerMatch = contentWithoutFm.match(/^(#{1,6})\s+(.+)$/m);
    if (!headerMatch) {
      throw new Error(
        'section-edit strategy requires content to start with a markdown header (e.g., "## Section Name")'
      );
    }

    const headerLevel = headerMatch[1];
    const headerText = headerMatch[2];

    // Escape special regex characters in header text for safe regex matching
    const escapedHeaderText = headerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerRegex = new RegExp(`^${headerLevel}\\s+${escapedHeaderText}$`, 'm');

    // Find the section in existing content
    const existingWithoutFm = existingContent.replace(/^---\n[\s\S]*?\n---\n/, '');
    const sectionStartMatch = existingWithoutFm.match(headerRegex);

    if (!sectionStartMatch || sectionStartMatch.index === undefined) {
      throw new Error(
        `Section "${headerText}" not found in existing document. Use strategy: "append" to add new sections.`
      );
    }

    const sectionStart = sectionStartMatch.index;

    // Find where this section ends (next header of same or higher level, or end of file)
    const afterSectionHeader = existingWithoutFm.slice(sectionStart + sectionStartMatch[0].length);
    const levelNum = headerLevel.length;
    const nextHeaderRegex = new RegExp(`\n(#{1,${levelNum}})\\s+`, '');
    const nextHeaderMatch = afterSectionHeader.match(nextHeaderRegex);

    let sectionEnd: number;
    if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
      // Found next header - section ends just before it (preserve the newline before next header)
      sectionEnd = sectionStart + sectionStartMatch[0].length + nextHeaderMatch.index + 1;
    } else {
      // No next header - section goes to end of file
      sectionEnd = existingWithoutFm.length;
    }

    // Replace the section content
    const before = existingWithoutFm.slice(0, sectionStart);
    const after = existingWithoutFm.slice(sectionEnd);

    // Combine parts with proper spacing
    newContent = before.trimEnd() + '\n\n' + contentWithoutFm.trim() + '\n\n' + after.trimStart();
  }

  // 6. Update frontmatter (secondary vault files keep existing frontmatter)
  let updatedFrontmatter = frontmatter;
  if (!isSecondaryVault && rules) {
    updatedFrontmatter = rules.frontmatterUpdates(frontmatter, reason);
  }
  const frontmatterYaml = yaml.stringify(updatedFrontmatter);

  // 7. Rebuild with updated frontmatter
  const finalContent = `---\n${frontmatterYaml}---\n${newContent.trim()}\n`;

  // 8. Write file
  await fs.writeFile(filePath, finalContent, 'utf-8');

  // 9. Post-write verification — read file back and validate integrity
  const verificationContent = await fs.readFile(filePath, 'utf-8');

  if (!verificationContent || verificationContent.trim().length === 0) {
    throw new Error(
      `VERIFICATION FAILED: File is empty after write — ${path.basename(filePath)}. ` +
        `This indicates a write failure. The file may need to be restored from git.`
    );
  }

  if (verificationContent !== finalContent) {
    throw new Error(
      `VERIFICATION FAILED: Written content does not match expected content for ${path.basename(filePath)}. ` +
        `Expected ${finalContent.length} bytes, got ${verificationContent.length} bytes.`
    );
  }

  // Detect significant content loss on replace strategy for existing files
  if (strategy === 'replace' && fileExists && existingContent.length > 0) {
    const originalBodyLength = existingContent.replace(/^---\n[\s\S]*?\n---\n/, '').trim().length;
    const newBodyLength = newContent.trim().length;
    if (originalBodyLength > 100 && newBodyLength < originalBodyLength * 0.5) {
      verificationWarnings.push(
        `⚠️ CONTENT LOSS WARNING: File body shrank from ${originalBodyLength} to ${newBodyLength} chars (${Math.round((newBodyLength / originalBodyLength) * 100)}% of original). ` +
          `If this was unintentional, restore from git: git checkout -- "${filePath}"`
      );
    }
  }

  // For edit strategy, verify old_string was replaced
  if (strategy === 'edit' && args.old_string) {
    const verificationBody = verificationContent.replace(/^---\n[\s\S]*?\n---\n/, '');
    // Only check if old_string is gone when the replacement text doesn't contain it
    // (e.g., appending rows to a table means old_string is a subset of new content)
    if (!content.includes(args.old_string) && verificationBody.includes(args.old_string)) {
      throw new Error(
        `VERIFICATION FAILED: old_string still present in ${path.basename(filePath)} after edit. The replacement may not have been applied.`
      );
    }
    if (!verificationBody.includes(content)) {
      verificationWarnings.push(
        `⚠️ EDIT WARNING: Replacement text not found verbatim in written file. This may indicate the content was modified during frontmatter processing.`
      );
    }
  }

  // 10. Track file access (CRITICAL - always happens, for both primary and secondary vaults)
  const action = fileExists ? 'edit' : 'create';
  context.trackFileAccess(filePath, action);

  // 11. Return success
  const vaultType = isSecondaryVault ? `secondary vault file` : `${docType}`;
  const corruptedNote = frontmatterWasCorrupted
    ? `⚠️ Recovered from corrupted frontmatter (used frontmatter from new content)\n`
    : '';
  const warningText =
    verificationWarnings.length > 0 ? '\n' + verificationWarnings.join('\n') + '\n' : '';
  const structureText =
    docType === 'topic'
      ? extractDocumentStructure(verificationContent.replace(/^---\n[\s\S]*?\n---\n/, ''))
      : '';
  return {
    content: [
      {
        type: 'text',
        text:
          `✅ ${vaultType} updated: ${path.basename(filePath)}\n` +
          `Strategy: ${strategy}\n` +
          `Action: ${action}\n` +
          `Verified: ✅ (${verificationContent.length} bytes)\n` +
          corruptedNote +
          warningText +
          (structureText ? structureText + '\n' : '') +
          (isSecondaryVault ? `Vault: ${secondaryVault?.name}\n` : '') +
          (reason ? `Reason: ${reason}` : ''),
      },
    ],
  };
}
