/**
 * Tool: workflow
 *
 * Description: Execute a workflow or list available workflows.
 * If workflow_name is provided, executes that workflow.
 * If workflow_name is omitted, lists all available workflows.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface WorkflowArgs {
  workflow_name?: string;
  _invoked_by_slash_command?: boolean;
}

export interface WorkflowResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface WorkflowFile {
  name: string;
  filename: string;
  filePath: string;
  description?: string;
}

interface WorkflowContext {
  vaultPath: string;
}

export async function workflow(
  args: WorkflowArgs,
  context: WorkflowContext
): Promise<WorkflowResult> {
  // Enforce that this tool can only be invoked via the /workflow slash command
  if (!args._invoked_by_slash_command) {
    throw new Error('workflow can only be invoked via the /workflow slash command');
  }

  const workflowsDir = path.join(context.vaultPath, 'workflows');

  // Check if workflows directory exists
  try {
    await fs.access(workflowsDir);
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: 'No workflows directory found. Create workflows in the workflows/ directory of your vault.',
        },
      ],
    };
  }

  // If workflow_name is provided, execute that workflow
  if (args.workflow_name) {
    return await executeWorkflow(args.workflow_name, workflowsDir);
  }

  // Otherwise, list all available workflows
  return await listWorkflows(workflowsDir);
}

/**
 * Execute a specific workflow
 */
async function executeWorkflow(
  workflowName: string,
  workflowsDir: string
): Promise<WorkflowResult> {
  const workflowFile = path.join(workflowsDir, `${workflowName}.md`);

  try {
    // Check if workflow file exists
    await fs.access(workflowFile);
  } catch {
    // Try to find similar workflow names for helpful error message
    try {
      const entries = await fs.readdir(workflowsDir);
      const mdFiles = entries.filter(f => f.endsWith('.md'));
      const available = mdFiles.map(f => f.replace('.md', '')).join(', ');

      return {
        content: [
          {
            type: 'text',
            text: `Workflow '${workflowName}' not found.\n\nAvailable workflows: ${available}\n\nUse /workflow to see all available workflows.`,
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: `Workflow '${workflowName}' not found. Use /workflow to see available workflows.`,
          },
        ],
      };
    }
  }

  // Read workflow file
  const content = await fs.readFile(workflowFile, 'utf-8');

  // Remove frontmatter if present
  const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');

  return {
    content: [
      {
        type: 'text',
        text: contentWithoutFrontmatter.trim(),
      },
    ],
  };
}

/**
 * List all available workflows
 */
async function listWorkflows(workflowsDir: string): Promise<WorkflowResult> {
  // Read all .md files from workflows directory
  const workflowFiles: WorkflowFile[] = [];
  const entries = await fs.readdir(workflowsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const filePath = path.join(workflowsDir, entry.name);
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse frontmatter to get description
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let description: string | undefined;

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }

      const name = entry.name.replace('.md', '');
      workflowFiles.push({
        name,
        filename: entry.name,
        filePath,
        description,
      });
    }
  }

  if (workflowFiles.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No workflows found in workflows/ directory. Create .md files in workflows/ to define workflows.',
        },
      ],
    };
  }

  // Sort alphabetically by name
  workflowFiles.sort((a, b) => a.name.localeCompare(b.name));

  // Format output
  let resultText = `Found ${workflowFiles.length} workflow(s):\n\n`;

  workflowFiles.forEach((w, idx) => {
    resultText += `${idx + 1}. ${w.name}`;
    if (w.description) {
      resultText += ` - ${w.description}`;
    }
    resultText += '\n';
  });

  resultText += `\nTo execute a workflow, use: /workflow {workflow-name}`;

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}
