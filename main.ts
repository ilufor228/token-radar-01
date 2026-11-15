#!/usr/bin/env node
// Token launch radar: read the sealed snapshot, price every protocol that has no token,
// write the ranked board, the dashboard's data and the dossier the judge reads.
//
//   node main.ts                      reads /input/snapshot.json, writes /output
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Standard library only. The dashboard it copies is static: dashboard/index.html reads
// data.js, which this program writes from the same rows as board.json, so the page works
// from disk with no network at all.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SCREENSHOTS = 3;

/** `--name value` or `--name=value` from the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const spaced = process.argv.indexOf(`--${name}`);
  if (spaced >= 0 && spaced + 1 < process.argv.length) return process.argv[spaced + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function die(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Copy one directory's plain files into `to`, skipping dot files and directories. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory>`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const rows = buildBoard(snapshot, Date.now());
const issue = boardIssue(rows, snapshot);
if (issue !== null) die(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: MODEL, as_of: snapshot.as_of, rows }, null, 2)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(rows, snapshot.as_of));

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (pages.length < 3) die(`dashboard/ holds ${pages.length} file${pages.length === 1 ? '' : 's'}, a page needs index.html, app.css and app.js`);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < MIN_SCREENSHOTS) {
  die(`screenshots/ holds ${shots.length}: hand in ${MIN_SCREENSHOTS}, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!FILE_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last and is built from the output dir, so the scorer's rebuild matches.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

const top = rows[0];
const watch = rows.filter((r) => r.watchlist).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist, ${rows.length} board rows (${watch} watchlist)\n` +
    `token radar: rank 1 ${top?.name ?? '-'} at $${(top?.implied_value_usd ?? 0).toLocaleString('en-US')}, rank ${rows.length} at $${(rows.at(-1)?.implied_value_usd ?? 0).toLocaleString('en-US')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, data.js, dashboard (${pages.length} files), screenshots (${shots.length}) and dossier.json\n`,
);
