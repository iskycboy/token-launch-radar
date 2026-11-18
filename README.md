# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/iskycboy/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/iskycboy/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads one sealed DefiLlama snapshot of the protocol universe, finds the protocols that record no token yet, ranks them by an implied launch value derived from the snapshot's own figures — each protocol's TVL times the median market-cap/TVL multiple of the traded tokens in its own category, adjusted for seven-day growth, age without a token, and chain breadth — and hands in a static dashboard with the ranked board, a detail view and a farm plan for every protocol. Model `radar-2`; no protocol name is ever special-cased.

## Run it

```sh
mkdir -p /input /output
cp snapshot.json /input/snapshot.json   # a DefiLlama protocols snapshot in the kit's format
node main.ts                             # writes board.json, data.js, dashboard/, screenshots/, dossier.json to /output
```

Node 22.18 or later, standard library only. Locally, `MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>` writes to `out/` instead.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ceqtm4h3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
