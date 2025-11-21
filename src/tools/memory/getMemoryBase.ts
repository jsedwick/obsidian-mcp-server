/**
 * Tool: get_memory_base
 *
 * Description: Retrieve the current contents of the rolling memory file.
 * Used at session start to provide continuity from recent conversations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GetMemoryBaseArgs {
  // No arguments needed - reads from fixed location
}

export interface GetMemoryBaseResult {
  content: string;
  size_bytes: number;
  last_modified: string | null;
  session_count: number;
}

export async function getMemoryBase(
  _args: GetMemoryBaseArgs,
  vaultPath: string
): Promise<GetMemoryBaseResult> {
  const memoryFilePath = path.join(vaultPath, 'memory-base.md');

  try {
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    const stats = await fs.stat(memoryFilePath);

    // Count session boundaries
    const sessionCount = (content.match(/### --- SESSION BOUNDARY/g) || []).length;

    return {
      content,
      size_bytes: Buffer.byteLength(content, 'utf-8'),
      last_modified: stats.mtime.toISOString(),
      session_count: sessionCount,
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return {
        content: '',
        size_bytes: 0,
        last_modified: null,
        session_count: 0,
      };
    }
    throw error;
  }
}
