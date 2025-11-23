/**
 * Tool: archive_topic
 *
 * Move a topic to the archive directory. Preserves all metadata and content.
 */

import fs from 'fs/promises';
import path from 'path';

export interface ArchiveTopicArgs {
  topic: string;
  reason?: string;
}

export interface ArchiveTopicResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface ArchiveTopicContext {
  vaultPath: string;
  slugify: (text: string) => string;
  ensureVaultStructure: () => Promise<void>;
  vaultCustodian: (args: { files_to_check: string[] }) => Promise<ArchiveTopicResult>;
}

export async function archiveTopic(
  args: ArchiveTopicArgs,
  context: ArchiveTopicContext
): Promise<ArchiveTopicResult> {
  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);
  const archiveFile = path.join(context.vaultPath, 'archive', 'topics', `${slug}.md`);

  try {
    await fs.access(topicFile);
  } catch {
    throw new Error(`Topic not found: ${args.topic}`);
  }

  await context.ensureVaultStructure();

  // Read current content
  const content = await fs.readFile(topicFile, 'utf-8');
  const today = new Date().toISOString().split('T')[0];

  // Update frontmatter to mark as archived
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) throw new Error('Invalid frontmatter');

  const frontmatter = frontmatterMatch[1];
  let updatedFrontmatter = frontmatter;

  // Add archived date and reason
  updatedFrontmatter += `\narchived: ${today}`;
  if (args.reason) {
    updatedFrontmatter += `\narchive_reason: ${args.reason}`;
  }

  // Add to review history
  const reviewHistoryEntry = `  - date: ${today}\n    action: archived\n    notes: "${args.reason || 'Topic archived'}"`;
  if (updatedFrontmatter.includes('review_history:')) {
    updatedFrontmatter = updatedFrontmatter.replace(
      /review_history:/,
      `review_history:\n${reviewHistoryEntry}`
    );
  } else {
    updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
  }

  const mainContent = content.substring(frontmatterMatch[0].length).trim();
  const newContent = `---\n${updatedFrontmatter}\n---\n\n${mainContent}`;

  // Move to archive
  await fs.writeFile(archiveFile, newContent);
  await fs.unlink(topicFile);

  // Run vault custodian on the archived topic (silent unless issues found)
  let custodianReport = '';
  try {
    const custodianResult = await context.vaultCustodian({
      files_to_check: [archiveFile],
    });
    if (custodianResult.content && custodianResult.content[0]) {
      const reportText = (custodianResult.content[0] as { text: string }).text;
      // Only show report if there are issues, warnings, or fixes applied
      if (!reportText.includes('No issues found')) {
        custodianReport = '\n\n' + reportText;
      }
    }
  } catch (error) {
    custodianReport =
      '\n\n⚠️  Vault custodian check failed: ' +
      (error instanceof Error ? error.message : String(error));
  }

  return {
    content: [
      {
        type: 'text',
        text: `Topic archived: ${args.topic}\nMoved from topics/${slug}.md to archive/topics/${slug}.md${args.reason ? `\nReason: ${args.reason}` : ''}${custodianReport}`,
      },
    ],
  };
}
