// Token Launch Radar — model v2 (radar-2).
//
// One sealed DefiLlama snapshot in, one ranked board out. The board covers every slug in the
// snapshot's watchlist (the floor, never a ceiling) and adds pre-token protocols below the floor:
// the early rows a radar exists to find. A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol); protocols whose token already trades are kept apart
// as the comparison set, never mixed into the ranked board.
//
// Implied value is derived from the snapshot's own figures, never from a list of names:
//
//   comps      = protocols whose token already trades (mcap_usd and tvl_usd both recorded)
//   multiple   = median mcap/TVL of the protocol's own category comps (trimmed when the set is
//                large), or the median of all comps when the category has fewer than 3; the
//                multiple is clamped to [0.05, 3.0] so one wild comp cannot carry a row
//   growth     = clamp(change_7d, -50, 100); growthMult = clamp(1 + growth/100 * 0.35, 0.6, 1.35)
//   maturity   = 0.7 + 0.3 * min(age_days, 1460) / 1460   (unknown age counts as 365 days)
//   breadth    = 1 + 0.03 * min(chains - 1, 4)             (a wider footprint, a wider launch)
//   implied    = max(1, round(tvl * multiple * growthMult * maturity * breadth))
//
// A separate readiness score (0-100) says how launch-shaped a protocol looks — age without a
// token, size against the watchlist floor, seven-day momentum and chain breadth — and is shown
// in the dashboard's detail view. It never changes the ranking: rank is implied value alone.

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

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  mult_min: number;
  mult_max: number;
  min_category_comps: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  mult_min: 0.05,
  mult_max: 3.0,
  min_category_comps: 3,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra: 4,
};

export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the comparison view carries, by market cap. */
export const LIVE_ROWS = 24;

export interface FarmStep {
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  readiness: number;
  model: {
    multiple: number;
    multiple_source: string;
    comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
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
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  readiness: number;
  multiple: number;
  multiple_source: string;
  comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

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

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, after a 10% trim at each end when the list has 10 or more. */
function medianTrimmed(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
  const core = sorted.slice(trim, sorted.length - trim);
  const mid = Math.floor(core.length / 2);
  return core.length % 2 === 1 ? core[mid]! : (core[mid - 1]! + core[mid]!) / 2;
}

/** Category comp multiples from the protocols whose token already trades. */
export interface CompTable {
  byCategory: Map<string, { multiple: number; comps: number }>;
  global: { multiple: number; comps: number };
}

export function compTable(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): CompTable {
  const ratios = (list: SnapshotProtocol[]): number[] =>
    list.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).map((p) => p.mcap_usd! / p.tvl_usd);
  const all = ratios(protocols);
  const global = { multiple: clamp(medianTrimmed(all), model.mult_min, model.mult_max), comps: all.length };
  const byCategory = new Map<string, { multiple: number; comps: number }>();
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) {
    if (p.category === null) continue;
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }
  for (const [category, list] of groups) {
    const r = ratios(list);
    if (r.length >= model.min_category_comps) {
      byCategory.set(category, { multiple: clamp(medianTrimmed(r), model.mult_min, model.mult_max), comps: r.length });
    }
  }
  return { byCategory, global };
}

/** The multiple one protocol is valued with, and where it came from. */
function multipleFor(p: SnapshotProtocol, comps: CompTable): { multiple: number; source: string; comps: number } {
  if (p.category !== null) {
    const own = comps.byCategory.get(p.category);
    if (own !== undefined) return { multiple: own.multiple, source: `median of ${own.comps} ${p.category} tokens that already trade`, comps: own.comps };
  }
  return { multiple: comps.global.multiple, source: `median of all ${comps.global.comps} tokens that already trade`, comps: comps.global.comps };
}

/** The multipliers, the implied value and the readiness one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: CompTable,
  floorUsd: number,
  model: ModelConstants = MODEL,
): { implied: number; readiness: number; multiple: number; multipleSource: string; comps: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = clamp(1 + (growthPct / 100) * model.growth_weight, 0.6, 1.35);
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const m = multipleFor(protocol, comps);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * m.multiple * growthMult * maturityMult * breadthMult));
  const ageScore = clamp(ageForModel / 1095, 0, 1) * 40;
  const sizeScore = clamp(Math.log10(Math.max(protocol.tvl_usd, 1)) / Math.log10(Math.max(floorUsd, 10)), 0, 1) * 25;
  const momentumScore = clamp((growthPct + 5) / 25, 0, 1) * 20;
  const breadthScore = (Math.min(Math.max(protocol.chains.length, 1), 5) / 5) * 15;
  const readiness = Math.round(ageScore + sizeScore + momentumScore + breadthScore);
  return { implied, readiness, multiple: m.multiple, multipleSource: m.source, comps: m.comps, growthPct, growthMult, maturityMult, breadthMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comps = compTable(snapshot.protocols, model);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, comps, snapshot.floor_usd, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    readiness: s.readiness,
    model: {
      multiple: round4(s.multiple),
      multiple_source: s.multipleSource,
      comps: s.comps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A realistic gas note for a chain the snapshot names; layer-2 chains are cheap, mainnets are not. */
function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $4-8 of gas per transaction at ordinary fees';
  if (c === 'bitcoin') return 'about $1-3 of network fees per transaction';
  if (c === 'solana') return 'under $0.05 of fees per transaction';
  return 'about $0.10-0.50 of gas per transaction on this chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's two core actions: opening the position, then deepening it the way farmers do. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} so the wallet starts earning supply history.`,
      `Borrow about 30% against the supply once, repay it within a week, and repeat monthly so the wallet shows real borrowing activity, not a parked deposit.`,
    ];
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return [
      `Provide $${capital} of liquidity to ${name}'s highest-volume pool on ${chain}, split evenly between the two pool assets.`,
      `Make two small swaps a week through ${name}'s own interface so the wallet builds genuine trading volume, and claim any pool fees weekly.`,
    ];
  if (c.includes('bridge'))
    return [
      `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}.`,
      `Use the bridged funds in one app on ${chain} the same day, then bridge a small amount back a week later so both directions are on record.`,
    ];
  if (c.includes('staking') || c.includes('restak'))
    return [
      `Stake $${capital} of the chain's staking asset through ${name} and keep the liquid receipt token in the same wallet.`,
      `Use the receipt token once in a lending or liquidity app that ${name} lists as a partner, so the wallet shows composed activity.`,
    ];
  if (c.includes('perpetual') || c.includes('derivative'))
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position (long and short the same asset in equal size).`,
      `Trade a few small positions each week to build volume history, keeping total open risk under 10% of the deposit.`,
    ];
  if (c.includes('prediction'))
    return [
      `Fund $${capital} and place one position in ${name}'s most liquid market.`,
      `Place one or two small positions a week in different markets so the wallet's history is broad, not a single bet.`,
    ];
  if (c.includes('curator') || c.includes('allocator'))
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} with a track record of at least 90 days and keep the vault shares.`,
      `Add a second, smaller deposit after two weeks so the wallet shows repeat deposits rather than one touch.`,
    ];
  if (c.includes('stable'))
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`,
      `Use the stable asset once in a partner lending or liquidity app named on ${name}'s own page, then return it to the wallet.`,
    ];
  if (c.includes('rwa'))
    return [
      `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it in the farming wallet.`,
      `Hold through at least two yield distributions so the wallet's holding period is visible in snapshots.`,
    ];
  if (c.includes('insurance'))
    return [
      `Buy $${capital} of cover from ${name} on ${chain} for the longest term offered and keep the policy active.`,
      `Renew or extend the cover once before it lapses so the wallet shows continuing participation.`,
    ];
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Repeat the core action once a week in a small amount so the wallet's activity spans several snapshots.`,
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, first chain, TVL, age) — never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const [open, deepen] = actionsFor(p, capital, chain);
  return [
    { text: `Set up one fresh wallet for ${p.name} only, fund it from an exchange withdrawal, and keep its seed phrase offline.`, cost: 'the withdrawal fee only, usually under $2', time: '10 minutes' },
    { text: open, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: deepen, cost: `${gas} per action`, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days and keep the wallet active in at least four separate weeks, so the activity survives more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Check ${p.name}'s own site and official social account once a week for a points, quests or rewards page; join only what the protocol itself publishes.`, cost: 'nothing to check, and never pay anyone to claim', time: '5 minutes a week' },
    { text: `Log every transaction hash, date and amount in a farm log for this wallet, so the position can be repeated, audited or unwound later.`, cost: 'nothing but the log', time: '5 minutes a week' },
    { text: `If a token or claim is announced, claim only from the link on ${p.name}'s official site, then decide to hold or sell with the position's full cost in front of you.`, cost: 'one claim transaction at the gas note above', time: '20 minutes when it happens' },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
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
    readiness: row.readiness,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    comps: row.model.comps,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
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
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
