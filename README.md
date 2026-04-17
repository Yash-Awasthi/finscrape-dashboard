# FinScrape Dashboard

> **This repo has been merged into the main [fin-scrape](https://github.com/Yash-Awasthi/fin-scrape) repository as `dashboard/`.** This standalone repo is kept for reference. For the latest code and comprehensive deployment guide, see the [monorepo](https://github.com/Yash-Awasthi/fin-scrape).

Real-time financial signal intelligence dashboard powered by AI. Ingests news from 13+ sources, scores market impact with hybrid AI+heuristic analysis, and streams actionable investment signals with on-demand AI reasoning — all deployed on Cloudflare's edge network.

---

## What It Does

FinScrape Dashboard is the web frontend for the [fin-scrape](https://github.com/Yash-Awasthi/fin-scrape) intelligence pipeline. It receives structured financial events via API, stores them in a Durable Object-backed SQLite database, and presents them through a rich, interactive signal feed with AI-powered analysis.

**The pipeline:** News scraper (Python) → AI scoring → POST to dashboard API → Durable Object stores & deduplicates → WebSocket broadcasts to connected clients → On-demand AI analysis expands each signal with summaries, ticker impacts, and verdict reasoning.

---

## Features

### Signal Intelligence Feed
- **Live WebSocket streaming** — Events appear in real-time as they're scraped and scored. Auto-reconnect with exponential backoff.
- **30-minute auto-refresh** — Visible countdown timer with manual refresh button that animates until new data arrives.
- **Date-based navigation** — Browse signals by day with prev/next arrows and an interactive calendar picker. Days with events are highlighted in emerald.
- **Sortable columns** — Click Score, Confidence, or Time headers to sort ascending/descending.
- **Multi-filter** — Filter by verdict (INVEST/OBSERVE/CAUTIOUS/PULL_OUT), event type (earnings, M&A, analyst upgrade, etc.), or ticker symbol.

### AI-Powered Expanded Rows
Click any signal row to expand it with on-demand AI analysis (free, via Cloudflare Workers AI):

- **Verdict Reasoning** — "Why INVEST?" — a sentence explaining the AI's rationale
- **Article Summary** — 2-3 sentence summary of the news event and market significance
- **Ticker Impact Table** — Per-ticker estimated % move with direction arrows and reasons
- **Metadata** — Direction, magnitude, sector, novelty, and source links
- **Cached** — First view triggers AI generation (~2-5s), subsequent views are instant from SQLite cache

### Dynamic Ticker Detection
- AI analysis automatically identifies tickers mentioned in articles that the heuristic scraper missed
- Detected tickers merge into the Tickers column in real-time without page reload
- Prefetches AI analysis for the first 5 visible events to populate tickers proactively

### Deduplication Engine
- **URL-based** — Uses `instr()` SQL matching to filter duplicate articles by source URL
- **Subject-based** — Same-day articles with identical subjects are deduplicated on ingestion

### Portfolio & Watchlists
- Track positions with cost basis and current price
- Manage watchlists for focused signal monitoring
- API endpoints for programmatic portfolio management

### Telegram Bot Alerts
- `/subscribe` — Get real-time INVEST and PULL_OUT alerts
- `/status` — Check bot and pipeline status
- `/latest` — Fetch most recent signals
- `/portfolio` — View portfolio positions
- `/watchlists` — Manage ticker watchlists

### Responsive Design
- Mobile-first with progressive column disclosure (`hidden md:table-cell`, `hidden lg:table-cell`)
- Tickers shown inline on mobile, in dedicated column on desktop
- 3D card effects with hover lift and glow shadows
- Sticky header with backdrop blur

---

## Architecture

```
┌──────────────────────────┐                        ┌───────────────────────────────┐
│   fin-scrape (Python)    │    POST /api/events     │   Cloudflare Worker (Edge)    │
│                          │ ──────────────────────▶ │                               │
│  11 news scrapers        │                         │  React Router 7 (SSR)         │
│  AI + heuristic scoring  │    WebSocket /api/ws    │  Durable Object + SQLite      │
│  SEC EDGAR integration   │ ◀─────────────────────▶ │  Workers AI (on-demand)       │
│  Google News scraper     │                         │  WebSocket broadcast          │
└──────────────────────────┘                         └──────────────┬────────────────┘
                                                                    │
                                                     ┌──────────────┴──────────────┐
                                                     │  Telegram Bot API            │
                                                     │  /subscribe /status /latest  │
                                                     └─────────────────────────────┘
```

### Request Flow (Signal Ingestion)
```
1. fin-scrape scrapes news → scores with AI → POST /api/events
2. Worker validates API key → forwards to SignalsDO.ingestEvents()
3. Durable Object deduplicates by URL + subject
4. Inserts new events into SQLite, returns inserted IDs
5. ctx.waitUntil() triggers background AI analysis on new events
6. AI analysis generates summary, ticker impacts, verdict reasoning
7. AI-detected tickers merge back into events table
8. broadcastAIUpdate() notifies all WebSocket clients
9. Frontend revalidates data → tickers column updates live
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React Router 7 (framework mode, SSR) |
| **Runtime** | Cloudflare Workers (V8 isolates, edge deployment) |
| **Database** | Durable Objects with SQLite (zero-latency co-located storage) |
| **AI** | Cloudflare Workers AI via `workers-ai-provider` + Vercel AI SDK |
| **Frontend** | React 19, TypeScript, Tailwind CSS 4 |
| **UI Components** | shadcn/ui (Calendar, Popover, Table, Badge, Card, Select) |
| **Real-time** | Native WebSocket (Durable Object hibernation API) |
| **Alerts** | Telegram Bot API with webhook |
| **Package Manager** | Bun |
| **Data Pipeline** | [fin-scrape](https://github.com/Yash-Awasthi/fin-scrape) (Python) |

---

## API Reference

### Ingest Events
```http
POST /api/events
X-API-Key: <API_KEY>
Content-Type: application/json

{
  "events": [
    {
      "subject": "Nvidia unveils next-gen AI inference chips",
      "event_type": "product_launch",
      "tickers": ["NVDA"],
      "impact_direction": "positive",
      "signal_score": 4,
      "confidence": 0.85,
      "verdict": "INVEST",
      "heuristic_impact": 3,
      "divergence_flag": false,
      "sources": ["bloomberg"],
      "articles": ["https://bloomberg.com/..."],
      "timestamp": "2026-04-15T12:00:00Z",
      "reasoning": "Strong product cycle...",
      "magnitude": "high",
      "novelty": "breaking",
      "sector_impact": "technology"
    }
  ]
}
```

**Response:**
```json
{ "inserted": 1, "duplicates": 0, "total_stored": 185 }
```

### Query Events
```http
GET /api/events?date=2026-04-15&verdict=INVEST&sort=signal_score&dir=desc&limit=50
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `date` | string | Filter by date (YYYY-MM-DD). Default: today |
| `verdict` | string | INVEST, OBSERVE, CAUTIOUS, PULL_OUT |
| `ticker` | string | Filter by ticker symbol |
| `source` | string | Filter by news source |
| `event_type` | string | earnings, guidance, merger_acquisition, etc. |
| `sort` | string | signal_score, confidence, timestamp |
| `dir` | string | asc or desc |
| `limit` | number | Max results (default: 100) |

### AI Analysis (On-Demand)
```http
GET /api/ai/analyze?id=123
```

Returns cached analysis or generates on first request:
```json
{
  "summary": "Nvidia unveiled next-gen inference chips...",
  "ticker_impacts": [
    { "ticker": "NVDA", "direction": "up", "estimated_pct": "+3-5%", "reason": "New models = revenue catalyst" }
  ],
  "verdict_reason": "Strong product cycle signals accelerating enterprise AI adoption..."
}
```

### Other Endpoints
```http
GET /api/stats           # Dashboard statistics
GET /api/dates           # Available dates with event counts
GET /api/portfolio       # Portfolio positions
POST /api/portfolio      # Update positions
GET /api/watchlists      # Watchlists
POST /api/watchlists     # Update watchlists
POST /api/telegram       # Telegram webhook endpoint
```

### WebSocket
```javascript
const ws = new WebSocket("wss://your-host/api/ws");
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.type: "init" | "new_events" | "ai_updated" | "pong"
  // data.events: SignalEvent[] (for new_events)
  // data.stats: DashboardStats
};
// Keep-alive
setInterval(() => ws.send(JSON.stringify({ type: "ping" })), 30000);
```

---

## Project Structure

```
finscrape-dashboard/
├── workers/
│   ├── app.ts              # Worker entry — routing, API handlers, background AI, Telegram
│   ├── signals-do.ts       # Durable Object — SQLite schema, events, AI cache, WebSocket
│   └── data-proxy.ts       # Local data proxy service binding shim
├── app/
│   ├── routes/
│   │   ├── home.tsx        # Signal feed — date nav, calendar, sorting, filters, AI expand
│   │   └── portfolio.tsx   # Portfolio positions & watchlist management
│   ├── components/ui/      # shadcn components (calendar, popover, table, badge, etc.)
│   └── lib/
│       └── use-realtime.ts # WebSocket hook with auto-reconnect + ping keep-alive
├── wrangler.jsonc          # Cloudflare config — DO bindings, migrations, env vars, AI binding
├── package.json            # Dependencies and scripts
└── vite.config.ts          # Vite + React Router + Cloudflare plugin config
```

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `workers/app.ts` | ~465 | HTTP routing, API key auth, event ingestion, background AI analysis pipeline, Telegram webhook |
| `workers/signals-do.ts` | ~510 | Durable Object with SQLite. Event storage, dedup, querying, AI cache, WebSocket broadcast, portfolio/watchlist management |
| `app/routes/home.tsx` | ~810 | Main dashboard UI. Signal table with sorting/filtering, calendar nav, AI-expanded rows with cached analysis, auto-refresh timer, responsive layout |
| `app/lib/use-realtime.ts` | ~91 | WebSocket hook. Auto-reconnect, ping keep-alive, new_events + ai_updated message handling |

---

## Deployment

### Prerequisites
- [Bun](https://bun.sh) runtime installed
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI (globally installed or via `bunx wrangler`)
- A Cloudflare account

### Environment Variables

Set these in `wrangler.jsonc` under `vars`, or use `wrangler secret put` for sensitive values:

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Yes | Authentication key for the `/api/events` ingest endpoint |
| `TELEGRAM_BOT_TOKEN` | No | Telegram Bot API token for alert notifications |
| `AI_VIRTUAL_MODEL` | No | AI model route (default: `auto`) |

### Deploy Steps

```bash
# 1. Clone the repository
git clone https://github.com/Yash-Awasthi/finscrape-dashboard.git
cd finscrape-dashboard

# 2. Install dependencies
bun install

# 3. Configure your API key in wrangler.jsonc
# Edit vars.API_KEY to your desired key

# 4. Build and deploy
bun run build
wrangler deploy

# Or use the combined script:
bun run deploy
```

### Feeding Data

The dashboard needs the [fin-scrape](https://github.com/Yash-Awasthi/fin-scrape) Python pipeline to push events:

```bash
# From the fin-scrape project
python push_to_dashboard.py --url https://your-dashboard.workers.dev --api-key YOUR_KEY
```

Or push events manually:
```bash
curl -X POST https://your-dashboard.workers.dev/api/events \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"events": [{"subject": "Test signal", "verdict": "OBSERVE", "signal_score": 1, "confidence": 0.5, "event_type": "market_movement", "tickers": ["AAPL"], "impact_direction": "positive", "heuristic_impact": 1, "divergence_flag": false, "sources": ["manual"], "articles": [], "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}]}'
```

### Local Development

```bash
bun dev          # Starts local dev server with Wrangler miniflare
```

Note: Workers AI (`env.AI`) requires deployment to Cloudflare — it's not available in local dev. AI-expanded rows will show fallback content locally.

---

## Versioning

| Version | Date | Changes |
|---------|------|---------|
| 0.4.0 | 2026-04-15 | AI expanded rows, text wrapping fix, dynamic ticker detection |
| 0.3.0 | 2026-04-14 | Background AI analysis, auto-refresh timer, deduplication engine |
| 0.2.0 | 2026-04-13 | Source column, responsive layout, 3D effects, calendar contrast |
| 0.1.0 | 2026-04-12 | Initial dashboard — signal feed, sorting, filtering, WebSocket |

---

## Related Projects

- **[fin-scrape](https://github.com/Yash-Awasthi/fin-scrape)** — The Python backend powering this dashboard. 11+ news scrapers with stealth anti-bot bypass, AI+heuristic signal scoring, SEC EDGAR integration, NLP entity extraction, and multi-agent AI council.

## License

MIT
