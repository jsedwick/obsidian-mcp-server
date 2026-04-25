#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(repoRoot, 'src');
const distDir = join(repoRoot, 'dist');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files = [];
for (const f of walk(srcDir)) {
  if (!f.endsWith('.ts')) continue;
  if (f.includes('__mocks__')) continue;
  if (f.endsWith('.test.ts') || f.endsWith('.spec.ts')) continue;
  files.push(f);
}
files.sort();

const hash = createHash('sha256');
for (const f of files) {
  hash.update(relative(repoRoot, f));
  hash.update('\0');
  hash.update(readFileSync(f));
  hash.update('\0');
}
const buildId = hash.digest('hex').slice(0, 16);

const payload = {
  buildId,
  builtAt: new Date().toISOString(),
  fileCount: files.length,
};

writeFileSync(join(distDir, '.build-id'), JSON.stringify(payload, null, 2) + '\n');
console.log(`build-id ${buildId} (${files.length} src files)`);
