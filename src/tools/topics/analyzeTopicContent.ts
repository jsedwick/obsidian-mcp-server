/**
 * Tool: analyze_topic_content
 *
 * Analyze topic content using AI to generate tags, summary, find related topics, and detect duplicates.
 * Returns structured analysis that can be used to enhance topic creation.
 *
 * This is the user-facing tool that provides analysis prompts and suggestions.
 * For internal heuristic analysis, see analyzeTopicContentInternal.
 */

export interface AnalyzeTopicContentArgs {
  content: string;
  topic_name?: string;
  context?: string;
}

export interface AnalyzeTopicContentResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface AnalyzeTopicContentContext {
  searchVault: (args: {
    query: string;
    directories?: string[];
    max_results?: number;
    snippets_only?: boolean;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

export async function analyzeTopicContent(
  args: AnalyzeTopicContentArgs,
  context: AnalyzeTopicContentContext
): Promise<AnalyzeTopicContentResult> {
  // Build analysis prompt for the sub-agent
  const analysisPrompt = `Analyze the following topic content and provide structured analysis.

${args.topic_name ? `Topic Name: ${args.topic_name}` : ''}
${args.context ? `Context: ${args.context}` : ''}

Content to analyze:
${args.content}

Please provide:
1. **Tags**: 3-7 relevant tags that categorize this topic (e.g., technology names, concepts, domains)
2. **Summary**: A concise 1-2 sentence summary of the main idea
3. **Key Concepts**: List 3-5 key technical concepts or terms discussed
4. **Related Topics**: Suggest 2-4 topic names that would be related (based on common knowledge and the content)
5. **Content Type**: Categorize as one of: implementation, architecture, troubleshooting, reference, tutorial, concept

Respond in JSON format:
{
  "tags": ["tag1", "tag2", ...],
  "summary": "...",
  "key_concepts": ["concept1", "concept2", ...],
  "related_topics": ["topic1", "topic2", ...],
  "content_type": "..."
}`;

  try {
    // Search for similar existing topics
    const searchResults = await context.searchVault({
      query: args.content.substring(0, 200), // Use first 200 chars for similarity search
      directories: ['topics'],
      max_results: 5,
      snippets_only: true,
    });

    // Parse search results to find potential duplicates
    const potentialDuplicates = searchResults.content[0].text.includes('Found 0 matches')
      ? []
      : searchResults.content[0].text
          .split('\n')
          .filter(line => line.includes('**'))
          .slice(0, 3)
          .map(line => {
            const match = line.match(/\*\*(.+?)\*\*/);
            return match ? match[1] : null;
          })
          .filter(Boolean);

    return {
      content: [
        {
          type: 'text',
          text: `# Topic Content Analysis

## Analysis Prompt for Sub-Agent
To complete this analysis, use a sub-agent with the following prompt:

\`\`\`
${analysisPrompt}
\`\`\`

## Potential Duplicate Topics
${
  potentialDuplicates.length > 0
    ? `Found ${potentialDuplicates.length} potentially similar existing topics:\n${potentialDuplicates.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : 'No similar topics found in the vault.'
}

## Next Steps
1. Run the analysis prompt above through a sub-agent to get structured analysis
2. Review the potential duplicates to decide if this is truly new content
3. Use the analysis results to enhance topic creation with auto-generated tags and summary`,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error analyzing topic content: ${errorMessage}`,
        },
      ],
    };
  }
}

/**
 * Internal method to analyze topic content using heuristic tag extraction.
 * Extracts meaningful keywords from title and content without LLM calls.
 * Used by auto_analyze feature in createTopicPage.
 */
export function analyzeTopicContentInternal(args: {
  content: string;
  topic_name?: string;
  context?: string;
}): {
  tags: string[];
  summary: string;
  key_concepts: string[];
  related_topics: string[];
  content_type: string;
} {
  // Common words to filter out (expanded stop words list)
  const commonWords = new Set([
    'the',
    'be',
    'to',
    'of',
    'and',
    'a',
    'in',
    'that',
    'have',
    'i',
    'it',
    'for',
    'not',
    'on',
    'with',
    'he',
    'as',
    'you',
    'do',
    'at',
    'this',
    'but',
    'his',
    'by',
    'from',
    'they',
    'we',
    'say',
    'her',
    'she',
    'or',
    'an',
    'will',
    'my',
    'one',
    'all',
    'would',
    'there',
    'their',
    'what',
    'so',
    'up',
    'out',
    'if',
    'about',
    'who',
    'get',
    'which',
    'go',
    'me',
    'when',
    'make',
    'can',
    'like',
    'time',
    'no',
    'just',
    'him',
    'know',
    'take',
    'people',
    'into',
    'year',
    'your',
    'good',
    'some',
    'could',
    'them',
    'see',
    'other',
    'than',
    'then',
    'now',
    'look',
    'only',
    'come',
    'its',
    'over',
    'think',
    'also',
    'back',
    'after',
    'use',
    'two',
    'how',
    'our',
    'work',
    'first',
    'well',
    'way',
    'even',
    'new',
    'want',
    'because',
    'any',
    'these',
    'give',
    'day',
    'most',
    'us',
    'is',
    'was',
    'are',
    'been',
    'has',
    'had',
    'were',
    'said',
    'did',
    'having',
    'may',
    'should',
    'does',
    'done',
  ]);

  // Extract title words to exclude from tags (title already provides discoverability)
  const titleText = (args.topic_name || '').toLowerCase();
  const titleWords = new Set(
    (titleText.match(/\b[a-z0-9]+(?:-[a-z0-9]+)*\b/g) || []).filter(w => w.length >= 3)
  );

  // Extract words from content only (not title - those words are already discoverable)
  const contentText = args.content.toLowerCase();

  // Extract all words (3+ characters, alphanumeric and hyphens)
  const words = contentText.match(/\b[a-z0-9]+(?:-[a-z0-9]+)*\b/g) || [];

  // Count word frequency
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    if (word.length >= 3 && !commonWords.has(word)) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  // Extract technical terms and acronyms from original text (preserve case)
  const technicalTerms = new Set<string>();

  // Find acronyms (2+ uppercase letters)
  const acronyms = args.content.match(/\b[A-Z]{2,}\b/g) || [];
  acronyms.forEach(term => technicalTerms.add(term.toLowerCase()));

  // Find capitalized technical terms (but not sentence starts)
  const capitalizedWords = args.content.match(/(?<!^|\. )\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) || [];
  capitalizedWords.forEach(term => technicalTerms.add(term.toLowerCase()));

  // Find hyphenated terms
  const hyphenatedTerms = args.content.match(/\b[a-z]+-[a-z]+(?:-[a-z]+)*\b/gi) || [];
  hyphenatedTerms.forEach(term => technicalTerms.add(term.toLowerCase()));

  // Combine technical terms with high-frequency words
  // Filter out title words since they already provide discoverability
  const candidateTags = new Set<string>();

  // Add technical terms first (higher priority), excluding title words
  technicalTerms.forEach(term => {
    if (!titleWords.has(term)) {
      candidateTags.add(term);
    }
  });

  // Add high-frequency words (appearing 2+ times), excluding title words
  Array.from(wordFreq.entries())
    .filter(([word, count]) => count >= 2 && !titleWords.has(word))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([word, _]) => candidateTags.add(word));

  // Convert to array and limit to 7 tags
  const tags = Array.from(candidateTags).slice(0, 7);

  // If we have too few tags, add single-occurrence words (still excluding title words)
  if (tags.length < 3) {
    Array.from(wordFreq.entries())
      .filter(([word, _]) => !titleWords.has(word))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .forEach(([word, _]) => {
        if (tags.length < 7 && !tags.includes(word)) {
          tags.push(word);
        }
      });
  }

  return {
    tags: tags.length > 0 ? tags : ['topic'],
    summary: '',
    key_concepts: [],
    related_topics: [],
    content_type: 'reference',
  };
}
