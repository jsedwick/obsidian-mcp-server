/**
 * Topic Tools - Barrel Export
 *
 * This module exports all topic-related MCP tools for managing technical documentation
 * in the Obsidian vault's topics/ directory.
 */

export {
  createTopicPage,
  type CreateTopicPageArgs,
  type CreateTopicPageResult,
  type CreateTopicPageContext,
} from './createTopicPage.js';

export {
  updateTopicPage,
  type UpdateTopicPageArgs,
  type UpdateTopicPageResult,
  type UpdateTopicPageContext,
} from './updateTopicPage.js';

export {
  archiveTopic,
  type ArchiveTopicArgs,
  type ArchiveTopicResult,
  type ArchiveTopicContext,
} from './archiveTopic.js';

export {
  analyzeTopicContent,
  analyzeTopicContentInternal,
  type AnalyzeTopicContentArgs,
  type AnalyzeTopicContentResult,
  type AnalyzeTopicContentContext,
} from './analyzeTopicContent.js';
