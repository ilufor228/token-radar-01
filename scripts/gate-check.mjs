// The entry's own gate, run before the site's: `node scripts/gate-check.mjs [--root .] [--out out]`.
//
// It reads what main.ts wrote and checks every row of the bounty's gate against it, plus the parts
// only the entrant can check: that the dossier is the byte-for-byte one buildDossier writes, that no
// dashboard file names a network address, and that the page's source stays inside the dossier's cap.
// Every check prints PASS or FAIL with what it found; the script exits 1 on the first FAIL.

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};

const root = flag('root', '.');
const out = flag('out', 'out');
const snapshotPath = flag('input', join(root, 'input', 'snapshot.json'));

const TEXT_MAX = 65_536;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SHOT_MAX_BYTES = 524_288;

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

// ---------------------------------------------------------------- board.json

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
  return `ranks 1..${rows.length}, implied values strictly falling from $${rows[0].implied_value_usd.toLocaleString('en-US')} to $${rows[rows.length - 1].implied_value_usd.toLocaleString('en-US')}`;
});

check('coverage', () => {
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  need(missing.length === 0, `missing ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`);
  return `all ${snapshot.watchlist.length} watchlist slugs are ranked, ${rows.length - snapshot.watchlist.length} more below the floor`;
});

check('farm_steps', () => {
  let shortest = Infinity;
  let longest = 0;
  for (const row of rows) {
    need(Array.isArray(row.farm_steps) && row.farm_steps.length >= 3 && row.farm_steps.length <= 12, `${row.slug} has ${row.farm_steps ? row.farm_steps.length : 0} farm steps`);
    for (const step of row.farm_steps) {
      need(typeof step === 'string', `${row.slug} has a farm step that is not a string`);
      const trimmed = step.trim().length;
      need(trimmed >= 20 && step.length <= 600, `${row.slug} has a farm step of ${trimmed} trimmed characters`);
      shortest = Math.min(shortest, trimmed);
      longest = Math.max(longest, step.length);
    }
  }
  return `${rows.length * 6} steps, ${shortest} to ${longest} characters`;
});

// ---------------------------------------------------------------- the dashboard

const dashboardDir = join(out, 'dashboard');
check('dashboard_files', () => {
  need(existsSync(dashboardDir), 'no dashboard/ in the output');
  const files = [];
  let bytes = 0;
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      need(!entry.name.startsWith('.') || !entry.isDirectory(), `dashboard/${rel} is a dot-directory`);
      if (entry.isFile()) {
        need(PLAIN_NAME.test(entry.name), `dashboard/${rel}: a name is letters, digits and . _ -`);
        files.push(rel);
        bytes += statSync(join(dir, entry.name)).size;
      } else if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
      }
    }
  };
  walk(dashboardDir, '');
  need(files.length <= 400, `${files.length} files, over 400`);
  need(bytes <= 4 * 1024 * 1024, `${bytes} bytes, over 4 MiB`);
  need(files.includes('index.html'), 'no index.html');
  need(files.some((f) => f.endsWith('.css')), 'no .css file');
  need(files.some((f) => f.endsWith('.js')), 'no .js file');
  for (const rel of files) {
    if (!/\.(html|css|js)$/.test(rel)) continue;
    const text = readFileSync(join(dashboardDir, rel), 'utf8');
    if (/\.html$/.test(rel)) {
      for (const m of text.matchAll(/\s(?:href|src|action|poster|data|content)=["']([^"']*)["']/gi)) {
        need(!/https?:\/\//i.test(m[1]), `dashboard/${rel} names a network address in an attribute: ${m[1]}`);
      }
    }
    if (/\.css$/.test(rel)) need(!/https?:\/\//i.test(text), `dashboard/${rel} names a network address`);
    if (/\.js$/.test(rel)) {
      need(!/https?:\/\//i.test(text), `dashboard/${rel} names a network address`);
      need(!/\bimport\s*\(/.test(text), `dashboard/${rel} has a dynamic import`);
      for (const m of text.matchAll(/\b(?:import|export)\b[^;\n]*?from\s*["']([^"']*)["']/g)) {
        need(!/^(?:https?:)?\/\//i.test(m[1]), `dashboard/${rel} imports ${m[1]}`);
      }
    }
  }
  return `${files.length} files, ${bytes} bytes, index.html plus ${files.filter((f) => f.endsWith('.css')).length} css and ${files.filter((f) => f.endsWith('.js')).length} js`;
});

// ---------------------------------------------------------------- screenshots

function pngSize(bytes) {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at < bytes.length - 9) {
    if (bytes[at] !== 0xff) { at++; continue; }
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

check('screenshots', () => {
  const dir = join(out, 'screenshots');
  need(existsSync(dir), 'no screenshots/ in the output');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  need(names.length >= 3 && names.length <= 4, `${names.length} screenshots, the gate wants 3 or 4`);
  const report = [];
  for (const name of names) {
    need(PLAIN_NAME.test(name), `screenshots/${name}: a name is letters, digits and . _ -`);
    const st = lstatSync(join(dir, name));
    need(st.isFile(), `screenshots/${name} is not a file`);
    need(st.size <= SHOT_MAX_BYTES, `screenshots/${name} is ${st.size} bytes, over 512 KiB`);
    const bytes = readFileSync(join(dir, name));
    const size = pngSize(bytes) ?? jpegSize(bytes);
    need(size !== null, `screenshots/${name} is not a whole PNG or JPEG`);
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    need(long <= 1440, `screenshots/${name} is ${size.width}x${size.height}, long side over 1440`);
    need(short >= 800, `screenshots/${name} is ${size.width}x${size.height}, short side under 800`);
    report.push(`${name} ${size.width}x${size.height} ${Math.round(st.size / 1024)}KB`);
  }
  return report.join(', ');
});

// ---------------------------------------------------------------- the dossier

check('dossier_matches', () => {
  const path = join(out, 'dossier.json');
  need(existsSync(path), 'no dossier.json in the output');
  const written = readFileSync(path);
  const rebuilt = Buffer.from(buildDossier(out, { text_max_bytes: TEXT_MAX }));
  need(written.equals(rebuilt), `dossier.json is ${written.length} bytes and buildDossier writes ${rebuilt.length}: they differ`);
  need(written.length <= 1_572_864, `dossier.json is ${written.length} bytes, over 1.5 MiB`);
  const doc = JSON.parse(written.toString('utf8'));
  need(doc.schema === 'makefun/dossier/v1', `schema is ${doc.schema}`);
  need(doc.text.length <= TEXT_MAX, `the text is ${Buffer.byteLength(doc.text)} bytes, over ${TEXT_MAX}`);
  const cut = /^\[Cut at /m.test(doc.text);
  return `${written.length} bytes, ${doc.images.length} images, text ${Buffer.byteLength(doc.text)} bytes${cut ? ' (CUT: the source is longer than the cap)' : ''}`;
});

check('source_size', () => {
  const files = ['main.ts', 'lib/model.ts', 'dashboard/index.html', 'dashboard/app.css', 'dashboard/app.js'];
  let bytes = 0;
  for (const rel of files) bytes += statSync(join(root, rel)).size;
  need(bytes < 65_536, `dashboard + main.ts + lib come to ${bytes} bytes, over 65,536`);
  return `${bytes} bytes for the page, the entrypoint and the model (vendor/ excluded: it is the kit's)`;
});

check('dossier_reads_every_source_file', () => {
  const text = readFileSync(join(out, 'dossier.json'), 'utf8');
  const doc = JSON.parse(text);
  for (const rel of readdirSync(join(out, 'dashboard'))) {
    if (!/\.(html|css|js|json|mjs|svg|md|txt)$/.test(rel)) continue;
    need(doc.text.includes(`### ${rel}`), `dossier text does not show dashboard/${rel}`);
    need(!new RegExp(`\\[\\d+ of this file's`).test(doc.text), 'the dossier cut a dashboard file: the judge would read a partial source');
  }
  return 'every dashboard source file is shown whole';
});

console.log('');
if (failed > 0) {
  console.log(`${failed} check${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('every check passed');
