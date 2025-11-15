/**
 * Tool: extract_decisions_from_session
 *
 * Extract architectural decisions from a session and generate ADR-formatted decision records.
 * Analyzes session content to identify strategic choices, alternatives considered, and consequences.
 *
 * This tool provides a structured prompt for sub-agent analysis rather than performing the
 * extraction directly, allowing the Claude agent to review and validate decisions before creating ADRs.
 */

import fs from 'fs/promises';

export interface ExtractDecisionsFromSessionArgs {
  session_id?: string;
  content?: string;
}

export interface ExtractDecisionsFromSessionResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface ExtractDecisionsFromSessionContext {
  vaultPath: string;
  currentSessionFile: string | null;
  currentSessionId: string | null;
  slugify: (text: string) => string;
  findSessionFile: (sessionId: string) => Promise<string | null>;
}

export async function extractDecisionsFromSession(
  args: ExtractDecisionsFromSessionArgs,
  context: ExtractDecisionsFromSessionContext
): Promise<ExtractDecisionsFromSessionResult> {
  try {
    let sessionContent = args.content;
    let sessionId = args.session_id;
    let detectedProject: string | null = null;

    // If no content provided, read from session file
    if (!sessionContent) {
      if (!sessionId && !context.currentSessionFile) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: No session_id provided and no current session active.',
            },
          ],
        };
      }

      sessionId = sessionId || context.currentSessionId || '';
      const sessionFile = sessionId
        ? await context.findSessionFile(sessionId)
        : context.currentSessionFile;

      if (!sessionFile) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Session file not found for ID: ${sessionId}`,
            },
          ],
        };
      }

      sessionContent = await fs.readFile(sessionFile, 'utf-8');

      // Extract project context from session frontmatter
      const frontmatterMatch = sessionContent.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];

        // Try to find repository name from frontmatter
        const repoNameMatch = frontmatter.match(/repository:\s*\n\s*path:.*\n\s*name:\s*(.+)/);
        if (repoNameMatch) {
          const repoName = repoNameMatch[1].trim();
          // Convert repository name to project slug (e.g., "accessibility-automatic-testing")
          detectedProject = context.slugify(repoName);
        }
      }
    }

    // Build decision extraction prompt
    const extractionPrompt = `Analyze the following session content and extract any architectural or technical decisions that were made.

Session Content:
${sessionContent}

For each decision found, provide:
1. **Decision Title**: A clear, concise title (e.g., "Use PostgreSQL instead of MongoDB")
2. **Context**: What problem or situation led to this decision?
3. **Alternatives Considered**: What other options were discussed or considered?
4. **Decision Made**: What was ultimately chosen?
5. **Rationale**: Why was this choice made?
6. **Consequences**: What are the positive and negative consequences?
7. **Strategic Level**: Rate from 1-5 (1=tactical implementation detail, 5=major architectural choice)

Only extract decisions with strategic level 3 or higher. Ignore minor implementation details.

Respond in JSON format:
{
  "decisions": [
    {
      "title": "...",
      "context": "...",
      "alternatives": ["...", "..."],
      "decision": "...",
      "rationale": "...",
      "consequences": {
        "positive": ["...", "..."],
        "negative": ["..."]
      },
      "strategic_level": 4
    }
  ]
}

If no significant decisions are found, return { "decisions": [] }`;

    const projectContext = detectedProject
      ? `\n- **Detected Project**: ${detectedProject}\n  → Consider using \`project: "${detectedProject}"\` when creating project-specific decisions`
      : '\n- **No project detected** → Decisions will be vault-level by default';

    return {
      content: [
        {
          type: 'text',
          text: `# Decision Extraction Analysis

## Session Information
- Session ID: ${sessionId || 'Current session'}
- Content length: ${sessionContent?.length || 0} characters${projectContext}

## Extraction Prompt for Sub-Agent
To complete this extraction, use a sub-agent with the following prompt:

\`\`\`
${extractionPrompt}
\`\`\`

## Next Steps
1. Run the extraction prompt through a sub-agent to identify decisions
2. For each decision found with strategic_level >= 3:
   - Review the extracted information for accuracy
   - Use \`create_decision\` tool to generate an ADR${detectedProject ? `\n   - **Recommended**: Use \`project: "${detectedProject}"\` for project-specific decisions` : ''}
   - Link the ADR back to this session
3. If no significant decisions found, no action needed

## How to Create ADRs from Results
For each decision in the JSON response:
\`\`\`
create_decision({
  title: decision.title,
  context: decision.context,
  content: \`
## Decision
\${decision.decision}

## Alternatives Considered
\${decision.alternatives.map((alt, i) => \`\${i + 1}. \${alt}\`).join('\\n')}

## Rationale
\${decision.rationale}

## Consequences

### Positive
\${decision.consequences.positive.map(c => \`- \${c}\`).join('\\n')}

### Negative
\${decision.consequences.negative.map(c => \`- \${c}\`).join('\\n')}
\`
})
\`\`\``,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error extracting decisions: ${errorMessage}`,
        },
      ],
    };
  }
}
