// Gate check for the token-radar-01 entry: re-implements the sealed scorer's seven rows
// (dashboard_files, board_file, sorted_by_value, coverage, farm_steps, screenshots,
// dossier_matches) against a main.ts output directory and the snapshot it was built from.
// Usage: node scripts/gate-check.mjs <output-dir> [snapshot.json]
// Exit 0 when all seven pass, 1 otherwise. No network, deterministic.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2] ?? '/tmp/makefun_out';
const snapPath = process.argv[3] ?? '/home/hatch/workspace/makefun_radar/kit/input/snapshot.json';
const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const results = [];
function row(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(16)} ${detail}`);
}

// --- helpers ---
function walk(dir, base = '') {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = base === '' ? e.name : `${base}/${e.name}`;
    if (e.isDirectory()) files.push(...walk(join(dir, e.name), p));
    else if (e.isFile()) files.push(p);
  }
  return files.sort();
}
function pngSize(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// 1. dashboard_files
{
  const files = walk(join(out, 'dashboard'));
  const total = files.reduce((n, f) => n + statSync(join(out, 'dashboard', f)).size, 0);
  const hasHtml = files.includes('index.html');
  const hasCss = files.some((f) => extname(f) === '.css');
  const hasJs = files.some((f) => extname(f) === '.js');
  const nameOk = files.every((f) => f.split('/').every((part) => /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(part)) && !f.split('/').some((part) => part.startsWith('.')));
  const urlHits = [];
  for (const f of files) {
    const text = readFileSync(join(out, 'dashboard', f), 'utf8');
    if (/https?:\/\//.test(text)) urlHits.push(f);
  }
  const pass = hasHtml && hasCss && hasJs && files.length <= 400 && total <= 4_194_304 && nameOk && urlHits.length === 0;
  row('dashboard_files', pass, `${files.length} files, ${total} bytes, html=${hasHtml} css=${hasCss} js=${hasJs} names_ok=${nameOk} url_files=${urlHits.length ? urlHits.join(',') : 'none'}`);
}

// 2-5. board
const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
const rows = Array.isArray(board) ? board : board.rows;
{
  const size = statSync(join(out, 'board.json')).size;
  const bad = [];
  for (const r of rows) {
    if (!snapSlugs.has(r.slug)) bad.push(`${r.slug}: invented slug`);
    else if (typeof r.name !== 'string' || r.name.length === 0) bad.push(`${r.slug}: empty name`);
    else if (!Number.isSafeInteger(r.rank) || r.rank <= 0) bad.push(`${r.slug}: bad rank`);
    else if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) bad.push(`${r.slug}: bad implied value`);
    else if (!Array.isArray(r.farm_steps)) bad.push(`${r.slug}: no farm_steps`);
  }
  const allSame = rows.length >= 2 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd);
  const pass = rows.length >= 100 && rows.length <= 4000 && size <= 8_388_608 && bad.length === 0 && !allSame;
  row('board_file', pass, `${rows.length} rows, ${size} bytes, bad=${bad.length ? bad.slice(0, 3).join('; ') : 'none'}, all_same_value=${allSame}`);
}
{
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((v, i) => v === i + 1);
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const nonRising = byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd);
  const strictly = byRank.every((r, i) => i === 0 || r.implied_value_usd < byRank[i - 1].implied_value_usd);
  const pass = ranksOk && nonRising;
  row('sorted_by_value', pass, `ranks 1..${rows.length} exact=${ranksOk}, non-rising=${nonRising}, strictly decreasing=${strictly}`);
}
{
  const have = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  row('coverage', missing.length === 0, `${snapshot.watchlist.length} watchlist slugs, missing=${missing.length ? missing.join(',') : 'none'}`);
}
{
  const bad = [];
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) bad.push(`${r.slug}: ${r.farm_steps.length} steps`);
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) bad.push(`${r.slug}: step ${t.length} chars`);
    }
  }
  row('farm_steps', bad.length === 0, `6 steps/row, bad=${bad.length ? bad.slice(0, 3).join('; ') : 'none'}`);
}

// 6. screenshots
{
  const names = readdirSync(join(out, 'screenshots')).filter((n) => !n.startsWith('.')).sort();
  const bad = [];
  for (const n of names) {
    const buf = readFileSync(join(out, 'screenshots', n));
    const dims = pngSize(buf) ?? jpegSize(buf);
    if (!dims) bad.push(`${n}: not PNG/JPEG`);
    else {
      const long = Math.max(dims.w, dims.h), short = Math.min(dims.w, dims.h);
      if (buf.length > 524_288) bad.push(`${n}: ${buf.length} bytes over 512KiB`);
      if (long > 1440) bad.push(`${n}: long side ${long}`);
      if (short < 800) bad.push(`${n}: short side ${short}`);
    }
  }
  const pass = names.length >= 3 && names.length <= 4 && bad.length === 0;
  row('screenshots', pass, `${names.length} images (${names.join(', ')}), bad=${bad.length ? bad.join('; ') : 'none'}`);
}

// 7. dossier_matches
{
  const actual = readFileSync(join(out, 'dossier.json'));
  let pass = false, detail = '';
  try {
    const expected = buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
    pass = Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0;
    detail = `${actual.length} bytes, byte-identical=${pass}, under 1.5MiB=${actual.length <= 1_572_864}`;
    if (actual.length > 1_572_864) pass = false;
  } catch (e) {
    detail = `buildDossier threw: ${e.message}`;
  }
  row('dossier_matches', pass, detail);
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length === 0 ? 'GATE: 7/7 pass' : `GATE: ${7 - failed.length}/7 pass — failed: ${failed.map((r) => r.name).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
