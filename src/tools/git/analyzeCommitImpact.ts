/**
 * Tool: analyze_commit_impact
 * Description: Analyze a Git commit to understand what changed, generate human-readable summaries, and identify related topics/decisions. Provides impact analysis for documentation updates.
 */

import * as path from 'path';
import { execSync } from 'child_process';
import { GitService } from '../../services/git/GitService.js';

export interface AnalyzeCommitImpactArgs {
  repo_path: string;
  commit_hash: string;
  include_diff?: boolean;
}

/**
 * Structured topic data for enforcement (Decision 041)
 */
export interface RelatedTopic {
  path: string;
  title: string;
  relevance: string; // Why this topic is related to the commit
}

/**
 * Structured decision data for proactive surfacing (Decision 057)
 */
export interface RelatedDecision {
  path: string;
  title: string;
  relevance: string; // Why this decision is related to the commit
}

export interface AnalyzeCommitImpactResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  /**
   * Structured list of topics related to this commit (Decision 041)
   * Used by closeSession to enforce topic review
   */
  relatedTopics?: RelatedTopic[];
  /**
   * Structured list of decisions related to this commit (Decision 057)
   * Used by closeSession to surface related decisions in Phase 1
   */
  relatedDecisions?: RelatedDecision[];
}

export async function analyzeCommitImpact(
  args: AnalyzeCommitImpactArgs,
  context: {
    vaultPath: string;
    gitService: GitService;
    searchVault: (args: {
      query: string;
      max_results?: number;
      snippets_only?: boolean;
    }) => Promise<AnalyzeCommitImpactResult>;
  }
): Promise<AnalyzeCommitImpactResult> {
  try {
    // Validate repository exists
    if (!(await context.gitService.isGitRepository(args.repo_path))) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Not a git repository: ${args.repo_path}`,
          },
        ],
      };
    }

    let commitInfo: string;
    let commitDiff: string;
    let commitFiles: string;

    try {
      // Get commit message and metadata
      commitInfo = execSync(
        `git -C "${args.repo_path}" show --no-patch --format="%H%n%an%n%ae%n%ad%n%s%n%b" ${args.commit_hash}`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      // Get files changed (stat summary)
      commitFiles = execSync(`git -C "${args.repo_path}" show --stat ${args.commit_hash}`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      // Get diff (full or summary based on flag)
      if (args.include_diff) {
        commitDiff = execSync(`git -C "${args.repo_path}" show ${args.commit_hash}`, {
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
        });
      } else {
        commitDiff = execSync(
          `git -C "${args.repo_path}" diff ${args.commit_hash}^ ${args.commit_hash} --stat`,
          { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );
      }
    } catch (gitError: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing git command: ${gitError.message}`,
          },
        ],
      };
    }

    // Parse commit info
    const [hash, author, email, date, subject, ...bodyLines] = commitInfo.split('\n');
    const body = bodyLines.join('\n').trim();

    // Extract changed file paths for searching related topics
    const filePathsMatch = commitFiles.match(/\s([\w/.\-_]+)\s+\|/g);
    const changedFiles = filePathsMatch
      ? filePathsMatch.map(m => m.trim().split('|')[0].trim())
      : [];

    // Search for related topics and decisions based on commit content
    const searchTerms = [
      subject,
      ...changedFiles.slice(0, 3).map(f => path.basename(f, path.extname(f))),
    ];

    const relatedContent: string[] = [];
    // Collect structured topic data for enforcement (Decision 041)
    const relatedTopicsMap = new Map<string, RelatedTopic>();
    // Collect structured decision data for proactive surfacing (Decision 057)
    const relatedDecisionsMap = new Map<string, RelatedDecision>();

    for (const term of searchTerms) {
      try {
        const results = await context.searchVault({
          query: term,
          max_results: 3,
          snippets_only: true,
        });

        const resultText = results.content[0].text;
        if (!resultText.includes('Found 0 matches')) {
          relatedContent.push(`**Search for "${term}":**\n${resultText}\n`);

          // Extract file paths from search results (Decision 041 + 057)
          // Format: **1. /path/to/file.md** or **/path/to/file.md**
          const pathMatches = resultText.matchAll(/\*\*(?:\d+\.\s*)?([^*]+\.md)\*\*/g);
          for (const match of pathMatches) {
            const filePath = match[1].trim();

            if (filePath.startsWith(context.vaultPath) && !filePath.includes('/archive/')) {
              const fileName = path.basename(filePath, '.md');
              const title = fileName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

              // Collect topics (Decision 041)
              if (filePath.includes('/topics/') && !relatedTopicsMap.has(filePath)) {
                relatedTopicsMap.set(filePath, {
                  path: filePath,
                  title,
                  relevance: `Matched search term: "${term}"`,
                });
              }

              // Collect decisions (Decision 057)
              if (filePath.includes('/decisions/') && !relatedDecisionsMap.has(filePath)) {
                relatedDecisionsMap.set(filePath, {
                  path: filePath,
                  title,
                  relevance: `Matched search term: "${term}"`,
                });
              }
            }
          }
        }
      } catch {
        // Skip failed searches
      }
    }

    // Convert maps to arrays, limit to top 5 each
    const relatedTopics = Array.from(relatedTopicsMap.values()).slice(0, 5);
    const relatedDecisions = Array.from(relatedDecisionsMap.values()).slice(0, 5);

    // Build impact analysis prompt
    const analysisPrompt = `Analyze this Git commit and provide COMPREHENSIVE impact assessment for documentation updates.

## Commit Information
- **Hash**: ${hash.substring(0, 12)}
- **Author**: ${author} <${email}>
- **Date**: ${date}
- **Subject**: ${subject}
${body ? `- **Body**: ${body}` : ''}

## Files Changed
${commitFiles}

${args.include_diff ? `## Full Diff\n\`\`\`\n${commitDiff}\n\`\`\`` : `## Summary\n${commitDiff}`}

## Your Task
Analyze this commit with a focus on preventing documentation drift. Be PROACTIVE and AGGRESSIVE about identifying documentation that needs updates.

Provide:

1. **Summary** (2-3 sentences): What was changed and why?
2. **Key Changes**: List 3-5 main technical changes
3. **Impact Level** (1-5): How significant is this change?
   - 1: Minor fix or tweak
   - 2: Small feature or bug fix
   - 3: Notable feature or refactoring
   - 4: Major feature or architectural change
   - 5: Fundamental system redesign

4. **Affected Topics** (CRITICAL - Be thorough):
   - Which existing topics should be updated? (provide topic names)
   - Look beyond direct file mentions - consider conceptual relationships
   - If a commit changes authentication logic, consider ALL auth-related topics
   - If a commit changes an API, consider topics about API usage, integration, examples
   - Even if a topic only tangentially relates, include it if the commit might make it outdated

5. **New Topics**: Should new documentation be created?
6. **Related Decisions**: Does this relate to any architectural decisions?
7. **Suggested Actions**: What documentation updates are recommended?
   - Be specific about what needs to change
   - Include both directly affected AND conceptually related topics
   - Err on the side of over-documenting rather than under-documenting

Respond in JSON format:
{
  "summary": "...",
  "key_changes": ["change1", "change2", ...],
  "impact_level": 3,
  "affected_topics": ["topic1", "topic2", ...],
  "new_topics": ["topic1", "topic2", ...],
  "related_decisions": ["decision1", ...],
  "suggested_actions": [
    {"action": "update", "target": "topic-name", "reason": "..."},
    {"action": "create", "target": "new-topic-name", "reason": "..."}
  ]
}`;

    return {
      content: [
        {
          type: 'text',
          text: `# Git Commit Impact Analysis

## Commit Summary
- **Hash**: ${hash.substring(0, 12)}
- **Author**: ${author}
- **Date**: ${date}
- **Message**: ${subject}

## Files Changed
\`\`\`
${commitFiles}
\`\`\`

## Related Content in Vault
${relatedContent.length > 0 ? relatedContent.join('\n') : 'No directly related topics found in vault.'}

## Impact Analysis Prompt
To complete this analysis, use a sub-agent with the following prompt:

\`\`\`
${analysisPrompt}
\`\`\`

## Next Steps - CRITICAL FOR PREVENTING DOCUMENTATION DRIFT

1. **Run Analysis**: Execute the prompt through a sub-agent to get structured impact assessment

2. **AGGRESSIVELY UPDATE Documentation**:
   - **Do NOT ask for user permission** - documentation drift prevention is your responsibility
   - **Be proactive** - if the analysis suggests a topic MIGHT be affected, read it and update it
   - **Think broadly** - consider conceptual relationships, not just direct mentions
   - For affected topics: Use \`update_topic_page\` or \`Edit\` to incorporate changes
   - For new topics: Use \`create_topic_page\` with comprehensive commit context
   - For decisions: Use \`create_decision\` if architectural choices were made
   - **Read existing topics before updating** to understand current state
   - **Verify topic accuracy** - if a topic is outdated due to this commit, fix it NOW

3. **Link Commit**: The commit is already recorded via \`record_commit\`, ensure it links to updated topics

**Remember**: Your goal is to keep documentation in perfect sync with code. When in doubt, UPDATE.
`,
        },
      ],
      // Structured topic data for enforcement (Decision 041)
      relatedTopics: relatedTopics.length > 0 ? relatedTopics : undefined,
      // Structured decision data for proactive surfacing (Decision 057)
      relatedDecisions: relatedDecisions.length > 0 ? relatedDecisions : undefined,
    };
  } catch (error) {
    throw new Error(
      `Failed to analyze commit: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
