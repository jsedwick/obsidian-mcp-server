/**
 * Compare Indexed Search vs Linear Search
 *
 * This script runs the same queries through both search implementations
 * and compares the results for validation.
 *
 * Usage: npx tsx src/scripts/compareSearch.ts
 */

import { IndexBuilder, BuildMode } from '../services/search/index/IndexBuilder.js';
import { IndexedSearch } from '../services/search/IndexedSearch.js';
import { KeywordSearch } from '../services/search/KeywordSearch.js';
import { DEFAULT_INDEX_CONFIG } from '../models/IndexModels.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// Configuration
const VAULT_PATH = process.env.VAULT_PATH || path.join(process.env.HOME || '', 'Documents/Obsidian/Claude/Claude');
const CACHE_DIR = path.join(VAULT_PATH, '.search-index');

// Test queries
const TEST_QUERIES = [
  'search optimization',
  'inverted index',
  'BM25 scoring',
  'semantic search',
  'embedding cache',
];

interface ComparisonResult {
  query: string;
  indexed: {
    count: number;
    topScores: number[];
    topFiles: string[];
    duration: number;
  };
  linear: {
    count: number;
    topScores: number[];
    topFiles: string[];
    duration: number;
  };
  overlap: {
    filesInBoth: number;
    filesOnlyIndexed: number;
    filesOnlyLinear: number;
    topOverlapPercent: number;
  };
}

async function runComparison() {
  console.log('🔍 Search Comparison Tool');
  console.log('========================\n');

  console.log(`Vault: ${VAULT_PATH}`);
  console.log(`Cache: ${CACHE_DIR}\n`);

  // Initialize services
  console.log('Initializing services...');
  const indexBuilder = new IndexBuilder(CACHE_DIR);

  const indexedSearch = new IndexedSearch(indexBuilder, CACHE_DIR);
  const keywordSearch = new KeywordSearch();

  // Build/load index
  console.log('Building/loading index...');
  const buildResult = await indexBuilder.build({
    mode: BuildMode.AUTO,
    vaults: [{ path: VAULT_PATH, name: 'primary' }],
    config: DEFAULT_INDEX_CONFIG,
  });

  if (!buildResult.success) {
    console.error('❌ Failed to build index:', buildResult.error);
    process.exit(1);
  }

  console.log(`✅ Index ready: ${buildResult.totalDocuments} documents, ${buildResult.totalTerms} terms\n`);

  // Run comparisons
  const results: ComparisonResult[] = [];

  for (const query of TEST_QUERIES) {
    console.log(`\nQuery: "${query}"`);
    console.log('─'.repeat(50));

    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    // Run indexed search
    const indexedStart = Date.now();
    const indexedResults = await indexedSearch.search({
      query,
      queryTerms,
      maxResults: 10,
    });
    const indexedDuration = Date.now() - indexedStart;

    console.log(`Indexed: ${indexedResults.length} results in ${indexedDuration}ms`);

    // Run linear search
    const linearStart = Date.now();
    const linearResults = await runLinearSearch(
      VAULT_PATH,
      query,
      queryTerms,
      keywordSearch
    );
    const linearDuration = Date.now() - linearStart;

    console.log(`Linear:  ${linearResults.length} results in ${linearDuration}ms`);

    // Compare results
    const indexedFiles = new Set(indexedResults.map(r => normalizeFilePath(r.file)));
    const linearFiles = new Set(linearResults.map(r => normalizeFilePath(r.file)));

    const filesInBoth = new Set([...indexedFiles].filter(f => linearFiles.has(f))).size;
    const filesOnlyIndexed = new Set([...indexedFiles].filter(f => !linearFiles.has(f))).size;
    const filesOnlyLinear = new Set([...linearFiles].filter(f => !indexedFiles.has(f))).size;

    // Compare top 5
    const top5Indexed = indexedResults.slice(0, 5).map(r => normalizeFilePath(r.file));
    const top5Linear = linearResults.slice(0, 5).map(r => normalizeFilePath(r.file));
    const top5Overlap = top5Indexed.filter(f => top5Linear.includes(f)).length;
    const topOverlapPercent = (top5Overlap / 5) * 100;

    console.log(`Overlap: ${filesInBoth} files in both, ${filesOnlyIndexed} only indexed, ${filesOnlyLinear} only linear`);
    console.log(`Top 5 overlap: ${top5Overlap}/5 (${topOverlapPercent.toFixed(1)}%)`);

    results.push({
      query,
      indexed: {
        count: indexedResults.length,
        topScores: indexedResults.slice(0, 5).map(r => r.score),
        topFiles: top5Indexed,
        duration: indexedDuration,
      },
      linear: {
        count: linearResults.length,
        topScores: linearResults.slice(0, 5).map(r => r.score),
        topFiles: top5Linear,
        duration: linearDuration,
      },
      overlap: {
        filesInBoth,
        filesOnlyIndexed,
        filesOnlyLinear,
        topOverlapPercent,
      },
    });
  }

  // Summary
  console.log('\n\n📊 Summary');
  console.log('='.repeat(50));

  const avgIndexedDuration = results.reduce((sum, r) => sum + r.indexed.duration, 0) / results.length;
  const avgLinearDuration = results.reduce((sum, r) => sum + r.linear.duration, 0) / results.length;
  const avgOverlap = results.reduce((sum, r) => sum + r.overlap.topOverlapPercent, 0) / results.length;

  console.log(`Average indexed duration: ${avgIndexedDuration.toFixed(0)}ms`);
  console.log(`Average linear duration: ${avgLinearDuration.toFixed(0)}ms`);
  console.log(`Speed improvement: ${(avgLinearDuration / avgIndexedDuration).toFixed(1)}x`);
  console.log(`Average top-5 overlap: ${avgOverlap.toFixed(1)}%`);

  if (avgOverlap >= 80) {
    console.log('\n✅ PASS: Indexed search matches linear search (>80% overlap)');
  } else {
    console.log('\n⚠️  WARNING: Low overlap between search methods');
  }

  // Save detailed results
  const outputPath = path.join(CACHE_DIR, 'comparison-results.json');
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);
}

/**
 * Run linear search (simulates existing behavior)
 */
async function runLinearSearch(
  vaultPath: string,
  query: string,
  queryTerms: string[],
  keywordSearch: KeywordSearch
): Promise<Array<{ file: string; score: number }>> {
  const results: Array<{ file: string; score: number }> = [];
  const directories = ['sessions', 'topics', 'decisions'];

  for (const dir of directories) {
    const dirPath = path.join(vaultPath, dir);
    try {
      await fs.access(dirPath);
      const dirResults = await searchDirectory(dirPath, dir, keywordSearch, query.toLowerCase(), queryTerms);
      results.push(...dirResults);
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, 10);
}

/**
 * Search directory recursively (linear scan)
 */
async function searchDirectory(
  dirPath: string,
  relativePath: string,
  keywordSearch: KeywordSearch,
  queryLower: string,
  queryTerms: string[]
): Promise<Array<{ file: string; score: number }>> {
  const results: Array<{ file: string; score: number }> = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (['.git', 'node_modules', '.DS_Store', '.obsidian', '.search-index'].includes(entry.name)) {
          continue;
        }

        // Recursively search subdirectories
        const subResults = await searchDirectory(
          fullPath,
          path.join(relativePath, entry.name),
          keywordSearch,
          queryLower,
          queryTerms
        );
        results.push(...subResults);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Process markdown file
        const fileStats = await fs.stat(fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');

        const searchResult = keywordSearch.scoreSearchResult(
          relativePath,
          entry.name,
          entry.name,
          content,
          fileStats,
          queryLower,
          queryTerms,
          undefined,
          fullPath
        );

        if (searchResult) {
          results.push({
            file: fullPath,
            score: searchResult.score,
          });
        }
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return results;
}

/**
 * Normalize file paths for comparison
 */
function normalizeFilePath(filePath: string): string {
  // Get just the filename for comparison
  return path.basename(filePath);
}

// Run comparison
runComparison().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
