/**
 * Search Tools
 *
 * This module exports all search-related MCP tools:
 * - searchVault: Search the vault for relevant notes
 * - getTopicContext: Load full topic content
 * - linkToTopic: Get Obsidian link format for a topic
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

export {
  linkToTopic,
  type LinkToTopicArgs,
  type LinkToTopicResult,
} from './linkToTopic.js';
