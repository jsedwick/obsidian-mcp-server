/**
 * Tool: update_user_reference
 *
 * Description: Update or append user reference information in a structured format.
 * This allows Claude to remember contextual information about the user across sessions.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface UpdateUserReferenceArgs {
  section: 'user_identity' | 'technical_context' | 'work_team' | 'personal' | 'additional';
  key: string;
  value: string;
}

export interface UpdateUserReferenceResult {
  content: Array<{ type: string; text: string }>;
}

const SECTION_MAPPING: Record<string, string> = {
  user_identity: 'User Identity',
  technical_context: 'Technical Context',
  work_team: 'Work Team Members',
  personal: 'Personal',
  additional: 'Additional',
};

/**
 * Create the initial template for user-reference.md
 */
function createTemplate(): string {
  const timestamp = new Date().toISOString().split('T')[0];
  return `# User Reference

*Last updated: ${timestamp}*

## User Identity

- **Name:** [Not yet specified]
- **Pronouns:** [Not yet specified]
- **Role:** [Not yet specified]

## Technical Context

- **Primary Technologies:** [Not yet specified]
- **Development Environment:** [Not yet specified]

## Work Team Members

- [Not yet specified]

## Personal

- **Location/Timezone:** [Not yet specified]
- **Communication Preferences:** [Not yet specified]
- **Interests:** [Not yet specified]

## Additional

- [Not yet specified]
`;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update a specific section in the user reference content
 */
function updateSection(content: string, sectionHeader: string, key: string, value: string): string {
  // Find section boundaries
  const sectionRegex = new RegExp(`(## ${escapeRegex(sectionHeader)}\\n)(.*?)(?=\\n## |$)`, 's');

  const match = content.match(sectionRegex);
  if (!match) {
    throw new Error(`Section "${sectionHeader}" not found in user-reference.md`);
  }

  const [fullMatch, header, sectionContent] = match;

  // Special handling for "Additional" section (append-only, no key-value)
  if (sectionHeader === 'Additional') {
    // Check for duplicates (case-insensitive contains)
    const lowerValue = value.toLowerCase();
    const lines = sectionContent.split('\n').filter(l => l.trim());
    const isDuplicate = lines.some(
      line =>
        line.toLowerCase().includes(lowerValue) ||
        lowerValue.includes(line.toLowerCase().replace(/^- /, ''))
    );

    if (isDuplicate) {
      return content; // Skip duplicate
    }

    // Append new item
    const newLine = `- ${value}`;
    const updatedSection =
      sectionContent.trim() === '- [Not yet specified]'
        ? `\n\n${newLine}\n`
        : `${sectionContent.trimEnd()}\n${newLine}\n`;

    return content.replace(fullMatch, `${header}${updatedSection}`);
  }

  // For Work Team Members (list without key-value pairs)
  if (sectionHeader === 'Work Team Members') {
    const lowerValue = value.toLowerCase();
    const lines = sectionContent.split('\n').filter(l => l.trim());
    const isDuplicate = lines.some(line => line.toLowerCase().includes(lowerValue));

    if (isDuplicate) {
      return content; // Skip duplicate
    }

    const newLine = `- ${value}`;
    const updatedSection =
      sectionContent.trim() === '- [Not yet specified]'
        ? `\n\n${newLine}\n`
        : `${sectionContent.trimEnd()}\n${newLine}\n`;

    return content.replace(fullMatch, `${header}${updatedSection}`);
  }

  // For key-value sections (User Identity, Technical Context, Personal)
  const keyRegex = new RegExp(`- \\*\\*${escapeRegex(key)}:\\*\\* (.*)`, 'i');
  const keyMatch = sectionContent.match(keyRegex);

  if (keyMatch) {
    // Update existing key
    const updatedSection = sectionContent.replace(keyRegex, `- **${key}:** ${value}`);
    return content.replace(fullMatch, `${header}${updatedSection}`);
  } else {
    // Add new key-value pair
    const newLine = `- **${key}:** ${value}`;
    const updatedSection = `${sectionContent.trimEnd()}\n${newLine}\n`;
    return content.replace(fullMatch, `${header}${updatedSection}`);
  }
}

/**
 * Update user reference information
 */
export async function updateUserReference(
  args: UpdateUserReferenceArgs,
  vaultPath: string
): Promise<UpdateUserReferenceResult> {
  const { section, key, value } = args;
  const userRefPath = path.join(vaultPath, 'user-reference.md');

  // Validate section
  const sectionHeader = SECTION_MAPPING[section];
  if (!sectionHeader) {
    throw new Error(
      `Invalid section: ${section}. Must be one of: ${Object.keys(SECTION_MAPPING).join(', ')}`
    );
  }

  let content: string;
  let fileExists = false;

  // Read existing file or create template
  try {
    content = await fs.readFile(userRefPath, 'utf-8');
    fileExists = true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      content = createTemplate();
    } else {
      throw error;
    }
  }

  // Update the content
  content = updateSection(content, sectionHeader, key, value);

  // Update timestamp
  const timestamp = new Date().toISOString().split('T')[0];
  content = content.replace(/\*Last updated: .*\*/, `*Last updated: ${timestamp}*`);

  // Write back
  await fs.writeFile(userRefPath, content, 'utf-8');

  return {
    content: [
      {
        type: 'text',
        text: fileExists
          ? `✅ Updated user reference: ${sectionHeader} > ${key}\n\nValue: ${value}`
          : `✅ Created user-reference.md and added: ${sectionHeader} > ${key}\n\nValue: ${value}`,
      },
    ],
  };
}
