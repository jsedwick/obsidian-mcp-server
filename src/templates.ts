/**
 * Centralized template definitions for all note types in the Obsidian vault.
 *
 * This module provides TypeScript interfaces and template generator functions
 * for creating consistent, type-safe notes across the MCP server.
 *
 * Related: [[decisions/008-hardcoded-templates-in-typescript-vs-user-configurable-templates]]
 * Related: [[topics/frontmatter-standards]]
 */

// ============================================================================
// Frontmatter Interfaces
// ============================================================================

/**
 * Session file frontmatter
 * Location: sessions/YYYY-MM/
 * Filename: YYYY-MM-DD_HH-mm-ss[_topic-slug].md
 */
export interface SessionFrontmatter {
  date: string;              // ISO 8601 date (YYYY-MM-DD)
  session_id: string;        // Unique session identifier
  topics: string[];          // List of topic titles covered
  decisions: string[];       // List of decision titles made
  status: 'ongoing' | 'completed';
}

/**
 * Topic file frontmatter
 * Location: topics/
 * Filename: {slugified-topic-name}.md
 */
export interface TopicFrontmatter {
  title: string;             // Human-readable topic name
  created: string;           // ISO 8601 date
  last_reviewed: string;     // ISO 8601 date
  review_count: number;      // Number of times reviewed
  tags: string[];            // Categorization tags
  review_history: Array<{
    date: string;
    action: string;
    notes: string;
  }>;
}

/**
 * Decision record frontmatter
 * Location: decisions/
 * Filename: {NNN}-{decision-slug}.md
 */
export interface DecisionFrontmatter {
  number: string;            // Zero-padded decision number (e.g., "008")
  title: string;             // Decision title
  date: string;              // ISO 8601 date
  status: 'accepted' | 'rejected' | 'superseded' | 'deprecated';
}

/**
 * Project file frontmatter
 * Location: projects/{project-slug}/
 * Filename: project.md
 */
export interface ProjectFrontmatter {
  project_name: string;      // Project name
  repo_path: string;         // Absolute path to repository
  repo_url: string;          // Remote URL (or "N/A")
  created: string;           // ISO 8601 date
  last_commit_tracked: string; // ISO 8601 date
  total_sessions: number;    // Count of related sessions
  total_commits_tracked: number; // Count of tracked commits
  tags: string[];            // Always ["project"]
}

/**
 * Commit file frontmatter
 * Location: projects/{project-slug}/commits/
 * Filename: {short-hash}.md
 */
export interface CommitFrontmatter {
  commit_hash: string;       // Full SHA hash
  short_hash: string;        // Abbreviated hash
  author: string;            // "Name <email>"
  date: string;              // ISO 8601 date with timezone
  branch: string;            // Branch name (or "unknown")
  session_id: string;        // Related session ID
  project: string;           // Project name
}

// ============================================================================
// Template Generator Functions
// ============================================================================

export interface TopicTemplateArgs {
  title: string;
  content: string;
  created: string;
  currentSessionId?: string;
  tags?: string[];
}

export function generateTopicTemplate(args: TopicTemplateArgs): string {
  const frontmatter: TopicFrontmatter = {
    title: args.title,
    created: args.created,
    last_reviewed: args.created,
    review_count: 0,
    tags: args.tags || ['topic'],
    review_history: [
      {
        date: args.created,
        action: 'created',
        notes: 'Topic created'
      }
    ]
  };

  return `---
title: ${frontmatter.title}
created: ${frontmatter.created}
last_reviewed: ${frontmatter.last_reviewed}
review_count: ${frontmatter.review_count}
tags: ${JSON.stringify(frontmatter.tags)}
review_history:
  - date: ${frontmatter.review_history[0].date}
    action: ${frontmatter.review_history[0].action}
    notes: "${frontmatter.review_history[0].notes}"
---

# ${args.title}

${args.content}

## Related Sessions

## Related Projects

## Related Decisions

`;
}

export interface DecisionTemplateArgs {
  number: string;
  title: string;
  date: string;
  context?: string;
  content: string;
  currentSessionId?: string;
}

export function generateDecisionTemplate(args: DecisionTemplateArgs): string {
  const frontmatter: DecisionFrontmatter = {
    number: args.number,
    title: args.title,
    date: args.date,
    status: 'accepted'
  };

  return `---
number: ${frontmatter.number}
title: ${frontmatter.title}
date: ${frontmatter.date}
status: ${frontmatter.status}
---

# Decision ${args.number}: ${args.title}

## Context
${args.context || 'Decision made during development.'}

## Decision
${args.content}

## Consequences

## Related Topics


## Related Projects


## Related Sessions
${args.currentSessionId ? `- [[${args.currentSessionId}]]` : ''}

`;
}

export interface ProjectTemplateArgs {
  projectName: string;
  repoPath: string;
  repoUrl: string;
  branch: string;
  created: string;
  currentSessionId?: string;
}

export function generateProjectTemplate(args: ProjectTemplateArgs): string {
  const frontmatter: ProjectFrontmatter = {
    project_name: args.projectName,
    repo_path: args.repoPath,
    repo_url: args.repoUrl || 'N/A',
    created: args.created,
    last_commit_tracked: args.created,
    total_sessions: 1,
    total_commits_tracked: 0,
    tags: ['project']
  };

  return `---
project_name: ${frontmatter.project_name}
repo_path: ${frontmatter.repo_path}
repo_url: ${frontmatter.repo_url}
created: ${frontmatter.created}
last_commit_tracked: ${frontmatter.last_commit_tracked}
total_sessions: ${frontmatter.total_sessions}
total_commits_tracked: ${frontmatter.total_commits_tracked}
tags: ${JSON.stringify(frontmatter.tags)}
---

# Project: ${args.projectName}

## Overview
Git repository tracked via Claude Code sessions.

## Repository Info
- **Path:** \`${args.repoPath}\`
- **Current Branch:** ${args.branch || 'unknown'}
- **Remote:** ${args.repoUrl || 'N/A'}

## Recent Activity

## Related Sessions
${args.currentSessionId ? `- [[${args.currentSessionId}]]` : ''}

## Related Topics

`;
}

export interface CommitTemplateArgs {
  commitHash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  branch: string;
  subject: string;
  body: string;
  stats: string;
  diff: string;
  sessionId: string;
  projectName: string;
  projectSlug: string;
}

export function generateCommitTemplate(args: CommitTemplateArgs): string {
  const frontmatter: CommitFrontmatter = {
    commit_hash: args.commitHash,
    short_hash: args.shortHash,
    author: `${args.authorName} <${args.authorEmail}>`,
    date: args.date,
    branch: args.branch,
    session_id: args.sessionId,
    project: args.projectName
  };

  return `---
commit_hash: ${frontmatter.commit_hash}
short_hash: ${frontmatter.short_hash}
author: ${frontmatter.author}
date: ${frontmatter.date}
branch: ${frontmatter.branch}
session_id: ${frontmatter.session_id}
project: ${frontmatter.project}
---

# Commit: ${args.subject}

**Session:** [[${args.sessionId}]]
**Project:** [[projects/${args.projectSlug}/project|${args.projectName}]]
**Branch:** \`${args.branch}\`
**Date:** ${args.date}
**Author:** ${args.authorName}

## Summary
${args.subject}

${args.body}

## Changes Overview
\`\`\`
${args.stats}
\`\`\`

## Full Diff
\`\`\`diff
${args.diff}
\`\`\`

## Related Sessions
- [[${args.sessionId}]]

## Related Projects
- [[projects/${args.projectSlug}/project|${args.projectName}]]
`;
}

export interface SessionTemplateArgs {
  sessionId: string;
  date: string;
  topic?: string;
  topicsList: string[];
  decisionsList: string[];
  summary: string;
  filesAccessed: Array<{ action: string; path: string }>;
  topicsCreated: Array<{ slug: string; title: string }>;
  decisionsCreated: Array<{ slug: string; title: string }>;
  projectsCreated: Array<{ slug: string; name: string }>;
  relatedTopics: Array<{ link: string; title: string }>;
  relatedDecisions: Array<{ link: string; title: string }>;
  relatedProjects: Array<{ link: string; name: string }>;
}

export function generateSessionTemplate(args: SessionTemplateArgs): string {
  const frontmatter: SessionFrontmatter = {
    date: args.date,
    session_id: args.sessionId,
    topics: args.topic ? [args.topic, ...args.topicsList] : args.topicsList,
    decisions: args.decisionsList,
    status: 'completed'
  };

  return `---
date: ${frontmatter.date}
session_id: ${frontmatter.session_id}
topics: ${JSON.stringify(frontmatter.topics)}
decisions: ${JSON.stringify(frontmatter.decisions)}
status: ${frontmatter.status}
---

# Session: ${args.topic || 'Work session'}

## Summary

${args.summary}

## Files Accessed

${args.filesAccessed.length > 0 ? args.filesAccessed.map(f => `- [\`${f.action}\`] ${f.path}`).join('\n') : '_No files tracked_'}

## Topics Created

${args.topicsCreated.length > 0 ? args.topicsCreated.map(t => `- [[topics/${t.slug}|${t.title}]]`).join('\n') : '_No topics created_'}

## Decisions Made

${args.decisionsCreated.length > 0 ? args.decisionsCreated.map(d => `- [[decisions/${d.slug}|${d.title}]]`).join('\n') : '_No decisions made_'}

## Projects

${args.projectsCreated.length > 0 ? args.projectsCreated.map(p => `- [[projects/${p.slug}/project|${p.name}]]`).join('\n') : '_No projects created_'}

## Related Topics

${args.relatedTopics.length > 0 ? args.relatedTopics.map(t => `- [[${t.link}|${t.title}]]`).join('\n') : '_None found_'}

## Related Decisions

${args.relatedDecisions.length > 0 ? args.relatedDecisions.map(d => `- [[${d.link}|${d.title}]]`).join('\n') : '_None found_'}

## Related Projects

${args.relatedProjects.length > 0 ? args.relatedProjects.map(p => `- [[${p.link}|${p.name}]]`).join('\n') : '_None found_'}
`;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate that a frontmatter object matches its schema
 */
export function validateSessionFrontmatter(fm: any): fm is SessionFrontmatter {
  return (
    typeof fm.date === 'string' &&
    typeof fm.session_id === 'string' &&
    Array.isArray(fm.topics) &&
    Array.isArray(fm.decisions) &&
    (fm.status === 'ongoing' || fm.status === 'completed')
  );
}

export function validateTopicFrontmatter(fm: any): fm is TopicFrontmatter {
  return (
    typeof fm.title === 'string' &&
    typeof fm.created === 'string' &&
    typeof fm.last_reviewed === 'string' &&
    typeof fm.review_count === 'number' &&
    Array.isArray(fm.tags) &&
    Array.isArray(fm.review_history)
  );
}

export function validateDecisionFrontmatter(fm: any): fm is DecisionFrontmatter {
  return (
    typeof fm.number === 'string' &&
    typeof fm.title === 'string' &&
    typeof fm.date === 'string' &&
    typeof fm.status === 'string'
  );
}

export function validateProjectFrontmatter(fm: any): fm is ProjectFrontmatter {
  return (
    typeof fm.project_name === 'string' &&
    typeof fm.repo_path === 'string' &&
    typeof fm.repo_url === 'string' &&
    typeof fm.created === 'string' &&
    typeof fm.last_commit_tracked === 'string' &&
    typeof fm.total_sessions === 'number' &&
    typeof fm.total_commits_tracked === 'number' &&
    Array.isArray(fm.tags)
  );
}

export function validateCommitFrontmatter(fm: any): fm is CommitFrontmatter {
  return (
    typeof fm.commit_hash === 'string' &&
    typeof fm.short_hash === 'string' &&
    typeof fm.author === 'string' &&
    typeof fm.date === 'string' &&
    typeof fm.branch === 'string' &&
    typeof fm.session_id === 'string' &&
    typeof fm.project === 'string'
  );
}
