/**
 * BM25Scorer - Okapi BM25 relevance ranking algorithm
 *
 * Responsibilities:
 * - Calculate BM25 scores for documents given query terms
 * - Apply term frequency saturation (k1 parameter)
 * - Apply length normalization (b parameter)
 * - Support multiple query terms
 * - Provide score explanations for debugging
 *
 * BM25 Formula:
 * score(D,Q) = Σ IDF(qi) × (f(qi,D) × (k1 + 1)) / (f(qi,D) + k1 × (1 - b + b × |D| / avgdl))
 *
 * Where:
 * - D = document
 * - Q = query
 * - qi = query term i
 * - f(qi,D) = frequency of qi in D
 * - |D| = length of D in terms
 * - avgdl = average document length
 * - k1 = term frequency saturation parameter (typically 1.2)
 * - b = length normalization parameter (typically 0.75)
 * - IDF(qi) = inverse document frequency of qi
 */

import type {
  DocumentPosting,
  IndexStatistics,
  BM25Parameters,
  IndexField,
} from '../../../models/IndexModels.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('BM25Scorer');

/**
 * Score for a single document
 */
export interface DocumentScore {
  /** Document ID */
  docId: string;

  /** Total BM25 score */
  score: number;

  /** Score breakdown by term */
  termScores: Map<string, number>;

  /** Score breakdown by field */
  fieldScores: Map<IndexField, number>;
}

/**
 * Explanation of score calculation
 */
export interface ScoreExplanation {
  /** Document ID */
  docId: string;

  /** Total score */
  totalScore: number;

  /** Per-term explanations */
  termExplanations: Array<{
    term: string;
    score: number;
    idf: number;
    termFreq: number;
    docLength: number;
    explanation: string;
  }>;
}

/**
 * Default BM25 parameters (Okapi BM25 standard)
 */
export const DEFAULT_BM25_PARAMETERS: BM25Parameters = {
  k1: 1.2, // Term frequency saturation
  b: 0.75, // Length normalization
};

/**
 * BM25 scorer for document relevance ranking
 */
export class BM25Scorer {
  private params: BM25Parameters;

  /**
   * Create a new BM25 scorer
   *
   * @param params - BM25 parameters (k1, b)
   */
  constructor(params: BM25Parameters = DEFAULT_BM25_PARAMETERS) {
    this.params = params;
    logger.debug('BM25Scorer initialized', { params });
  }

  /**
   * Score all documents for a query
   *
   * @param queryTerms - Query terms to search for
   * @param termPostings - Map of term → postings from inverted index
   * @param stats - Index statistics for IDF calculation
   * @returns Array of document scores, sorted by score descending
   */
  scoreDocuments(
    queryTerms: string[],
    termPostings: Map<string, DocumentPosting[]>,
    stats: IndexStatistics
  ): DocumentScore[] {
    logger.debug('Scoring documents', {
      queryTerms: queryTerms.length,
      totalDocuments: stats.totalDocuments,
    });

    // Collect all unique documents that match at least one term
    const documentMap = new Map<string, Map<string, DocumentPosting[]>>();

    for (const term of queryTerms) {
      const postings = termPostings.get(term);
      if (!postings) continue;

      for (const posting of postings) {
        if (!documentMap.has(posting.docId)) {
          documentMap.set(posting.docId, new Map());
        }
        const docTerms = documentMap.get(posting.docId)!;
        if (!docTerms.has(term)) {
          docTerms.set(term, []);
        }
        docTerms.get(term)!.push(posting);
      }
    }

    // Score each document
    const scores: DocumentScore[] = [];

    for (const [docId, termPostingsMap] of documentMap.entries()) {
      const score = this.scoreDocument(docId, termPostingsMap, stats);
      scores.push(score);
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    logger.debug('Scoring complete', {
      documentsScored: scores.length,
      topScore: scores[0]?.score || 0,
    });

    return scores;
  }

  /**
   * Score a single document
   *
   * @param docId - Document ID
   * @param termPostings - Map of term → postings for this document
   * @param stats - Index statistics
   * @returns Document score with breakdown
   */
  private scoreDocument(
    docId: string,
    termPostings: Map<string, DocumentPosting[]>,
    stats: IndexStatistics
  ): DocumentScore {
    let totalScore = 0;
    const termScores = new Map<string, number>();
    const fieldScores = new Map<IndexField, number>();

    // Get document length from first posting (all postings have same docId)
    const firstPostingArray = termPostings.values().next().value;
    const firstPosting = firstPostingArray?.[0];
    const docLength = firstPosting?.termFrequency || 0; // Placeholder, should come from DocumentStore

    for (const [term, postings] of termPostings.entries()) {
      const termScore = this.scoreTerm(term, postings, docLength, stats);
      totalScore += termScore;
      termScores.set(term, termScore);

      // Aggregate field scores
      for (const posting of postings) {
        for (const fieldScore of posting.fieldScores) {
          const currentFieldScore = fieldScores.get(fieldScore.field) || 0;
          fieldScores.set(fieldScore.field, currentFieldScore + termScore);
        }
      }
    }

    return {
      docId,
      score: totalScore,
      termScores,
      fieldScores,
    };
  }

  /**
   * Score a single term in a document
   *
   * @param term - The term to score
   * @param postings - Postings for this term in this document
   * @param docLength - Length of document in terms
   * @param stats - Index statistics
   * @returns BM25 score for this term
   */
  private scoreTerm(
    term: string,
    postings: DocumentPosting[],
    docLength: number,
    stats: IndexStatistics
  ): number {
    // Calculate IDF (Inverse Document Frequency)
    const idf = this.calculateIDF(term, stats);

    // Calculate term frequency in document (sum across all fields)
    const termFreq = postings.reduce((sum, p) => sum + p.termFrequency, 0);

    // BM25 formula
    const numerator = termFreq * (this.params.k1 + 1);

    // Handle zero average document length
    const avgDocLen = stats.averageDocumentLength || 1;
    const denominator =
      termFreq +
      this.params.k1 *
        (1 - this.params.b + this.params.b * (docLength / avgDocLen));

    const score = idf * (numerator / denominator);

    return score;
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for a term
   *
   * IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
   *
   * Where:
   * - N = total number of documents
   * - df = number of documents containing term
   *
   * @param term - The term
   * @param stats - Index statistics
   * @returns IDF score
   */
  private calculateIDF(term: string, stats: IndexStatistics): number {
    const N = stats.totalDocuments;
    const df = stats.documentFrequency.get(term) || 0;

    // Avoid division by zero
    if (df === 0) return 0;

    // BM25 IDF formula (with smoothing)
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    return Math.max(0, idf); // IDF should never be negative
  }

  /**
   * Generate detailed explanation of score calculation
   *
   * @param docId - Document ID
   * @param termPostings - Map of term → postings for this document
   * @param stats - Index statistics
   * @returns Score explanation
   */
  explainScore(
    docId: string,
    termPostings: Map<string, DocumentPosting[]>,
    stats: IndexStatistics
  ): ScoreExplanation {
    const termExplanations: ScoreExplanation['termExplanations'] = [];
    let totalScore = 0;

    // Get document length
    const firstPosting = termPostings.values().next().value?.[0];
    const docLength = firstPosting?.termFrequency || 0;

    for (const [term, postings] of termPostings.entries()) {
      const idf = this.calculateIDF(term, stats);
      const termFreq = postings.reduce((sum, p) => sum + p.termFrequency, 0);
      const score = this.scoreTerm(term, postings, docLength, stats);

      totalScore += score;

      const explanation = [
        `IDF: ${idf.toFixed(4)}`,
        `TF: ${termFreq}`,
        `DocLen: ${docLength}`,
        `AvgDocLen: ${stats.averageDocumentLength.toFixed(2)}`,
        `Score: ${score.toFixed(4)}`,
      ].join(', ');

      termExplanations.push({
        term,
        score,
        idf,
        termFreq,
        docLength,
        explanation,
      });
    }

    return {
      docId,
      totalScore,
      termExplanations,
    };
  }

  /**
   * Update BM25 parameters
   *
   * @param params - New parameters
   */
  setParameters(params: Partial<BM25Parameters>): void {
    this.params = {
      ...this.params,
      ...params,
    };
    logger.debug('BM25 parameters updated', { params: this.params });
  }

  /**
   * Get current BM25 parameters
   *
   * @returns Current parameters
   */
  getParameters(): BM25Parameters {
    return { ...this.params };
  }

  /**
   * Calculate document frequency map from postings
   *
   * @param termPostings - Map of term → postings
   * @returns Map of term → document frequency
   */
  static calculateDocumentFrequency(
    termPostings: Map<string, DocumentPosting[]>
  ): Map<string, number> {
    const df = new Map<string, number>();

    for (const [term, postings] of termPostings.entries()) {
      // Count unique documents for this term
      const uniqueDocs = new Set(postings.map(p => p.docId));
      df.set(term, uniqueDocs.size);
    }

    return df;
  }
}
