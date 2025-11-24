/**
 * Search Tools
 *
 * This module exports all search-related MCP tools:
 * - searchVault: Search the vault for relevant notes
 * - getTopicContext: Load full topic content
 */

export {
  searchVault,
  type SearchVaultArgs,
  type SearchVaultResult,
} from './searchVault.js';

export {
  getTopicContext,
  type GetTopicContextArgs,
  type GetTopicContextResult,
} from './getTopicContext.js';
