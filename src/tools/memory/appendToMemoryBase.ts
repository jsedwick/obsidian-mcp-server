/**
 * Tool: append_to_memory_base
 *
 * Description: Append a session summary to the rolling memory file.
 * Optionally uses Haiku to generate a concise summary.
 * Automatically trims old content when the file exceeds the size limit.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { haikuSummarizer } from '../../services/ai/HaikuSummarizer.js';

// Default max size: 10KB (~3K tokens, room for 5-10 session summaries)
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024;

export interface AppendToMemoryBaseArgs {
  summary: string;
  session_topic?: string;
  max_size_bytes?: number;
  use_haiku?: boolean; // If true, summarize with Haiku before appending
}

export interface AppendToMemoryBaseResult {
  content: Array<{ type: string; text: string }>;
}

export async function appendToMemoryBase(
  args: AppendToMemoryBaseArgs,
  vaultPath: string
): Promise<AppendToMemoryBaseResult> {
  const {
    session_topic: sessionTopic,
    max_size_bytes: maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
    use_haiku: useHaiku = false,
  } = args;
  let { summary } = args;
  const memoryFilePath = path.join(vaultPath, 'memory-base.md');

  let haikuUsed = false;
  let haikuTokens: { input: number; output: number } | undefined;

  // Use Haiku to condense the summary if available and requested
  if (useHaiku && haikuSummarizer.isAvailable()) {
    try {
      const result = await haikuSummarizer.summarize(summary);
      summary = result.summary;
      haikuUsed = true;
      haikuTokens = { input: result.inputTokens, output: result.outputTokens };
    } catch (error) {
      // If Haiku fails, fall back to original summary
      console.error('Haiku summarization failed, using original:', error);
    }
  }

  // Read existing content
  let existingContent = '';
  try {
    existingContent = await fs.readFile(memoryFilePath, 'utf-8');
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error;
    }
    // File doesn't exist yet, start fresh
  }

  // Create session entry
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const topicLine = sessionTopic ? `\n**Topic:** ${sessionTopic}` : '';
  const sessionEntry = `### --- SESSION BOUNDARY (${timestamp})${topicLine}

${summary}

`;

  // Append new entry
  let newContent = existingContent + sessionEntry;
  let trimmed = false;
  let sessionsRemoved = 0;

  // Trim from the beginning if over limit
  while (Buffer.byteLength(newContent, 'utf-8') > maxSizeBytes) {
    const boundaryMatch = newContent.match(/### --- SESSION BOUNDARY[^\n]*\n/);
    if (!boundaryMatch) {
      // No more boundaries to trim, just truncate
      break;
    }

    // Find the next boundary after the first one
    const firstBoundaryEnd = boundaryMatch.index! + boundaryMatch[0].length;
    const nextBoundary = newContent.slice(firstBoundaryEnd).search(/### --- SESSION BOUNDARY/);

    if (nextBoundary === -1) {
      // Only one session left, keep it even if over limit
      break;
    }

    // Remove the first session
    newContent = newContent.slice(firstBoundaryEnd + nextBoundary);
    trimmed = true;
    sessionsRemoved++;
  }

  // Write the updated content
  await fs.writeFile(memoryFilePath, newContent, 'utf-8');

  const newSizeBytes = Buffer.byteLength(newContent, 'utf-8');

  // Build result message
  let resultText = '✅ Session summary appended to rolling memory base.\n\n';
  resultText += `**Metadata:**\n`;
  resultText += `- New size: ${newSizeBytes} bytes\n`;
  resultText += `- Trimmed: ${trimmed ? 'Yes' : 'No'}\n`;
  if (trimmed) {
    resultText += `- Sessions removed: ${sessionsRemoved}\n`;
  }
  if (haikuUsed) {
    resultText += `- Haiku summarization: Used\n`;
    if (haikuTokens) {
      resultText += `- Haiku tokens: ${haikuTokens.input} input, ${haikuTokens.output} output\n`;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}
