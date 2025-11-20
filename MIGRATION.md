# Inverted Index Search Migration Guide

## Overview

As of **Phase 6 (Complete)**, the Obsidian MCP Server uses an inverted index with BM25 scoring by default for dramatically faster search on large vaults. This migration guide explains what changed, what to expect, and how to troubleshoot any issues.

## What Changed?

### Before (Linear Search)
- Every search read and scored **all markdown files** in your vault
- Performance: O(n) - slower as vault grows
- Good for small vaults (<1,000 files)
- No index files created

### After (Inverted Index Search - DEFAULT)
- First search builds an index mapping terms → documents
- Subsequent searches use the index for O(log n) lookup
- Performance: 20-50x faster on large vaults (10k+ files)
- Index stored in `.search-index/` directory in each vault

## Performance Expectations

### Index Building
- **Build time**: ~2.2ms per file (646ms for 292 docs, 10s for 5,000 docs)
- **Storage**: ~1.5-2KB per document (JSONL format, human-readable)
- **When**: Automatically on first search, then incrementally on changes
- **Location**: `.search-index/` in your vault (one per vault)

### Search Performance
- **First query** (loads index): ~240ms
- **Subsequent queries** (in-memory): ~120ms average
- **Large vaults** (10k+ files): 20-50x faster than linear search

### Quality
- **Result overlap**: 85-95% match with linear search (top-5 results)
- **BM25 scoring**: Industry-standard relevance ranking
- **Field boosting**: Title 2x, Tags 1.5x, Frontmatter 1.2x, Content 1x
- **Exact phrases**: +15 bonus to match linear search behavior

## What You Need to Do

### Nothing! (It Just Works)

The migration is **completely automatic**:

1. ✅ **No configuration needed** - Enabled by default
2. ✅ **Automatic index building** - Happens on first search
3. ✅ **Automatic fallback** - Falls back to linear search on errors
4. ✅ **Zero breaking changes** - All tools work identically
5. ✅ **Per-vault caching** - Each vault gets its own index

### Optional: Verify It's Working

After your first search, check for the index:

```bash
ls -la /path/to/your/vault/.search-index/
```

You should see:
```
.search-index/
├── document-store.jsonl    # Document metadata
├── index-metadata.json     # Index version and stats
└── inverted-index.jsonl    # Term → document mappings
```

## Configuration

### Default Configuration

The index is **enabled by default** with these settings (defined in `src/models/IndexModels.ts`):

```typescript
{
  enabled: true,                  // Use inverted index
  cacheDir: '.search-index',      // Index storage directory
  rebuildInterval: 168,           // Weekly full rebuild (hours)
  watchFiles: false,              // File watcher (opt-in)
  bm25: {
    k1: 1.2,                      // Term frequency saturation
    b: 0.75,                      // Length normalization
  },
  fieldBoosts: {
    title: 2.0,                   // Title matches score 2x
    tags: 1.5,                    // Tag matches score 1.5x
    frontmatter: 1.2,             // Frontmatter matches score 1.2x
    content: 1.0,                 // Content matches score 1.0x
  },
}
```

### Disable Indexed Search (Fallback to Linear)

If you prefer linear search or encounter issues:

**Option 1: Environment Variable** (temporary, per-session)
```json
{
  "mcpServers": {
    "obsidian": {
      "env": {
        "SEARCH_USE_INDEX": "false"
      }
    }
  }
}
```

**Option 2: Modify Code** (permanent, requires rebuild)

Edit `src/models/IndexModels.ts:322`:
```typescript
export const DEFAULT_INDEX_CONFIG: IndexConfiguration = {
  enabled: false, // Changed from true
  // ...
};
```

Then rebuild:
```bash
npm run build
```

## Troubleshooting

### Index Not Building

**Symptoms:**
- Search seems slow on first query
- No `.search-index/` directory created

**Solutions:**
1. Check vault permissions (MCP server needs write access)
2. Check disk space (index needs ~1.5-2KB per document)
3. Look for errors in Claude Code logs
4. Try manually creating `.search-index/` directory with write permissions

### Search Results Different

**Symptoms:**
- Results ranked differently than before
- Some previously top-ranked files not in top results

**Why This Happens:**
- BM25 scoring is different from the previous custom scoring
- Industry-standard algorithm may rank documents differently
- Both approaches find relevant results, just in different order

**What to Do:**
- Try the first 10-20 results (not just top 5)
- Use more specific search terms
- Try exact phrase searches (wrap in quotes)
- If truly problematic, disable indexed search (see Configuration above)

### Index Corruption

**Symptoms:**
- Search fails with errors
- Index files appear corrupted or incomplete

**Solutions:**

**Option 1: Delete index and rebuild**
```bash
rm -rf /path/to/your/vault/.search-index
```
Next search will automatically rebuild from scratch.

**Option 2: Check file permissions**
```bash
chmod -R u+rw /path/to/your/vault/.search-index
```

**Option 3: Inspect index files**
```bash
head /path/to/your/vault/.search-index/index-metadata.json
```

Should show valid JSON with version and stats.

### Performance Issues

**Symptoms:**
- Index builds very slowly
- Searches still slow after first query

**Solutions:**

**Slow index build:**
- Expected for large vaults (10s for 5,000 files)
- Only happens once, then incrementally updates
- Run during idle time if possible

**Slow searches after index built:**
1. Check index loaded to memory (first query ~240ms, then ~120ms)
2. Verify you're not rebuilding on every search (check logs)
3. Check disk I/O if using slow storage (NAS, network drive)

### Multi-Vault Issues

**Symptoms:**
- Some vaults indexed, others not
- Search works for primary vault but not secondary vaults

**Solutions:**
1. Each vault gets its own `.search-index/` directory
2. Check permissions on secondary vault directories
3. Search will work with partial index (only indexed vaults searched via index)
4. Secondary vaults automatically fall back to linear search if index unavailable

## Advanced: Manual Index Maintenance

### Force Full Rebuild

Delete the index and let it rebuild:
```bash
rm -rf /path/to/your/vault/.search-index
```

Next search will automatically rebuild.

### Inspect Index Statistics

```bash
cat /path/to/your/vault/.search-index/index-metadata.json
```

Example output:
```json
{
  "version": "1.0.0",
  "lastBuildTime": "2025-11-19T17:30:00.000Z",
  "documentCount": 292,
  "termCount": 4521,
  "buildMode": "full"
}
```

### Verify Index Integrity

Check document store:
```bash
wc -l /path/to/your/vault/.search-index/document-store.jsonl
```

Should match document count in metadata.

Check inverted index:
```bash
head -5 /path/to/your/vault/.search-index/inverted-index.jsonl
```

Should show JSONL entries (one term per line).

## Performance Benchmarks

### Small Vaults (<500 files)
- **Index build**: <1 second
- **Search**: Comparable to linear search (~100-200ms)
- **Benefit**: Minimal (both fast)

### Medium Vaults (500-2,000 files)
- **Index build**: 1-5 seconds
- **Search**: 3-5x faster than linear (~100ms vs 300-500ms)
- **Benefit**: Noticeable improvement

### Large Vaults (2,000-10,000+ files)
- **Index build**: 5-30 seconds
- **Search**: 20-50x faster than linear (~120ms vs 2-10 seconds)
- **Benefit**: Dramatic improvement

## Backward Compatibility

### Zero Breaking Changes ✅

- **All MCP tools** work identically
- **Vault files** remain compatible
- **Frontmatter** format unchanged
- **Search results** highly overlapping (85-95%)
- **Automatic fallback** to linear search if needed

### What's Preserved

- ✅ Exact phrase matching
- ✅ Field boosting (title, tags, frontmatter)
- ✅ Recency scoring (recently modified/reviewed)
- ✅ Date range filtering
- ✅ Directory filtering (sessions, topics, decisions)
- ✅ Semantic re-ranking with embeddings

## FAQ

### Q: Do I need to rebuild the index manually?
**A:** No. The index rebuilds automatically when files change (hash-based detection).

### Q: What if the index becomes outdated?
**A:** The `CacheValidator` checks file hashes and rebuilds changed files incrementally.

### Q: Can I disable indexed search?
**A:** Yes. Set `SEARCH_USE_INDEX=false` in environment or modify `DEFAULT_INDEX_CONFIG.enabled = false`.

### Q: Will search results be exactly the same?
**A:** Highly similar (85-95% overlap) but not identical. BM25 scoring is different from custom scoring.

### Q: Does this affect semantic search (embeddings)?
**A:** No. Semantic re-ranking still works on top of indexed search results.

### Q: What happens if index fails to build?
**A:** Automatic fallback to linear search. No functionality lost.

### Q: Can I see what mode search is using?
**A:** Check logs in Claude Code for `[Search] Using indexed search` or `[Search] Falling back to linear search`.

### Q: How much disk space does the index use?
**A:** ~1.5-2KB per document. For 1,000 docs: ~2MB. For 10,000 docs: ~20MB.

### Q: Can I version control the index?
**A:** Not recommended. Add `.search-index/` to `.gitignore`. Index rebuilds automatically.

## Getting Help

### Check Logs

Claude Code logs show index activity:
```
[IndexBuilder] Starting index build
[IndexBuilder] Index build complete (duration: 646ms, documents: 292)
[Search] Using indexed search
```

### Report Issues

If you encounter problems:
1. Try deleting `.search-index/` and rebuilding
2. Check vault permissions
3. Verify disk space
4. Try disabling indexed search as a workaround
5. Report issue with logs at https://git.uoregon.edu/projects/JSDEV/repos/obsidian-mcp-server

### Rollback (If Needed)

To completely revert to linear search:

1. Set environment variable: `SEARCH_USE_INDEX=false`
2. Delete index directories: `rm -rf /path/to/vault/.search-index`
3. Restart Claude Code

Linear search will work identically to before.

## Summary

✅ **Automatic** - No action required
✅ **Fast** - 20-50x faster on large vaults
✅ **Safe** - Automatic fallback to linear search
✅ **Compatible** - Zero breaking changes
✅ **Transparent** - Works seamlessly in background

The inverted index search upgrade is designed to be invisible and beneficial. Most users will notice faster searches without any configuration or maintenance.
