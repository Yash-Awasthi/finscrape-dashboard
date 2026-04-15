import { createRequestHandler } from "react-router";
import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";

export { SignalsDO } from "./signals-do";
export { LocalDataProxyService } from "./data-proxy";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

function getSignalsStub(env: Env) {
  const id = env.SIGNALS_DO.idFromName("global");
  return env.SIGNALS_DO.get(id);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // WebSocket event stream
    if (url.pathname === "/api/ws" && request.headers.get("Upgrade") === "websocket") {
      const stub = getSignalsStub(env);
      return stub.handleWebSocket(request);
    }

    // API routes handled directly (bypasses React Router for performance)
    if (url.pathname === "/api/events" && request.method === "POST") {
      return handleIngestEvents(request, env, ctx);
    }

    if (url.pathname === "/api/events" && request.method === "GET") {
      return handleGetEvents(request, env);
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      return handleGetStats(env);
    }

    if (url.pathname === "/api/dates" && request.method === "GET") {
      const stub = getSignalsStub(env);
      const dates = await stub.getAvailableDates();
      return Response.json({ dates });
    }

    if (url.pathname === "/api/telegram/webhook" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    if (url.pathname === "/api/portfolio" && request.method === "GET") {
      return handleGetPortfolio(env);
    }

    if (url.pathname === "/api/portfolio/position" && request.method === "POST") {
      return handleSetPosition(request, env);
    }

    if (url.pathname === "/api/portfolio/position" && request.method === "DELETE") {
      return handleDeletePosition(request, env);
    }

    if (url.pathname === "/api/portfolio/watchlist" && request.method === "POST") {
      return handleSetWatchlist(request, env);
    }

    if (url.pathname === "/api/ai/analyze" && request.method === "GET") {
      return handleAIAnalyze(request, env);
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;

async function handleIngestEvents(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json() as { events?: unknown[] };
    const events = body.events;
    if (!Array.isArray(events)) {
      return Response.json({ error: "Expected { events: [...] }" }, { status: 400 });
    }

    const stub = getSignalsStub(env);
    const result = await stub.ingestEvents(events as any);

    // Background: trigger AI analysis for all newly inserted events
    if (result.insertedIds && result.insertedIds.length > 0) {
      ctx.waitUntil(runBackgroundAIAnalysis(env, stub, result.insertedIds));
    }

    // Send Telegram alerts for high-signal events
    const alertEvents = (events as any[]).filter(
      (e: any) => e.verdict === "INVEST" || e.verdict === "PULL_OUT"
    );
    if (alertEvents.length > 0 && env.TELEGRAM_BOT_TOKEN) {
      ctx_sendTelegramAlerts(env, stub, alertEvents).catch(() => {});
    }

    return Response.json({ ok: true, ...result });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

async function handleGetEvents(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const stub = getSignalsStub(env);
  const events = await stub.getEvents({
    limit: parseInt(url.searchParams.get("limit") || "100"),
    offset: parseInt(url.searchParams.get("offset") || "0"),
    verdict: url.searchParams.get("verdict") || undefined,
    ticker: url.searchParams.get("ticker") || undefined,
    source: url.searchParams.get("source") || undefined,
    event_type: url.searchParams.get("event_type") || undefined,
    date: url.searchParams.get("date") || undefined,
    sort_by: url.searchParams.get("sort") || undefined,
    sort_dir: url.searchParams.get("dir") || undefined,
  });
  return Response.json({ events });
}

async function handleGetStats(env: Env): Promise<Response> {
  const stub = getSignalsStub(env);
  const stats = await stub.getStats();
  return Response.json(stats);
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ error: "Telegram not configured" }, { status: 503 });
  }

  try {
    const update = await request.json() as any;
    const message = update.message;
    if (!message?.text) return Response.json({ ok: true });

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const stub = getSignalsStub(env);

    if (text === "/start" || text === "/subscribe") {
      await stub.registerTelegramChat(chatId);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        "Subscribed to FinScrape alerts! You'll receive INVEST and PULL_OUT signals.\n\n" +
        "Commands:\n/status - Pipeline stats\n/latest - Recent signals\n/portfolio - View portfolio\n/watchlists - View watchlists\n/unsubscribe - Stop alerts"
      );
    } else if (text === "/unsubscribe") {
      await stub.removeTelegramChat(chatId);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Unsubscribed from alerts.");
    } else if (text === "/status") {
      const stats = await stub.getStats();
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `📊 *FinScrape Stats*\n\n` +
        `Total Events: ${stats.total_events}\n` +
        `🟢 INVEST: ${stats.invest_count}\n` +
        `🔵 OBSERVE: ${stats.observe_count}\n` +
        `🟡 CAUTIOUS: ${stats.cautious_count}\n` +
        `🔴 PULL OUT: ${stats.pull_out_count}\n` +
        `Tickers Tracked: ${stats.unique_tickers}\n` +
        `Sources Active: ${stats.sources_active}\n` +
        `Last Update: ${stats.last_update || "Never"}`
      );
    } else if (text === "/latest") {
      const events = await stub.getEvents({ limit: 5 });
      if (events.length === 0) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "No signals yet.");
      } else {
        const lines = events.map(e => {
          const icon = e.verdict === "INVEST" ? "🟢" : e.verdict === "PULL_OUT" ? "🔴" : e.verdict === "CAUTIOUS" ? "🟡" : "🔵";
          const sign = e.signal_score >= 0 ? "+" : "";
          return `${icon} *${e.verdict}* (${sign}${e.signal_score}) | ${e.tickers.join(", ")}\n${e.subject}`;
        });
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          `📰 *Latest Signals*\n\n${lines.join("\n\n")}`
        );
      }
    } else if (text === "/portfolio") {
      const summary = await stub.getPortfolioSummary();
      if (summary.positions.length === 0) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "No positions in portfolio yet.");
      } else {
        const lines = summary.positions.map((p: any) => {
          const value = p.shares * p.current_price;
          const pnl = value - (p.shares * p.avg_cost);
          const pnlPct = p.avg_cost > 0 ? ((p.current_price - p.avg_cost) / p.avg_cost * 100).toFixed(1) : "0.0";
          const icon = pnl >= 0 ? "📈" : "📉";
          return `${icon} *${p.ticker}*: ${p.shares} shares @ $${p.avg_cost.toFixed(2)}\n   Value: $${value.toFixed(0)} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)} (${pnlPct}%)`;
        });
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          `💼 *Portfolio*\n\n${lines.join("\n\n")}\n\n` +
          `Total Value: $${summary.total_value.toLocaleString()}\n` +
          `Total P&L: ${summary.total_pnl >= 0 ? "+" : ""}$${summary.total_pnl.toLocaleString()}`
        );
      }
    } else if (text === "/watchlists") {
      const summary = await stub.getPortfolioSummary();
      if (summary.watchlists.length === 0) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "No watchlists configured.");
      } else {
        const lines = summary.watchlists.map((wl: any) =>
          `📋 *${wl.name}*: ${wl.tickers.join(", ")}`
        );
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          `👁 *Watchlists*\n\n${lines.join("\n")}`
        );
      }
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        "FinScrape Bot - Use /start to subscribe to alerts."
      );
    }

    return Response.json({ ok: true });
  } catch (e: any) {
    console.error("Telegram webhook error:", e);
    return Response.json({ ok: true }); // Always 200 to Telegram
  }
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function ctx_sendTelegramAlerts(env: Env, stub: any, events: any[]): Promise<void> {
  const chats = await stub.getTelegramChats();
  if (chats.length === 0) return;

  for (const event of events) {
    const icon = event.verdict === "INVEST" ? "🟢" : "🔴";
    const sign = event.signal_score >= 0 ? "+" : "";
    const reasoning = event.reasoning ? `\nReasoning: ${event.reasoning.substring(0, 120)}` : "";
    const msg =
      `${icon} *${event.verdict}* Signal\n\n` +
      `*${event.subject}*\n` +
      `Score: ${sign}${event.signal_score} | Confidence: ${Math.round(event.confidence * 100)}%\n` +
      `Tickers: ${(event.tickers || []).join(", ")}\n` +
      `Source: ${(event.sources || []).join(", ")}` +
      reasoning;

    for (const chat of chats) {
      sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chat.chat_id, msg).catch(() => {});
    }
  }
}

// --- Portfolio API handlers ---

async function handleGetPortfolio(env: Env): Promise<Response> {
  const stub = getSignalsStub(env);
  const summary = await stub.getPortfolioSummary();
  return Response.json(summary);
}

async function handleSetPosition(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json() as any;
  const stub = getSignalsStub(env);
  await stub.setPosition({
    ticker: body.ticker,
    shares: body.shares || 0,
    avg_cost: body.avg_cost || 0,
    current_price: body.current_price || body.avg_cost || 0,
    tags: body.tags || [],
  });
  return Response.json({ ok: true });
}

async function handleDeletePosition(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) return Response.json({ error: "Missing ticker" }, { status: 400 });
  const stub = getSignalsStub(env);
  await stub.removePosition(ticker);
  return Response.json({ ok: true });
}

async function handleSetWatchlist(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json() as any;
  const stub = getSignalsStub(env);
  await stub.setWatchlist(body.name, body.tickers || [], body.description || "");
  return Response.json({ ok: true });
}

// --- AI Analysis endpoint ---

async function handleAIAnalyze(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const idStr = url.searchParams.get("id");
  if (!idStr) return Response.json({ error: "Missing id param" }, { status: 400 });

  const eventId = parseInt(idStr);
  if (isNaN(eventId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const stub = getSignalsStub(env);

  // Check cache first
  const cached = await stub.getAIAnalysis(eventId);
  if (cached) return Response.json(cached);

  // Fetch the event
  const event = await stub.getEventById(eventId);
  if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

  // Call AI
  try {
    const workersai = createWorkersAI({ binding: env.AI });
    const { text } = await generateText({
      model: workersai("auto", {}),
      prompt: `You are a senior financial analyst. Analyze this news event and return ONLY valid JSON (no markdown, no code blocks, no explanation):
{
  "summary": "2-3 sentence summary of what happened and its market significance",
  "ticker_impacts": [
    { "ticker": "SYM", "direction": "up|down|neutral", "estimated_pct": "+X-Y%", "reason": "brief reason for this ticker" }
  ],
  "verdict_reason": "One sentence explaining why this event warrants a ${event.verdict} verdict"
}

Event details:
Subject: ${event.subject}
Verdict: ${event.verdict} (Score: ${event.signal_score >= 0 ? "+" : ""}${event.signal_score})
Tickers: ${event.tickers.join(", ") || "none identified"}
Event Type: ${event.event_type}
Direction: ${event.impact_direction}
Confidence: ${Math.round(event.confidence * 100)}%
Sources: ${event.sources.join(", ")}
Timestamp: ${event.timestamp}`,
    });

    // Parse AI response
    let analysis;
    try {
      // Strip any markdown code blocks the model might add
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      // Fallback: use raw text as summary
      analysis = {
        summary: text.slice(0, 500),
        ticker_impacts: event.tickers.map(t => ({
          ticker: t,
          direction: event.impact_direction === "positive" ? "up" : event.impact_direction === "negative" ? "down" : "neutral",
          estimated_pct: "N/A",
          reason: "AI response could not be parsed as structured data",
        })),
        verdict_reason: `${event.verdict} signal based on ${event.event_type} event with score ${event.signal_score}.`,
      };
    }

    // Ensure required fields
    const result = {
      summary: analysis.summary || "",
      ticker_impacts: Array.isArray(analysis.ticker_impacts) ? analysis.ticker_impacts : [],
      verdict_reason: analysis.verdict_reason || "",
    };

    // Cache it
    await stub.saveAIAnalysis(eventId, result);

    return Response.json(result);
  } catch (e: any) {
    console.error("AI analysis error:", e);
    return Response.json({
      summary: `Could not generate AI analysis: ${e.message}`,
      ticker_impacts: [],
      verdict_reason: `${event.verdict} signal (score ${event.signal_score}) — AI analysis unavailable.`,
    });
  }
}

// Background AI analysis for newly ingested events
async function runBackgroundAIAnalysis(env: Env, stub: any, eventIds: number[]): Promise<void> {
  const workersai = createWorkersAI({ binding: env.AI });

  for (let i = 0; i < eventIds.length; i += 3) {
    const batch = eventIds.slice(i, i + 3);
    await Promise.allSettled(batch.map(async (eventId) => {
      try {
        const cached = await stub.getAIAnalysis(eventId);
        if (cached) return;

        const event = await stub.getEventById(eventId);
        if (!event) return;

        const { text } = await generateText({
          model: workersai("auto", {}),
          prompt: `You are a senior financial analyst. Analyze this news event and return ONLY valid JSON (no markdown, no code blocks):
{
  "summary": "2-3 sentence summary of what happened and its market significance",
  "ticker_impacts": [
    { "ticker": "SYM", "direction": "up|down|neutral", "estimated_pct": "+X-Y%", "reason": "brief reason" }
  ],
  "verdict_reason": "One sentence explaining why this event warrants a ${event.verdict} verdict"
}

Event: ${event.subject}
Verdict: ${event.verdict} (Score: ${event.signal_score >= 0 ? "+" : ""}${event.signal_score})
Tickers: ${event.tickers.join(", ") || "none identified"}
Type: ${event.event_type}
Direction: ${event.impact_direction}
Sources: ${event.sources.join(", ")}`,
        });

        let analysis;
        try {
          const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          analysis = JSON.parse(cleaned);
        } catch {
          analysis = {
            summary: text.slice(0, 500),
            ticker_impacts: event.tickers.map((t: string) => ({
              ticker: t, direction: event.impact_direction === "positive" ? "up" : event.impact_direction === "negative" ? "down" : "neutral",
              estimated_pct: "N/A", reason: "AI response not parseable",
            })),
            verdict_reason: `${event.verdict} signal based on ${event.event_type} with score ${event.signal_score}.`,
          };
        }

        await stub.saveAIAnalysis(eventId, {
          summary: analysis.summary || "",
          ticker_impacts: Array.isArray(analysis.ticker_impacts) ? analysis.ticker_impacts : [],
          verdict_reason: analysis.verdict_reason || "",
        });
      } catch (e) {
        console.error(`Background AI analysis failed for event ${eventId}:`, e);
      }
    }));
  }
}
