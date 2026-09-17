# QuantEdge Terminal

A terminal that tells a quant trader **how much money market-data latency costs
their strategy**, and lets them check it against real historical Solana order
books. Nothing is sent to any market: every run is a replay.

Three screens:

- **Run** — pick a market, a recorded period and a preset, tune its parameters,
  run the same strategy at five feed delays (0 · 50 · 100 · 200 · 400 ms) and read
  the table "delay → P&L" plus the *cost of 100 ms*.
- **Terminal** — the live book for one market with the measured lag between our
  two real delivery channels, the age of the last update and a staleness mark.
- **Compare** — the same book arriving over two real channels side by side, one
  row per update, with the distribution of the difference. A third, emulated
  lane appears only when you type a delay profile and say where the number
  comes from; it is labelled as emulated and never counted as a measurement.

## What it measures — and what it refuses to claim

- **Latency is measured differentially, between two real channels only.** For
  each book update: when this channel received it minus when the earliest real
  channel received it. Lag from the on-chain event is not shown — validator
  timestamps are too coarse for that.
- **An emulated channel is never measured.** Its distance from a real channel
  equals the profile typed into it; the product does not present that as data,
  in the UI or in the API. Every payload that carries channel data carries the
  channel's `kind` (`real` | `emulated`); an audit test enforces this.
- **A run over incomplete data does not start.** The API names the missing
  ranges instead of silently computing across gaps.
- **Runs are byte-for-byte reproducible.** The engine has no I/O, no clock, no
  randomness; money and sizes are integers in the smallest units.
- **No provider is claimed to match any number here.** No DoubleZero figures, no
  vendor benchmarks. Takers only — makers cannot be modelled honestly without a
  trade tape.

Not in the product by decision: order execution, wallets, custody, accounts and
authentication, user code or a strategy DSL, any monetisation, AMMs as a book
source.

## Layout

```
packages/shared     book packing, event keys, differential-latency aggregation
packages/engine     pure backtest engine: latency model, taker fills, presets, metrics
packages/venue      Manifest book decoder, channel adapters, market probe
packages/db         Drizzle schema + migrations (Postgres / Supabase)
apps/collector      two WebSocket subscriptions per market → book_updates, arrivals, coverage
apps/api            Hono: markets, coverage, runs, strategies, latency, arrivals, SSE stream
apps/web            React 19 + Vite 7: run, result, terminal, compare screens
```

Stack: pnpm workspaces · TypeScript 5.9 strict · Biome 2 · Vitest 3 · Hono 4 ·
Drizzle · React 19 · Tailwind 4 · Zod 4 · `@cks-systems/manifest-sdk`. Versions
are pinned exactly.

## Running it

```sh
pnpm install
cp .env.example .env            # two Postgres URLs, two INDEPENDENT RPC providers, markets
pnpm --filter @quantedge/db migrate
pnpm --filter @quantedge/collector seed   # markets (symbols from MARKET_SYMBOLS) and the two channels
pnpm --filter @quantedge/collector dev   # starts recording; market-hours add up across markets — three markets reach 40 in about 13 hours
pnpm --filter @quantedge/api dev
pnpm --filter @quantedge/web dev
```

Without a database or keys, a stand with synthetic data serves the whole UI:

```sh
pnpm --filter @quantedge/api dev:memory
pnpm --filter @quantedge/web dev
```

The collector also prunes: with `RETENTION_HOURS` set it deletes book updates
older than that window once an hour and shortens `dataset_coverage` to match, so
a run can never be offered a period whose data is gone. `FROZEN_FROM`/`FROZEN_TO`
fence one reference dataset the pruning never touches. Unset `RETENTION_HOURS`
to keep everything.

`pnpm gate` runs lint, typecheck and every test suite; it is the bar for each
commit.

## API in one glance

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `POST /session` | anonymous session key; sent back as `X-Session-Key` |
| `GET /markets`, `GET /markets/:id/coverage` | markets and gap-free recorded periods |
| `GET /presets` | the three built-in presets with their parameter specs |
| `POST /runs`, `GET /runs/:id` | start a run (synchronous), read its results; `levelsMs` overrides the five default delays (1–10 levels, ≤ 60 s) |
| `GET/POST /strategies`, `DELETE /strategies/:id` | saved parameter sets on the session key |
| `GET /markets/:id/latency` | p50/p95 lag per channel over a 60 s window, real channels only |
| `GET /markets/:id/arrivals` | last updates with per-channel arrival lag |
| `GET /markets/:id/stream` | SSE book stream; `?offsetMs=&source=` opens an emulated channel |

Every validation failure answers `{ error, field, message }`. Runs are limited
to 30 per hour per session and 120 per hour per IP (`429` with `retryAfterSec`),
and to 24 hours of data each.

## Session key

Saved strategies and the run quota hang on a random key the server issues and
the browser keeps. It carries no personal data. Clearing site data or switching
browsers starts with an empty list; nothing can be recovered — the screens say
so where they offer to save.
