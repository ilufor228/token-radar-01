# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ilufor228/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ilufor228/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that record no token yet: it reads DefiLlama's sealed snapshot, scores every pre-token protocol on TVL, seven-day change, time tracked and chain breadth, turns that score into an implied value, and gives each one a six-step farm plan. The dashboard sorts, filters and opens a detail view for any protocol, with no network and no framework.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json` (the ranked board), `out/data.js` (the page's data), a copy of `dashboard/` and `screenshots/`, and `out/dossier.json`. Open `out/dashboard/index.html` in a browser. On the grader the same `main.ts` reads `/input/snapshot.json` and writes `/output`.

To re-take the three screenshots from the real page (headless Chromium, no installs):

```sh
node scripts/shoot.mjs --page out/dashboard/index.html --dir screenshots
```

To run this repository's own gate over what `main.ts` wrote:

```sh
node scripts/gate-check.mjs --root . --out out --input ../input/snapshot.json
```

## What is in here

- `main.ts` reads the snapshot, builds the board, writes the dashboard data and the dossier.
- `lib/model.ts` is the model: the four signals, the score, the multiple band and the farm plans. No protocol is named in it.
- `dashboard/` is the page: `index.html`, `app.css`, `app.js`. It reads `../data.js`, keeps no state on a server, and never reaches the network.
- `screenshots/` holds the board, a protocol's detail view and a filtered view, taken from the real page at 1440x900.
- `scripts/shoot.mjs` renders the page in headless Chromium over the DevTools protocol and writes those three images; `scripts/gate-check.mjs` checks the board, the watchlist coverage, the farm steps, the screenshots and the dossier byte for byte.
- `vendor/makefun-board.ts` is make.fun's dossier library, copied from the competition kit and unmodified, as the rules require.

## The model, in one paragraph

Each protocol's record gives four signals, each scored from 0 to 1: scale is `log10(tvl / $1M)` over the range to $3B, momentum is the seven-day change clamped to -60%..+120%, tenure is the days DefiLlama has tracked it with no token up to 1,825, and breadth is its chain count up to five. Weighted 52/22/18/8 they make a score out of 100, which sets a multiple of TVL inside a fixed band, `0.08 · e^(2.9 · score / 100)`, about 0.08x to 1.45x. The implied value is that multiple times the protocol's own TVL. The band is checked against the market in the same snapshot: protocols that already trade sit at a median market-cap-to-TVL near 0.25x, so a pre-token protocol is priced inside the range its trading peers occupy. The page states every constant, and its model panel re-ranks the board live if you move a weight.

An implied value is this board's own claim about a token that does not exist yet, not a forecast that one is issued. A protocol that records no token may still hold one DefiLlama does not carry. Nothing here is investment advice.

---

<sub>Entered on [make.fun](https://make.fun/?ref=g918srnc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
