/**
 * Tool: find_stale_topics
 *
 * Find topics that haven't been reviewed recently, automatically archive obsolete ones,
 * and return the remaining stale topics that need manual review.
 *
 * This tool implements automatic vault maintenance by:
 * 1. Finding topics > 30 days old (top 10 oldest)
 * 2. Assessing each for relevance (using same logic as update_document)
 * 3. Automatically archiving obsolete topics with high confidence
 * 4. Returning non-obsolete stale topics for manual review/update
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

export interface RelevanceAssessment {
  should_archive: boolean;
  confidence: 'certain' | 'likely' | 'uncertain';
  reasoning: string;
  evidence: string[];
}

export interface FindStaleTopicsContext {
  vaultPath: string;
  ensureVaultStructure: () => Promise<void>;
  getFileAgeDays: (dateString: string) => number;
  slugify: (text: string) => string;
  archiveTopic: (args: { topic: string; reason?: string }) => Promise<unknown>;
}

/**
 * Assess whether a topic should be archived instead of updated.
 *
 * Same logic as update_document's assessTopicRelevance (Decision 038).
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

export async function findStaleTopics(
  args: FindStaleTopicsArgs,
  context: FindStaleTopicsContext
): Promise<FindStaleTopicsResult> {
  await context.ensureVaultStructure();

  // Default to 30 days (monthly review cycle)
  const thresholdDays = args.age_threshold_days || 30;
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
    throw new Error(
      `Failed to scan topics: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Sort by age (oldest first), limit to top 10
  staleTopics.sort((a, b) => b.age_days - a.age_days);
  const topicsToProcess = staleTopics.slice(0, 10);

  if (topicsToProcess.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No stale topics found. All topics have been reviewed within the last ${thresholdDays} days.`,
        },
      ],
    };
  }

  // Process each topic: assess relevance and archive if obsolete
  const archivedTopics: Array<{ title: string; reason: string }> = [];
  const topicsNeedingReview: typeof topicsToProcess = [];

  for (const topic of topicsToProcess) {
    const filePath = path.join(context.vaultPath, topic.file_path);
    const content = await fs.readFile(filePath, 'utf-8');

    // Assess relevance (Decision 038 logic)
    const assessment = await assessTopicRelevance(content);

    if (assessment.should_archive && assessment.confidence === 'certain') {
      // Automatically archive obsolete topics
      try {
        await context.archiveTopic({
          topic: topic.title,
          reason: assessment.reasoning,
        });

        archivedTopics.push({
          title: topic.title,
          reason: assessment.reasoning,
        });
      } catch {
        // If archiving fails, treat as needing manual review
        topicsNeedingReview.push(topic);
      }
    } else {
      // Topic is stale but not obsolete - needs manual review
      topicsNeedingReview.push(topic);
    }
  }

  // Build result message
  let resultText = `# Stale Topics Report\n\n`;
  resultText += `Scanned topics older than ${thresholdDays} days. Processed top 10 oldest.\n\n`;

  // Report archived topics
  if (archivedTopics.length > 0) {
    resultText += `## ✅ Automatically Archived (${archivedTopics.length})\n\n`;
    resultText += `The following obsolete topics were automatically moved to archive:\n\n`;

    archivedTopics.forEach((topic, idx) => {
      resultText += `${idx + 1}. **${topic.title}**\n`;
      resultText += `   - Reason: ${topic.reason}\n\n`;
    });
  }

  // Report topics needing review
  if (topicsNeedingReview.length > 0) {
    resultText += `## 📝 Topics Needing Review (${topicsNeedingReview.length})\n\n`;
    resultText += `The following topics are stale but not obsolete. Review each for accuracy and currency:\n\n`;

    topicsNeedingReview.forEach((topic, idx) => {
      resultText += `${idx + 1}. **[[${topic.slug}|${topic.title}]]**\n`;
      resultText += `   - Created: ${topic.created_date}\n`;
      resultText += `   - Last reviewed: ${topic.last_reviewed || 'Never'}\n`;
      resultText += `   - Age: ${topic.age_days} days\n`;
      resultText += `   - Reviews: ${topic.review_count}\n\n`;
    });

    resultText += `\n---\n\n`;
    resultText += `**Next Steps - Structured Review Workflow:**\n\n`;
    resultText += `**⚠️  IMPORTANT:** To ensure meaningful review and prevent rubber-stamping, you must submit structured assessments using \`submit_topic_reviews\`.\n\n`;
    resultText += `**Workflow:**\n`;
    resultText += `1. Load each topic with \`get_topic_context\` to review full content\n`;
    resultText += `2. Apply the [[topic-review-checklist-for-stale-topic-assessment|Topic Review Checklist]] systematically\n`;
    resultText += `3. Submit structured reviews using \`submit_topic_reviews\` with:\n`;
    resultText += `   - Technical accuracy assessment (verified/outdated/needs_check)\n`;
    resultText += `   - Completeness assessment (comprehensive/needs_expansion/adequate)\n`;
    resultText += `   - Organization assessment (excellent/needs_improvement/poor)\n`;
    resultText += `   - Redundancy check (no_duplicates/consolidate_with/not_checked)\n`;
    resultText += `   - Final outcome (current/expand/reorganize/consolidate/archive)\n`;
    resultText += `   - Issues found and updates needed\n`;
    resultText += `4. Tool will validate reviews and flag rubber-stamping patterns\n`;
    resultText += `5. Apply updates based on approved review outcomes\n\n`;
    resultText += `**Legacy workflow (discouraged):** Directly update topics without structured assessment. This bypasses quality enforcement.\n`;
  }

  if (archivedTopics.length === 0 && topicsNeedingReview.length === 0) {
    resultText += `\nAll stale topics were processed but none required action.`;
  }

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}
