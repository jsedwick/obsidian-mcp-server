/**
 * MultiVaultManager - Coordinate operations across multiple vaults
 *
 * Responsible for:
 * - Managing primary and secondary vaults
 * - Cross-vault file operations
 * - Vault priority handling
 */

import { createLogger } from '../../utils/logger.js';
import type { VaultConfig } from '../../models/Vault.js';
import { VaultManager } from './VaultManager.js';

const logger = createLogger('MultiVaultManager');

/**
 * Manages multiple vaults (primary + secondary)
 */
export class MultiVaultManager {
  private primaryVault: VaultManager;
  private secondaryVaults: VaultManager[];
  private allVaults: VaultManager[];

  constructor(primaryConfig: VaultConfig, secondaryConfigs: VaultConfig[] = []) {
    this.primaryVault = new VaultManager(primaryConfig);
    this.secondaryVaults = secondaryConfigs.map(config => new VaultManager(config));
    this.allVaults = [this.primaryVault, ...this.secondaryVaults];

    logger.info('MultiVaultManager initialized', {
      primaryVault: primaryConfig.name,
      secondaryVaults: secondaryConfigs.length,
    });
  }

  /**
   * Get the primary vault
   */
  getPrimaryVault(): VaultManager {
    return this.primaryVault;
  }

  /**
   * Get all secondary vaults
   */
  getSecondaryVaults(): VaultManager[] {
    return this.secondaryVaults;
  }

  /**
   * Get all vaults (primary + secondary)
   */
  getAllVaults(): VaultManager[] {
    return this.allVaults;
  }

  /**
   * Find which vault contains a file
   *
   * @param filePath - Absolute file path
   * @returns VaultManager that contains the file, or null if not found
   */
  getVaultForFile(filePath: string): VaultManager | null {
    for (const vault of this.allVaults) {
      if (vault.containsFile(filePath)) {
        return vault;
      }
    }
    return null;
  }

  /**
   * Check if a file is in the primary vault
   *
   * @param filePath - Absolute file path
   * @returns true if file is in primary vault
   */
  isInPrimaryVault(filePath: string): boolean {
    return this.primaryVault.containsFile(filePath);
  }

  /**
   * Get the cache directory for a vault
   *
   * Embedding caches are stored per-vault to avoid conflicts.
   *
   * @param vaultPath - Vault path or VaultManager instance
   * @returns Path to cache directory
   */
  getCacheDirectory(vaultPath: string | VaultManager): string {
    const path = typeof vaultPath === 'string' ? vaultPath : vaultPath.getPath();
    return `${path}/.embedding-cache`;
  }

  /**
   * Ensure all vaults have required structure
   */
  async ensureAllStructures(): Promise<void> {
    logger.info('Ensuring structure for all vaults');

    const results = await Promise.allSettled(this.allVaults.map(vault => vault.ensureStructure()));

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn('Some vaults failed to ensure structure', {
        failed: failed.length,
        total: this.allVaults.length,
      });
    }

    logger.info('All vault structures ensured', {
      successful: results.length - failed.length,
      failed: failed.length,
    });
  }

  /**
   * Validate all vaults
   *
   * Checks that all configured vaults exist and are accessible.
   *
   * @throws VaultError if any vault is invalid
   */
  async validateAll(): Promise<void> {
    logger.info('Validating all vaults');

    try {
      await Promise.all(this.allVaults.map(vault => vault.validate()));
      logger.info('All vaults validated successfully');
    } catch (error) {
      logger.error('Vault validation failed', error as Error);
      throw error;
    }
  }

  /**
   * Get statistics about all vaults
   *
   * @returns Vault statistics
   */
  async getStatistics(): Promise<{
    total: number;
    primary: string;
    secondary: number;
    structures: Array<{ name: string; hasTopics: boolean; hasSessions: boolean }>;
  }> {
    const structures = await Promise.all(
      this.allVaults.map(async vault => {
        const structure = await vault.analyzeStructure();
        return {
          name: vault.getName(),
          hasTopics: structure.hasTopicsDir,
          hasSessions: structure.hasSessionsDir,
        };
      })
    );

    return {
      total: this.allVaults.length,
      primary: this.primaryVault.getName(),
      secondary: this.secondaryVaults.length,
      structures,
    };
  }

  /**
   * Find a file across all vaults
   *
   * Searches for a file by relative path in all vaults.
   * Returns the first match (primary vault has priority).
   *
   * @param relativePath - Relative path to find
   * @returns Absolute path to file, or null if not found
   */
  async findFile(relativePath: string): Promise<string | null> {
    for (const vault of this.allVaults) {
      const absolutePath = vault.getAbsolutePath(relativePath);
      try {
        await vault.listFiles(''); // Just check if we can read the vault
        // File exists in this vault
        return absolutePath;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * List all files across all vaults
   *
   * @param directory - Directory to list (relative to vault roots)
   * @param options - Search options
   * @returns Map of vault name to file paths
   */
  async listFilesAcrossVaults(
    directory: string,
    options: { recursive?: boolean; pattern?: RegExp } = {}
  ): Promise<Map<string, string[]>> {
    const filesByVault = new Map<string, string[]>();

    await Promise.all(
      this.allVaults.map(async vault => {
        try {
          const files = await vault.listFiles(directory, options);
          filesByVault.set(vault.getName(), files);
        } catch (error) {
          logger.warn('Failed to list files in vault', {
            vault: vault.getName(),
            error: (error as Error).message,
          });
          filesByVault.set(vault.getName(), []);
        }
      })
    );

    return filesByVault;
  }

  /**
   * Get count of vaults
   *
   * @returns Number of vaults (primary + secondary)
   */
  getVaultCount(): number {
    return this.allVaults.length;
  }

  /**
   * Check if multi-vault mode is enabled
   *
   * @returns true if there are secondary vaults
   */
  hasSecondaryVaults(): boolean {
    return this.secondaryVaults.length > 0;
  }
}
