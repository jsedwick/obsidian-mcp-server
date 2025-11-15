/**
 * Tool: approve_topic_update
 *
 * Apply or dismiss a pending topic review.
 * Updates the topic with new content and review history.
 */

import fs from 'fs/promises';
import path from 'path';
import { PendingReview } from './reviewTopic.js';

export interface ApproveTopicUpdateArgs {
  review_id: string;
  action: string;
  modified_content?: string;
}

export interface ApproveTopicUpdateResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface ApproveTopicUpdateContext {
  vaultPath: string;
  pendingReviews: Map<string, PendingReview>;
  archiveTopic: (args: { topic: string; reason?: string }) => Promise<ApproveTopicUpdateResult>;
}

export async function approveTopicUpdate(
  args: ApproveTopicUpdateArgs,
  context: ApproveTopicUpdateContext
): Promise<ApproveTopicUpdateResult> {
  const pendingReview = context.pendingReviews.get(args.review_id);

  if (!pendingReview) {
    throw new Error(`Review not found: ${args.review_id}. It may have expired or already been processed.`);
  }

  const { slug, topic, current_content } = pendingReview;
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);
  const today = new Date().toISOString().split('T')[0];

  try {
    switch (args.action) {
      case 'update': {
        // Parse existing frontmatter
        const frontmatterMatch = current_content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) throw new Error('Invalid frontmatter');

        const frontmatter = frontmatterMatch[1];
        const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
        const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;

        // Update frontmatter with new review info
        let updatedFrontmatter = frontmatter
          .replace(/last_reviewed:.*/, `last_reviewed: ${today}`)
          .replace(/review_count:.*/, `review_count: ${reviewCount + 1}`);

        // Add to review history
        const reviewHistoryEntry = `  - date: ${today}\n    action: updated\n    notes: "Content updated via review process"`;
        if (updatedFrontmatter.includes('review_history:')) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /review_history:/,
            `review_history:\n${reviewHistoryEntry}`
          );
        } else {
          updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
        }

        const mainContent = current_content.substring(frontmatterMatch[0].length).trim();
        const newContent = `---\n${updatedFrontmatter}\n---\n\n${args.modified_content || mainContent}`;

        await fs.writeFile(topicFile, newContent);

        context.pendingReviews.delete(args.review_id);

        return {
          content: [
            {
              type: 'text',
              text: `Topic updated: ${topic}\nFile: topics/${slug}.md\nReview count: ${reviewCount + 1}`,
            },
          ],
        };
      }

      case 'keep': {
        // Mark as reviewed without content changes
        const frontmatterMatch = current_content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) throw new Error('Invalid frontmatter');

        const frontmatter = frontmatterMatch[1];
        const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
        const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;

        let updatedFrontmatter = frontmatter
          .replace(/last_reviewed:.*/, `last_reviewed: ${today}`)
          .replace(/review_count:.*/, `review_count: ${reviewCount + 1}`);

        const reviewHistoryEntry = `  - date: ${today}\n    action: reviewed\n    notes: "Reviewed - no changes needed"`;
        if (updatedFrontmatter.includes('review_history:')) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /review_history:/,
            `review_history:\n${reviewHistoryEntry}`
          );
        } else {
          updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
        }

        const mainContent = current_content.substring(frontmatterMatch[0].length).trim();
        const newContent = `---\n${updatedFrontmatter}\n---\n\n${mainContent}`;

        await fs.writeFile(topicFile, newContent);

        context.pendingReviews.delete(args.review_id);

        return {
          content: [
            {
              type: 'text',
              text: `Topic marked as reviewed: ${topic}\nNo content changes made.\nReview count: ${reviewCount + 1}`,
            },
          ],
        };
      }

      case 'archive': {
        return await context.archiveTopic({ topic: slug, reason: 'Archived via review process' });
      }

      case 'dismiss': {
        context.pendingReviews.delete(args.review_id);

        return {
          content: [
            {
              type: 'text',
              text: `Review dismissed for: ${topic}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown action: ${args.action}. Use: update, keep, archive, or dismiss`);
    }
  } catch (error) {
    throw new Error(`Failed to process review: ${error}`);
  }
}
