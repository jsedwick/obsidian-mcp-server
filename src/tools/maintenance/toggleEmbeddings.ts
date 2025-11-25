/**
 * Tool: toggle_embeddings
 *
 * Description: Toggle the embedding cache on or off. Embeddings are used for semantic search in search_vault.
 * Easily toggle without restarting the server.
 */

import * as fs from 'fs/promises';

export interface ToggleEmbeddingsArgs {
  enabled?: boolean;
}

export interface ToggleEmbeddingsResult {
  content: Array<{ type: string; text: string }>;
}

export interface EmbeddingToggleConfig {
  enabled: boolean;
  lastModified: string;
}

export interface EmbeddingConfig {
  enabled: boolean;
  modelName: string;
  cacheDirs: Map<string, string>;
  keywordCandidatesLimit: number;
}

/**
 * Save embedding toggle state to configuration file
 */
async function saveEmbeddingToggleState(
  embeddingToggleFile: string,
  enabled: boolean
): Promise<void> {
  const config: EmbeddingToggleConfig = {
    enabled,
    lastModified: new Date().toISOString(),
  };

  try {
    await fs.writeFile(embeddingToggleFile, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('[Embedding] Failed to save toggle state:', error);
    throw new Error(
      `Failed to save embedding toggle state: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function toggleEmbeddings(
  args: ToggleEmbeddingsArgs,
  context: {
    embeddingConfig: EmbeddingConfig;
    embeddingToggleFile: string;
    embeddingCache: { clear: () => void };
    setExtractor: (extractor: any) => void;
    setEmbeddingInitPromise: (promise: Promise<void> | null) => void;
  }
): Promise<ToggleEmbeddingsResult> {
  // If no explicit state provided, toggle current state
  const newState = args.enabled !== undefined ? args.enabled : !context.embeddingConfig.enabled;

  // Update in-memory config
  context.embeddingConfig.enabled = newState;

  // Save to file
  await saveEmbeddingToggleState(context.embeddingToggleFile, newState);

  // If disabling, reset the extractor
  if (!newState) {
    context.setExtractor(null);
    context.setEmbeddingInitPromise(null);
    // Clear cache to prevent stale embeddings
    context.embeddingCache.clear();
  }

  const status = newState ? 'enabled' : 'disabled';
  const action = newState
    ? 'enabled (will generate on next search)'
    : 'disabled (using keyword search only)';

  return {
    content: [
      {
        type: 'text',
        text: `Embeddings ${action}\n\nConfiguration saved to: ${context.embeddingToggleFile}\n\nCurrent state: ${status}`,
      },
    ],
  };
}
