import { readFileSync, statSync, readdirSync, existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';

const logger = createLogger('BuildId');

interface BuildIdPayload {
  buildId: string;
  builtAt: string;
  fileCount: number;
}

const here = dirname(fileURLToPath(import.meta.url));
// src/utils/buildId.ts -> dist/utils/buildId.js -> repo layout:
//   dist/utils/  → ../  = dist/   → ../  = repo root
const DIST_DIR = join(here, '..');
const REPO_ROOT = join(DIST_DIR, '..');
const SRC_DIR = join(REPO_ROOT, 'src');
const BUILD_ID_PATH = join(DIST_DIR, '.build-id');

function readBuildIdFile(): BuildIdPayload | null {
  try {
    const raw = readFileSync(BUILD_ID_PATH, 'utf-8');
    return JSON.parse(raw) as BuildIdPayload;
  } catch {
    return null;
  }
}

const startupPayload = readBuildIdFile();
export const RUNTIME_BUILD_ID: string | null = startupPayload?.buildId ?? null;
export const RUNTIME_BUILT_AT: string | null = startupPayload?.builtAt ?? null;

if (startupPayload) {
  logger.info('build-id loaded at startup', {
    buildId: startupPayload.buildId,
    builtAt: startupPayload.builtAt,
    fileCount: startupPayload.fileCount,
  });
} else {
  logger.warn('dist/.build-id missing at startup — staleness check disabled');
}

/**
 * Walk src/ at startup and compare mtimes to the corresponding dist/ files.
 * If any src/*.ts is newer than its compiled output, the running dist is
 * already stale before a single tool call. Logs a fat WARN listing the
 * drifted files so the MCP error monitor surfaces it. Silent no-op when
 * the package is installed without a sibling src/ directory.
 */
function checkStartupSrcDistDrift(): void {
  if (!existsSync(SRC_DIR)) return; // installed-as-package layout

  const drifted: { src: string; srcMtime: number; distMtime: number | null }[] = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith('.ts')) continue;
      if (full.includes('__mocks__')) continue;
      if (full.endsWith('.test.ts') || full.endsWith('.spec.ts')) continue;

      const rel = relative(SRC_DIR, full).replace(/\.ts$/, '.js');
      const distPath = join(DIST_DIR, rel);
      let distMtime: number | null = null;
      try {
        distMtime = statSync(distPath).mtimeMs;
      } catch {
        distMtime = null;
      }
      if (distMtime === null || st.mtimeMs > distMtime) {
        drifted.push({ src: full, srcMtime: st.mtimeMs, distMtime });
      }
    }
  }

  try {
    walk(SRC_DIR);
  } catch (err) {
    logger.warn('src/dist drift check failed', { error: String(err) });
    return;
  }

  if (drifted.length > 0) {
    logger.warn(
      `STALE DIST DETECTED at startup: ${drifted.length} src file(s) newer than dist. Run \`npm run build\` and restart Claude Code.`,
      {
        sample: drifted.slice(0, 5).map(d => ({
          src: relative(REPO_ROOT, d.src),
          distMissing: d.distMtime === null,
        })),
      }
    );
  }
}

checkStartupSrcDistDrift();

export class StaleBuildError extends Error {
  constructor(
    public readonly runtimeBuildId: string,
    public readonly diskBuildId: string,
    public readonly diskBuiltAt: string
  ) {
    super(
      `MCP server is running stale code. Restart Claude Code to pick up the latest build.\n` +
        `  runtime build-id: ${runtimeBuildId}\n` +
        `  on-disk build-id: ${diskBuildId} (built ${diskBuiltAt})\n` +
        `Refusing to proceed — silently running stale code corrupted session records previously.`
    );
    this.name = 'StaleBuildError';
  }
}

/**
 * Throws StaleBuildError if the on-disk build-id no longer matches the build-id
 * loaded at server startup. Tools that produce durable, non-recoverable artifacts
 * (e.g. session files) should call this on entry. If the build-id file is missing
 * at runtime check time, this is a no-op — the warn at startup already surfaced it.
 */
export function assertFreshBuild(): void {
  if (!RUNTIME_BUILD_ID) return;
  const current = readBuildIdFile();
  if (!current) return;
  if (current.buildId !== RUNTIME_BUILD_ID) {
    throw new StaleBuildError(RUNTIME_BUILD_ID, current.buildId, current.builtAt);
  }
}
