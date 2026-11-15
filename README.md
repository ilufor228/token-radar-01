[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ilufor228/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ilufor228/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token launch radar

Ranks the protocols in a sealed DefiLlama snapshot that record **no token**, by what a
launch of each would plausibly be worth, and gives every one of them a farm plan.

An entry for [make.fun's Build the best token launch radar bounty](https://make.fun/bounty/token-radar-01),
in `ilufor228/token-radar-01`.

## What it does

1. Reads `snapshot.json`: 758 protocols as of 2026-11-14, with a `watchlist` of 40.
2. Keeps every protocol that has no token recorded (no symbol, no CoinGecko id), is not a
   wrapped, staked or bridged product, and either holds at least the snapshot's floor
   ($50M TVL) or sits on the watchlist. That is 108 protocols on this snapshot, all 40
   watchlist rows among them.
3. Scores each one 0-100 with model `radar-2` and turns the score into an implied value:

   | signal | weight | how it is read |
   | --- | --- | --- |
   | scale | 55% | log10 TVL mapped from $50M to $10B |
   | momentum | 25% | 7d TVL change, clamped to -60% .. +120% |
   | tenure | 15% | days listed with no token, capped at 5 years |
   | breadth | 5% | chains it runs on, one chain counts zero |

   `implied value = round(500,000 * 10 ^ (0.05 * score))`

4. Sorts, forces the implied values to be distinct and strictly falling, and writes the
   board, the dashboard's data and the dossier.

## Run it

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
node scripts/gate-check.mjs
```

`node main.ts` with no arguments reads `/input/snapshot.json` and writes `/output`, which
is how the scorer runs it. Standard library only: no dependencies, no install step.
`node scripts/shoot.mjs` re-renders the three screenshots in headless Chromium.

## The dashboard

`dashboard/index.html` is a static page. It reads `../data.js`, which `main.ts` writes from
the same rows as `board.json`, so it opens from disk with no server and no network: every
sort, filter and the detail drawer work offline. Click a column to sort, use the chain,
category, floor and watchlist controls to filter, click a row for that protocol's signals
and its six-step farm plan.

## Files

```
main.ts                  entrypoint: snapshot in, board + data.js + dossier out
lib/model.ts             scoring, implied value, tiers, gas table, farm plans
dashboard/               index.html, app.css, app.js - the page
scripts/gate-check.mjs   the shape gate: rows, ordering, watchlist, steps, shots, dossier
scripts/shoot.mjs        renders the page in headless Chromium and keeps 3 screenshots
vendor/makefun-board.ts  the kit's dossier builder (kit code, not mine)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
```

## How much to trust the numbers

The implied value is a model, not a market: it prices a protocol on the evidence in the
snapshot (scale, momentum, tenure, breadth) and nothing else. It does not know a team, a
roadmap, a points program or a token announcement. The `multiple` field on each row is the
implied value divided by TVL, which is the quickest read on whether the model thinks a
protocol is early or already priced.

## License

MIT. See [LICENSE](LICENSE).

---

Optional: [earn referral rewards](https://make.fun/r/g918srnc), a second way to make money.
