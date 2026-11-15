// Token Radar's value model (radar-3).
//
// One sealed DefiLlama snapshot in, one ranked board out. Every number comes from a protocol's own
// record: its TVL, its seven-day change, the day DefiLlama began tracking it, and how many chains it
// runs on. No protocol is named in this file.
//
//   1. A radar score 0..100, a weight for each of four signals from the record:
//        scale    52  log10(tvl / $1M) over $1M..$3B
//        momentum 22  change_7d clamped to -60%..+120%
//        tenure   18  days tracked with no token, 0..1825
//        breadth   8  chains deployed on, 1..5
//   2. An implied value: TVL times a multiple the score sets inside a fixed band,
//        multiple = 0.08 * e^(2.9 * score / 100)      about 0.08x to 1.45x TVL
//        implied_value_usd = round(tvl_usd * multiple)
//
// The band is anchored on the market: token-bearing protocols in this same snapshot trade at a median
// market-cap-to-TVL near 0.25x (the page states the figure it computes), so a pre-token protocol is
// priced inside the range its trading peers already occupy and moved within it by momentum, tenure and
// chain breadth. The implied value is the board's own claim about a token that does not exist, never a
// forecast that one is issued.

/** One protocol, exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// radar-3: the model every number on the board comes from.
export const MODEL = {
  weights: { scale: 52, momentum: 22, tenure: 18, breadth: 8 },
  multiple_floor: 0.08,
  multiple_spread: 2.9,
  scale_min_usd: 1_000_000,
  scale_max_usd: 3_000_000_000,
  momentum_floor_pct: -60,
  momentum_cap_pct: 120,
  tenure_cap_days: 1825,
  unknown_tenure_days: 130,
  breadth_cap_chains: 5,
};

/** What a model is: the constant above, or one the page's sliders make. */
export type Model = typeof MODEL;

export const MODEL_VERSION = 'radar-3';

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, low: number, high: number): number {
  return n < low ? low : n > high ? high : n;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export interface ScoreParts {
  scale: number;
  momentum: number;
  tenure: number;
  breadth: number;
}

/** One protocol's radar score under `model`. */
export interface Scored {
  score: number;
  parts: ScoreParts;
  age: number | null;
  growth_pct: number | null;
}

export function scoreParts(p: SnapshotProtocol, asOf: string, model: Model): Scored {
  const age = ageDays(asOf, p.listed_at);
  // Scale: a log ladder, because protocol size is multiplicative, not additive.
  const span = Math.log10(model.scale_max_usd / model.scale_min_usd);
  const scale = span <= 0 ? 0 : clamp(Math.log10(Math.max(p.tvl_usd, 1) / model.scale_min_usd) / span, 0, 1);
  // Momentum: where the week's change sits between the floor and the cap; no reading is neutral.
  const raw = p.change_7d;
  const growth = raw === null || !Number.isFinite(raw) ? null : clamp(raw, model.momentum_floor_pct, model.momentum_cap_pct);
  const momentum = growth === null ? 0.5 : (growth - model.momentum_floor_pct) / (model.momentum_cap_pct - model.momentum_floor_pct);
  // Tenure: how long it has run while carrying no token, capped; no start date reads as young.
  const tenureDays = age ?? model.unknown_tenure_days;
  const tenure = model.tenure_cap_days <= 0 ? 0 : clamp(tenureDays / model.tenure_cap_days, 0, 1);
  // Breadth: how many chains it is deployed on.
  const chains = p.chains.length === 0 ? 1 : p.chains.length;
  const breadth = clamp((chains - 1) / Math.max(1, model.breadth_cap_chains - 1), 0, 1);
  const total = model.weights.scale + model.weights.momentum + model.weights.tenure + model.weights.breadth;
  const scale100 = total <= 0 ? 0 : 100;
  const score = (model.weights.scale * scale + model.weights.momentum * momentum + model.weights.tenure * tenure + model.weights.breadth * breadth) * (scale100 / (total || 1));
  return { score, parts: { scale, momentum, tenure, breadth }, age, growth_pct: growth };
}

export function multipleFor(score: number, model: Model): number {
  return model.multiple_floor * Math.exp((model.multiple_spread * clamp(score, 0, 100)) / 100);
}

export interface Valued extends Scored {
  multiple: number;
  implied: number;
}

export function impliedValue(p: SnapshotProtocol, asOf: string, model: Model): Valued {
  const s = scoreParts(p, asOf, model);
  const multiple = multipleFor(s.score, model);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  return { ...s, multiple, implied };
}

// DefiLlama's release markers: a name ending in one is a pool of another protocol, not a candidate.
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
// A wrapped, staked or restaked product of a token that already trades.
const PRODUCT_WORD = /\b(wrapped|staked|staking|restaked)\b/i;
// An exchange's own brand on a product it issues.
const EXCHANGE_HEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
// Categories whose members are a receipt for another protocol's asset, not a protocol.
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function trades(p: SnapshotProtocol): boolean {
  return p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX';
}

// The watchlist's own rule, minus the part of it the snapshot does not carry (DefiLlama's parent
// protocol), applied to the whole universe: no token recorded, and no product of one that trades.
export function rankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORY.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_HEAD.test(p.name)) return false;
  return true;
}

export interface FarmStep {
  step: number;
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'records-no-token';
  watchlist: boolean;
  age_days: number | null;
  score: number;
  multiple: number;
  implied_value_usd: number;
  signals: { scale: number; momentum: number; tenure: number; breadth: number };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  score: number;
  multiple: number;
  implied_value_usd: number;
  signals: BoardRow['signals'];
  plan: FarmStep[];
}

export interface Comparable {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: Model;
  scanned: number;
  watchlist_size: number;
  board_size: number;
  median_multiple: number;
  median_comparable_ratio: number;
  top_implied_usd: number;
  rows: RadarRow[];
  comparables: Comparable[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function stepText(step: FarmStep): string {
  let text = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (text.length > 600) text = `${text.slice(0, 596)}...`;
  if (text.length < 20) text = `${text} Log the transaction so the position can be repeated.`;
  return text;
}

// One transaction's cost by chain, in cents. A table about chains, never protocols: a cheap chain
// makes a small farm worth running, an expensive one makes batching worth it.
const CHAIN_GAS_CENTS: Record<string, number> = Object.fromEntries(
  ('ethereum:420 solana:2 base:3 arbitrum:6 optimism:6 binance:25 polygon:4 avalanche:9 tron:130 ' +
    'bitcoin:90 monad:3 hyperliquid:2 ink:3 unichain:3 berachain:4 scroll:8 mantle:3 linea:6 sui:2 ' +
    'aptos:2 sei:1 sonic:2 flare:4 stellar:1 plasma:2 katana:2 tempo:2 starknet:4 zksync:5 mode:3 ' +
    'bob:4 mezo:3 rsk:5 bitlayer:3 core:4 hemi:4 pharos:4 arc:3 robinhood:2 fantom:3 gnosis:3 celo:3')
    .split(' ')
    .map((pair) => pair.split(':') as [string, number]),
);

export function gasCents(chain: string | undefined): { cents: number; known: boolean } {
  const key = (chain ?? '').toLowerCase().trim();
  const hit = CHAIN_GAS_CENTS[key];
  if (hit !== undefined) return { cents: hit, known: true };
  if (key.includes('chain') && CHAIN_GAS_CENTS[key.replace(/\s*chain$/, '')] !== undefined) {
    return { cents: CHAIN_GAS_CENTS[key.replace(/\s*chain$/, '')]!, known: true };
  }
  return { cents: 35, known: false };
}

const dollars = (cents: number): string => (cents / 100).toFixed(2);

// $50 to $250, from the protocol's own scale.
export function capitalFor(tvl: number): number {
  if (tvl >= 3_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 200;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 15_000_000) return 75;
  return 50;
}

export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 120) return 90;
  if (age < 365) return 60;
  if (age < 1095) return 45;
  return 30;
}

function positionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager'))
    return `Deposit $${capital} of USDC into one of ${name}'s vaults on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('rwa'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open rather than looping it.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('farm') || c.includes('basis'))
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('interest rate'))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and keep one small position open.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} and keep one open market position, not a settled one.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('payment') || c.includes('card'))
    return `Move $${capital} of USDC through ${name} on ${chain} and keep the account active.`;
  if (c.includes('index'))
    return `Mint $${capital} of ${name}'s index on ${chain} and hold the shares in the same wallet.`;
  if (c.includes('governance'))
    return `Deposit $${capital} into ${name} on ${chain} and vote on one proposal with the position.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

// Six steps, each with its cost and its time, from the protocol's own record: category, chains, TVL, age.
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasCents(p.chains[0]);
  const cheapGas = gas.cents <= 10;
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const weekly = Math.max(1, Math.round(gas.cents * 2));
  const setup = Math.round(gas.cents * 3 + 60);
  const ageLine = age === null ? 'the record gives no start date, so treat it as young' : `it has run ${age} days without a token`;
  return [
    {
      step: 1,
      text: `Make a fresh wallet for this position alone on ${chain} and fund it with $${capital} plus $${dollars(setup)} of gas; keep the seed phrase offline and off any device you browse from.`,
      cost: `$${capital} of capital and about $${dollars(setup)} of ${chain} fees`,
      time: '10 minutes',
    },
    {
      step: 2,
      text: positionFor(p, capital, chain),
      cost: `$${capital} and about $${dollars(gas.cents)} of gas for the deposit`,
      time: '15 minutes',
    },
    {
      step: 3,
      text: cheapGas
        ? `Make one qualifying action a week (a deposit, a borrow, a swap or a vote) while fees on ${chain} stay under a dollar a transaction.`
        : `Batch your qualifying actions into one transaction a week: ${chain} fees make daily activity expensive at about $${dollars(gas.cents)} a transaction.`,
      cost: `about $${dollars(weekly)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      step: 4,
      text: `Keep the position open for at least ${hold} days: ${ageLine}, so activity spread over more than one month is what a points or snapshot programme can see.`,
      cost: `the $${capital} stays in the position for ${hold} days`,
      time: `${hold} days`,
    },
    {
      step: 5,
      text: `Once a month open ${p.name}'s own site or docs from a bookmark you saved yourself and check for a points, rewards or snapshot page; claim only where that page says to.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    },
    {
      step: 6,
      text: `Write the wallet address, each transaction hash, the ${chain} fee you paid and the date in one log, and set the exit rule now: unwind if TVL halves or the position is worth under $${Math.round(capital * 0.8)}.`,
      cost: 'nothing but the log',
      time: '5 minutes now, then on each withdrawal',
    },
  ];
}

export function buildBoard(snapshot: Snapshot, model: Model = MODEL): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  // The watchlist is the floor: every slug on it is ranked, whether or not the wider rule keeps it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && rankable(p)) chosen.set(p.slug, p);
  }
  const valued = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model) }));
  valued.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const { p, v } of valued) {
    // Two protocols can round to the same dollar; the gate wants a strict ranking, so the lower one
    // steps down by a dollar. Under this model they differ by thousands, so this is a guard, not a rule.
    const implied = Math.max(1, Math.min(Math.round(v.implied), Math.floor(previous) - 1));
    if (!(implied > 0)) continue;
    previous = implied;
    rows.push({
      rank: rows.length + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'records-no-token',
      watchlist: watchlist.has(p.slug),
      age_days: v.age,
      score: round4(v.score),
      multiple: round6(v.multiple),
      implied_value_usd: implied,
      signals: {
        scale: round4(v.parts.scale),
        momentum: round4(v.parts.momentum),
        tenure: round4(v.parts.tenure),
        breadth: round4(v.parts.breadth),
      },
      farm_steps: farmPlan(p, v.age).map(stepText),
    });
  }
  return rows;
}

export function comparables(snapshot: Snapshot, limit = 12): { rows: Comparable[]; median_ratio: number } {
  const live = snapshot.protocols.filter(trades).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!,
    ratio: round6(p.mcap_usd! / p.tvl_usd),
  }));
  const median_ratio = round6(median(live.map((r) => r.ratio)));
  return { rows: live.sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, limit), median_ratio };
}

export function buildRadar(snapshot: Snapshot, model: Model = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = comparables(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    median_multiple: round6(median(board.map((r) => r.multiple))),
    median_comparable_ratio: comps.median_ratio,
    top_implied_usd: board.length > 0 ? board[0]!.implied_value_usd : 0,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      watchlist: row.watchlist,
      score: row.score,
      multiple: row.multiple,
      implied_value_usd: row.implied_value_usd,
      signals: row.signals,
      plan: farmPlan(
        snapshot.protocols.find((p) => p.slug === row.slug)!,
        row.age_days,
      ),
    })),
    comparables: comps.rows,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} (${board[i]!.implied_value_usd}) does not sit below row ${i} (${board[i - 1]!.implied_value_usd})`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

// data.js: the whole dataset as one script, no fetch and no network.
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
