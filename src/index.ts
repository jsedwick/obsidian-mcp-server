#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || path.join(process.env.HOME || '', 'obsidian-vault');

interface SessionMetadata {
  date: string;
  session_id: string;
  topics: string[];
  decisions: string[];
  status: 'ongoing' | 'completed';
}

interface TopicMetadata {
  title: string;
  created: string;
  last_reviewed?: string;
  review_count?: number;
  tags: string[];
  review_history?: Array<{
    date: string;
    action: 'created' | 'updated' | 'reviewed' | 'archived';
    notes: string;
  }>;
}

interface ReviewAnalysis {
  is_outdated: boolean;
  concerns: string[];
  suggested_updates: string;
  confidence: 'high' | 'medium' | 'low';
}

interface PendingReview {
  review_id: string;
  topic: string;
  slug: string;
  current_content: string;
  analysis: ReviewAnalysis;
  timestamp: number;
}

class ObsidianMCPServer {
  private server: Server;
  private currentSessionId: string | null = null;
  private currentSessionFile: string | null = null;
  private pendingReviews: Map<string, PendingReview> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'obsidian-context-manager',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.closeSession();
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'start_session':
            return await this.startSession(args as { topic?: string });
          
          case 'save_session_note':
            return await this.saveSessionNote(args as { content: string; append?: boolean });
          
          case 'search_vault':
            return await this.searchVault(args as {
              query: string;
              directories?: string[];
              max_results?: number;
              date_range?: { start?: string; end?: string };
              snippets_only?: boolean;
            });
          
          case 'create_topic_page':
            return await this.createTopicPage(args as { topic: string; content: string });
          
          case 'create_decision':
            return await this.createDecision(args as { title: string; content: string; context?: string });
          
          case 'update_topic_page':
            return await this.updateTopicPage(args as { topic: string; content: string; append?: boolean });
          
          case 'get_session_context':
            return await this.getSessionContext(args as { session_id?: string });
          
          case 'link_to_topic':
            return await this.linkToTopic(args as { topic: string });
          
          case 'close_session':
            return await this.closeSession();

          case 'find_stale_topics':
            return await this.findStaleTopics(args as { age_threshold_days?: number; include_never_reviewed?: boolean });

          case 'review_topic':
            return await this.reviewTopic(args as { topic: string; analysis_prompt?: string });

          case 'approve_topic_update':
            return await this.approveTopicUpdate(args as { review_id: string; action: string; modified_content?: string });

          case 'archive_topic':
            return await this.archiveTopic(args as { topic: string; reason?: string });

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'start_session',
        description: 'Start a new conversation session and create a session file in the Obsidian vault. Call this at the beginning of each conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Optional initial topic for the session',
            },
          },
        },
      },
      {
        name: 'save_session_note',
        description: 'Save or append content to the current session file. Use this to record key points, decisions, and context during the conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content to save in the session note',
            },
            append: {
              type: 'boolean',
              description: 'If true, append to existing content; if false, replace. Default: true',
              default: true,
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'search_vault',
        description: 'Search the Obsidian vault for relevant notes and context. Returns ranked results with snippets. Use get_session_context to read full files.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (keywords or phrases)',
            },
            directories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: specific directories to search (sessions, topics, decisions)',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
              default: 10,
            },
            date_range: {
              type: 'object',
              properties: {
                start: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
                end: { type: 'string', description: 'End date (YYYY-MM-DD)' },
              },
              description: 'Optional: filter by date range',
            },
            snippets_only: {
              type: 'boolean',
              description: 'If true, return condensed snippets instead of full matches (default: true)',
              default: true,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'create_topic_page',
        description: 'Create a new topic page in the topics/ directory. Use this for significant technical concepts or areas that will be referenced multiple times.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name (will be slugified for filename)',
            },
            content: {
              type: 'string',
              description: 'Content for the topic page',
            },
          },
          required: ['topic', 'content'],
        },
      },
      {
        name: 'create_decision',
        description: 'Create a new architectural decision record in the decisions/ directory.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Decision title',
            },
            content: {
              type: 'string',
              description: 'Decision content (rationale, alternatives, consequences)',
            },
            context: {
              type: 'string',
              description: 'Optional context for the decision',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'update_topic_page',
        description: 'Update an existing topic page with new information.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name',
            },
            content: {
              type: 'string',
              description: 'Content to add or replace',
            },
            append: {
              type: 'boolean',
              description: 'If true, append to existing content; if false, replace',
              default: true,
            },
          },
          required: ['topic', 'content'],
        },
      },
      {
        name: 'get_session_context',
        description: 'Retrieve the full context from a session file.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Optional session ID; if not provided, returns current session',
            },
          },
        },
      },
      {
        name: 'link_to_topic',
        description: 'Get the Obsidian link format for a topic, creating the page if it doesn\'t exist.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name to link to',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'close_session',
        description: 'Mark the current session as completed. Call this at the end of a conversation.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'find_stale_topics',
        description: 'Find topics that haven\'t been reviewed in a specified time period. Returns list of topics that may need review.',
        inputSchema: {
          type: 'object',
          properties: {
            age_threshold_days: {
              type: 'number',
              description: 'Number of days since creation or last review to consider a topic stale (default: 365)',
              default: 365,
            },
            include_never_reviewed: {
              type: 'boolean',
              description: 'Include topics that have never been reviewed (default: true)',
              default: true,
            },
          },
        },
      },
      {
        name: 'review_topic',
        description: 'Analyze a topic for outdated content and suggest updates. Returns current content and AI analysis with suggested changes.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name or slug to review',
            },
            analysis_prompt: {
              type: 'string',
              description: 'Optional custom instructions for the review analysis',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'approve_topic_update',
        description: 'Apply or dismiss a pending topic review. Updates the topic with new content and review history.',
        inputSchema: {
          type: 'object',
          properties: {
            review_id: {
              type: 'string',
              description: 'Review ID from review_topic call',
            },
            action: {
              type: 'string',
              enum: ['update', 'archive', 'keep', 'dismiss'],
              description: 'Action to take: update (apply changes), archive (move to archive), keep (mark reviewed, no changes), dismiss (cancel review)',
            },
            modified_content: {
              type: 'string',
              description: 'Optional: edited content if you want to modify the AI suggestion before applying',
            },
          },
          required: ['review_id', 'action'],
        },
      },
      {
        name: 'archive_topic',
        description: 'Move a topic to the archive directory. Preserves all metadata and content.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic name or slug to archive',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for archiving',
            },
          },
          required: ['topic'],
        },
      },
    ];
  }

  private async ensureVaultStructure(): Promise<void> {
    const dirs = ['sessions', 'topics', 'decisions', 'archive/topics'];

    for (const dir of dirs) {
      const dirPath = path.join(VAULT_PATH, dir);
      await fs.mkdir(dirPath, { recursive: true });
    }

    // Create index.md if it doesn't exist
    const indexPath = path.join(VAULT_PATH, 'index.md');
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, `# Obsidian Vault Index

This vault contains context from Claude Code conversations.

## Structure
- **sessions/**: Individual conversation sessions
- **topics/**: Technical topics and concepts
- **decisions/**: Architectural decision records

## Recent Sessions
Check the sessions/ directory for recent conversations.
`);
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  private async startSession(args: { topic?: string }) {
    await this.ensureVaultStructure();

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const topicSlug = args.topic ? `_${this.slugify(args.topic)}` : '';
    
    this.currentSessionId = `${dateStr}_${timeStr}${topicSlug}`;
    this.currentSessionFile = path.join(VAULT_PATH, 'sessions', `${this.currentSessionId}.md`);

    const metadata: SessionMetadata = {
      date: dateStr,
      session_id: this.currentSessionId,
      topics: args.topic ? [args.topic] : [],
      decisions: [],
      status: 'ongoing',
    };

    const content = `---
date: ${metadata.date}
session_id: ${metadata.session_id}
topics: ${JSON.stringify(metadata.topics)}
decisions: []
status: ongoing
---

# Session: ${args.topic || 'New Session'}

## Context
${args.topic ? `Working on: ${args.topic}` : 'New conversation session started.'}

## Key Points

## Outcomes

## Code References

`;

    await fs.writeFile(this.currentSessionFile, content);

    return {
      content: [
        {
          type: 'text',
          text: `Session started: ${this.currentSessionId}\nSession file: ${this.currentSessionFile}\n\nUse save_session_note to record key information during the conversation.`,
        },
      ],
    };
  }

  private async saveSessionNote(args: { content: string; append?: boolean }) {
    if (!this.currentSessionFile) {
      throw new Error('No active session. Call start_session first.');
    }

    const append = args.append !== false;

    if (append) {
      const existing = await fs.readFile(this.currentSessionFile, 'utf-8');
      const newContent = existing + '\n' + args.content;
      await fs.writeFile(this.currentSessionFile, newContent);
    } else {
      await fs.writeFile(this.currentSessionFile, args.content);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Session note ${append ? 'updated' : 'saved'}: ${this.currentSessionFile}`,
        },
      ],
    };
  }

  private async searchVault(args: {
    query: string;
    directories?: string[];
    max_results?: number;
    date_range?: { start?: string; end?: string };
    snippets_only?: boolean;
  }) {
    await this.ensureVaultStructure();

    const searchDirs = args.directories || ['sessions', 'topics', 'decisions'];
    const maxResults = args.max_results || 10;
    const snippetsOnly = args.snippets_only !== false; // Default true
    const results: {
      file: string;
      matches: string[];
      date?: string;
      score: number;
    }[] = [];
    const queryLower = args.query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    for (const dir of searchDirs) {
      const dirPath = path.join(VAULT_PATH, dir);

      try {
        const files = await fs.readdir(dirPath);

        for (const file of files) {
          if (!file.endsWith('.md')) continue;

          const filePath = path.join(dirPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const contentLower = content.toLowerCase();

          // Extract date from filename or frontmatter
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
          const fileDate = dateMatch ? dateMatch[1] : undefined;

          // Date filtering
          if (args.date_range) {
            if (args.date_range.start && fileDate && fileDate < args.date_range.start) continue;
            if (args.date_range.end && fileDate && fileDate > args.date_range.end) continue;
          }

          // Calculate relevance score
          let score = 0;
          let hasMatch = false;

          for (const term of queryTerms) {
            const termCount = (contentLower.match(new RegExp(term, 'g')) || []).length;
            if (termCount > 0) {
              hasMatch = true;
              score += termCount;

              // Boost score if term is in filename or title
              if (file.toLowerCase().includes(term)) score += 5;

              // Boost score for recent files (based on creation/modification date)
              if (fileDate) {
                const age = this.getFileAgeDays(fileDate);
                if (age < 7) score += 3;      // Within a week
                else if (age < 30) score += 2; // Within a month
                else if (age < 90) score += 1; // Within 3 months
              }
            }
          }

          // For topics: apply review-based scoring adjustments
          if (dir === 'topics' && hasMatch) {
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
              const frontmatter = frontmatterMatch[1];
              const lastReviewedMatch = frontmatter.match(/last_reviewed:\s*(.+)/);
              const createdMatch = frontmatter.match(/created:\s*(.+)/);

              if (lastReviewedMatch) {
                const lastReviewed = lastReviewedMatch[1].trim();
                const created = createdMatch ? createdMatch[1].trim() : null;
                const reviewAge = this.getFileAgeDays(lastReviewed);

                // Bonus for recently reviewed topics (within 1 year)
                if (reviewAge < 365) {
                  score += 2; // Reviewed within a year = trusted content
                }
              } else if (createdMatch) {
                // No review date, check creation date
                const created = createdMatch[1].trim();
                const creationAge = this.getFileAgeDays(created);

                // Penalty for old topics that have never been reviewed
                if (creationAge > 365) {
                  score -= 2; // Old + never reviewed = potentially stale
                }
              }
            }
          }

          if (hasMatch) {
            const lines = content.split('\n');
            const matchingLines = lines
              .filter(line => {
                const lineLower = line.toLowerCase();
                return queryTerms.some(term => lineLower.includes(term));
              })
              .slice(0, 3); // Limit to 3 matching lines per file

            results.push({
              file: path.join(dir, file),
              matches: matchingLines,
              date: fileDate,
              score: score,
            });
          }
        }
      } catch (error) {
        continue;
      }
    }

    // Sort by relevance score (descending) and limit results
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, maxResults);

    if (topResults.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No results found for "${args.query}".`,
          },
        ],
      };
    }

    // Generate response based on snippets_only flag
    let resultText: string;

    if (snippetsOnly) {
      // Return condensed results with option to read full files
      resultText = `Found ${results.length} matches. Top ${topResults.length} results:\n\n`;

      topResults.forEach((r, idx) => {
        resultText += `${idx + 1}. **${r.file}** ${r.date ? `(${r.date})` : ''}\n`;
        if (r.matches.length > 0) {
          resultText += r.matches
            .map(m => `   ${m.trim().substring(0, 100)}${m.length > 100 ? '...' : ''}`)
            .join('\n') + '\n';
        }
        resultText += '\n';
      });

      if (results.length > maxResults) {
        resultText += `\n_Showing top ${maxResults} of ${results.length} results. Refine your query or increase max_results for more._`;
      }

      resultText += `\n\n💡 Use get_session_context with a specific session_id to read full files.`;
    } else {
      // Return full matching content (old behavior, for backwards compatibility)
      resultText = topResults
        .map(r => `**${r.file}** ${r.date ? `(${r.date})` : ''}:\n${r.matches.map(m => `  - ${m.trim()}`).join('\n')}`)
        .join('\n\n');
    }

    return {
      content: [
        {
          type: 'text',
          text: `Search results for "${args.query}":\n\n${resultText}`,
        },
      ],
    };
  }

  private async createTopicPage(args: { topic: string; content: string }) {
    await this.ensureVaultStructure();

    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);
    const today = new Date().toISOString().split('T')[0];

    const content = `---
title: ${args.topic}
created: ${today}
last_reviewed: ${today}
review_count: 0
tags: [topic]
review_history:
  - date: ${today}
    action: created
    notes: "Topic created"
---

# ${args.topic}

${args.content}

## Related Sessions

## Related Decisions

`;

    await fs.writeFile(topicFile, content);

    // Update current session to reference this topic
    if (this.currentSessionFile) {
      await this.saveSessionNote({
        content: `\n- Created topic page: [[topics/${slug}|${args.topic}]]`,
        append: true,
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: `Topic page created: ${topicFile}\nObsidian link: [[topics/${slug}|${args.topic}]]`,
        },
      ],
    };
  }

  private async createDecision(args: { title: string; content: string; context?: string }) {
    await this.ensureVaultStructure();

    const decisionsDir = path.join(VAULT_PATH, 'decisions');
    const files = await fs.readdir(decisionsDir);
    const decisionNumbers = files
      .filter(f => f.match(/^\d{3}-/))
      .map(f => parseInt(f.split('-')[0]))
      .filter(n => !isNaN(n));
    
    const nextNumber = decisionNumbers.length > 0 ? Math.max(...decisionNumbers) + 1 : 1;
    const numberStr = String(nextNumber).padStart(3, '0');
    const slug = this.slugify(args.title);
    const decisionFile = path.join(decisionsDir, `${numberStr}-${slug}.md`);

    const content = `---
number: ${numberStr}
title: ${args.title}
date: ${new Date().toISOString().split('T')[0]}
status: accepted
---

# Decision ${numberStr}: ${args.title}

## Context
${args.context || 'Decision made during development.'}

## Decision
${args.content}

## Consequences

## Related
${this.currentSessionId ? `- Session: [[sessions/${this.currentSessionId}]]` : ''}

`;

    await fs.writeFile(decisionFile, content);

    // Update current session
    if (this.currentSessionFile) {
      await this.saveSessionNote({
        content: `\n- [[decisions/${numberStr}-${slug}|Decision ${numberStr}]]: ${args.title}`,
        append: true,
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: `Decision record created: ${decisionFile}\nDecision number: ${numberStr}`,
        },
      ],
    };
  }

  private async updateTopicPage(args: { topic: string; content: string; append?: boolean }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      // Topic doesn't exist, create it
      return await this.createTopicPage({ topic: args.topic, content: args.content });
    }

    const append = args.append !== false;

    if (append) {
      const existing = await fs.readFile(topicFile, 'utf-8');
      const newContent = existing + '\n' + args.content;
      await fs.writeFile(topicFile, newContent);
    } else {
      await fs.writeFile(topicFile, args.content);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Topic page updated: ${topicFile}`,
        },
      ],
    };
  }

  private async getSessionContext(args: { session_id?: string }) {
    const sessionId = args.session_id || this.currentSessionId;
    
    if (!sessionId) {
      throw new Error('No session ID provided and no active session.');
    }

    const sessionFile = args.session_id
      ? path.join(VAULT_PATH, 'sessions', `${sessionId}.md`)
      : this.currentSessionFile!;

    const content = await fs.readFile(sessionFile, 'utf-8');

    return {
      content: [
        {
          type: 'text',
          text: `Session context for ${sessionId}:\n\n${content}`,
        },
      ],
    };
  }

  private async linkToTopic(args: { topic: string }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      // Create minimal topic page if it doesn't exist
      await this.createTopicPage({
        topic: args.topic,
        content: 'Topic created automatically via link.',
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: `[[topics/${slug}|${args.topic}]]`,
        },
      ],
    };
  }

  private async closeSession() {
    if (!this.currentSessionFile) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active session to close.',
          },
        ],
      };
    }

    // Update status in frontmatter
    const content = await fs.readFile(this.currentSessionFile, 'utf-8');
    const updatedContent = content.replace(/status: ongoing/, 'status: completed');
    await fs.writeFile(this.currentSessionFile, updatedContent);

    const sessionId = this.currentSessionId;
    this.currentSessionId = null;
    this.currentSessionFile = null;

    return {
      content: [
        {
          type: 'text',
          text: `Session closed: ${sessionId}`,
        },
      ],
    };
  }

  private getFileAgeDays(dateString: string): number {
    const fileDate = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - fileDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private async findStaleTopics(args: { age_threshold_days?: number; include_never_reviewed?: boolean }) {
    await this.ensureVaultStructure();

    const thresholdDays = args.age_threshold_days || 365;
    const includeNeverReviewed = args.include_never_reviewed !== false;
    const topicsDir = path.join(VAULT_PATH, 'topics');
    const staleTopics: Array<{
      title: string;
      slug: string;
      created_date: string;
      last_reviewed?: string;
      age_days: number;
      review_count: number;
      file_path: string;
    }> = [];

    try {
      const files = await fs.readdir(topicsDir);

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(topicsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) continue;

        const frontmatter = frontmatterMatch[1];
        const createdMatch = frontmatter.match(/created:\s*(.+)/);
        const lastReviewedMatch = frontmatter.match(/last_reviewed:\s*(.+)/);
        const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
        const titleMatch = frontmatter.match(/title:\s*(.+)/);

        if (!createdMatch) continue;

        const created = createdMatch[1].trim();
        const lastReviewed = lastReviewedMatch ? lastReviewedMatch[1].trim() : undefined;
        const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;
        const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');

        // Determine if stale
        const referenceDate = lastReviewed || created;
        const ageDays = this.getFileAgeDays(referenceDate);

        const isStale = ageDays > thresholdDays;
        const neverReviewed = !lastReviewed || lastReviewed === created;

        if (isStale && (includeNeverReviewed || !neverReviewed)) {
          staleTopics.push({
            title,
            slug: file.replace('.md', ''),
            created_date: created,
            last_reviewed: lastReviewed !== created ? lastReviewed : undefined,
            age_days: ageDays,
            review_count: reviewCount,
            file_path: `topics/${file}`,
          });
        }
      }
    } catch (error) {
      throw new Error(`Failed to scan topics: ${error}`);
    }

    // Sort by age (oldest first)
    staleTopics.sort((a, b) => b.age_days - a.age_days);

    if (staleTopics.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No stale topics found. All topics have been reviewed within the last ${thresholdDays} days.`,
          },
        ],
      };
    }

    let resultText = `Found ${staleTopics.length} stale topic(s) older than ${thresholdDays} days:\n\n`;

    staleTopics.forEach((topic, idx) => {
      resultText += `${idx + 1}. **${topic.title}** (${topic.slug})\n`;
      resultText += `   - Created: ${topic.created_date}\n`;
      resultText += `   - Last reviewed: ${topic.last_reviewed || 'Never'}\n`;
      resultText += `   - Age: ${topic.age_days} days\n`;
      resultText += `   - Reviews: ${topic.review_count}\n\n`;
    });

    resultText += `\nUse review_topic to analyze any of these topics.`;

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
    };
  }

  private async reviewTopic(args: { topic: string; analysis_prompt?: string }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      throw new Error(`Topic not found: ${args.topic}`);
    }

    const content = await fs.readFile(topicFile, 'utf-8');

    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new Error('Invalid topic file format (missing frontmatter)');
    }

    const frontmatter = frontmatterMatch[1];
    const titleMatch = frontmatter.match(/title:\s*(.+)/);
    const title = titleMatch ? titleMatch[1].trim() : args.topic;

    // Extract main content (without frontmatter)
    const mainContent = content.substring(frontmatterMatch[0].length).trim();

    // Generate review analysis
    const defaultPrompt = `Analyze this topic for outdated or inaccurate information. Consider:
1. Are there any deprecated technologies or approaches mentioned?
2. Is the information still current and accurate?
3. Are there any missing important updates or developments?
4. What specific changes would improve accuracy?

Provide a structured analysis with:
- is_outdated: true/false
- concerns: list of specific issues
- suggested_updates: concrete suggestions for improvements
- confidence: high/medium/low`;

    const analysisPrompt = args.analysis_prompt || defaultPrompt;

    // For now, we'll create a placeholder analysis since we don't have AI integration
    // In a real implementation, this would call an LLM API
    const analysis: ReviewAnalysis = {
      is_outdated: false,
      concerns: [
        'Manual review required - AI analysis not yet implemented',
        'Please review the content below and provide your assessment',
      ],
      suggested_updates: 'Please review the topic content and suggest specific updates if needed.',
      confidence: 'low',
    };

    // Generate review ID and store pending review
    const reviewId = `review_${Date.now()}_${slug}`;
    const pendingReview: PendingReview = {
      review_id: reviewId,
      topic: title,
      slug,
      current_content: content,
      analysis,
      timestamp: Date.now(),
    };

    this.pendingReviews.set(reviewId, pendingReview);

    let resultText = `# Review Analysis: ${title}\n\n`;
    resultText += `**Review ID:** ${reviewId}\n`;
    resultText += `**Topic File:** topics/${slug}.md\n\n`;
    resultText += `## Current Content\n\n${mainContent}\n\n`;
    resultText += `## AI Analysis\n\n`;
    resultText += `**Status:** ${analysis.is_outdated ? '⚠️ Potentially Outdated' : '✅ Appears Current'}\n`;
    resultText += `**Confidence:** ${analysis.confidence}\n\n`;
    resultText += `**Concerns:**\n`;
    analysis.concerns.forEach(c => resultText += `- ${c}\n`);
    resultText += `\n**Suggested Updates:**\n${analysis.suggested_updates}\n\n`;
    resultText += `---\n\n`;
    resultText += `**Next Steps:**\n`;
    resultText += `Use approve_topic_update with one of these actions:\n`;
    resultText += `- \`update\`: Apply suggested changes (you can provide modified_content)\n`;
    resultText += `- \`keep\`: Mark as reviewed without changes\n`;
    resultText += `- \`archive\`: Move to archive\n`;
    resultText += `- \`dismiss\`: Cancel this review\n`;

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
    };
  }

  private async approveTopicUpdate(args: { review_id: string; action: string; modified_content?: string }) {
    const pendingReview = this.pendingReviews.get(args.review_id);

    if (!pendingReview) {
      throw new Error(`Review not found: ${args.review_id}. It may have expired or already been processed.`);
    }

    const { slug, topic, current_content } = pendingReview;
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);
    const today = new Date().toISOString().split('T')[0];

    try {
      switch (args.action) {
        case 'update': {
          // Update content
          const contentToWrite = args.modified_content || pendingReview.analysis.suggested_updates;

          // Parse existing frontmatter
          const frontmatterMatch = current_content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) throw new Error('Invalid frontmatter');

          const frontmatter = frontmatterMatch[1];
          const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
          const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;

          // Update frontmatter with new review info
          let updatedFrontmatter = frontmatter
            .replace(/last_reviewed:.*/, `last_reviewed: ${today}`)
            .replace(/review_count:.*/, `review_count: ${reviewCount + 1}`);

          // Add to review history
          const reviewHistoryEntry = `  - date: ${today}\n    action: updated\n    notes: "Content updated via review process"`;
          if (updatedFrontmatter.includes('review_history:')) {
            updatedFrontmatter = updatedFrontmatter.replace(
              /review_history:/,
              `review_history:\n${reviewHistoryEntry}`
            );
          } else {
            updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
          }

          const mainContent = current_content.substring(frontmatterMatch[0].length).trim();
          const newContent = `---\n${updatedFrontmatter}\n---\n\n${args.modified_content || mainContent}`;

          await fs.writeFile(topicFile, newContent);

          this.pendingReviews.delete(args.review_id);

          return {
            content: [
              {
                type: 'text',
                text: `Topic updated: ${topic}\nFile: topics/${slug}.md\nReview count: ${reviewCount + 1}`,
              },
            ],
          };
        }

        case 'keep': {
          // Mark as reviewed without content changes
          const frontmatterMatch = current_content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) throw new Error('Invalid frontmatter');

          const frontmatter = frontmatterMatch[1];
          const reviewCountMatch = frontmatter.match(/review_count:\s*(\d+)/);
          const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : 0;

          let updatedFrontmatter = frontmatter
            .replace(/last_reviewed:.*/, `last_reviewed: ${today}`)
            .replace(/review_count:.*/, `review_count: ${reviewCount + 1}`);

          const reviewHistoryEntry = `  - date: ${today}\n    action: reviewed\n    notes: "Reviewed - no changes needed"`;
          if (updatedFrontmatter.includes('review_history:')) {
            updatedFrontmatter = updatedFrontmatter.replace(
              /review_history:/,
              `review_history:\n${reviewHistoryEntry}`
            );
          } else {
            updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
          }

          const mainContent = current_content.substring(frontmatterMatch[0].length).trim();
          const newContent = `---\n${updatedFrontmatter}\n---\n\n${mainContent}`;

          await fs.writeFile(topicFile, newContent);

          this.pendingReviews.delete(args.review_id);

          return {
            content: [
              {
                type: 'text',
                text: `Topic marked as reviewed: ${topic}\nNo content changes made.\nReview count: ${reviewCount + 1}`,
              },
            ],
          };
        }

        case 'archive': {
          return await this.archiveTopic({ topic: slug, reason: 'Archived via review process' });
        }

        case 'dismiss': {
          this.pendingReviews.delete(args.review_id);

          return {
            content: [
              {
                type: 'text',
                text: `Review dismissed for: ${topic}`,
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown action: ${args.action}. Use: update, keep, archive, or dismiss`);
      }
    } catch (error) {
      throw new Error(`Failed to process review: ${error}`);
    }
  }

  private async archiveTopic(args: { topic: string; reason?: string }) {
    const slug = this.slugify(args.topic);
    const topicFile = path.join(VAULT_PATH, 'topics', `${slug}.md`);
    const archiveFile = path.join(VAULT_PATH, 'archive', 'topics', `${slug}.md`);

    try {
      await fs.access(topicFile);
    } catch {
      throw new Error(`Topic not found: ${args.topic}`);
    }

    await this.ensureVaultStructure();

    // Read current content
    const content = await fs.readFile(topicFile, 'utf-8');
    const today = new Date().toISOString().split('T')[0];

    // Update frontmatter to mark as archived
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) throw new Error('Invalid frontmatter');

    const frontmatter = frontmatterMatch[1];
    let updatedFrontmatter = frontmatter;

    // Add archived date and reason
    updatedFrontmatter += `\narchived: ${today}`;
    if (args.reason) {
      updatedFrontmatter += `\narchive_reason: ${args.reason}`;
    }

    // Add to review history
    const reviewHistoryEntry = `  - date: ${today}\n    action: archived\n    notes: "${args.reason || 'Topic archived'}"`;
    if (updatedFrontmatter.includes('review_history:')) {
      updatedFrontmatter = updatedFrontmatter.replace(
        /review_history:/,
        `review_history:\n${reviewHistoryEntry}`
      );
    } else {
      updatedFrontmatter += `\nreview_history:\n${reviewHistoryEntry}`;
    }

    const mainContent = content.substring(frontmatterMatch[0].length).trim();
    const newContent = `---\n${updatedFrontmatter}\n---\n\n${mainContent}`;

    // Move to archive
    await fs.writeFile(archiveFile, newContent);
    await fs.unlink(topicFile);

    return {
      content: [
        {
          type: 'text',
          text: `Topic archived: ${args.topic}\nMoved from topics/${slug}.md to archive/topics/${slug}.md${args.reason ? `\nReason: ${args.reason}` : ''}`,
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Obsidian MCP Server running on stdio');
  }
}

const server = new ObsidianMCPServer();
server.run().catch(console.error);
