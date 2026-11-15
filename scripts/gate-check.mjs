// The entry's own gate, run before the site's: `node scripts/gate-check.mjs [--root .] [--out out]`.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};

const root = flag('root', '.');
const out = flag('out', 'out');
const snapshotPath = flag('input', join(root, 'input', 'snapshot.json'));

let failed = 0;
function check(name, run) {
  try {
    const detail = run();
    console.log(`PASS  ${name}${detail ? `: ${detail}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}

function need(condition, message) {
  if (!condition) throw new Error(message);
}

const snapshot = JSON.parse(readFileSync(existsSync(snapshotPath) ? snapshotPath : join(root, '..', 'input', 'snapshot.json'), 'utf8'));
const knownSlugs = new Set(snapshot.protocols.map((p) => p.slug));

const boardPath = join(out, 'board.json');
const boardBytes = existsSync(boardPath) ? readFileSync(boardPath) : null;
let rows = [];
check('board_file', () => {
  need(boardBytes !== null, `no ${boardPath}: run main.ts first`);
  need(boardBytes.length <= 8 * 1024 * 1024, `board.json is ${boardBytes.length} bytes, over 8 MiB`);
  const doc = JSON.parse(boardBytes.toString('utf8'));
  rows = Array.isArray(doc) ? doc : doc.rows;
  need(Array.isArray(rows), 'board.json holds no rows array');
  need(rows.length >= 100 && rows.length <= 4000, `${rows.length} rows, the gate wants 100 to 4,000`);
  for (const row of rows) {
    need(typeof row.slug === 'string' && row.slug.length >= 1 && row.slug.length <= 128 && !/\s/.test(row.slug), `bad slug ${JSON.stringify(row.slug)}`);
    need(knownSlugs.has(row.slug), `slug ${row.slug} is not one of the snapshot's protocols`);
    need(typeof row.name === 'string' && row.name.length > 0, `${row.slug} has no name`);
    need(Number.isInteger(row.rank) && row.rank > 0, `${row.slug} has rank ${row.rank}`);
    need(Number.isInteger(row.implied_value_usd) && row.implied_value_usd > 0 && row.implied_value_usd <= 100_000_000_000_000, `${row.slug} has implied value ${row.implied_value_usd}`);
  }
  const slugs = new Set(rows.map((r) => r.slug));
  need(slugs.size === rows.length, 'a slug appears twice');
  return `${rows.length} rows, ${boardBytes.length} bytes`;
});

check('sorted_by_value', () => {
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) need(ranks[i] === i + 1, `rank ${i + 1} is ${ranks[i]}`);
  for (let i = 1; i < rows.length; i++) {
    need(rows[i].implied_value_usd <= rows[i - 1].implied_value_usd, `row ${i + 1} rises above row ${i}`);
    need(rows[i].implied_value_usd !== rows[i - 1].implied_value_usd, `rows ${i} and ${i + 1} share $${rows[i].implied_value_usd}`);
  }
  const distinct = new Set(rows.map((r) => r.implied_value_usd)).size;
  need(distinct > 1 || rows.length < 2, 'every row carries the same implied value');
  return `ranks 1..${rows.length}, implied values strictly falling`;
});

check('coverage', () => {
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  need(missing.length === 0, `missing ${missing.length} watchlist slugs`);
  return `all ${snapshot.watchlist.length} watchlist slugs ranked, ${rows.length - snapshot.watchlist.length} more below floor`;
});

check('farm_steps', () => {
  let shortest = Infinity;
  let longest = 0;
  for (const row of rows) {
    need(Array.isArray(row.farm_steps) && row.farm_steps.length >= 3 && row.farm_steps.length <= 12, `${row.slug} farm steps count invalid`);
    for (const step of row.farm_steps) {
      need(typeof step === 'string', `${row.slug} step not string`);
      const trimmed = step.trim().length;
      need(trimmed >= 20 && step.length <= 600, `${row.slug} step length ${trimmed}`);
      shortest = Math.min(shortest, trimmed);
      longest = Math.max(longest, step.length);
    }
  }
  return `${rows.length * 6} steps, ${shortest} to ${longest} characters`;
});

if (failed > 0) {
  console.error(`\ngate check: ${failed} check${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
} else {
  console.log('\ngate check: all checks passed');
  process.exit(0);
}
