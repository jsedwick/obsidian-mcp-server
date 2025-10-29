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

class ObsidianMCPServer {
  private server: Server;
  private currentSessionId: string | null = null;
  private currentSessionFile: string | null = null;

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
            return await this.searchVault(args as { query: string; directories?: string[] });
          
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
        description: 'Search the Obsidian vault for relevant notes and context. Use this to find past conversations, decisions, and topic information.',
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
    ];
  }

  private async ensureVaultStructure(): Promise<void> {
    const dirs = ['sessions', 'topics', 'decisions'];
    
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

  private async searchVault(args: { query: string; directories?: string[] }) {
    await this.ensureVaultStructure();

    const searchDirs = args.directories || ['sessions', 'topics', 'decisions'];
    const results: { file: string; matches: string[] }[] = [];
    const queryLower = args.query.toLowerCase();

    for (const dir of searchDirs) {
      const dirPath = path.join(VAULT_PATH, dir);
      
      try {
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          
          const filePath = path.join(dirPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const contentLower = content.toLowerCase();
          
          if (contentLower.includes(queryLower)) {
            const lines = content.split('\n');
            const matchingLines = lines
              .filter(line => line.toLowerCase().includes(queryLower))
              .slice(0, 3); // Limit to 3 matching lines per file
            
            results.push({
              file: path.join(dir, file),
              matches: matchingLines,
            });
          }
        }
      } catch (error) {
        // Directory might not exist yet
        continue;
      }
    }

    const resultText = results.length > 0
      ? results.map(r => `**${r.file}**:\n${r.matches.map(m => `  - ${m.trim()}`).join('\n')}`).join('\n\n')
      : 'No results found.';

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

    const content = `---
title: ${args.topic}
created: ${new Date().toISOString().split('T')[0]}
tags: [topic]
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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Obsidian MCP Server running on stdio');
  }
}

const server = new ObsidianMCPServer();
server.run().catch(console.error);
