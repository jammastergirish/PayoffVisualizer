# TradeShape

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)

<img width="796" height="454" alt="Screenshot 2026-01-05 at 10 12 03" src="https://github.com/user-attachments/assets/bea2750f-0be4-4d8a-bb6e-d1a5c433e8d5" />

A personalized trading dashboard that connects to Interactive Brokers (IBKR) TWS for real-time portfolio analysis, payoff diagrams, market data, and SEC filings. **Fully responsive** for desktop and mobile.

## Features

### Portfolio Dashboard
- **Live Connection**: Real-time sync with IBKR TWS positions and P&L
- **Multi-Account Support**: View positions across all accounts or filter by account
- **Key Metrics**: Net Liquidation, Daily P&L, Realized P&L, Unrealized P&L
- **Orders**: Place stock and options orders directly from the dashboard

### Payoff & Risk Analysis
- **Interactive Charts**: P&L at different price points for stocks and options
- **Greeks Dashboard**: Delta, Gamma, Theta, Vega exposure per ticker
- **IV & Date Simulation**: Stress-test positions with volatility and time changes
- **Options Presets**: One-click vertical spreads, straddles, condors, etc.

### Per-Ticker Research
- **Price Charts**: Historical OHLC with 1H / 1D / 1W / 1M / 1Y timeframes
- **News**: Latest headlines with full-article popups and AI-generated price-impact summary
- **Insights**: Analyst ratings, price targets, and firm-by-firm commentary
- **Insider Trades**: SEC Form 4 transactions (open-market buys/sells highlighted vs mechanical grants/10b5-1 plans); click an insider's name to see their full cross-company Form 4 history
- **8-Ks**: Recent SEC current reports with item-code classification (earnings, M&A, leadership, distress, etc.), AI summary banner, and full embedded HTML filings
- **10-K**: Latest annual report — Business / Risk Factors sections with on-demand AI summaries, plus the full HTML filing embedded inline
- **Big Investors**: 13F institutional holders with quarter-over-quarter delta (new / added / trimmed / held) sourced from a local SQLite cache

### Demo Mode
Run the app without an IBKR connection using sample data—perfect for development or quick demos.

<img width="798" height="451" alt="Screenshot 2026-01-05 at 10 11 48" src="https://github.com/user-attachments/assets/31c43623-beaf-4dd1-bfb6-555d4476699f" />

## Architecture

- **Frontend**: Next.js + React (in `frontend/`)
- **Backend**: Python FastAPI + ib_insync (in `backend/`)
- **Local cache**: SQLite at `backend/data/cache.db` for 13F holdings (extensible to prices, etc.) — see `backend/local_db.py`
- **Provider abstraction**: pluggable data/news/brokerage providers (Massive, Alpaca, IBKR) — selected via `DATA_PROVIDER` / `NEWS_PROVIDER` / `BROKERAGE_PROVIDER` env vars
- **SEC proxy**: backend embeds SEC filing HTML same-origin (bypasses `X-Frame-Options`) — see `/api/sec-proxy`

## Quick Start

### Prerequisites
1. IBKR TWS or IB Gateway running
2. API enabled on port **7496** (or 7497 for paper trading)
3. [uv](https://docs.astral.sh/uv/) and Node.js installed

### Environment Variables

Copy `.env.example` to `.env` and add your keys:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|----------|-------------|----------|
| `MASSIVE_API_KEY` | API key from [massive.com](https://massive.com) — price data, news, SEC filings, analyst insights, 13F | Yes |
| `OPENAI_API_KEY` | OpenAI API key — used for AI news / 8-K / 10-K summaries | Optional |
| `ALPACA_API_KEY` + `ALPACA_API_SECRET` + `ALPACA_PAPER` | Only if using Alpaca instead of IBKR for brokerage | Optional |
| `DATA_PROVIDER` / `NEWS_PROVIDER` / `BROKERAGE_PROVIDER` | Pluggable providers (defaults: `massive`, `massive`, `ibkr`) | Optional |
| `SEC_USER_AGENT` | Identifying string for SEC EDGAR requests (defaults to the maintainer's) | Optional |

> Note: a `credentials.sample.json` file exists in the repo but is not currently read by the backend — environment variables are the source of truth.

### Run Locally
```bash
./run.sh
```

This starts both:
- **Backend** at `http://localhost:8000`
- **Frontend** at `http://localhost:3000`

### One-time setup: 13F backfill (for Institutional Investors tab)

The Big Investors and Institutional Investors tabs read from a local SQLite cache populated by an ingest script. Run once to backfill the most recent two quarters of 13F filings (~50–65 min for ~6M holdings + filer-name enrichment + CUSIP→ticker resolution):

```bash
uv run python -m backend.scripts.ingest_13f --quarters 2
```

That single command does three phases:
1. Paginated scan of Massive's 13F endpoint → upserts filings + holdings.
2. Filer-name enrichment via `data.sec.gov/submissions` for each unique CIK.
3. CUSIP → ticker resolution for the top 2,000 uncached CUSIPs (by aggregated reported value), via Massive.

Flags to skip phases (e.g. for testing): `--no-enrich-names`, `--no-resolve-cusips`, `--cusip-limit N`.

The cache lives at `backend/data/cache.db` (gitignored). Without this step, the Institutional Investors tab will be empty.

### Nightly maintenance

Wire this into `cron` / `launchd` / whatever you use. The single command picks up new filings, resolves any new CIK names, and extends CUSIP coverage:

```bash
# Pull new 13F filings since two weeks ago (covers late filings + amendments),
# plus enrich any new filer names and CUSIPs that appear. Idempotent.
uv run python -m backend.scripts.ingest_13f --since "$(date -v-14d +%Y-%m-%d)"
```

Optional weekly cleanup if you suspect CUSIP mappings drifted (corporate actions, share-class changes):

```bash
# Retry heuristic CUSIPs (next visit re-resolves them via Massive).
sqlite3 backend/data/cache.db "DELETE FROM ticker_cusip WHERE resolved_via = 'heuristic';"

# Or nuke the entire CUSIP cache (forces every ticker to re-resolve).
sqlite3 backend/data/cache.db "DELETE FROM ticker_cusip;"
```

### Access from Phone (LAN)

The app is accessible from any device on your local network:

1. Find your Mac's IP: `ipconfig getifaddr en0`
2. On your phone, go to: `http://YOUR_IP:3000`

> **Note**: Only devices on your local WiFi can access the app. It is not exposed to the internet.

## Manual Setup

**Backend:**
```bash
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## TWS Configuration

1. Open TWS → Edit → Global Configuration → API → Settings
2. Enable **"Enable ActiveX and Socket Clients"**
3. Set Socket Port to **7496** (live) or **7497** (paper)
4. Uncheck **"Read-Only API"** if you want trading features

## Testing

```bash
# Backend tests
uv run pytest backend/tests/ -v

# Frontend tests
cd frontend
npm test
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Recharts
- **Backend**: FastAPI, ib_insync, httpx, OpenAI, SQLite (stdlib), Python 3.13
- **Data Sources**:
  - Interactive Brokers (positions, P&L, orders)
  - [Massive.com](https://massive.com) (prices, news, analyst insights, SEC filings, 13F holdings)
  - SEC EDGAR (filing primary documents, submissions metadata — fetched server-side and proxied to bypass `X-Frame-Options`)
  - OpenAI (news / 8-K / 10-K summarization)

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
