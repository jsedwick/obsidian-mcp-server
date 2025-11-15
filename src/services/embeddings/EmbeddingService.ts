/**
 * EmbeddingService - Semantic embedding generation
 *
 * Responsible for:
 * - Lazy loading of embedding model
 * - Embedding generation from text
 * - Cosine similarity calculation
 */

import { pipeline } from '@xenova/transformers';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('EmbeddingService');

/**
 * Service for generating text embeddings
 */
export class EmbeddingService {
  private extractor: any = null;
  private extractorPromise: Promise<any> | null = null;
  private modelName: string;

  constructor(modelName: string = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
    logger.info('EmbeddingService initialized', { model: modelName });
  }

  /**
   * Ensure embedding model is loaded (lazy initialization)
   */
  private async ensureExtractorInitialized(): Promise<void> {
    // Return cached extractor if already loaded
    if (this.extractor) {
      return;
    }

    // If loading in progress, wait for it
    if (this.extractorPromise) {
      await this.extractorPromise;
      return;
    }

    // Start loading
    logger.info('Loading embedding model (first use)...', { model: this.modelName });

    this.extractorPromise = pipeline('feature-extraction', this.modelName)
      .then(extractor => {
        this.extractor = extractor;
        logger.info('Embedding model loaded successfully');
        return extractor;
      })
      .catch(error => {
        logger.error('Failed to initialize embedding extractor', error as Error, {
          model: this.modelName,
        });
        throw error;
      });

    await this.extractorPromise;
  }

  /**
   * Generate embedding vector from text
   *
   * @param text - Input text to embed
   * @returns Embedding vector (normalized)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    logger.debug('Generating embedding', { textLength: text.length });

    await this.ensureExtractorInitialized();

    if (!this.extractor) {
      throw new Error('Embedding extractor not initialized');
    }

    try {
      // Generate embedding for the text
      const result = await this.extractor(text, { pooling: 'mean', normalize: true });

      // Convert to array (handle different result formats from transformer library)
      let embedding: number[];
      if (result.data) {
        embedding = Array.from(result.data as number[]);
      } else if (Array.isArray(result)) {
        embedding = result[0] ? Array.from(result[0] as number[]) : Array.from(result as number[]);
      } else {
        embedding = Array.from(result as number[]);
      }

      logger.debug('Embedding generated successfully', {
        textLength: text.length,
        embeddingDimension: embedding.length,
      });

      return embedding;
    } catch (error) {
      logger.error('Failed to generate embedding', error as Error, {
        textLength: text.length,
      });
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   *
   * @param vecA - First embedding vector
   * @param vecB - Second embedding vector
   * @returns Similarity score (0-1, where 1 is identical)
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    const len = Math.min(vecA.length, vecB.length);

    for (let i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      logger.warn('Zero magnitude vector encountered', {
        magnitudeA,
        magnitudeB,
      });
      return 0;
    }

    const similarity = dotProduct / (magnitudeA * magnitudeB);

    logger.debug('Cosine similarity calculated', { similarity });

    return similarity;
  }

  /**
   * Check if the model is loaded
   */
  isInitialized(): boolean {
    return this.extractor !== null;
  }

  /**
   * Get the model name being used
   */
  getModelName(): string {
    return this.modelName;
  }
}
