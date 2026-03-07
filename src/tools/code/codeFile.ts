/**
 * Tool: code_file
 *
 * Edit or write non-vault code files with automatic file access tracking.
 * This tool provides the same file operation semantics as native Edit/Write
 * but ensures all file accesses are tracked for repository detection and
 * vault_custodian processing.
 *
 * Use this tool instead of native Edit/Write for code files.
 * For vault files, use update_document instead.
 *
 * Related: Decision 044 - File tracking gap causing enforcement bypass
 */

import fs from 'fs/promises';
import path from 'path';

export interface CodeFileArgs {
  file_path: string;
  operation: 'edit' | 'write';
  content: string;
  old_string?: string;
}

export interface CodeFileResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface CodeFileContext {
  vaultPath: string;
  secondaryVaults?: Array<{ path: string; name: string }>;
  trackFileAccess: (path: string, action: 'read' | 'edit' | 'create') => void;
}

/**
 * Check if a path is within a vault (should use update_document instead)
 */
function isVaultPath(
  filePath: string,
  vaultPath: string,
  secondaryVaults?: Array<{ path: string; name: string }>
): { isVault: boolean; vaultName?: string } {
  if (filePath.startsWith(vaultPath)) {
    return { isVault: true, vaultName: 'primary vault' };
  }

  if (secondaryVaults) {
    for (const vault of secondaryVaults) {
      if (filePath.startsWith(vault.path)) {
        return { isVault: true, vaultName: vault.name };
      }
    }
  }

  return { isVault: false };
}

/**
 * Main code_file tool implementation
 */
export async function codeFile(
  args: CodeFileArgs,
  context: CodeFileContext
): Promise<CodeFileResult> {
  const { file_path: filePath, operation, content, old_string: oldString } = args;

  // 1. Reject vault paths - must use update_document instead
  const vaultCheck = isVaultPath(filePath, context.vaultPath, context.secondaryVaults);
  if (vaultCheck.isVault) {
    throw new Error(
      `Use update_document for vault files: ${filePath}\n` +
        `File is in ${vaultCheck.vaultName}.\n` +
        'code_file is for non-vault code files only.'
    );
  }

  // 2. Check if file exists
  let fileExists = false;
  let existingContent = '';

  try {
    existingContent = await fs.readFile(filePath, 'utf-8');
    fileExists = true;
  } catch {
    // File doesn't exist
  }

  // 3. Handle operation
  let finalContent: string;

  if (operation === 'write') {
    // Full file write (create or overwrite)
    finalContent = content;
  } else {
    // Edit: search and replace
    if (!fileExists) {
      throw new Error(`Cannot edit non-existent file: ${filePath}`);
    }

    if (!oldString) {
      throw new Error('edit operation requires old_string parameter');
    }

    const occurrences = existingContent.split(oldString).length - 1;

    if (occurrences === 0) {
      const preview = oldString.length > 100 ? `${oldString.slice(0, 100)}...` : oldString;
      throw new Error(`old_string not found in file: ${filePath}\nSearched for: "${preview}"`);
    }
    if (occurrences > 1) {
      throw new Error(
        `old_string found ${occurrences} times in ${path.basename(filePath)}. Provide a larger string with more context to make it unique.`
      );
    }

    finalContent = existingContent.replace(oldString, content);
  }

  // 4. Ensure parent directory exists
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  // 5. Write file
  await fs.writeFile(filePath, finalContent, 'utf-8');

  // 6. Track file access (CRITICAL - this is the whole point of this tool)
  const action = fileExists ? 'edit' : 'create';
  context.trackFileAccess(filePath, action);

  // 7. Return success
  return {
    content: [
      {
        type: 'text',
        text:
          `Code file ${action === 'create' ? 'created' : 'edited'}: ${filePath}\n` +
          `Operation: ${operation}\n` +
          `Action tracked: ${action}`,
      },
    ],
  };
}
