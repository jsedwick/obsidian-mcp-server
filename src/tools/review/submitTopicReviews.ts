/**
 * Tool: submit_topic_reviews
 *
 * Submit structured review assessments for stale topics with validation
 * to detect rubber-stamping and ensure meaningful quality review.
 *
 * This implements Decision 033's principle: tool architecture enforces
 * critical workflows, not just document them. Prevents AI from bypassing
 * the review checklist by requiring structured data.
 */

/**
 * Structured assessment for a single topic review
 */
export interface TopicReviewAssessment {
  topic_slug: string;

  // Technical accuracy check (CRITICAL)
  technical_accuracy: 'verified' | 'outdated' | 'needs_check';
  technical_accuracy_notes?: string;  // Required if 'outdated' or 'needs_check'

  // Completeness check (HIGH PRIORITY)
  completeness: 'comprehensive' | 'needs_expansion' | 'adequate';
  completeness_notes?: string;  // Required if 'needs_expansion'

  // Organization check (MEDIUM PRIORITY)
  organization: 'excellent' | 'needs_improvement' | 'poor';
  organization_notes?: string;  // Required if 'needs_improvement' or 'poor'

  // Redundancy/consolidation check (MEDIUM PRIORITY)
  redundancy_check: 'no_duplicates' | 'consolidate_with' | 'not_checked';
  consolidate_with_topic?: string;  // Required if 'consolidate_with'

  // Final outcome
  outcome: 'current' | 'expand' | 'reorganize' | 'consolidate' | 'archive';

  // Issues and updates (must have at least one if outcome !== 'current')
  issues_found: string[];
  updates_needed: string[];
}

export interface SubmitTopicReviewsArgs {
  reviews: TopicReviewAssessment[];
}

export interface ReviewValidationWarning {
  type: 'rubber_stamp_detected' | 'missing_notes' | 'suspicious_uniformity';
  severity: 'error' | 'warning';
  message: string;
  affected_topics?: string[];
}

export interface SubmitTopicReviewsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface SubmitTopicReviewsContext {
  vaultPath: string;
}

/**
 * Validate reviews for rubber-stamping patterns
 */
function validateReviews(reviews: TopicReviewAssessment[]): ReviewValidationWarning[] {
  const warnings: ReviewValidationWarning[] = [];

  // Check 1: All topics marked "current" (most suspicious)
  const allCurrent = reviews.every(r => r.outcome === 'current');
  if (allCurrent && reviews.length > 2) {
    warnings.push({
      type: 'rubber_stamp_detected',
      severity: 'error',
      message: `🚨 CRITICAL: All ${reviews.length} topics marked as "current" with no updates needed. This suggests rubber-stamping without meaningful review. Expected: at least some topics need expansion, reorganization, or have issues to address.`,
      affected_topics: reviews.map(r => r.topic_slug),
    });
  }

  // Check 2: No issues found across all topics (very suspicious)
  const noIssuesFound = reviews.every(r => r.issues_found.length === 0);
  if (noIssuesFound && reviews.length > 2) {
    warnings.push({
      type: 'suspicious_uniformity',
      severity: 'error',
      message: `🚨 CRITICAL: Zero issues found across ${reviews.length} topics. Real reviews typically identify broken links, missing examples, or outdated information in at least some topics.`,
      affected_topics: reviews.map(r => r.topic_slug),
    });
  }

  // Check 3: All identical assessments (suspicious)
  const firstReview = reviews[0];
  const allIdentical = reviews.every(r =>
    r.technical_accuracy === firstReview.technical_accuracy &&
    r.completeness === firstReview.completeness &&
    r.organization === firstReview.organization &&
    r.redundancy_check === firstReview.redundancy_check &&
    r.outcome === firstReview.outcome
  );

  if (allIdentical && reviews.length > 2) {
    warnings.push({
      type: 'suspicious_uniformity',
      severity: 'warning',
      message: `⚠️  WARNING: All ${reviews.length} topics have identical assessment ratings. Real reviews typically show variation in quality across different topics.`,
    });
  }

  // Check 4: Missing required notes
  const missingNotes: string[] = [];
  reviews.forEach(review => {
    if ((review.technical_accuracy === 'outdated' || review.technical_accuracy === 'needs_check')
        && !review.technical_accuracy_notes) {
      missingNotes.push(`${review.topic_slug}: technical_accuracy is '${review.technical_accuracy}' but no notes provided`);
    }

    if (review.completeness === 'needs_expansion' && !review.completeness_notes) {
      missingNotes.push(`${review.topic_slug}: completeness is 'needs_expansion' but no notes provided`);
    }

    if ((review.organization === 'needs_improvement' || review.organization === 'poor')
        && !review.organization_notes) {
      missingNotes.push(`${review.topic_slug}: organization is '${review.organization}' but no notes provided`);
    }

    if (review.redundancy_check === 'consolidate_with' && !review.consolidate_with_topic) {
      missingNotes.push(`${review.topic_slug}: redundancy_check is 'consolidate_with' but no topic specified`);
    }

    // Outcome must have supporting evidence
    if (review.outcome !== 'current' && review.issues_found.length === 0 && review.updates_needed.length === 0) {
      missingNotes.push(`${review.topic_slug}: outcome is '${review.outcome}' but no issues_found or updates_needed specified`);
    }
  });

  if (missingNotes.length > 0) {
    warnings.push({
      type: 'missing_notes',
      severity: 'error',
      message: `🚨 CRITICAL: Missing required notes or details:\n${missingNotes.map(n => `  - ${n}`).join('\n')}`,
    });
  }

  // Check 5: Low-effort reviews (few details)
  const lowEffortCount = reviews.filter(r => {
    const totalNotes = (r.technical_accuracy_notes || '').length +
                      (r.completeness_notes || '').length +
                      (r.organization_notes || '').length;
    return r.outcome !== 'current' && totalNotes < 20; // Less than 20 chars of notes
  }).length;

  if (lowEffortCount > reviews.length / 2) {
    warnings.push({
      type: 'suspicious_uniformity',
      severity: 'warning',
      message: `⚠️  WARNING: ${lowEffortCount} of ${reviews.length} non-current topics have minimal notes (<20 chars). High-quality reviews typically provide detailed reasoning.`,
    });
  }

  return warnings;
}

/**
 * Format review summary for display
 */
function formatReviewSummary(reviews: TopicReviewAssessment[]): string {
  const outcomes = {
    current: reviews.filter(r => r.outcome === 'current').length,
    expand: reviews.filter(r => r.outcome === 'expand').length,
    reorganize: reviews.filter(r => r.outcome === 'reorganize').length,
    consolidate: reviews.filter(r => r.outcome === 'consolidate').length,
    archive: reviews.filter(r => r.outcome === 'archive').length,
  };

  let summary = `# Topic Review Summary\n\n`;
  summary += `Reviewed ${reviews.length} stale topics with structured assessment.\n\n`;

  summary += `## Outcomes\n\n`;
  summary += `- ✅ **Current & Comprehensive**: ${outcomes.current}\n`;
  summary += `- 📝 **Needs Expansion**: ${outcomes.expand}\n`;
  summary += `- 🔧 **Needs Reorganization**: ${outcomes.reorganize}\n`;
  summary += `- 🔄 **Consolidate with Another**: ${outcomes.consolidate}\n`;
  summary += `- 🗄️  **Archive**: ${outcomes.archive}\n\n`;

  return summary;
}

/**
 * Format detailed review results
 */
function formatDetailedResults(reviews: TopicReviewAssessment[]): string {
  let details = `## Detailed Review Results\n\n`;

  const grouped = {
    current: reviews.filter(r => r.outcome === 'current'),
    expand: reviews.filter(r => r.outcome === 'expand'),
    reorganize: reviews.filter(r => r.outcome === 'reorganize'),
    consolidate: reviews.filter(r => r.outcome === 'consolidate'),
    archive: reviews.filter(r => r.outcome === 'archive'),
  };

  // Current & Comprehensive
  if (grouped.current.length > 0) {
    details += `### ✅ Current & Comprehensive (${grouped.current.length})\n\n`;
    grouped.current.forEach(r => {
      details += `- **[[${r.topic_slug}]]**\n`;
      if (r.technical_accuracy_notes || r.completeness_notes || r.organization_notes) {
        details += `  ${r.technical_accuracy_notes || r.completeness_notes || r.organization_notes}\n`;
      }
    });
    details += `\n`;
  }

  // Needs Expansion
  if (grouped.expand.length > 0) {
    details += `### 📝 Needs Expansion (${grouped.expand.length})\n\n`;
    grouped.expand.forEach(r => {
      details += `- **[[${r.topic_slug}]]**\n`;
      if (r.completeness_notes) details += `  - ${r.completeness_notes}\n`;
      if (r.issues_found.length > 0) {
        details += `  - Issues: ${r.issues_found.join('; ')}\n`;
      }
      if (r.updates_needed.length > 0) {
        details += `  - Updates: ${r.updates_needed.join('; ')}\n`;
      }
    });
    details += `\n`;
  }

  // Needs Reorganization
  if (grouped.reorganize.length > 0) {
    details += `### 🔧 Needs Reorganization (${grouped.reorganize.length})\n\n`;
    grouped.reorganize.forEach(r => {
      details += `- **[[${r.topic_slug}]]**\n`;
      if (r.organization_notes) details += `  - ${r.organization_notes}\n`;
      if (r.issues_found.length > 0) {
        details += `  - Issues: ${r.issues_found.join('; ')}\n`;
      }
    });
    details += `\n`;
  }

  // Consolidate
  if (grouped.consolidate.length > 0) {
    details += `### 🔄 Consolidate with Another (${grouped.consolidate.length})\n\n`;
    grouped.consolidate.forEach(r => {
      details += `- **[[${r.topic_slug}]]** → consolidate with [[${r.consolidate_with_topic}]]\n`;
      if (r.issues_found.length > 0) {
        details += `  - Reason: ${r.issues_found.join('; ')}\n`;
      }
    });
    details += `\n`;
  }

  // Archive
  if (grouped.archive.length > 0) {
    details += `### 🗄️  Archive (${grouped.archive.length})\n\n`;
    grouped.archive.forEach(r => {
      details += `- **[[${r.topic_slug}]]**\n`;
      if (r.issues_found.length > 0) {
        details += `  - Reason: ${r.issues_found.join('; ')}\n`;
      }
    });
    details += `\n`;
  }

  return details;
}

/**
 * Submit structured topic reviews with validation
 */
export function submitTopicReviews(
  args: SubmitTopicReviewsArgs,
  _context: SubmitTopicReviewsContext
): SubmitTopicReviewsResult {

  // Validate reviews for rubber-stamping patterns
  const warnings = validateReviews(args.reviews);

  // Build result message
  let resultText = '';

  // Show validation warnings first (if any)
  if (warnings.length > 0) {
    resultText += `# ⚠️  Review Validation Warnings\n\n`;

    const errors = warnings.filter(w => w.severity === 'error');
    const warningList = warnings.filter(w => w.severity === 'warning');

    if (errors.length > 0) {
      resultText += `## Errors (Must Address)\n\n`;
      errors.forEach(w => {
        resultText += `${w.message}\n\n`;
      });
    }

    if (warningList.length > 0) {
      resultText += `## Warnings (Review Recommended)\n\n`;
      warningList.forEach(w => {
        resultText += `${w.message}\n\n`;
      });
    }

    resultText += `---\n\n`;

    // If errors exist, reject the submission
    if (errors.length > 0) {
      resultText += `**❌ Review submission REJECTED due to validation errors.**\n\n`;
      resultText += `Please revise your reviews to address the issues above. The topic review checklist ([[topic-review-checklist-for-stale-topic-assessment]]) provides guidance for meaningful assessment.\n\n`;

      resultText += `**Common fixes:**\n`;
      resultText += `- If all topics are truly "current", provide detailed notes explaining why no improvements are needed\n`;
      resultText += `- Document any issues found (broken links, missing examples, outdated info)\n`;
      resultText += `- Vary assessments based on actual topic quality differences\n`;
      resultText += `- Add required notes for non-current assessments\n`;

      return {
        content: [{ type: 'text', text: resultText }],
      };
    }
  }

  // Validation passed (or warnings only) - accept submission
  resultText += formatReviewSummary(args.reviews);
  resultText += formatDetailedResults(args.reviews);

  resultText += `---\n\n`;
  resultText += `**✅ Review submission accepted.**\n\n`;

  if (warnings.length > 0) {
    resultText += `Note: Some warnings were flagged above. Consider reviewing those topics again to ensure quality assessment.\n\n`;
  }

  resultText += `**Next Steps:**\n`;
  resultText += `1. For topics needing expansion: use \`update_document\` to add missing content\n`;
  resultText += `2. For topics needing reorganization: use \`update_document\` with \`strategy: 'replace'\`\n`;
  resultText += `3. For topics to consolidate: merge content then archive the duplicate\n`;
  resultText += `4. For topics to archive: use \`archive_topic\` with reason from review\n`;
  resultText += `5. For current topics: use \`update_document\` to refresh \`last_reviewed\` date only\n`;

  return {
    content: [{ type: 'text', text: resultText }],
  };
}
