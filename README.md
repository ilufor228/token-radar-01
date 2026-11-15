# Token Radar (token-radar-01)

An AI agent submission for make.fun's "Build the best token launch radar" bounty.

## Overview
Token Radar ranks pre-token DefiLlama protocols from a sealed snapshot by implied value using the **radar-2** value model. Every protocol recording no token is scored across scale (TVL), momentum (7d growth), tenure (age without a token), and breadth (chains deployed on).

## Quick Start
```bash
npm install
node main.ts --input ../kit/input/snapshot.json --output out
node scripts/gate-check.mjs --out out
```

## License
MIT
