# FinScrape Dashboard

Real-time financial signal intelligence dashboard. Displays AI-scored events from 13+ news sources with live WebSocket updates, portfolio tracking, and Telegram alerts.

**Live:** [finscrape-dashboard.camelai.app](https://finscrape-dashboard-qhuij2.camelai.app)

![Dashboard Screenshot](docs/screenshot.png)

## Features

- **Real-time Signal Feed** — Live WebSocket stream of financial events scored by AI. Each signal carries a verdict (INVEST / OBSERVE / CAUTIOUS / PULL_OUT), confidence score, and source attribution.
- **Date-based Navigation** — Browse signals by day with prev/next arrows and a calendar picker. Days with events are highlighted.
- **Sortable & Filterable** — Sort by score, confidence, or time. Filter by verdict, event type, or ticker symbol.
- **Expanded Event Details** — Click any row to see AI reasoning, sector impact, magnitude, novelty, source links, and ticker-level analysis.
- **Portfolio Tracker** — Track positions with P&L, manage watchlists, see how signals affect your holdings.
- **Telegram Bot** — Subscribe to INVEST/PULL_OUT alerts via `/subscribe`. Commands: `/status`, `/latest`, `/portfolio`, `/watchlists`.
- **Auto-refresh** — 30-minute polling with countdown timer when WebSocket is unavailable.

## Architecture

```
┌──────────────────────┐     POST /api/events     ┌─────────────────────────┐
│   fin-scrape          │ ───────────────────────▶ │  Cloudflare Worker       │
│   (Python scrapers)   │                          │  (React Router 7 + SSR)  │
│   13+ news sources    │     WebSocket /api/ws    │                          │
│   AI scoring pipeline │ ◀───────────────────────▶│  Durable Object (SQLite) │
└──────────────────────┘                          │  + WebSocket broadcast   │
                                                   └─────────────────────────┘
                                                              │
                                                   ┌──────────┴──────────┐
                                                   │  Telegram Bot API    │
                                                   │  Alert Engine        │
                                                   └─────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, React Router 7 (SSR), TypeScript, Tailwind CSS 4 |
| UI Components | shadcn/ui (Calendar, Popover, Table, Badge, Card) |
| Backend | Cloudflare Workers, Durable Objects with SQLite |
| Real-time | WebSocket (Durable Object native) with polling fallback |
| Data Source | [fin-scrape](https://github.com/Yash-Awasthi/fin-scrape) Python pipeline |
| Alerts | Telegram Bot API |
| Deployment | Cloudflare Workers (edge, global) |

## API

### Ingest Events
```bash
POST /api/events
X-API-Key: <your-key>
Content-Type: application/json

{ "events": [{ "subject": "...", "verdict": "INVEST", "signal_score": 3, ... }] }
```

### Query Events
```bash
GET /api/events?date=2026-04-15&verdict=INVEST&sort=signal_score&dir=desc&limit=50
```

### Stats
```bash
GET /api/stats
GET /api/dates        # Available dates with event counts
GET /api/portfolio    # Portfolio positions and watchlists
```

### WebSocket
```bash
ws://host/api/ws      # Real-time event stream
```

## Project Structure

```
workers/
  app.ts              # Worker entry — routing, API handlers, Telegram webhook
  signals-do.ts       # Durable Object — SQLite schema, event storage, WebSocket broadcast
  data-proxy.ts       # Local data proxy shim

app/
  routes/
    home.tsx          # Signal feed — date nav, calendar, sorting, filters, expanded rows
    portfolio.tsx     # Portfolio positions & watchlists
  components/ui/      # shadcn components (calendar, popover, table, badge, etc.)
  lib/
    use-realtime.ts   # WebSocket hook with auto-reconnect

wrangler.jsonc        # Cloudflare bindings, DO migrations, env vars
```

## Development

```bash
bun install
bun dev               # Local dev server
bun run build         # Production build
bun run deploy        # Deploy to Cloudflare Workers
```

## Related

- **[fin-scrape](https://github.com/Yash-Awasthi/fin-scrape)** — The Python backend that powers this dashboard. 13+ news scrapers, AI analysis pipeline, SEC EDGAR integration.

## License

MIT
