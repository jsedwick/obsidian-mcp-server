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

export interface AnalyzeCommitImpactResult {
  content: Array<{
    type: string;
    text: string;
  }>;
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

    for (const term of searchTerms) {
      try {
        const results = await context.searchVault({
          query: term,
          max_results: 3,
          snippets_only: true,
        });

        if (!results.content[0].text.includes('Found 0 matches')) {
          relatedContent.push(`**Search for "${term}":**\n${results.content[0].text}\n`);
        }
      } catch {
        // Skip failed searches
      }
    }

    // Build impact analysis prompt
    const analysisPrompt = `Analyze this Git commit and provide impact assessment for documentation updates.

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
Analyze this commit and provide:

1. **Summary** (2-3 sentences): What was changed and why?
2. **Key Changes**: List 3-5 main technical changes
3. **Impact Level** (1-5): How significant is this change?
   - 1: Minor fix or tweak
   - 2: Small feature or bug fix
   - 3: Notable feature or refactoring
   - 4: Major feature or architectural change
   - 5: Fundamental system redesign

4. **Affected Topics**: Which existing topics should be updated? (provide topic names)
5. **New Topics**: Should new documentation be created?
6. **Related Decisions**: Does this relate to any architectural decisions?
7. **Suggested Actions**: What documentation updates are recommended?

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

## Next Steps

1. **Run Analysis**: Execute the prompt through a sub-agent to get structured impact assessment
2. **Review Suggestions**: Check which topics need updates based on the analysis
3. **Update Documentation**:
   - For affected topics: Use \`update_topic_page\` with new information
   - For new topics: Use \`create_topic_page\` with commit context
   - For decisions: Use \`create_decision\` if architectural choices were made
4. **Link Commit**: The commit is already recorded via \`record_commit\`, ensure it links to updated topics
`,
        },
      ],
    };
  } catch (error) {
    throw new Error(
      `Failed to analyze commit: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
