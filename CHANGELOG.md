# Changelog

All notable changes to the Obsidian MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - Inverted Index Search (Phases 1-6 Complete)

#### Phase 1: Core Index Structure ✅
- Trie-based inverted index for term → document mapping
- Document store for metadata and BM25 statistics
- JSONL persistence layer for index storage
- Comprehensive type system in `IndexModels.ts`
- 112 unit tests with >80% coverage

#### Phase 2: Index Builder ✅
- Full index building from vault files
- Incremental update system for changed files
- Hash-based change detection for cache validation
- Multi-vault support for index building
- File scanner with intelligent directory filtering
- 96 unit tests for Phase 2 components

#### Phase 3: BM25 Scoring ✅
- Okapi BM25 ranking algorithm implementation
- Field-level score boosting (title 2x, tags 1.5x, frontmatter 1.2x, content 1x)
- Recency scoring for recently modified/reviewed documents
- Configurable BM25 parameters (k1=1.2, b=0.75)
- Score explanations for debugging
- 103 unit tests for Phase 3 components

#### Phase 4: Integration ✅
- `IndexedSearch` service matching KeywordSearch interface
- Integrated into `searchVault.ts` with automatic fallback
- In-memory index caching for performance
- Result comparison validation scripts
- Field merging bug fix for proper BM25 scoring
- Performance benchmarks (145ms avg query, 2.2ms/file indexing)

#### Phase 5: Optimization ✅
- Exact phrase matching bonus (+15) to match linear search behavior
- Phrase match check for top 50 documents (avoids excessive file I/O)
- Single-term query optimization (skip phrase matching)
- Improved result overlap from 72% → 85-95%

#### Phase 6: Migration ✅ (COMPLETE)
- **Enabled by default** - Inverted index search now active for all vaults
- Automatic fallback to linear search if index unavailable
- Per-vault index caching (`.search-index/` in each vault)
- Lazy index building on first search
- Zero breaking changes - all existing functionality preserved
- 674 tests passing (30 test files)

### Performance Improvements

**Index Building:**
- Build time: ~2.2ms per file (646ms for 292 documents)
- Incremental updates: <100ms per changed file
- Storage: ~1.5-2KB per document (JSONL format)

**Search Performance:**
- First query: ~240ms (loads index from disk)
- Subsequent queries: ~120ms average (in-memory cache)
- Expected speedup: 20-50x on large vaults (10k+ files)
- Scalability: O(log n) vs O(n) for linear search

**Quality:**
- Top-5 result overlap: 85-95% vs linear search
- BM25 finds different but equally relevant results
- Exact phrase matching preserves linear search behavior
- Field boosting maintains title/tag/header priorities

### Technical Details

**Architecture:**
- Trie-based inverted index for efficient term lookup
- Document store with BM25 statistics (avg doc length, total docs)
- JSONL persistence for human-readable storage
- Per-vault caching with automatic cache invalidation

**Configuration:**
- Enabled by default in `DEFAULT_INDEX_CONFIG`
- Index directory: `.search-index/` in each vault
- Automatic rebuild on file changes (hash-based detection)
- Graceful fallback to linear search on errors

**Files Added:**
```
src/models/IndexModels.ts       - Type definitions and configuration
src/services/search/index/
  ├── TrieNode.ts               - Trie data structure
  ├── InvertedIndex.ts          - Inverted index implementation
  ├── DocumentStore.ts          - Document metadata management
  ├── IndexPersistence.ts       - JSONL serialization
  ├── Tokenizer.ts              - Text tokenization
  ├── FileScanner.ts            - Vault file discovery
  ├── CacheValidator.ts         - Change detection
  ├── IndexBuilder.ts           - Build orchestration
  ├── BM25Scorer.ts             - BM25 ranking
  ├── FieldBooster.ts           - Field-level boosting
  ├── RecencyScorer.ts          - Time-based scoring
  └── index.ts                  - Barrel exports
src/services/search/IndexedSearch.ts - Search service
```

**Tests Added:**
- 348 unit tests across all phases
- Integration tests for end-to-end workflows
- Performance benchmarks
- Score comparison validation scripts

### Breaking Changes
- None! All existing functionality preserved and enhanced.

### Migration Guide
See [MIGRATION.md](./MIGRATION.md) for details on:
- How inverted index search works
- Performance expectations
- Troubleshooting index issues
- Rebuilding index if needed

### References
- Implementation plan: `topics/inverted-index-implementation-6-week-rollout-plan.md` in vault
- Architecture design: `topics/inverted-index-architecture-for-search_vault-scalability.md` in vault
- Phase 5-6 summary: `topics/inverted-index-phase-5-6-implementation-summary.md` in vault

---

## [1.0.0] - 2025-11-XX (Phase 1 Refactoring)

### Added
- Modular architecture with focused, single-responsibility modules
- Comprehensive testing with 80%+ coverage
- Full TypeScript strict mode with zero `any` types
- Runtime validation using Zod schemas
- Structured logging with custom error types
- Performance optimizations (3-5x faster search)
- ESLint and Prettier configurations
- Pre-commit hooks for automated quality checks

### Changed
- Refactored from 6,000-line monolith into focused modules
- Optimized search with parallel file operations
- Improved error handling with graceful degradation
- Enhanced caching strategies

### Performance
- Search 3-5x faster on large vaults
- Better scalability for 10,000+ file vaults
- Parallel file operations
- Intelligent search result limiting

### Backward Compatibility
- ✅ All 25 MCP tools work identically
- ✅ Vault files remain compatible
- ✅ Frontmatter format unchanged
- ✅ MCP tool API unchanged
- ✅ Automatic migration for existing vaults

---

## [0.9.0] - 2025-10-XX

### Added
- Initial release with session management
- Topic and decision tracking
- Git integration
- Semantic search with embeddings
- Multi-vault support

[Unreleased]: https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse
[1.0.0]: https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse
[0.9.0]: https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server/browse
