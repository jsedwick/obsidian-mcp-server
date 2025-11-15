/**
 * Migration system for Obsidian MCP Server
 *
 * Handles vault version detection and automatic migration between versions.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';
import { MigrationError } from '../utils/errors.js';

const logger = createLogger('MigrationManager');

export interface Migration {
  version: string;
  description: string;
  up(vaultPath: string): Promise<void>;
  down(vaultPath: string): Promise<void>;
}

export interface VaultMetadata {
  version: string;
  created: string;
  lastModified: string;
  migrations: string[];
}

export interface MigrationReport {
  applied: string[];
  skipped: number;
  currentVersion: string;
  targetVersion: string;
}

/**
 * Manages vault migrations
 *
 * Detects vault version and applies necessary migrations to bring it up to date.
 */
export class MigrationManager {
  private metadataPath: string;
  private migrations: Migration[] = [];

  constructor(private vaultPath: string) {
    this.metadataPath = path.join(vaultPath, '.obsidian-mcp', 'metadata.json');
  }

  /**
   * Register a migration
   *
   * Migrations should be registered in order (oldest to newest).
   *
   * @param migration - The migration to register
   */
  registerMigration(migration: Migration): void {
    this.migrations.push(migration);
    logger.debug(`Registered migration: ${migration.version} - ${migration.description}`);
  }

  /**
   * Detect current vault version
   *
   * Returns '1.0.0' for legacy vaults without metadata.
   *
   * @returns Current vault version
   */
  async detectVersion(): Promise<string> {
    try {
      const metadata = await this.readMetadata();
      logger.info(`Detected vault version: ${metadata.version}`);
      return metadata.version;
    } catch (_error) {
      // No metadata = v1.0.0 (legacy vault)
      logger.info('No metadata found, assuming v1.0.0 (legacy vault)');
      return '1.0.0';
    }
  }

  /**
   * Check if migration is needed
   *
   * @param targetVersion - The target version to migrate to (default: latest)
   * @returns true if migration needed, false otherwise
   */
  async needsMigration(targetVersion?: string): Promise<boolean> {
    const currentVersion = await this.detectVersion();
    const target = targetVersion ?? this.getLatestVersion();

    const needsMigration = this.compareVersions(currentVersion, target) < 0;
    logger.info(`Migration check: ${currentVersion} -> ${target}, needed: ${needsMigration}`);

    return needsMigration;
  }

  /**
   * Run all pending migrations
   *
   * @param targetVersion - The target version to migrate to (default: latest)
   * @returns Migration report
   */
  async migrate(targetVersion?: string): Promise<MigrationReport> {
    const currentVersion = await this.detectVersion();
    const target = targetVersion ?? this.getLatestVersion();
    const pendingMigrations = this.getPendingMigrations(currentVersion, target);

    if (pendingMigrations.length === 0) {
      logger.info('No migrations needed');
      return {
        applied: [],
        skipped: 0,
        currentVersion,
        targetVersion: target,
      };
    }

    logger.info(`Running ${pendingMigrations.length} migrations`);
    const applied: string[] = [];

    // Ensure metadata directory exists
    await this.ensureMetadataDir();

    for (const migration of pendingMigrations) {
      logger.info(`Applying migration: ${migration.version} - ${migration.description}`);

      try {
        await migration.up(this.vaultPath);
        applied.push(migration.version);
        await this.recordMigration(migration.version);
        logger.info(`Migration completed: ${migration.version}`);
      } catch (error) {
        logger.error(`Migration failed: ${migration.description}`, error as Error, {
          version: migration.version,
        });
        throw new MigrationError(
          `Migration ${migration.version} failed: ${(error as Error).message}`,
          {
            version: migration.version,
            description: migration.description,
            appliedMigrations: applied,
          }
        );
      }
    }

    return {
      applied,
      skipped: 0,
      currentVersion,
      targetVersion: target,
    };
  }

  /**
   * Rollback to a specific version
   *
   * @param targetVersion - The version to rollback to
   */
  async rollback(targetVersion: string): Promise<void> {
    const currentVersion = await this.detectVersion();
    const migrationsToRollback = this.getMigrationsToRollback(currentVersion, targetVersion);

    logger.info(`Rolling back ${migrationsToRollback.length} migrations`);

    for (const migration of migrationsToRollback.reverse()) {
      logger.info(`Rolling back migration: ${migration.version}`);

      try {
        await migration.down(this.vaultPath);
        await this.removeMigration(migration.version);
        logger.info(`Rollback completed: ${migration.version}`);
      } catch (error) {
        logger.error(`Rollback failed: ${migration.description}`, error as Error, {
          version: migration.version,
        });
        throw new MigrationError(
          `Rollback ${migration.version} failed: ${(error as Error).message}`,
          {
            version: migration.version,
            description: migration.description,
          }
        );
      }
    }
  }

  private async ensureMetadataDir(): Promise<void> {
    const metadataDir = path.dirname(this.metadataPath);
    await fs.mkdir(metadataDir, { recursive: true });
  }

  private async readMetadata(): Promise<VaultMetadata> {
    const content = await fs.readFile(this.metadataPath, 'utf-8');
    return JSON.parse(content) as VaultMetadata;
  }

  private async writeMetadata(metadata: VaultMetadata): Promise<void> {
    await fs.writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  private async recordMigration(version: string): Promise<void> {
    try {
      const metadata = await this.readMetadata();
      metadata.migrations.push(version);
      metadata.version = version;
      metadata.lastModified = new Date().toISOString();
      await this.writeMetadata(metadata);
    } catch (_error) {
      // Create initial metadata
      const metadata: VaultMetadata = {
        version,
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        migrations: [version],
      };
      await this.writeMetadata(metadata);
    }
  }

  private async removeMigration(version: string): Promise<void> {
    const metadata = await this.readMetadata();
    metadata.migrations = metadata.migrations.filter(v => v !== version);
    metadata.version = metadata.migrations[metadata.migrations.length - 1] || '1.0.0';
    metadata.lastModified = new Date().toISOString();
    await this.writeMetadata(metadata);
  }

  private getPendingMigrations(currentVersion: string, targetVersion: string): Migration[] {
    return this.migrations.filter(
      m =>
        this.compareVersions(m.version, currentVersion) > 0 &&
        this.compareVersions(m.version, targetVersion) <= 0
    );
  }

  private getMigrationsToRollback(currentVersion: string, targetVersion: string): Migration[] {
    return this.migrations.filter(
      m =>
        this.compareVersions(m.version, currentVersion) <= 0 &&
        this.compareVersions(m.version, targetVersion) > 0
    );
  }

  private getLatestVersion(): string {
    if (this.migrations.length === 0) return '1.0.0';
    return this.migrations[this.migrations.length - 1].version;
  }

  /**
   * Simple semantic version comparison
   *
   * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }

    return 0;
  }
}
