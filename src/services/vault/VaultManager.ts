/**
 * VaultManager - Vault structure and directory management
 *
 * Responsible for:
 * - Vault structure detection and validation
 * - Directory creation and management
 * - Vault metadata operations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { VaultError } from '../../utils/errors.js';
import type { VaultConfig, VaultStructure, VaultDirectory } from '../../models/Vault.js';

const logger = createLogger('VaultManager');

/**
 * Manages vault structure and operations
 */
export class VaultManager {
  constructor(private vaultConfig: VaultConfig) {}

  /**
   * Get the vault path
   */
  getPath(): string {
    return this.vaultConfig.path;
  }

  /**
   * Get the vault name
   */
  getName(): string {
    return this.vaultConfig.name;
  }

  /**
   * Analyze vault structure
   *
   * Detects which standard directories exist in the vault.
   *
   * @returns Vault structure metadata
   */
  async analyzeStructure(): Promise<VaultStructure> {
    logger.debug('Analyzing vault structure', { vault: this.vaultConfig.name });

    try {
      const entries = await fs.readdir(this.vaultConfig.path, { withFileTypes: true });
      const directories = entries.filter(e => e.isDirectory()).map(e => e.name);

      const structure: VaultStructure = {
        hasSessionsDir: directories.includes('sessions'),
        hasTopicsDir: directories.includes('topics'),
        hasDecisionsDir: directories.includes('decisions'),
        hasProjectsDir: directories.includes('projects'),
        directories,
      };

      logger.debug('Vault structure analyzed', {
        vault: this.vaultConfig.name,
        structure,
      });

      return structure;
    } catch (error) {
      logger.error('Failed to analyze vault structure', error as Error, {
        vault: this.vaultConfig.name,
      });

      throw new VaultError(`Failed to analyze vault structure: ${this.vaultConfig.path}`, {
        vaultName: this.vaultConfig.name,
        vaultPath: this.vaultConfig.path,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Ensure standard vault directory structure exists
   *
   * Creates missing directories if they don't exist.
   */
  async ensureStructure(): Promise<void> {
    logger.info('Ensuring vault structure', { vault: this.vaultConfig.name });

    const requiredDirs = ['sessions', 'topics', 'decisions', 'projects'];

    try {
      for (const dir of requiredDirs) {
        const dirPath = path.join(this.vaultConfig.path, dir);
        await fs.mkdir(dirPath, { recursive: true });
        logger.debug('Directory ensured', { vault: this.vaultConfig.name, directory: dir });
      }

      // Create index file if it doesn't exist
      const indexPath = path.join(this.vaultConfig.path, 'index.md');
      try {
        await fs.access(indexPath);
      } catch {
        await fs.writeFile(
          indexPath,
          `# Obsidian Vault Index

This vault is managed by the Obsidian MCP Server.

## Directory Structure

- **sessions/**: Conversation session logs organized by month
- **topics/**: Technical documentation and how-to guides
- **decisions/**: Architectural decision records (ADRs)
- **projects/**: Git repository tracking and commit logs
`
        );
        logger.debug('Created index file', { vault: this.vaultConfig.name });
      }

      logger.info('Vault structure ensured', { vault: this.vaultConfig.name });
    } catch (error) {
      logger.error('Failed to ensure vault structure', error as Error, {
        vault: this.vaultConfig.name,
      });

      throw new VaultError(`Failed to ensure vault structure: ${this.vaultConfig.path}`, {
        vaultName: this.vaultConfig.name,
        vaultPath: this.vaultConfig.path,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Get the path to a specific directory in the vault
   *
   * @param directory - The directory type
   * @returns Absolute path to the directory
   */
  getDirectoryPath(directory: VaultDirectory | string): string {
    return path.join(this.vaultConfig.path, directory);
  }

  /**
   * Check if a file path belongs to this vault
   *
   * @param filePath - Absolute file path to check
   * @returns true if file is in this vault
   */
  containsFile(filePath: string): boolean {
    return filePath.startsWith(this.vaultConfig.path + path.sep);
  }

  /**
   * Get relative path from vault root
   *
   * @param absolutePath - Absolute file path
   * @returns Relative path from vault root
   */
  getRelativePath(absolutePath: string): string {
    if (!this.containsFile(absolutePath)) {
      throw new VaultError('File is not in this vault', {
        filePath: absolutePath,
        vaultPath: this.vaultConfig.path,
      });
    }

    return path.relative(this.vaultConfig.path, absolutePath);
  }

  /**
   * Get absolute path from relative path
   *
   * @param relativePath - Relative path from vault root
   * @returns Absolute file path
   */
  getAbsolutePath(relativePath: string): string {
    return path.join(this.vaultConfig.path, relativePath);
  }

  /**
   * List all files in a directory
   *
   * @param directory - Directory to list (relative to vault root)
   * @param options - Search options
   * @returns Array of absolute file paths
   */
  async listFiles(
    directory: string,
    options: { recursive?: boolean; pattern?: RegExp } = {}
  ): Promise<string[]> {
    const dirPath = path.join(this.vaultConfig.path, directory);
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory() && options.recursive) {
          const relativePath = path.relative(this.vaultConfig.path, fullPath);
          const subFiles = await this.listFiles(relativePath, options);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          if (!options.pattern || options.pattern.test(entry.name)) {
            files.push(fullPath);
          }
        }
      }

      return files;
    } catch (error) {
      logger.error('Failed to list files', error as Error, {
        vault: this.vaultConfig.name,
        directory,
      });

      throw new VaultError(`Failed to list files in directory: ${directory}`, {
        vaultName: this.vaultConfig.name,
        directory,
        originalError: (error as Error).message,
      });
    }
  }

  /**
   * Check if vault exists and is accessible
   *
   * @returns true if vault exists and is readable
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.vaultConfig.path, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate vault configuration
   *
   * Checks that the vault path exists and is a directory.
   *
   * @throws VaultError if vault is invalid
   */
  async validate(): Promise<void> {
    logger.debug('Validating vault', { vault: this.vaultConfig.name });

    try {
      const stats = await fs.stat(this.vaultConfig.path);

      if (!stats.isDirectory()) {
        throw new VaultError('Vault path is not a directory', {
          vaultName: this.vaultConfig.name,
          vaultPath: this.vaultConfig.path,
        });
      }

      // Check read/write permissions
      await fs.access(this.vaultConfig.path, fs.constants.R_OK | fs.constants.W_OK);

      logger.debug('Vault validated', { vault: this.vaultConfig.name });
    } catch (error) {
      if (error instanceof VaultError) {
        throw error;
      }

      logger.error('Failed to validate vault', error as Error, {
        vault: this.vaultConfig.name,
      });

      throw new VaultError(`Invalid vault: ${this.vaultConfig.path}`, {
        vaultName: this.vaultConfig.name,
        vaultPath: this.vaultConfig.path,
        originalError: (error as Error).message,
      });
    }
  }
}
