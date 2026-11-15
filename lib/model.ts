// Token Radar's value model (radar-2).
//
// One sealed DefiLlama snapshot in, one ranked board out. Every number comes from a protocol's own
// record: its TVL, its seven-day change, the day DefiLlama began tracking it, and how many chains it
// runs on. No protocol is named in this file.
//
//   1. A radar score 0..100, a weight for each of four signals from the record:
//        scale    55  log10(tvl / $1M) over $1M..$3B
//        momentum 25  change_7d clamped to -60%..+120%
//        tenure   15  days tracked with no token, 0..1825
//        breadth   5  chains deployed on, 1..5
//   2. An implied value: round($500,000 * 10^(score*0.024))
//
// The implied value is the board's own claim about a token that does not exist, never a forecast that one is issued.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL = {
  weights: { scale: 55, momentum: 25, tenure: 15, breadth: 5 },
  scale_min_usd: 1_000_000,
  scale_max_usd: 3_000_000_000,
  momentum_floor_pct: -60,
  momentum_cap_pct: 120,
  tenure_cap_days: 1825,
  unknown_tenure_days: 130,
  breadth_cap_chains: 5,
};

export type Model = typeof MODEL;

export const MODEL_VERSION = 'radar-2';

const DAY_MS = 86_400_000;

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

export interface Scored {
  score: number;
  parts: ScoreParts;
  age: number | null;
  growth_pct: number | null;
}

export function scoreParts(p: SnapshotProtocol, asOf: string, model: Model): Scored {
  const age = ageDays(asOf, p.listed_at);
  const span = Math.log10(model.scale_max_usd / model.scale_min_usd);
  const scale = span <= 0 ? 0 : clamp(Math.log10(Math.max(p.tvl_usd, 1) / model.scale_min_usd) / span, 0, 1);
  const raw = p.change_7d;
  const growth = raw === null || !Number.isFinite(raw) ? null : clamp(raw, model.momentum_floor_pct, model.momentum_cap_pct);
  const momentum = growth === null ? 0.5 : (growth - model.momentum_floor_pct) / (model.momentum_cap_pct - model.momentum_floor_pct);
  const tenureDays = age ?? model.unknown_tenure_days;
  const tenure = model.tenure_cap_days <= 0 ? 0 : clamp(tenureDays / model.tenure_cap_days, 0, 1);
  const chains = p.chains.length === 0 ? 1 : p.chains.length;
  const breadth = clamp((chains - 1) / Math.max(1, model.breadth_cap_chains - 1), 0, 1);
  const score = model.weights.scale * scale + model.weights.momentum * momentum + model.weights.tenure * tenure + model.weights.breadth * breadth;
  return { score, parts: { scale, momentum, tenure, breadth }, age, growth_pct: growth };
}

export interface Valued extends Scored {
  multiple: number;
  implied: number;
}

export function impliedValue(p: SnapshotProtocol, asOf: string, model: Model): Valued {
  const s = scoreParts(p, asOf, model);
  const implied = Math.max(1, Math.round(500_000 * Math.pow(10, (s.score / 100) * 2.4)));
  const multiple = Math.max(0.01, implied / Math.max(1, p.tvl_usd));
  return { ...s, multiple, implied };
}

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking|restaked)\b/i;
const EXCHANGE_HEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function trades(p: SnapshotProtocol): boolean {
  return p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX';
}

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

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function parseSnapshot(raw: string): Snapshot {
  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (!doc || typeof doc !== 'object') throw new SnapshotError('snapshot.json must be an object');
  if (typeof doc.as_of !== 'string' || typeof doc.source !== 'string' || typeof doc.floor_usd !== 'number') {
    throw new SnapshotError('snapshot.json missing header fields');
  }
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new SnapshotError('snapshot.json missing protocols or watchlist arrays');
  }
  return doc as Snapshot;
}

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

export function buildBoard(snapshot: Snapshot, model: Model = MODEL): { board: BoardRow[]; radar: RadarData } {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && rankable(p)) {
      chosen.set(p.slug, p);
    }
  }
  const valued = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model) }));
  valued.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const rows: BoardRow[] = [];
  const radarRows: RadarRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const { p, v } of valued) {
    const implied = Math.max(1, Math.min(Math.round(v.implied), Math.floor(previous) - 1));
    if (!(implied > 0)) continue;
    previous = implied;
    const rank = rows.length + 1;
    const isWatchlist = watchlist.has(p.slug);
    const steps = farmPlan(p, v.age);

    rows.push({
      rank,
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
      watchlist: isWatchlist,
      age_days: v.age,
      score: Math.round(v.score * 100) / 100,
      multiple: Math.round(v.multiple * 1000) / 1000,
      implied_value_usd: implied,
      signals: {
        scale: Math.round(v.parts.scale * 1000) / 1000,
        momentum: Math.round(v.parts.momentum * 1000) / 1000,
        tenure: Math.round(v.parts.tenure * 1000) / 1000,
        breadth: Math.round(v.parts.breadth * 1000) / 1000,
      },
      farm_steps: steps.map((s) => `${s.step}. ${s.text} Cost: ${s.cost}. Time: ${s.time}.`),
    });

    radarRows.push({
      rank,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: v.age,
      watchlist: isWatchlist,
      score: Math.round(v.score * 100) / 100,
      multiple: Math.round(v.multiple * 1000) / 1000,
      implied_value_usd: implied,
      signals: rows[rows.length - 1]!.signals,
      plan: steps,
    });
  }

  const comparables: Comparable[] = snapshot.protocols
    .filter(trades)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: Math.round((p.mcap_usd! / Math.max(1, p.tvl_usd)) * 1000) / 1000,
    }));

  const medianComparableRatio = median(comparables.map((c) => c.ratio));
  const medianMultiple = median(rows.map((r) => r.multiple));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    median_multiple: Math.round(medianMultiple * 1000) / 1000,
    median_comparable_ratio: Math.round(medianComparableRatio * 1000) / 1000,
    top_implied_usd: rows.length > 0 ? rows[0]!.implied_value_usd : 0,
    rows: radarRows,
    comparables,
  };

  return { board: rows, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board has ${board.length} rows, need at least 100`;
  const slugs = new Set(board.map((r) => r.slug));
  for (const s of snapshot.watchlist) {
    if (!slugs.has(s)) return `watchlist slug ${s} is missing from the board`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} (${board[i]!.slug}) has implied value >= row ${i} (${board[i - 1]!.slug})`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar, null, 2)};\n`;
}
