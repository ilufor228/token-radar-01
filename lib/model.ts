// radar-2: the pricing model. A protocol is scored 0-100 on how much it looks like a
// launch is coming, then that score is turned into one number, an implied value in USD.
//
//   scale      55%  log10(TVL) mapped from $50M to $10B
//   momentum   25%  the 7d TVL change, clamped to -60% .. +120%
//   tenure     15%  days listed with no token, capped at 5 years
//   breadth     5%  how many chains the protocol runs on, 1 chain counts 0
//
// implied value = round(500,000 * 10 ** (0.05 * score)), so the ladder runs from about
// $1.6M at a score of 10 to $50B at 100, and a $2.7B protocol near 0.65x covers TVL.
//
// Nothing here knows a protocol by name: every number comes out of the snapshot row.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
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
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Signals {
  scale: number;
  momentum: number;
  tenure: number;
  breadth: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  watchlist: boolean;
  age_days: number | null;
  score: number;
  multiple: number | null;
  implied_value_usd: number;
  signals: Signals;
  farm_steps: string[];
}

export const MODEL = 'radar-2';
export const WEIGHTS = { scale: 0.55, momentum: 0.25, tenure: 0.15, breadth: 0.05 } as const;
export const GROWTH_MIN = -0.6;
export const GROWTH_MAX = 1.2;
export const TVL_MIN = 50_000_000;
export const TVL_MAX = 10_000_000_000;
export const TENURE_CAP_DAYS = 365 * 5;
export const BASE_USD = 500_000;
export const SCORE_EXP = 0.05;
export const MIN_ROWS = 100;
export const MIN_STEPS = 3;
export const MAX_STEPS = 12;
export const STEP_MIN_CHARS = 20;
export const STEP_MAX_CHARS = 600;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Read the sealed snapshot and refuse one that cannot be scored. */
export function parseSnapshot(raw: string): Snapshot {
  const body = JSON.parse(raw) as Partial<Snapshot>;
  if (!Array.isArray(body.protocols) || body.protocols.length === 0) {
    throw new Error('snapshot: no protocols array');
  }
  if (!Array.isArray(body.watchlist)) throw new Error('snapshot: no watchlist array');
  const floor = typeof body.floor_usd === 'number' && body.floor_usd > 0 ? body.floor_usd : TVL_MIN;
  const protocols: SnapshotProtocol[] = [];
  for (const row of body.protocols) {
    if (typeof row?.slug !== 'string' || typeof row.name !== 'string') continue;
    if (typeof row.tvl_usd !== 'number' || !Number.isFinite(row.tvl_usd)) continue;
    protocols.push({
      slug: row.slug,
      name: row.name,
      category: typeof row.category === 'string' ? row.category : 'Unknown',
      chains: Array.isArray(row.chains) ? row.chains.filter((c) => typeof c === 'string') : [],
      tvl_usd: row.tvl_usd,
      change_7d: typeof row.change_7d === 'number' ? row.change_7d : null,
      mcap_usd: typeof row.mcap_usd === 'number' ? row.mcap_usd : null,
      listed_at: typeof row.listed_at === 'string' ? row.listed_at : null,
      gecko_id: typeof row.gecko_id === 'string' ? row.gecko_id : null,
      symbol: typeof row.symbol === 'string' ? row.symbol : null,
    });
  }
  return {
    as_of: typeof body.as_of === 'string' ? body.as_of : '',
    floor_usd: floor,
    protocols,
    watchlist: body.watchlist.filter((s): s is string => typeof s === 'string'),
  };
}

/** A protocol with no token recorded: no ticker and no CoinGecko id. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.symbol !== null || p.gecko_id !== null;
}

/**
 * Wrapped, staked and bridged products borrow another token's value: they are not a launch,
 * which is why the brief puts them out of scope. A bridge's TVL is other chains' assets in
 * transit, and a receipt token's value is the asset behind it.
 */
export function isDerivative(p: SnapshotProtocol): boolean {
  const { name, category } = p;
  if (/^(bridge|bridges)$/i.test(category)) return true;
  return /(wrapped|staked|bridged|liquid staking receipt|restaking receipt)/i.test(`${name} ${category}`);
}

/** On the board: no token, not a derivative, and either at the floor or named on the watchlist. */
export function isEligible(p: SnapshotProtocol, snapshot: Snapshot): boolean {
  if (hasToken(p)) return false;
  if (isDerivative(p)) return false;
  return p.tvl_usd >= snapshot.floor_usd || snapshot.watchlist.includes(p.slug);
}

/** Days since the snapshot row says the protocol was listed, or null when it says nothing. */
export function ageDays(listedAt: string | null, now: number): number | null {
  if (!listedAt) return null;
  const at = Date.parse(listedAt);
  if (!Number.isFinite(at)) return null;
  const days = Math.floor((now - at) / 86_400_000);
  return days < 0 ? null : days;
}

export function scaleSignal(tvl: number): number {
  if (!(tvl > 0)) return 0;
  const lo = Math.log10(TVL_MIN);
  const hi = Math.log10(TVL_MAX);
  return clamp((Math.log10(tvl) - lo) / (hi - lo), 0, 1);
}

/**
 * The snapshot keeps change_7d as a percentage (-2.19 is a 2.19% fall), so it is divided by
 * 100 before the clamp. A protocol the snapshot does not track sits in the middle.
 */
export function momentumSignal(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 0.5;
  const change = change7d / 100;
  return clamp((change - GROWTH_MIN) / (GROWTH_MAX - GROWTH_MIN), 0, 1);
}

export function tenureSignal(days: number | null): number {
  if (days === null) return 0.4;
  return clamp(days / TENURE_CAP_DAYS, 0, 1);
}

export function breadthSignal(chains: string[]): number {
  if (chains.length <= 1) return 0;
  return clamp((chains.length - 1) / 9, 0, 1);
}

export function signalsFor(p: SnapshotProtocol, now: number): Signals {
  return {
    scale: round4(scaleSignal(p.tvl_usd)),
    momentum: round4(momentumSignal(p.change_7d)),
    tenure: round4(tenureSignal(ageDays(p.listed_at, now))),
    breadth: round4(breadthSignal(p.chains)),
  };
}

/** The weighted score, 0 to 100. */
export function scoreFor(s: Signals): number {
  const total =
    WEIGHTS.scale * s.scale +
    WEIGHTS.momentum * s.momentum +
    WEIGHTS.tenure * s.tenure +
    WEIGHTS.breadth * s.breadth;
  return Math.round(clamp(total, 0, 1) * 10_000) / 100;
}

/** The one number the board ranks on. */
export function impliedValue(score: number): number {
  return Math.round(BASE_USD * 10 ** (SCORE_EXP * clamp(score, 0, 100)));
}

/** Capital band by tier: tier 1 is the top of the board and takes the largest band. */
export function capitalForTier(tier: number): number {
  return [250, 180, 100, 50][clamp(tier, 1, 4) - 1]!;
}

/** About what one transaction costs on a chain, in dollars. */
export function gasFor(chain: string): number {
  const table: Record<string, number> = {
    Ethereum: 3.4,
    Arbitrum: 0.09,
    Base: 0.03,
    Optimism: 0.05,
    Polygon: 0.02,
    Solana: 0.001,
    Avalanche: 0.08,
    BNB: 0.12,
    Gnosis: 0.02,
    Linea: 0.06,
    Scroll: 0.07,
    Blast: 0.04,
    Mantle: 0.03,
    Sonic: 0.02,
    Berachain: 0.04,
    Unichain: 0.02,
    Monad: 0.01,
  };
  return table[chain] ?? 0.15;
}

const money = (n: number): string => `$${n < 1 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`;

/** The chain with the cheapest gas among the ones the protocol runs on. */
export function cheapestChain(chains: string[]): string {
  if (chains.length === 0) return 'Ethereum';
  return [...chains].sort((a, b) => gasFor(a) - gasFor(b))[0]!;
}

/**
 * Six steps for entering the position, priced in the protocol's cheapest chain's gas and
 * in the capital band that goes with its rank. Each step stands alone, so a reader can
 * start at any of them, and none of them is advice to spend money the reader does not have.
 */
export function farmPlan(p: SnapshotProtocol, tier: number, watchlist: boolean): string[] {
  const capital = capitalForTier(tier);
  const chain = cheapestChain(p.chains);
  const gas = gasFor(chain);
  const weeks = watchlist ? 8 : 6;
  const years = ageDays(p.listed_at, Date.now());
  const keep = Math.max(30, Math.min(90, Math.round((years ?? 180) / 6)));
  return [
    `Make a wallet that holds this position only, on ${chain}, and fund it with ${money(capital)} plus ${money(gas * 6)} of gas. Keep the seed phrase offline and never on a device you browse from. Cost: ${money(capital)} of capital and about ${money(gas * 6)} of ${chain} fees. Time: 10 minutes.`,
    `Put ${money(capital)} into ${p.name} itself, in one position rather than several, and leave the receipt token in that same wallet. Cost: ${money(capital)} and about ${money(gas)} of ${chain} gas. Time: 15 minutes.`,
    `Do one qualifying action a week inside ${p.name} (a deposit, a withdrawal, a borrow or a vote) for ${weeks} weeks, so the wallet has a history rather than one deposit. Cost: about ${money(gas)} a week in ${chain} gas. Time: 10 minutes a week.`,
    `Hold the position for at least ${keep} days. ${p.name} has run ${years ?? 'several hundred'} days with no token, so tenure is part of what it is being priced on, and a two-week position scores nothing. Cost: none beyond keeping the capital in place. Time: ${keep} days.`,
    `Follow ${p.name}'s own governance and changelog once a month and note anything that looks like a points program, a token vote or a snapshot; that note is what turns a position into an early claim. Cost: none. Time: 20 minutes a month.`,
    `Write down the wallet, the amount, the entry date and the exit rule (a token claim, a 30% drawdown or a better protocol on this board) somewhere outside the browser. Cost: none. Time: 5 minutes, once.`,
  ];
}

/** Tier from rank: the top of the board takes the largest band. */
export function tierForRank(rank: number, rows: number): number {
  const share = rows <= 1 ? 0 : (rank - 1) / (rows - 1);
  if (share < 0.1) return 1;
  if (share < 0.35) return 2;
  if (share < 0.7) return 3;
  return 4;
}

/**
 * The board: every eligible protocol, priced, ranked, with the implied values forced to be
 * distinct and strictly falling (two rows may score the same, but no two may tie on value).
 */
export function buildBoard(snapshot: Snapshot, now: number): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => isEligible(p, snapshot))
    .map((p) => {
      const signals = signalsFor(p, now);
      const score = scoreFor(signals);
      return { p, signals, score, value: impliedValue(score) };
    })
    .sort((a, b) => b.value - a.value || a.p.slug.localeCompare(b.p.slug));

  const rows: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const entry of scored) {
    const value = Math.min(entry.value, previous - 1);
    if (value <= 0) continue;
    previous = value;
    const rank = rows.length + 1;
    const tier = tierForRank(rank, scored.length);
    rows.push({
      rank,
      slug: entry.p.slug,
      name: entry.p.name,
      category: entry.p.category,
      chains: entry.p.chains,
      tvl_usd: entry.p.tvl_usd,
      change_7d: entry.p.change_7d,
      mcap_usd: entry.p.mcap_usd,
      listed_at: entry.p.listed_at,
      gecko_id: entry.p.gecko_id,
      symbol: entry.p.symbol,
      token_status: 'records-no-token',
      watchlist: watch.has(entry.p.slug),
      age_days: ageDays(entry.p.listed_at, now),
      score: entry.score,
      multiple: entry.p.tvl_usd > 0 ? round4(value / entry.p.tvl_usd) : null,
      implied_value_usd: value,
      signals: entry.signals,
      farm_steps: farmPlan(entry.p, tier, watch.has(entry.p.slug)),
    });
  }
  return rows;
}

/** What is wrong with a board, or null when nothing is. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < MIN_ROWS) return `only ${rows.length} rows, ${MIN_ROWS} needed`;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (i > 0 && row.implied_value_usd >= rows[i - 1]!.implied_value_usd) {
      return `row ${row.rank} (${row.implied_value_usd}) does not sit below row ${row.rank - 1}`;
    }
    const steps = row.farm_steps;
    if (!Array.isArray(steps) || steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
      return `${row.slug} has ${steps?.length ?? 0} farm steps`;
    }
    for (const step of steps) {
      if (typeof step !== 'string') return `${row.slug} has a farm step that is not text`;
      if (step.length < STEP_MIN_CHARS || step.length > STEP_MAX_CHARS) {
        return `${row.slug} has a farm step of ${step.length} characters`;
      }
    }
  }
  const slugs = new Set(rows.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist protocol ${slug} is not on the board`;
  }
  return null;
}

/** The dashboard's data, as a script the page can load from disk without a network. */
export function dataScript(rows: BoardRow[], asOf: string): string {
  const payload = { model: MODEL, as_of: asOf, rows };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}
