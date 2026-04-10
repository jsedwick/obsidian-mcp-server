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
 * Recursively collect all .md files from a directory, returning paths relative to the base dir.
 */
async function collectWorkflowFiles(dir: string, baseDir: string): Promise<WorkflowFile[]> {
  const results: WorkflowFile[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await collectWorkflowFiles(fullPath, baseDir);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const relativePath = path.relative(baseDir, fullPath);
      const name = relativePath.replace(/\.md$/, '');
      const content = await fs.readFile(fullPath, 'utf-8');

      let description: string | undefined;
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }

      results.push({ name, filename: entry.name, filePath: fullPath, description });
    }
  }

  return results;
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
    await fs.access(workflowFile);
  } catch {
    try {
      const allWorkflows = await collectWorkflowFiles(workflowsDir, workflowsDir);
      const available = allWorkflows.map(w => w.name).join(', ');

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

  const content = await fs.readFile(workflowFile, 'utf-8');
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
  const workflowFiles = await collectWorkflowFiles(workflowsDir, workflowsDir);

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

  workflowFiles.sort((a, b) => a.name.localeCompare(b.name));

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
