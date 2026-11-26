[![make.fun · news-image-20261126](https://make.fun/badge/news-image-20261126.svg)](https://make.fun/bounty/news-image-20261126?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)
[![rank](https://make.fun/badge/news-image-20261126/mohamad824/news-image-20261126-v1/rank.svg)](https://make.fun/bounty/news-image-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)
[![reward](https://make.fun/badge/news-image-20261126/mohamad824/news-image-20261126-v1/reward.svg)](https://make.fun/bounty/news-image-20261126?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)

# news-image-20261126 v1 — The World in One Day (mid-day edition)

One 1024×1024 PNG summing up the world news of Thursday 26 November 2026, cut-off ~02:00 UTC: the EU summit opening in Brussels, oil climbing past $90 after the Houthi refinery claim, Taiwan winning the lowest 15% tariff tier, plus 33 more stories, a UTC timeline, a dotted world map with 13 pins, and an honest DATE CHECK. Modern colourful theme on warm newspaper-paper (#f7f2e7).

Built for the [make.fun bounty](https://make.fun/bounty/news-image-20261126).

## Run it

```sh
node main.ts
```

Writes `entry.png` to `$MAKEFUN_OUTPUT_DIR` (or `/output` when unset). Node 22 stdlib only, no network, deterministic output. Text is rendered from a real-TTF glyph atlas (`atlas.png` + `metrics.json`, Liberation Sans, OFL — see `OFL.txt`) generated in-session.
