/**
 * HaikuSummarizer - Uses Claude Haiku to generate concise session summaries
 */

import Anthropic from '@anthropic-ai/sdk';

const SUMMARIZATION_PROMPT = `Summarize this conversation concisely. Include: key decisions, problems solved, code changes, and any open questions. Omit pleasantries, debugging back-and-forth, and routine details. Be as brief as possible while preserving essential context for future sessions.

Output only the summary, no preamble.`;

export interface SummarizationResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

export class HaikuSummarizer {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      // SDK automatically uses ANTHROPIC_API_KEY env var
      this.client = new Anthropic();
    }
    return this.client;
  }

  async summarize(conversationText: string): Promise<SummarizationResult> {
    const client = this.getClient();

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${SUMMARIZATION_PROMPT}\n\n---\n\n${conversationText}`,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    const summary = textBlock && 'text' in textBlock ? textBlock.text : '';

    return {
      summary,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  /**
   * Check if the API key is available
   */
  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }
}

// Singleton instance
export const haikuSummarizer = new HaikuSummarizer();
