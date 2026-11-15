# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ilufor228/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ilufor228/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: a dark trading-terminal dashboard that ranks every pre-token protocol in a sealed DefiLlama snapshot by an implied value it states, and shows how to farm each one. Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

The board covers all 40 watchlist protocols (TVL at or above $50M, no token on record) plus every other protocol that passes the watchlist's own eligibility rule below the floor — 178 rows in this snapshot. Implied value is a transparent four-component model scored from the snapshot's own figures only: log-scale TVL (55%), seven-day growth clamped to -60/+120% (25%), age running with no token capped at 5 years (15%), and chain breadth (5%). Every row carries its score breakdown, and the dashboard recomputes each row to check the board's numbers. Wrapped, staked and bridged products, CEXs and versioned pools are left out by the same rule that defines the watchlist. Each row carries a six-step farm plan with concrete costs in USD and times, priced per chain. Live-token protocols are set aside in their own view with their market caps.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only, no network at runtime. Reads the snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Runs are deterministic: two runs write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
