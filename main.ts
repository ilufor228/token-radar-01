// Token Radar: token-radar-01's entrypoint. Node 22, the standard library only.
//
// It reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with lib/model.ts, writes the ranked board to /output/board.json and the page's
// data to /output/data.js, copies this repository's dashboard/ and screenshots/ into /output, and
// writes /output/dossier.json last with the vendored make.fun library.
//
// The dashboard is a static page with no framework and no network: index.html, app.css and app.js
// read ../data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own cap on the dossier's source text. */
const TEXT_MAX_BYTES = 65_536;
/** A plain file's name, as the dossier reads one. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}. Pass --input <snapshot.json|directory>, or mount the sealed /input.\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: radar.model_version, as_of: radar.as_of, rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    if (!PLAIN_NAME.test(name)) {
      process.stderr.write(`token radar: ${path}: a file's name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (!dashboardFiles.includes('index.html')) {
  process.stderr.write('token radar: dashboard/ has no index.html\n');
  process.exit(1);
}
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in three, the board, a detail view and a filtered view\n`);
  process.exit(1);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares the bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES }));

const dollars = (n: number): string => `$${n.toLocaleString('en-US')}`;
process.stdout.write(
  `token radar: ${radar.scanned} protocols in the snapshot, ${radar.watchlist_size} on the watchlist, ${board.length} ranked by ${radar.model_version}\n` +
    `token radar: rank 1 is ${board[0]!.name} at ${dollars(board[0]!.implied_value_usd)} implied, rank ${board.length} is ${dollars(board[board.length - 1]!.implied_value_usd)}; median multiple ${radar.median_multiple}x TVL against ${radar.median_comparable_ratio}x for protocols already trading\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
