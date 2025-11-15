/**
 * Tool: review_topic
 *
 * Analyze a topic for outdated content and suggest updates.
 * Returns current content and AI analysis with suggested changes.
 */

import fs from 'fs/promises';
import path from 'path';

export interface ReviewTopicArgs {
  topic: string;
  analysis_prompt?: string;
}

export interface ReviewTopicResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface ReviewAnalysis {
  is_outdated: boolean;
  concerns: string[];
  suggested_updates: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PendingReview {
  review_id: string;
  topic: string;
  slug: string;
  current_content: string;
  analysis: ReviewAnalysis;
  timestamp: number;
}

export interface ReviewTopicContext {
  vaultPath: string;
  slugify: (text: string) => string;
  pendingReviews: Map<string, PendingReview>;
}

export async function reviewTopic(
  args: ReviewTopicArgs,
  context: ReviewTopicContext
): Promise<ReviewTopicResult> {
  const slug = context.slugify(args.topic);
  const topicFile = path.join(context.vaultPath, 'topics', `${slug}.md`);

  try {
    await fs.access(topicFile);
  } catch {
    throw new Error(`Topic not found: ${args.topic}`);
  }

  const content = await fs.readFile(topicFile, 'utf-8');

  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    throw new Error('Invalid topic file format (missing frontmatter)');
  }

  const frontmatter = frontmatterMatch[1];
  const titleMatch = frontmatter.match(/title:\s*(.+)/);
  const title = titleMatch ? titleMatch[1].trim() : args.topic;

  // Extract main content (without frontmatter)
  const mainContent = content.substring(frontmatterMatch[0].length).trim();

  // For now, we'll create a placeholder analysis since we don't have AI integration
  // In a real implementation, this would call an LLM API
  const analysis: ReviewAnalysis = {
    is_outdated: false,
    concerns: [
      'Manual review required - AI analysis not yet implemented',
      'Please review the content below and provide your assessment',
    ],
    suggested_updates: 'Please review the topic content and suggest specific updates if needed.',
    confidence: 'low',
  };

  // Generate review ID and store pending review
  const reviewId = `review_${Date.now()}_${slug}`;
  const pendingReview: PendingReview = {
    review_id: reviewId,
    topic: title,
    slug,
    current_content: content,
    analysis,
    timestamp: Date.now(),
  };

  context.pendingReviews.set(reviewId, pendingReview);

  let resultText = `# Review Analysis: ${title}\n\n`;
  resultText += `**Review ID:** ${reviewId}\n`;
  resultText += `**Topic File:** topics/${slug}.md\n\n`;
  resultText += `## Current Content\n\n${mainContent}\n\n`;
  resultText += `## AI Analysis\n\n`;
  resultText += `**Status:** ${analysis.is_outdated ? '⚠️ Potentially Outdated' : '✅ Appears Current'}\n`;
  resultText += `**Confidence:** ${analysis.confidence}\n\n`;
  resultText += `**Concerns:**\n`;
  analysis.concerns.forEach(c => resultText += `- ${c}\n`);
  resultText += `\n**Suggested Updates:**\n${analysis.suggested_updates}\n\n`;
  resultText += `---\n\n`;
  resultText += `**Next Steps:**\n`;
  resultText += `Use approve_topic_update with one of these actions:\n`;
  resultText += `- \`update\`: Apply suggested changes (you can provide modified_content)\n`;
  resultText += `- \`keep\`: Mark as reviewed without changes\n`;
  resultText += `- \`archive\`: Move to archive\n`;
  resultText += `- \`dismiss\`: Cancel this review\n`;

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}
