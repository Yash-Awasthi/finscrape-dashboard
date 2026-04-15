import { DurableObject } from "cloudflare:workers";

export interface SignalEvent {
  id?: number;
  subject: string;
  event_type: string;
  tickers: string[];
  impact_direction: string;
  signal_score: number;
  confidence: number;
  verdict: string;
  heuristic_impact: number;
  divergence_flag: boolean;
  sources: string[];
  articles: string[];
  timestamp: string;
  created_at?: string;
  // Enriched fields
  reasoning?: string;
  magnitude?: string;
  novelty?: string;
  actionability?: string;
  sector_impact?: string;
}

export interface PortfolioPosition {
  ticker: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  tags: string[];
}

export interface DashboardStats {
  total_events: number;
  invest_count: number;
  observe_count: number;
  cautious_count: number;
  pull_out_count: number;
  unique_tickers: number;
  sources_active: number;
  last_update: string | null;
}

export interface AIAnalysis {
  summary: string;
  ticker_impacts: Array<{ ticker: string; direction: string; estimated_pct: string; reason: string }>;
  verdict_reason: string;
}

export class SignalsDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private wsClients: Set<WebSocket> = new Set();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'other',
        tickers TEXT NOT NULL DEFAULT '[]',
        impact_direction TEXT NOT NULL DEFAULT 'neutral',
        signal_score INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0.5,
        verdict TEXT NOT NULL DEFAULT 'OBSERVE',
        heuristic_impact REAL NOT NULL DEFAULT 0.0,
        divergence_flag INTEGER NOT NULL DEFAULT 0,
        sources TEXT NOT NULL DEFAULT '[]',
        articles TEXT NOT NULL DEFAULT '[]',
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        reasoning TEXT NOT NULL DEFAULT '',
        magnitude TEXT NOT NULL DEFAULT '',
        novelty TEXT NOT NULL DEFAULT '',
        actionability TEXT NOT NULL DEFAULT '',
        sector_impact TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_events_verdict ON events(verdict);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
    `);

    // Add enriched columns if missing (safe for existing tables)
    const cols = new Set(
      this.sql.exec<{ name: string }>("PRAGMA table_info(events)").toArray().map(r => r.name)
    );
    const enrichedCols: [string, string][] = [
      ["reasoning", "TEXT NOT NULL DEFAULT ''"],
      ["magnitude", "TEXT NOT NULL DEFAULT ''"],
      ["novelty", "TEXT NOT NULL DEFAULT ''"],
      ["actionability", "TEXT NOT NULL DEFAULT ''"],
      ["sector_impact", "TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [col, def] of enrichedCols) {
      if (!cols.has(col)) {
        this.sql.exec(`ALTER TABLE events ADD COLUMN ${col} ${def}`);
      }
    }

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS telegram_chats (
        chat_id TEXT PRIMARY KEY,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        filters TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS portfolio_positions (
        ticker TEXT PRIMARY KEY,
        shares REAL NOT NULL DEFAULT 0,
        avg_cost REAL NOT NULL DEFAULT 0,
        current_price REAL NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS portfolio_watchlists (
        name TEXT PRIMARY KEY,
        tickers TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ai_analysis_cache (
        event_id INTEGER PRIMARY KEY,
        summary TEXT NOT NULL DEFAULT '',
        ticker_impacts TEXT NOT NULL DEFAULT '[]',
        verdict_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  async ingestEvents(events: SignalEvent[]): Promise<{ inserted: number; duplicates: number; insertedIds: number[] }> {
    let inserted = 0;
    let duplicates = 0;
    const insertedEvents: SignalEvent[] = [];
    const insertedIds: number[] = [];
    this.ctx.storage.transactionSync(() => {
      for (const ev of events) {
        // Deduplicate by first article URL
        const articles = ev.articles || [];
        if (articles.length > 0) {
          const firstUrl = articles[0];
          const existing = this.sql.exec<{ c: number }>(
            "SELECT COUNT(*) as c FROM events WHERE instr(articles, ?) > 0",
            firstUrl
          ).one();
          if (existing && existing.c > 0) {
            duplicates++;
            continue;
          }
        }

        // Deduplicate by exact subject match on same day
        if (ev.subject) {
          const ts = ev.timestamp || new Date().toISOString();
          const day = ts.split("T")[0];
          const dayStart = day + "T00:00:00Z";
          const dayEnd = day + "T23:59:59Z";
          const subjectDup = this.sql.exec<{ c: number }>(
            "SELECT COUNT(*) as c FROM events WHERE subject = ? AND timestamp >= ? AND timestamp <= ?",
            ev.subject, dayStart, dayEnd
          ).one();
          if (subjectDup && subjectDup.c > 0) {
            duplicates++;
            continue;
          }
        }

        this.sql.exec(
          `INSERT INTO events
           (subject, event_type, tickers, impact_direction, signal_score,
            confidence, verdict, heuristic_impact, divergence_flag,
            sources, articles, timestamp, reasoning, magnitude, novelty, actionability, sector_impact)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ev.subject,
          ev.event_type || "other",
          JSON.stringify(ev.tickers || []),
          ev.impact_direction || "neutral",
          ev.signal_score || 0,
          ev.confidence || 0.5,
          ev.verdict || "OBSERVE",
          ev.heuristic_impact || 0.0,
          ev.divergence_flag ? 1 : 0,
          JSON.stringify(ev.sources || []),
          JSON.stringify(ev.articles || []),
          ev.timestamp || new Date().toISOString(),
          ev.reasoning || "",
          ev.magnitude || "",
          ev.novelty || "",
          ev.actionability || "",
          ev.sector_impact || ""
        );
        const lastId = this.sql.exec<{ id: number }>("SELECT last_insert_rowid() as id").one();
        if (lastId) insertedIds.push(lastId.id);
        insertedEvents.push(ev);
        inserted++;
      }
    });

    // Broadcast new events to all connected WebSocket clients
    if (insertedEvents.length > 0) {
      this.broadcast({
        type: "new_events",
        events: insertedEvents,
        stats: await this.getStats(),
      });
    }

    return { inserted, duplicates, insertedIds };
  }

  async getEvents(opts: {
    limit?: number;
    verdict?: string;
    ticker?: string;
    source?: string;
    event_type?: string;
    offset?: number;
    date?: string; // YYYY-MM-DD — filter to a single UTC day
    sort_by?: string; // timestamp | signal_score | confidence
    sort_dir?: string; // asc | desc
  } = {}): Promise<SignalEvent[]> {
    const limit = opts.limit || 100;
    const offset = opts.offset || 0;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.date) {
      // Filter to a specific UTC day
      const dayStart = opts.date + "T00:00:00Z";
      const d = new Date(dayStart);
      d.setUTCDate(d.getUTCDate() + 1);
      const dayEnd = d.toISOString().split("T")[0] + "T00:00:00Z";
      conditions.push("timestamp >= ? AND timestamp < ?");
      params.push(dayStart, dayEnd);
    }

    if (opts.verdict) {
      conditions.push("verdict = ?");
      params.push(opts.verdict);
    }
    if (opts.ticker) {
      conditions.push("tickers LIKE ?");
      params.push(`%"${opts.ticker}"%`);
    }
    if (opts.source) {
      conditions.push("sources LIKE ?");
      params.push(`%"${opts.source}"%`);
    }
    if (opts.event_type) {
      conditions.push("event_type = ?");
      params.push(opts.event_type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Sorting — whitelist allowed columns
    const allowedSorts: Record<string, string> = {
      timestamp: "timestamp",
      signal_score: "signal_score",
      confidence: "confidence",
      id: "id",
    };
    const sortCol = allowedSorts[opts.sort_by || ""] || "id";
    const sortDir = opts.sort_dir === "asc" ? "ASC" : "DESC";

    params.push(limit, offset);

    const rows = this.sql.exec<Record<string, unknown>>(
      `SELECT * FROM events ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
      ...params
    ).toArray();

    return rows.map(this.rowToEvent);
  }

  async getAvailableDates(): Promise<Array<{ day: string; count: number }>> {
    const rows = this.sql.exec<{ day: string; c: number }>(
      `SELECT DATE(timestamp) as day, COUNT(*) as c FROM events GROUP BY day ORDER BY day DESC LIMIT 90`
    ).toArray();
    return rows.map(r => ({ day: r.day, count: r.c as number }));
  }

  async getStats(): Promise<DashboardStats> {
    const total = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM events").one();
    const invest = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM events WHERE verdict = 'INVEST'").one();
    const observe = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM events WHERE verdict = 'OBSERVE'").one();
    const cautious = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM events WHERE verdict = 'CAUTIOUS'").one();
    const pullOut = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM events WHERE verdict = 'PULL_OUT'").one();
    const lastRow = this.sql.exec<{ timestamp: string }>(
      "SELECT timestamp FROM events ORDER BY id DESC LIMIT 1"
    ).toArray();

    // Count unique tickers by scanning all ticker arrays
    const allTickers = this.sql.exec<{ tickers: string }>("SELECT DISTINCT tickers FROM events").toArray();
    const tickerSet = new Set<string>();
    for (const row of allTickers) {
      try {
        const arr = JSON.parse(row.tickers as string);
        if (Array.isArray(arr)) arr.forEach((t: string) => tickerSet.add(t));
      } catch {}
    }

    const allSources = this.sql.exec<{ sources: string }>("SELECT DISTINCT sources FROM events").toArray();
    const sourceSet = new Set<string>();
    for (const row of allSources) {
      try {
        const arr = JSON.parse(row.sources as string);
        if (Array.isArray(arr)) arr.forEach((s: string) => sourceSet.add(s));
      } catch {}
    }

    return {
      total_events: total?.c || 0,
      invest_count: invest?.c || 0,
      observe_count: observe?.c || 0,
      cautious_count: cautious?.c || 0,
      pull_out_count: pullOut?.c || 0,
      unique_tickers: tickerSet.size,
      sources_active: sourceSet.size,
      last_update: lastRow.length > 0 ? (lastRow[0].timestamp as string) : null,
    };
  }

  async registerTelegramChat(chatId: string, filters: Record<string, string> = {}): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO telegram_chats (chat_id, filters) VALUES (?, ?)`,
      chatId,
      JSON.stringify(filters)
    );
  }

  async getTelegramChats(): Promise<Array<{ chat_id: string; filters: Record<string, string> }>> {
    const rows = this.sql.exec<{ chat_id: string; filters: string }>(
      "SELECT chat_id, filters FROM telegram_chats"
    ).toArray();
    return rows.map(r => ({
      chat_id: r.chat_id,
      filters: JSON.parse(r.filters as string),
    }));
  }

  async removeTelegramChat(chatId: string): Promise<void> {
    this.sql.exec("DELETE FROM telegram_chats WHERE chat_id = ?", chatId);
  }

  // --- Portfolio ---

  async setPosition(pos: PortfolioPosition): Promise<void> {
    this.sql.exec(
      `INSERT INTO portfolio_positions (ticker, shares, avg_cost, current_price, tags, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ticker) DO UPDATE SET
         shares = excluded.shares,
         avg_cost = excluded.avg_cost,
         current_price = excluded.current_price,
         tags = excluded.tags,
         updated_at = datetime('now')`,
      pos.ticker.toUpperCase(), pos.shares, pos.avg_cost,
      pos.current_price, JSON.stringify(pos.tags || [])
    );
  }

  async removePosition(ticker: string): Promise<void> {
    this.sql.exec("DELETE FROM portfolio_positions WHERE ticker = ?", ticker.toUpperCase());
  }

  async getPositions(): Promise<PortfolioPosition[]> {
    const rows = this.sql.exec<Record<string, unknown>>(
      "SELECT ticker, shares, avg_cost, current_price, tags FROM portfolio_positions ORDER BY ticker"
    ).toArray();
    return rows.map(r => ({
      ticker: r.ticker as string,
      shares: r.shares as number,
      avg_cost: r.avg_cost as number,
      current_price: r.current_price as number,
      tags: JSON.parse(r.tags as string),
    }));
  }

  async setWatchlist(name: string, tickers: string[], description: string = ""): Promise<void> {
    this.sql.exec(
      `INSERT INTO portfolio_watchlists (name, tickers, description)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET tickers = excluded.tickers, description = excluded.description`,
      name, JSON.stringify(tickers.map(t => t.toUpperCase())), description
    );
  }

  async getWatchlists(): Promise<Array<{ name: string; tickers: string[]; description: string }>> {
    const rows = this.sql.exec<Record<string, unknown>>(
      "SELECT name, tickers, description FROM portfolio_watchlists ORDER BY name"
    ).toArray();
    return rows.map(r => ({
      name: r.name as string,
      tickers: JSON.parse(r.tickers as string),
      description: r.description as string,
    }));
  }

  async deleteWatchlist(name: string): Promise<void> {
    this.sql.exec("DELETE FROM portfolio_watchlists WHERE name = ?", name);
  }

  async getPortfolioSummary(): Promise<{
    positions: PortfolioPosition[];
    watchlists: Array<{ name: string; tickers: string[] }>;
    total_value: number;
    total_pnl: number;
  }> {
    const positions = await this.getPositions();
    const watchlists = await this.getWatchlists();
    const totalValue = positions.reduce((s, p) => s + p.shares * p.current_price, 0);
    const totalCost = positions.reduce((s, p) => s + p.shares * p.avg_cost, 0);
    return {
      positions,
      watchlists,
      total_value: Math.round(totalValue * 100) / 100,
      total_pnl: Math.round((totalValue - totalCost) * 100) / 100,
    };
  }

  // --- AI Analysis Cache ---

  async getEventById(eventId: number): Promise<SignalEvent | null> {
    const rows = this.sql.exec<Record<string, unknown>>(
      "SELECT * FROM events WHERE id = ? LIMIT 1", eventId
    ).toArray();
    if (rows.length === 0) return null;
    return this.rowToEvent(rows[0]);
  }

  async getAIAnalysis(eventId: number): Promise<AIAnalysis | null> {
    const rows = this.sql.exec<Record<string, unknown>>(
      "SELECT summary, ticker_impacts, verdict_reason FROM ai_analysis_cache WHERE event_id = ?",
      eventId
    ).toArray();
    if (rows.length === 0) return null;
    return {
      summary: rows[0].summary as string,
      ticker_impacts: JSON.parse(rows[0].ticker_impacts as string),
      verdict_reason: rows[0].verdict_reason as string,
    };
  }

  async saveAIAnalysis(eventId: number, analysis: AIAnalysis): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO ai_analysis_cache (event_id, summary, ticker_impacts, verdict_reason)
       VALUES (?, ?, ?, ?)`,
      eventId,
      analysis.summary,
      JSON.stringify(analysis.ticker_impacts),
      analysis.verdict_reason
    );

    // Update event tickers from AI-detected ticker_impacts
    if (analysis.ticker_impacts && analysis.ticker_impacts.length > 0) {
      const existingRow = this.sql.exec<{ tickers: string }>(
        "SELECT tickers FROM events WHERE id = ?", eventId
      ).toArray();
      if (existingRow.length > 0) {
        const existingTickers: string[] = JSON.parse(existingRow[0].tickers as string);
        const aiTickers = analysis.ticker_impacts.map(t => t.ticker).filter(t => t && t.length <= 6);
        const merged = [...new Set([...existingTickers, ...aiTickers])];
        if (merged.length > existingTickers.length) {
          this.sql.exec(
            "UPDATE events SET tickers = ? WHERE id = ?",
            JSON.stringify(merged), eventId
          );
        }
      }
    }
  }

  // --- WebSocket real-time stream ---

  async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.wsClients.add(server);

    // Send initial snapshot
    const stats = await this.getStats();
    const recentEvents = await this.getEvents({ limit: 20 });
    server.send(JSON.stringify({
      type: "init",
      stats,
      events: recentEvents,
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketClose(ws: WebSocket) {
    this.wsClients.delete(ws);
  }

  webSocketError(ws: WebSocket) {
    this.wsClients.delete(ws);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Handle client messages (ping/pong, filter subscriptions)
    try {
      const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {}
  }

  private broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.wsClients) {
      try {
        ws.send(msg);
      } catch {
        this.wsClients.delete(ws);
      }
    }
  }

  private rowToEvent(row: Record<string, unknown>): SignalEvent {
    return {
      id: row.id as number,
      subject: row.subject as string,
      event_type: row.event_type as string,
      tickers: JSON.parse(row.tickers as string),
      impact_direction: row.impact_direction as string,
      signal_score: row.signal_score as number,
      confidence: row.confidence as number,
      verdict: row.verdict as string,
      heuristic_impact: row.heuristic_impact as number,
      divergence_flag: !!(row.divergence_flag as number),
      sources: JSON.parse(row.sources as string),
      articles: JSON.parse(row.articles as string),
      timestamp: row.timestamp as string,
      created_at: row.created_at as string,
      reasoning: (row.reasoning as string) || undefined,
      magnitude: (row.magnitude as string) || undefined,
      novelty: (row.novelty as string) || undefined,
      actionability: (row.actionability as string) || undefined,
      sector_impact: (row.sector_impact as string) || undefined,
    };
  }
}
