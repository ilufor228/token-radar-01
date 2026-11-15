// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol that passes the watchlist's own eligibility rule, not a hand-kept
// list of names: pre-token (DefiLlama records no token), not a wrapped / staked / bridged product,
// not a CEX, not a versioned pool, and not named after an exchange. That rule is the whole
// selection: the 40 watchlist protocols plus every rankable protocol below the $50M floor — 178
// rows in this snapshot. A protocol below the floor is no worse a subject than one on it, and the
// floor is never the whole board. Live-token protocols are kept apart in the dashboard's Live view
// with their market caps, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, as four scored components:
//
//   tvlScore     = 100 * (log10(tvl_usd) - log10(5,000,000)) / (log10(3,000,000,000) - log10(5,000,000)), clamped 0..100
//                  (log scale: a $2.7B protocol is not worth 500x a $5M one as a launch)
//   growthScore  = 100 * (clamp(change_7d, -60, 120) + 60) / 180, clamped 0..100
//   ageScore     = 100 * min(age_days, 1825) / 1825            (age unknown: 365 days)
//   breadthScore = 100 * min(chains, 8) / 8
//   total        = 0.55*tvlScore + 0.25*growthScore + 0.15*ageScore + 0.05*breadthScore   (0..100)
//   implied      = round(500,000 * 10^(total * 0.024))
//
// Every row carries its four component scores and its total, so the dashboard can show the
// breakdown and the page recomputes the same total. Implied values are forced strictly
// decreasing down the ranks (a tied score loses $1 to the row above it), so rank 1 is always the
// most valuable and no two rows share a value. No protocol name is ever special-cased: the same
// function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  tvl_floor_usd: number;
  tvl_cap_usd: number;
  growth_floor: number;
  growth_cap: number;
  age_cap_days: number;
  unknown_age_days: number;
  chains_cap: number;
  weight_tvl: number;
  weight_growth: number;
  weight_age: number;
  weight_breadth: number;
  implied_base_usd: number;
  implied_exponent: number;
}

export const MODEL: ModelConstants = {
  tvl_floor_usd: 5_000_000,
  tvl_cap_usd: 3_000_000_000,
  growth_floor: -60,
  growth_cap: 120,
  age_cap_days: 1825,
  unknown_age_days: 365,
  chains_cap: 8,
  weight_tvl: 0.55,
  weight_growth: 0.25,
  weight_age: 0.15,
  weight_breadth: 0.05,
  implied_base_usd: 500_000,
  implied_exponent: 0.024,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row's score breakdown: the four components and their weighted total, each 0..100. */
export interface ScoreBreakdown {
  tvl: number;
  growth: number;
  age: number;
  breadth: number;
  total: number;
}

/** One row of board.json: the ranked board's row. */
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
  token_status: 'pre-token';
  has_token: boolean;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  score: ScoreBreakdown;
  model: {
    growth_pct: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  score: ScoreBreakdown;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The four component scores and the weighted total for one protocol. */
export function scoreProtocol(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { score: ScoreBreakdown; growthPct: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const tvl = clamp(100 * (Math.log10(Math.max(1, protocol.tvl_usd)) - Math.log10(model.tvl_floor_usd)) / (Math.log10(model.tvl_cap_usd) - Math.log10(model.tvl_floor_usd)), 0, 100);
  const growth = clamp(100 * (growthPct - model.growth_floor) / (model.growth_cap - model.growth_floor), 0, 100);
  const ageForModel = age ?? model.unknown_age_days;
  const ageScore = clamp(100 * Math.min(Math.max(ageForModel, 0), model.age_cap_days) / model.age_cap_days, 0, 100);
  const breadth = clamp(100 * Math.min(protocol.chains.length, model.chains_cap) / model.chains_cap, 0, 100);
  const total = model.weight_tvl * tvl + model.weight_growth * growth + model.weight_age * ageScore + model.weight_breadth * breadth;
  return {
    score: { tvl: round2(tvl), growth: round2(growth), age: round2(ageScore), breadth: round2(breadth), total: round2(total) },
    growthPct,
    age,
  };
}

/** The implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; score: ScoreBreakdown; growthPct: number; age: number | null } {
  const { score, growthPct, age } = scoreProtocol(protocol, asOf, model);
  const implied = Math.max(1, Math.round(model.implied_base_usd * Math.pow(10, score.total * model.implied_exponent)));
  return { implied, score, growthPct, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or bridged product is not a token that does not exist yet. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories the watchlist rule leaves out. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a protocol name must not begin with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's own
 * eligibility rule — not a wrapped/staked/bridged product, not a CEX, not a versioned pool, not
 * named after an exchange. WBTC is Bitcoin on Ethereum and Binance staked ETH is ETH in a staking
 * product; neither is a protocol still waiting on a launch of its own.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly decreasing values. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries
  // (it cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable protocol below the watchlist floor, not just the biggest 160.
  // The rule is the whole selection, so nothing here is hand-picked.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, score, growthPct, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, score, growthPct, age };
  });
  scored.sort((a, b) => b.score.total - a.score.total || b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Strictly decreasing implied values: a tied score loses $1 to the row above it, so rank 1 is
  // always the most valuable and no two rows share a value.
  let prev = Number.POSITIVE_INFINITY;
  const rows = scored.map((s, i) => {
    const implied = Math.min(s.implied, prev - 1);
    prev = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      has_token: false,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      age_days: s.age,
      implied_value_usd: Math.max(1, implied),
      score: s.score,
      model: { growth_pct: s.growthPct, age_days: s.age },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
  return rows;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Typical gas for one transaction on a chain, in whole US dollars (DefiLlama's chain names). */
const GAS_USD: Record<string, number> = {
  ethereum: 4, solana: 0.05, base: 0.15, arbitrum: 0.3, optimism: 0.2, polygon: 0.05,
  binance: 0.25, avalanche: 0.3, 'hyperliquid l1': 0.05, monad: 0.05, plasma: 0.1,
  berachain: 0.1, sui: 0.05, aptos: 0.05, gnosis: 0.1, linea: 0.1, scroll: 0.15,
  zksync: 0.15, blast: 0.1, mode: 0.05, 'robinhood chain': 0.05, ink: 0.05,
  unichain: 0.1, worldchain: 0.1, sei: 0.05, near: 0.02, tron: 0.5, bitcoin: 2,
  'lightning network': 0.01, katana: 0.1, arc: 0.1, tempo: 0.1, stable: 0.1, corn: 0.1,
  morph: 0.1, cronos: 0.1, celo: 0.05, 'arbitrum nova': 0.1, mantle: 0.1, taiko: 0.15,
};
const DEFAULT_GAS_USD = 1.5;

/** Gas for one transaction on `chain`, in US dollars. */
export function gasUsd(chain: string): number {
  return GAS_USD[chain.toLowerCase()] ?? DEFAULT_GAS_USD;
}

function money(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL and age), never from a hand-written list
 * of names. Gas is priced per chain, capital scales with TVL, and the hold scales with age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasUsd(chain);
  const gas2 = chain2 === null ? gas : gasUsd(chain2);
  const capital = capitalFor(p);
  const secondCapital = capital >= 150 ? 50 : 25;
  const hold = holdDaysFor(age);
  const gas6 = money(gas * 6);
  const action = actionFor(p, capital, chain);
  const second: FarmStep =
    chain2 === null
      ? {
          text: `Make a second qualifying action on ${chain} in the same week, such as a swap, a borrow or a vote.`,
          cost: `about ${money(gas)} of gas`,
          time: '10 minutes',
        }
      : {
          text: `Repeat a smaller $${secondCapital} position on ${chain2} so the same wallet is active on a second chain.`,
          cost: `$${secondCapital} of capital and about ${money(gas2)} of gas`,
          time: '10 minutes',
        };
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and fund it with enough ${chain} gas for about six transactions.`,
      cost: `about ${gas6} in gas`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about ${money(gas)} of gas`,
      time: '15 minutes to set up',
    },
    second,
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active across snapshots.`,
      cost: `about ${money(gas)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, then open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check; never pay to claim',
      time: `${hold} days of holding, 10 minutes to check`,
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and unwind in reverse order when you exit.`,
      cost: `about ${money(gas)} of gas to unwind`,
      time: '5 minutes to log, 10 minutes to exit',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
    score: row.score,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
