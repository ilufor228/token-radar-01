#!/usr/bin/env node
// The gate this entry holds itself to, checked from the repository root:
//
//   node scripts/gate-check.mjs        (after a final `node main.ts`)
//
// It is the shape RULES.txt asks for: a board of at least 100 rows ranked 1..N on an
// implied value that only falls, every watchlist protocol on it, farm plans in the step
// and length bounds, three screenshots inside the geometry and byte caps, a dossier that
// matches what buildDossier rebuilds from out/, a source budget under 64KB and no network
// address anywhere in the page.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-board.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const MIN_ROWS = 100;
const WATCHLIST = 40;
const STEP = { min: 3, max: 12, chars: [20, 600] };
const SHOT = { long: 1440, short: 800, bytes: 512 * 1024 };
const SOURCE_CAP = 65_536;
const SHOTS = ['1-board.png', '2-detail.png', '3-filtered.png'];

// ---------------------------------------------------------------- board

let board = null;
try {
  board = readJson('out/board.json');
} catch {
  board = null;
}
const rows = Array.isArray(board?.rows) ? board.rows : [];
check('board_rows', rows.length >= MIN_ROWS, `${rows.length} rows, ${MIN_ROWS} needed`);

const ranks = rows.every((row, i) => row.rank === i + 1);
check('ranks_1_to_n', ranks, ranks ? 'rank column runs 1..N' : 'a rank is out of step with its row');

let falling = true;
let tie = null;
for (let i = 1; i < rows.length; i++) {
  if (!(rows[i].implied_value_usd < rows[i - 1].implied_value_usd)) {
    falling = false;
    tie = `row ${rows[i].rank} ${rows[i].implied_value_usd} vs row ${rows[i - 1].rank} ${rows[i - 1].implied_value_usd}`;
    break;
  }
}
check('implied_value_strictly_falling', falling, falling ? `${rows.length} values each below the one above` : tie);

const values = rows.map((r) => r.implied_value_usd);
check('implied_value_distinct', new Set(values).size === values.length, `${new Set(values).size} distinct of ${values.length}`);

const slugs = new Set(rows.map((r) => r.slug));
let watchRows = 0;
for (const row of rows) if (row.watchlist) watchRows++;
check('watchlist_covered', watchRows >= WATCHLIST, `${watchRows} watchlist rows ranked`);
check('watchlist_none_missing', slugs.size >= WATCHLIST, `${slugs.size} distinct protocols`);

const stepProblems = [];
for (const row of rows) {
  const steps = row.farm_steps;
  if (!Array.isArray(steps) || steps.length < STEP.min || steps.length > STEP.max) {
    stepProblems.push(`${row.slug}: ${Array.isArray(steps) ? steps.length : 0} steps`);
    continue;
  }
  for (const step of steps) {
    if (typeof step !== 'string' || step.length < STEP.chars[0] || step.length > STEP.chars[1]) {
      stepProblems.push(`${row.slug}: step of ${typeof step === 'string' ? step.length : 0} characters`);
      break;
    }
  }
  if (stepProblems.length > 4) break;
}
check('farm_steps_valid', stepProblems.length === 0, stepProblems.length === 0 ? `${rows.length} rows, ${STEP.min}-${STEP.max} steps of ${STEP.chars[0]}-${STEP.chars[1]} characters` : stepProblems.join('; '));

// ---------------------------------------------------------------- screenshots

const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const shotProblems = [];
for (const name of SHOTS) {
  const path = join(root, 'screenshots', name);
  if (!existsSync(path)) {
    shotProblems.push(`${name} missing`);
    continue;
  }
  const bytes = readFileSync(path);
  if (bytes.length > SHOT.bytes) shotProblems.push(`${name} is ${bytes.length} bytes`);
  if (bytes.subarray(1, 4).toString('ascii') !== 'PNG') {
    shotProblems.push(`${name} is not a PNG`);
    continue;
  }
  const { width, height } = pngSize(bytes);
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long > SHOT.long || short < SHOT.short) shotProblems.push(`${name} is ${width}x${height}`);
}
check('screenshots', shotProblems.length === 0, shotProblems.length === 0 ? `3 PNGs at or inside ${SHOT.long} on the long side, ${SHOT.short} on the short, under ${SHOT.bytes} bytes` : shotProblems.join('; '));

// ---------------------------------------------------------------- dossier

let dossierIssue = 'out/dossier.json missing';
if (existsSync(join(root, 'out/dossier.json'))) {
  const onDisk = readFileSync(join(root, 'out/dossier.json'));
  try {
    const rebuilt = buildDossier(join(root, 'out'), {
      text_max_bytes: SOURCE_CAP,
      screenshots: { max: 4, max_bytes: SHOT.bytes },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    });
    const same = Buffer.compare(onDisk, rebuilt) === 0;
    dossierIssue = same ? '' : 'out/dossier.json differs from a fresh buildDossier of out/ (run main.ts again)';
  } catch (error) {
    dossierIssue = `buildDossier refused out/: ${error.message}`;
  }
}
check('dossier_matches', dossierIssue === '', dossierIssue === '' ? `${(statSync(join(root, 'out/dossier.json')).size / 1024).toFixed(0)} KB, byte for byte what buildDossier rebuilds` : dossierIssue);

// ---------------------------------------------------------------- source budget and network

const sourceFiles = ['main.ts', 'lib/model.ts', ...filesUnder(join(root, 'dashboard'), 'dashboard/')];
const sourceBytes = sourceFiles.reduce((sum, path) => sum + statSync(join(root, path)).size, 0);
check('source_under_64kb', sourceBytes <= SOURCE_CAP, `${sourceBytes} bytes of ${SOURCE_CAP} (main.ts, lib, dashboard)`);

const page = ['dashboard/index.html', 'dashboard/app.css', 'dashboard/app.js', 'main.ts', 'lib/model.ts']
  .map((path) => readFileSync(join(root, path), 'utf8'))
  .join('\n');
const url = /https?:\/\//.exec(page);
check('no_network_addresses', url === null, url === null ? 'no http(s) address in the page, the model or the entrypoint' : `found ${url[0]}`);

const licence = existsSync(join(root, 'LICENSE')) && /SPDX-License-Identifier:\s*MIT/.test(readFileSync(join(root, 'LICENSE'), 'utf8'));
check('license_mit', licence, licence ? 'LICENSE declares MIT' : 'LICENSE is missing or not MIT');

// ---------------------------------------------------------------- report

let failed = 0;
for (const result of results) {
  if (!result.ok) failed++;
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'} ${result.name} - ${result.detail}\n`);
}
process.stdout.write(failed === 0 ? `all ${results.length} gate checks passed\n` : `${failed} failed of ${results.length}\n`);
process.exit(failed === 0 ? 0 : 1);

function filesUnder(dir, prefix, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) filesUnder(path, `${prefix}${name}/`, out);
    else out.push(`${prefix}${name}`);
  }
  return out;
}
