/**
 * Tool: enhanced_search
 *
 * Description: Enhanced semantic search with query understanding, expansion, and contextual refinement.
 * Uses sub-agent to transform queries into multiple search variations and synthesize results.
 */

import * as fs from 'fs/promises';

export interface EnhancedSearchArgs {
  query: string;
  context?: string;
  current_session_id?: string;
  max_results_per_query?: number;
}

export interface EnhancedSearchResult {
  content: Array<{ type: string; text: string }>;
}

export async function enhancedSearch(
  args: EnhancedSearchArgs,
  context: {
    findSessionFile: (sessionId: string) => Promise<string | null>;
    searchVault: (args: {
      query: string;
      max_results?: number;
      snippets_only?: boolean;
    }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  }
): Promise<EnhancedSearchResult> {
  try {
    const maxResults = args.max_results_per_query || 5;

    // Get current session context if provided
    let sessionContext = '';
    if (args.current_session_id) {
      const sessionFile = await context.findSessionFile(args.current_session_id);
      if (sessionFile) {
        const content = await fs.readFile(sessionFile, 'utf-8');
        // Extract just the context section for brevity
        const contextMatch = content.match(/## Context\n(.*?)(?=\n##|\n---|$)/s);
        sessionContext = contextMatch ? contextMatch[1].trim() : '';
      }
    }

    // Build query expansion prompt
    const expansionPrompt = `You are helping expand a search query to find relevant information in an Obsidian vault.

Original Query: "${args.query}"
${args.context ? `Additional Context: ${args.context}` : ''}
${sessionContext ? `Current Session Context: ${sessionContext}` : ''}

Your task:
1. Understand the user's intent behind this query
2. Generate 4-5 diverse search query variations that capture different aspects
3. Include:
   - Technical terms and synonyms
   - Related concepts
   - Different phrasings
   - Specific vs. general variations

Format your response as a JSON array of query strings:
["query1", "query2", "query3", "query4", "query5"]

Each query should be concise (2-5 words) and focused on a specific aspect of the original query.`;

    // Perform a preliminary search to understand available content
    const preliminarySearch = await context.searchVault({
      query: args.query,
      max_results: 3,
      snippets_only: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: `# Enhanced Search Analysis

## Original Query
"${args.query}"

${args.context ? `## Context\n${args.context}\n` : ''}
${sessionContext ? `## Current Session Context\n${sessionContext}\n` : ''}

## Query Expansion Prompt
To complete this search, use a sub-agent with the following prompt to generate query variations:

\`\`\`
${expansionPrompt}
\`\`\`

## Preliminary Results
Here's what a basic search for "${args.query}" found:

${preliminarySearch.content[0].text}

## Next Steps

1. **Generate Query Variations**: Run the expansion prompt through a sub-agent to get 4-5 query variations
2. **Execute Multiple Searches**: For each variation, call \`search_vault\` with max_results=${maxResults}
3. **Deduplicate Results**: Track unique file paths to avoid duplicates
4. **Synthesize Findings**: Combine results and identify key themes

## Example Workflow

\`\`\`javascript
// After getting query variations from sub-agent:
const queryVariations = ["variation1", "variation2", ...];
const allResults = new Map(); // filePath -> result

for (const query of queryVariations) {
  const results = await search_vault({
    query: query,
    max_results: ${maxResults}
  });

  // Extract file paths and add to map (deduplicates automatically)
  // Higher scores override lower scores for same file
}

// Present synthesized results to user
\`\`\`

## Benefits of This Approach

- **Improved Recall**: Multiple query variations find more relevant content
- **Semantic Understanding**: Captures user intent beyond literal keywords
- **Context Awareness**: Uses session context to refine search direction
- **Efficient Deduplication**: Map structure ensures each file appears once
- **Embedding Cache Reuse**: Subsequent searches benefit from cached embeddings`,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error in enhanced search: ${errorMessage}`,
        },
      ],
    };
  }
}
