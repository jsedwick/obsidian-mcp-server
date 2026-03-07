/**
 * Tool: find_undocumented_decisions
 *
 * Scan recent sessions for decision-like patterns that don't have corresponding ADRs.
 * Helps identify strategic choices that were made but never formally documented.
 *
 * Decision 057: Proactive decision document creation
 */

import fs from 'fs/promises';
import path from 'path';

export interface FindUndocumentedDecisionsArgs {
  days?: number; // How far back to scan (default: 30)
  project?: string; // Optional: filter to a specific project slug
}

export interface FindUndocumentedDecisionsResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface FindUndocumentedDecisionsContext {
  vaultPath: string;
}

// Patterns that suggest a strategic choice was made
const DECISION_PATTERNS = [
  // Explicit choice language
  /\b(?:chose|decided|selected|picked|went with|opted for|switched to|migrated to)\b/i,
  // Comparison language
  /\b(?:vs\.?|versus|instead of|rather than|over|compared to)\b/i,
  // Tradeoff language
  /\b(?:tradeoff|trade-off|tradeoffs|trade-offs|pros and cons|advantages|disadvantages)\b/i,
  // Architecture language
  /\b(?:architecture|architectural|design pattern|approach|strategy|framework selection)\b/i,
  // Alternative consideration
  /\b(?:alternatives?|options? (?:were|are)|considered|evaluated|assessed)\b/i,
];

// Minimum number of pattern matches to flag a session
const MIN_PATTERN_MATCHES = 2;

interface SessionCandidate {
  file: string;
  sessionId: string;
  title: string;
  date: string;
  matchedPatterns: string[];
  snippet: string;
  existingDecisionLinks: string[];
}

/**
 * Analyze a single session file for decision-like patterns.
 * Returns a SessionCandidate if patterns found, null otherwise.
 */
function analyzeSessionFile(
  filePath: string,
  fileName: string,
  content: string,
  project?: string
): SessionCandidate | null {
  // If filtering by project, check session content
  if (project) {
    const hasProject =
      content.includes(`projects/${project}`) || content.includes(`decisions/${project}`);
    if (!hasProject) return null;
  }

  // Check for decision-like patterns
  const matchedPatterns: string[] = [];
  for (const pattern of DECISION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      matchedPatterns.push(match[0]);
    }
  }

  if (matchedPatterns.length < MIN_PATTERN_MATCHES) return null;

  // Check if session already links to decisions
  const decisionLinkMatches = content.matchAll(/\[\[decisions\/([^\]|]+)/g);
  const existingDecisionLinks = Array.from(decisionLinkMatches).map(m => m[1]);

  // Extract session title and summary for context
  const titleMatch = content.match(/^# (.+)$/m);
  const summaryMatch = content.match(/## Summary\n\n([\s\S]*?)(?=\n\n##)/);
  const handoffMatch = content.match(/## Handoff\n\n([\s\S]*?)(?=\n\n##)/);

  // Build a snippet from the most relevant section
  const snippet = (summaryMatch?.[1] || handoffMatch?.[1] || '').trim().substring(0, 200);

  const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
  const sessionId = fileName.replace('.md', '');
  const title = titleMatch?.[1] || sessionId;

  return {
    file: filePath,
    sessionId,
    title,
    date: dateMatch?.[1] || '',
    matchedPatterns: [...new Set(matchedPatterns)],
    snippet: snippet + (snippet.length >= 200 ? '...' : ''),
    existingDecisionLinks,
  };
}

export async function findUndocumentedDecisions(
  args: FindUndocumentedDecisionsArgs,
  context: FindUndocumentedDecisionsContext
): Promise<FindUndocumentedDecisionsResult> {
  const days = args.days ?? 30;
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Scan session files within the date range
  const sessionsDir = path.join(context.vaultPath, 'sessions');
  const candidates: SessionCandidate[] = [];

  try {
    await fs.access(sessionsDir);
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: 'No sessions directory found in vault.',
        },
      ],
    };
  }

  // Read month directories (format: YYYY-MM)
  const monthDirs = await fs.readdir(sessionsDir);
  const relevantMonthDirs = monthDirs
    .filter(d => /^\d{4}-\d{2}$/.test(d))
    .filter(d => {
      const [year, month] = d.split('-').map(Number);
      const monthEnd = new Date(year, month, 0);
      return monthEnd >= cutoff;
    })
    .sort()
    .reverse();

  for (const monthDir of relevantMonthDirs) {
    const monthPath = path.join(sessionsDir, monthDir);
    let files: string[];
    try {
      files = (await fs.readdir(monthPath))
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();
    } catch {
      continue;
    }

    for (const file of files) {
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      const fileDate = new Date(dateMatch[1]);
      if (fileDate < cutoff) continue;

      const filePath = path.join(monthPath, file);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const candidate = analyzeSessionFile(filePath, file, content, args.project);
      if (candidate) candidates.push(candidate);
    }
  }

  // Sort: sessions without decision links first, then by pattern count
  candidates.sort((a, b) => {
    const aHasDecisions = a.existingDecisionLinks.length > 0 ? 1 : 0;
    const bHasDecisions = b.existingDecisionLinks.length > 0 ? 1 : 0;
    if (aHasDecisions !== bHasDecisions) return aHasDecisions - bHasDecisions;
    return b.matchedPatterns.length - a.matchedPatterns.length;
  });

  // Limit to top 10
  const topCandidates = candidates.slice(0, 10);

  if (topCandidates.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            `Scanned sessions from the last ${days} days. ` +
            'No sessions with undocumented decision patterns found.' +
            (args.project ? ` (filtered to project: ${args.project})` : ''),
        },
      ],
    };
  }

  // Format output
  const withoutDecisions = topCandidates.filter(c => c.existingDecisionLinks.length === 0);
  const withDecisions = topCandidates.filter(c => c.existingDecisionLinks.length > 0);

  let output =
    `Found ${topCandidates.length} session(s) with decision-like patterns ` +
    `in the last ${days} days` +
    (args.project ? ` (project: ${args.project})` : '') +
    ':\n\n';

  if (withoutDecisions.length > 0) {
    output += `**Sessions with NO linked decisions (${withoutDecisions.length}):**\n\n`;
    for (const c of withoutDecisions) {
      output += `### ${c.date} — ${c.title}\n`;
      output += `Patterns: ${c.matchedPatterns.join(', ')}\n`;
      if (c.snippet) output += `Summary: ${c.snippet}\n`;
      output += `File: ${c.file}\n\n`;
    }
  }

  if (withDecisions.length > 0) {
    output += `**Sessions with existing decisions but additional patterns (${withDecisions.length}):**\n\n`;
    for (const c of withDecisions) {
      output += `### ${c.date} — ${c.title}\n`;
      output += `Patterns: ${c.matchedPatterns.join(', ')}\n`;
      output += `Linked decisions: ${c.existingDecisionLinks.join(', ')}\n`;
      if (c.snippet) output += `Summary: ${c.snippet}\n`;
      output += `File: ${c.file}\n\n`;
    }
  }

  output +=
    '---\n\n' +
    '**Next steps:**\n' +
    '1. Read each flagged session to understand the context\n' +
    '2. Determine if the strategic choice warrants an ADR\n' +
    '3. Use `create_decision` for any undocumented decisions\n' +
    '4. **Litmus test:** Can you list 2-3 alternatives that were considered?\n';

  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
  };
}
