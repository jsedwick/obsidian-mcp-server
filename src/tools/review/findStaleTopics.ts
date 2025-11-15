/**
 * Tool: find_stale_topics
 *
 * Find topics that haven't been reviewed in a specified time period.
 * Returns list of topics that may need review.
 */

import fs from 'fs/promises';
import path from 'path';

export interface FindStaleTopicsArgs {
  age_threshold_days?: number;
  include_never_reviewed?: boolean;
}

export interface FindStaleTopicsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface FindStaleTopicsContext {
  vaultPath: string;
  ensureVaultStructure: () => Promise<void>;
  getFileAgeDays: (dateString: string) => number;
}

export async function findStaleTopics(
  args: FindStaleTopicsArgs,
  context: FindStaleTopicsContext
): Promise<FindStaleTopicsResult> {
  await context.ensureVaultStructure();

  const thresholdDays = args.age_threshold_days || 365;
  const includeNeverReviewed = args.include_never_reviewed !== false;
  const topicsDir = path.join(context.vaultPath, 'topics');
  const staleTopics: Array<{
    title: string;
    slug: string;
    created_date: string;
    last_reviewed?: string;
    age_days: number;
    review_count: number;
    file_path: string;
  }> = [];

  try {
    const files = await fs.readdir(topicsDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(topicsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      const frontmatter = frontmatterMatch[1];
      const createdMatch = frontmatter.match(/created:\s*(.+)/);
      const lastReviewedMatch = frontmatter.match(/last_reviewed:\s*(.+)/);
      const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
      const titleMatch = frontmatter.match(/title:\s*(.+)/);

      if (!createdMatch) continue;

      const created = createdMatch[1].trim();
      const lastReviewed = lastReviewedMatch ? lastReviewedMatch[1].trim() : undefined;
      const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;
      const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');

      // Determine if stale
      const referenceDate = lastReviewed || created;
      const ageDays = context.getFileAgeDays(referenceDate);

      const isStale = ageDays > thresholdDays;
      const neverReviewed = !lastReviewed || lastReviewed === created;

      if (isStale && (includeNeverReviewed || !neverReviewed)) {
        staleTopics.push({
          title,
          slug: file.replace('.md', ''),
          created_date: created,
          last_reviewed: lastReviewed !== created ? lastReviewed : undefined,
          age_days: ageDays,
          review_count: reviewCount,
          file_path: `topics/${file}`,
        });
      }
    }
  } catch (error) {
    throw new Error(`Failed to scan topics: ${error}`);
  }

  // Sort by age (oldest first)
  staleTopics.sort((a, b) => b.age_days - a.age_days);

  if (staleTopics.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No stale topics found. All topics have been reviewed within the last ${thresholdDays} days.`,
        },
      ],
    };
  }

  let resultText = `Found ${staleTopics.length} stale topic(s) older than ${thresholdDays} days:\n\n`;

  staleTopics.forEach((topic, idx) => {
    resultText += `${idx + 1}. **${topic.title}** (${topic.slug})\n`;
    resultText += `   - Created: ${topic.created_date}\n`;
    resultText += `   - Last reviewed: ${topic.last_reviewed || 'Never'}\n`;
    resultText += `   - Age: ${topic.age_days} days\n`;
    resultText += `   - Reviews: ${topic.review_count}\n\n`;
  });

  resultText += `\nUse review_topic to analyze any of these topics.`;

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}
