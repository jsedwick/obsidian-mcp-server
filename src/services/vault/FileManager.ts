/**
 * FileManager - File I/O operations
 *
 * Responsible for:
 * - File reading/writing with error handling
 * - Frontmatter parsing and updating
 * - Batch file operations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { VaultError } from '../../utils/errors.js';

const logger = createLogger('FileManager');

/**
 * Frontmatter data structure
 */
export interface Frontmatter {
  [key: string]: unknown;
}

/**
 * File with parsed frontmatter
 */
export interface FileWithFrontmatter {
  path: string;
  frontmatter: Frontmatter;
  body: string;
  raw: string;
}

/**
 * Manages file operations in the vault
 */
export class FileManager {
  /**
   * Read a file
   *
   * @param filePath - Absolute path to file
   * @returns File content
   */
  async readFile(filePath: string): Promise<string> {
    logger.debug('Reading file', { path: filePath });

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      logger.debug('File read successfully', {
        path: filePath,
        size: content.length,
      });
      return content;
    } catch (error) {
      logger.error('Failed to read file', error as Error, { path: filePath });

      throw new VaultError(`Failed to read file: ${filePath}`, {
        path: filePath,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Write a file
   *
   * @param filePath - Absolute path to file
   * @param content - File content
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    logger.debug('Writing file', { path: filePath, size: content.length });

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, 'utf-8');
      logger.debug('File written successfully', { path: filePath });
    } catch (error) {
      logger.error('Failed to write file', error as Error, { path: filePath });

      throw new VaultError(`Failed to write file: ${filePath}`, {
        path: filePath,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Check if a file exists
   *
   * @param filePath - Absolute path to file
   * @returns true if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file
   *
   * @param filePath - Absolute path to file
   */
  async deleteFile(filePath: string): Promise<void> {
    logger.debug('Deleting file', { path: filePath });

    try {
      await fs.unlink(filePath);
      logger.debug('File deleted successfully', { path: filePath });
    } catch (error) {
      logger.error('Failed to delete file', error as Error, { path: filePath });

      throw new VaultError(`Failed to delete file: ${filePath}`, {
        path: filePath,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Parse frontmatter from markdown content
   *
   * @param content - Markdown content
   * @returns Parsed frontmatter and body
   */
  parseFrontmatter(content: string): FileWithFrontmatter {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      return {
        path: '',
        frontmatter: {},
        body: content,
        raw: content,
      };
    }

    const frontmatterText = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    // Parse YAML-like frontmatter
    const frontmatter: Frontmatter = {};
    const lines = frontmatterText.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const key = match[1];
        let value: unknown = match[2];

        // Try to parse as JSON for arrays/objects
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (value === 'null') value = null;
        else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
        else if (/^\d+\.\d+$/.test(value as string)) value = parseFloat(value as string);
        else if (/^[[{]/.test(value as string)) {
          try {
            value = JSON.parse(value as string);
          } catch {
            // Keep as string if not valid JSON
          }
        } else if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
          value = (value as string).slice(1, -1);
        }

        frontmatter[key] = value;
      }
    }

    return {
      path: '',
      frontmatter,
      body,
      raw: content,
    };
  }

  /**
   * Serialize frontmatter to YAML-like format
   *
   * @param frontmatter - Frontmatter object
   * @returns YAML string
   */
  serializeFrontmatter(frontmatter: Frontmatter): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(frontmatter)) {
      if (value === null || value === undefined) {
        lines.push(`${key}: null`);
      } else if (typeof value === 'boolean') {
        lines.push(`${key}: ${value}`);
      } else if (typeof value === 'number') {
        lines.push(`${key}: ${value}`);
      } else if (typeof value === 'string') {
        // Quote strings that contain special characters
        if (value.includes(':') || value.includes('#') || value.includes('\n')) {
          lines.push(`${key}: "${value}"`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      } else if (Array.isArray(value) || typeof value === 'object') {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Update frontmatter in a file
   *
   * @param filePath - Absolute path to file
   * @param updates - Frontmatter fields to update
   */
  async updateFrontmatter(filePath: string, updates: Frontmatter): Promise<void> {
    logger.debug('Updating frontmatter', { path: filePath, updates });

    try {
      const content = await this.readFile(filePath);
      const parsed = this.parseFrontmatter(content);

      // Merge updates
      const newFrontmatter = { ...parsed.frontmatter, ...updates };

      // Reconstruct file
      const frontmatterText = this.serializeFrontmatter(newFrontmatter);
      const newContent = `---\n${frontmatterText}\n---\n${parsed.body}`;

      await this.writeFile(filePath, newContent);
      logger.debug('Frontmatter updated successfully', { path: filePath });
    } catch (error) {
      logger.error('Failed to update frontmatter', error as Error, { path: filePath });

      throw new VaultError(`Failed to update frontmatter: ${filePath}`, {
        path: filePath,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Read multiple files in parallel
   *
   * @param filePaths - Array of absolute file paths
   * @returns Array of file contents (in same order as input)
   */
  async readFiles(filePaths: string[]): Promise<string[]> {
    logger.debug('Reading multiple files', { count: filePaths.length });

    try {
      const contents = await Promise.all(filePaths.map(p => this.readFile(p)));
      logger.debug('Files read successfully', { count: filePaths.length });
      return contents;
    } catch (error) {
      logger.error('Failed to read files', error as Error, { count: filePaths.length });
      throw error; // Re-throw the VaultError from readFile
    }
  }

  /**
   * Write multiple files in parallel
   *
   * @param files - Array of { path, content } pairs
   */
  async writeFiles(files: Array<{ path: string; content: string }>): Promise<void> {
    logger.debug('Writing multiple files', { count: files.length });

    try {
      await Promise.all(files.map(f => this.writeFile(f.path, f.content)));
      logger.debug('Files written successfully', { count: files.length });
    } catch (error) {
      logger.error('Failed to write files', error as Error, { count: files.length });
      throw error; // Re-throw the VaultError from writeFile
    }
  }

  /**
   * Append content to a file
   *
   * @param filePath - Absolute path to file
   * @param content - Content to append
   */
  async appendToFile(filePath: string, content: string): Promise<void> {
    logger.debug('Appending to file', { path: filePath, size: content.length });

    try {
      const existing = (await this.exists(filePath)) ? await this.readFile(filePath) : '';
      const newContent = existing ? `${existing}\n${content}` : content;
      await this.writeFile(filePath, newContent);
      logger.debug('Content appended successfully', { path: filePath });
    } catch (error) {
      logger.error('Failed to append to file', error as Error, { path: filePath });

      throw new VaultError(`Failed to append to file: ${filePath}`, {
        path: filePath,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Get file statistics
   *
   * @param filePath - Absolute path to file
   * @returns File stats
   */
  async getStats(filePath: string): Promise<{ size: number; modified: Date; created: Date }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime,
      };
    } catch (error) {
      logger.error('Failed to get file stats', error as Error, { path: filePath });

      throw new VaultError(`Failed to get file stats: ${filePath}`, {
        path: filePath,
        originalError: (error as Error).message,
      });
    }
  }
}
