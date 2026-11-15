// Token Radar: token-radar-01 entrypoint. Node 22, standard library only.
//
// Reads sealed snapshot from /input/snapshot.json (or --input), scores pre-token protocols
// using lib/model.ts, writes ranked board to board.json and data.js, copies dashboard and screenshots,
// and writes dossier.json with vendor/makefun-board.ts.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}. Pass --input <snapshot.json|directory>.\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: radar.model_version, as_of: radar.as_of, rows: board }, null, 2)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    if (!PLAIN_NAME.test(name)) {
      process.stderr.write(`token radar: ${path}: bad file name\n`);
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
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images; need at least 3\n`);
  process.exit(1);
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES }));

const dollars = (n: number): string => `$${n.toLocaleString('en-US')}`;
process.stdout.write(
  `token radar: ${radar.scanned} protocols in snapshot, ${radar.watchlist_size} on watchlist, ${board.length} ranked by ${radar.model_version}\n` +
    `token radar: rank 1 is ${board[0]!.name} at ${dollars(board[0]!.implied_value_usd)} implied, rank ${board.length} is ${dollars(board[board.length - 1]!.implied_value_usd)}; median multiple ${radar.median_multiple}x TVL\n` +
    `token radar: wrote board.json, data.js, dashboard/, screenshots/ and dossier.json to ${out}\n`,
);
