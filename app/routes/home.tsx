import * as React from "react";
import type { Route } from "./+types/home";
import { data, useSearchParams, Link, useRevalidator } from "react-router";
import { useRealtimeSignals } from "~/lib/use-realtime";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";

interface SignalEvent {
  id: number;
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
  reasoning?: string;
  magnitude?: string;
  novelty?: string;
  actionability?: string;
  sector_impact?: string;
}

interface AIAnalysis {
  summary: string;
  ticker_impacts: Array<{ ticker: string; direction: string; estimated_pct: string; reason: string }>;
  verdict_reason: string;
}

interface DashboardStats {
  total_events: number;
  invest_count: number;
  observe_count: number;
  cautious_count: number;
  pull_out_count: number;
  unique_tickers: number;
  sources_active: number;
  last_update: string | null;
}

export function meta() {
  return [
    { title: "FinScrape Dashboard" },
    { name: "description", content: "AI-powered financial news intelligence signals" },
    { property: "og:title", content: "FinScrape Dashboard" },
    { property: "og:description", content: "Real-time financial signal intelligence" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const env = context.cloudflare.env;
  const id = env.SIGNALS_DO.idFromName("global");
  const stub = env.SIGNALS_DO.get(id);

  // Default to today in GMT if no date param
  const todayGMT = new Date().toISOString().split("T")[0];
  const dateParam = url.searchParams.get("date") || todayGMT;

  const [events, stats, availableDates] = await Promise.all([
    stub.getEvents({
      limit: 100,
      date: dateParam,
      verdict: url.searchParams.get("verdict") || undefined,
      ticker: url.searchParams.get("ticker") || undefined,
      source: url.searchParams.get("source") || undefined,
      event_type: url.searchParams.get("event_type") || undefined,
      sort_by: url.searchParams.get("sort") || undefined,
      sort_dir: url.searchParams.get("dir") || undefined,
    }),
    stub.getStats(),
    stub.getAvailableDates(),
  ]);

  return data({ events, stats, availableDates, currentDate: dateParam, todayGMT });
}

const verdictConfig: Record<string, { color: string; bg: string }> = {
  INVEST: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  OBSERVE: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  CAUTIOUS: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  PULL_OUT: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const cfg = verdictConfig[verdict] || verdictConfig.OBSERVE;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${cfg.bg} ${cfg.color}`}>
      {verdict.replace("_", " ")}
    </span>
  );
}

function ScoreDisplay({ score }: { score: number }) {
  const color = score >= 3 ? "text-emerald-400" : score >= 1 ? "text-blue-400" : score >= -1 ? "text-amber-400" : "text-red-400";
  const sign = score >= 0 ? "+" : "";
  return <span className={`font-mono font-bold ${color}`}>{sign}{score}</span>;
}

function StatCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-zinc-400">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-zinc-100">{value}</div>
        {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { events, stats, availableDates, currentDate, todayGMT } = loaderData as {
    events: SignalEvent[];
    stats: DashboardStats;
    availableDates: Array<{ day: string; count: number }>;
    currentDate: string;
    todayGMT: string;
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const revalidator = useRevalidator();

  // Live clock in GMT, updates every minute
  const [nowGMT, setNowGMT] = React.useState(() => formatGMTNow());
  React.useEffect(() => {
    const tick = setInterval(() => setNowGMT(formatGMTNow()), 15_000);
    return () => clearInterval(tick);
  }, []);

  // Real-time WebSocket connection — auto-refreshes data when new events arrive
  const { connected, newEventCount, resetCount } = useRealtimeSignals({
    onNewEvents: () => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
        resetCount();
      }
    },
  });

  // Auto-refresh every 30 minutes with visible countdown
  const REFRESH_INTERVAL = 30 * 60; // 30 minutes in seconds
  const [refreshCountdown, setRefreshCountdown] = React.useState(REFRESH_INTERVAL);

  React.useEffect(() => {
    setRefreshCountdown(REFRESH_INTERVAL);
    const tick = setInterval(() => {
      setRefreshCountdown((prev) => {
        if (prev <= 1) {
          if (revalidator.state === "idle") {
            revalidator.revalidate();
          }
          return REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1_000);
    return () => clearInterval(tick);
  }, [revalidator]);

  // Track whether a manual refresh is in progress
  const [isManualRefresh, setIsManualRefresh] = React.useState(false);
  React.useEffect(() => {
    if (revalidator.state === "idle" && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [revalidator.state, isManualRefresh]);

  // AI analysis cache — lazy loaded on row expand
  const [aiCache, setAiCache] = React.useState<Record<number, AIAnalysis | "loading" | "error">>({});
  React.useEffect(() => {
    if (expandedId && !aiCache[expandedId]) {
      setAiCache((prev) => ({ ...prev, [expandedId]: "loading" }));
      fetch(`/api/ai/analyze?id=${expandedId}`)
        .then((r) => r.json())
        .then((data) => setAiCache((prev) => ({ ...prev, [expandedId]: data as AIAnalysis })))
        .catch(() => setAiCache((prev) => ({ ...prev, [expandedId]: "error" })));
    }
  }, [expandedId]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    setSearchParams(params);
  };

  // Date navigation helpers
  const navigateDate = (offset: number) => {
    const d = new Date(currentDate + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    const newDate = d.toISOString().split("T")[0];
    const params = new URLSearchParams(searchParams);
    if (newDate === todayGMT) {
      params.delete("date");
    } else {
      params.set("date", newDate);
    }
    setSearchParams(params);
  };

  const goToDate = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const params = new URLSearchParams(searchParams);
    if (dateStr === todayGMT) {
      params.delete("date");
    } else {
      params.set("date", dateStr);
    }
    setSearchParams(params);
    setCalendarOpen(false);
  };

  // Sort helper
  const toggleSort = (col: string) => {
    const params = new URLSearchParams(searchParams);
    const currentSort = searchParams.get("sort");
    const currentDir = searchParams.get("dir") || "desc";
    if (currentSort === col) {
      params.set("dir", currentDir === "desc" ? "asc" : "desc");
    } else {
      params.set("sort", col);
      params.set("dir", "desc");
    }
    setSearchParams(params);
  };

  const sortIndicator = (col: string) => {
    const currentSort = searchParams.get("sort");
    if (currentSort !== col) return null;
    const dir = searchParams.get("dir") || "desc";
    return <span className="ml-1 text-emerald-400">{dir === "desc" ? "\u25BC" : "\u25B2"}</span>;
  };

  // Calendar: dates that have events
  const eventDaySet = new Set(availableDates.map((d) => d.day));
  const eventDayCounts = new Map(availableDates.map((d) => [d.day, d.count]));

  const isToday = currentDate === todayGMT;
  const displayDate = formatDateDisplay(currentDate, todayGMT);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-emerald-400">Fin</span>Scrape
            </h1>
            <nav className="ml-6 flex items-center gap-4 text-sm">
              <span className="text-zinc-100 font-medium">Signals</span>
              <Link to="/portfolio" className="text-zinc-400 hover:text-zinc-200 transition-colors">Portfolio</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-blue-500 animate-pulse"}`} />
              {connected ? "Live" : `Next refresh: ${formatCountdown(refreshCountdown)}`}
            </span>
            {stats.last_update && (
              <span>Last update: {formatGMTTime(stats.last_update)} GMT</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard title="Total Signals" value={stats.total_events} />
          <StatCard title="INVEST" value={stats.invest_count} subtitle="Score ≥ 3" />
          <StatCard title="OBSERVE" value={stats.observe_count} subtitle="Score 1-2" />
          <StatCard title="CAUTIOUS" value={stats.cautious_count} subtitle="Score -1 to 0" />
          <StatCard title="PULL OUT" value={stats.pull_out_count} subtitle="Score < -1" />
          <StatCard title="Tickers" value={stats.unique_tickers} />
          <StatCard title="Sources" value={stats.sources_active} />
        </div>

        {/* Date Navigation */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => navigateDate(-1)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Button>

            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-8 px-3 bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100 font-medium text-sm gap-2"
                >
                  <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {displayDate}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-zinc-900 border-zinc-700" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(currentDate + "T12:00:00")}
                  onSelect={(date) => date && goToDate(date)}
                  modifiers={{ hasEvents: (date) => {
                    const yyyy = date.getFullYear();
                    const mm = String(date.getMonth() + 1).padStart(2, "0");
                    const dd = String(date.getDate()).padStart(2, "0");
                    return eventDaySet.has(`${yyyy}-${mm}-${dd}`);
                  }}}
                  modifiersClassNames={{ hasEvents: "!bg-emerald-900/40 !text-emerald-300 !font-semibold" }}
                  disabled={(date) => date > new Date()}
                  classNames={{
                    today: "!bg-zinc-700 !text-zinc-100 !rounded-md",
                    disabled: "!text-zinc-700 !opacity-40",
                  }}
                  className="text-zinc-200 [&_[data-selected-single=true]]:!bg-white [&_[data-selected-single=true]]:!text-emerald-700 [&_[data-selected-single=true]]:!font-bold [&_[data-selected-single=true]]:!rounded-md"
                />
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => navigateDate(1)}
              disabled={isToday}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>

          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                params.delete("date");
                setSearchParams(params);
              }}
            >
              Jump to Today
            </Button>
          )}

          {/* Event count for current date */}
          {eventDayCounts.has(currentDate) && (
            <span className="text-xs text-zinc-500">
              {eventDayCounts.get(currentDate)} signal{eventDayCounts.get(currentDate) !== 1 ? "s" : ""} on this day
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Select
            value={searchParams.get("verdict") || "all"}
            onValueChange={(v) => updateFilter("verdict", v)}
          >
            <SelectTrigger className="w-[140px] bg-zinc-900 border-zinc-700">
              <SelectValue placeholder="Verdict" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Verdicts</SelectItem>
              <SelectItem value="INVEST">INVEST</SelectItem>
              <SelectItem value="OBSERVE">OBSERVE</SelectItem>
              <SelectItem value="CAUTIOUS">CAUTIOUS</SelectItem>
              <SelectItem value="PULL_OUT">PULL OUT</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={searchParams.get("event_type") || "all"}
            onValueChange={(v) => updateFilter("event_type", v)}
          >
            <SelectTrigger className="w-[180px] bg-zinc-900 border-zinc-700">
              <SelectValue placeholder="Event Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="earnings">Earnings</SelectItem>
              <SelectItem value="guidance">Guidance</SelectItem>
              <SelectItem value="price_target_change">Price Target</SelectItem>
              <SelectItem value="analyst_upgrade">Analyst Upgrade</SelectItem>
              <SelectItem value="analyst_downgrade">Analyst Downgrade</SelectItem>
              <SelectItem value="merger_acquisition">M&A</SelectItem>
              <SelectItem value="regulatory_decision">Regulatory</SelectItem>
              <SelectItem value="product_launch">Product Launch</SelectItem>
              <SelectItem value="management_change">Management</SelectItem>
              <SelectItem value="market_movement">Market Movement</SelectItem>
              <SelectItem value="investment_activity">Investment</SelectItem>
            </SelectContent>
          </Select>

          <Input
            placeholder="Filter by ticker (e.g. AAPL)"
            className="w-[200px] bg-zinc-900 border-zinc-700"
            defaultValue={searchParams.get("ticker") || ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateFilter("ticker", (e.target as HTMLInputElement).value.toUpperCase());
              }
            }}
          />

          {(searchParams.get("verdict") || searchParams.get("ticker") || searchParams.get("event_type") || searchParams.get("sort")) && (
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (searchParams.get("date")) params.set("date", searchParams.get("date")!);
                setSearchParams(params);
              }}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Signal Table */}
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Signal Feed — {displayDate} ({events.length} signals)
            </CardTitle>
            <div className="flex items-center gap-4">
              <span className="text-xs text-zinc-500 font-mono">{nowGMT} GMT</span>
              <span className="text-xs text-zinc-600 font-mono">
                {connected ? "" : `⟳ ${formatCountdown(refreshCountdown)}`}
              </span>
              <button
                onClick={() => {
                  if (revalidator.state === "idle") {
                    setIsManualRefresh(true);
                    revalidator.revalidate();
                    setRefreshCountdown(REFRESH_INTERVAL);
                  }
                }}
                disabled={isManualRefresh}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-50"
              >
                <svg className={`w-3.5 h-3.5 transition-transform ${isManualRefresh ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isManualRefresh ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {events.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <p className="text-lg">No signals for {displayDate}</p>
                <p className="text-sm mt-2">
                  Try navigating to a different date or clear your filters
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Verdict</TableHead>
                      <TableHead className="text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors" onClick={() => toggleSort("signal_score")}>
                        Score{sortIndicator("signal_score")}
                      </TableHead>
                      <TableHead className="text-zinc-400">Subject</TableHead>
                      <TableHead className="text-zinc-400">Tickers</TableHead>
                      <TableHead className="text-zinc-400">Type</TableHead>
                      <TableHead className="text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors" onClick={() => toggleSort("confidence")}>
                        Confidence{sortIndicator("confidence")}
                      </TableHead>
                      <TableHead className="text-zinc-400">Sources</TableHead>
                      <TableHead className="text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors" onClick={() => toggleSort("timestamp")}>
                        Time (GMT){sortIndicator("timestamp")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <React.Fragment key={event.id}>
                        <TableRow
                          className="border-zinc-800 hover:bg-zinc-800/50 cursor-pointer"
                          onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                        >
                          <TableCell>
                            <VerdictBadge verdict={event.verdict} />
                          </TableCell>
                          <TableCell>
                            <ScoreDisplay score={event.signal_score} />
                          </TableCell>
                          <TableCell className="max-w-md">
                            {event.articles.length > 0 ? (
                              <a
                                href={event.articles[0]}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-emerald-300/90 hover:text-emerald-400 underline decoration-emerald-500/30 hover:decoration-emerald-400/60 transition-colors block"
                                onClick={(e) => e.stopPropagation()}
                                title={`Open: ${event.subject}`}
                              >
                                {event.subject}
                                <svg className="inline-block w-3 h-3 ml-1.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            ) : (
                              <div className="truncate text-zinc-200">{event.subject}</div>
                            )}
                            <div className="flex gap-2 mt-0.5">
                              {event.divergence_flag && (
                                <span className="text-[10px] text-amber-500 font-medium">DIVERGENCE</span>
                              )}
                              {event.magnitude && event.magnitude !== "medium" && (
                                <span className={`text-[10px] font-medium ${event.magnitude === "high" ? "text-red-400" : "text-zinc-500"}`}>
                                  {event.magnitude.toUpperCase()} IMPACT
                                </span>
                              )}
                              {event.novelty === "breaking" && (
                                <span className="text-[10px] text-orange-400 font-medium">BREAKING</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {event.tickers.slice(0, 4).map((t) => (
                                <Badge key={t} variant="outline" className="text-[10px] border-zinc-700 text-zinc-300">
                                  {t}
                                </Badge>
                              ))}
                              {event.tickers.length > 4 && (
                                <span className="text-[10px] text-zinc-500">+{event.tickers.length - 4}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-zinc-400">{event.event_type.replace(/_/g, " ")}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    event.confidence >= 0.7 ? "bg-emerald-500" : event.confidence >= 0.4 ? "bg-amber-500" : "bg-red-500"
                                  }`}
                                  style={{ width: `${event.confidence * 100}%` }}
                                />
                              </div>
                              <span className="text-xs text-zinc-500">{Math.round(event.confidence * 100)}%</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {event.sources.map((s) => (
                                <span key={s} className="text-[10px] text-zinc-500">{s}</span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            <div className="text-zinc-300 font-mono">{formatGMTTime(event.timestamp)}</div>
                            <div className="text-zinc-600 text-[10px]">{formatTimeAgo(event.timestamp)}</div>
                          </TableCell>
                        </TableRow>
                        {expandedId === event.id && (
                          <TableRow className="border-zinc-800 bg-zinc-900/80">
                            <TableCell colSpan={8} className="p-4">
                              {(() => {
                                const ai = aiCache[event.id];
                                const isLoading = ai === "loading";
                                const isError = ai === "error";
                                const analysis = typeof ai === "object" && ai !== null && "summary" in ai ? ai as AIAnalysis : null;
                                const cfg = verdictConfig[event.verdict] || verdictConfig.OBSERVE;

                                return (
                                  <div className="space-y-4 text-sm">
                                    {/* Verdict Reason */}
                                    <div className={`rounded-lg border p-3 ${cfg.bg}`}>
                                      <div className={`text-xs font-semibold mb-1 ${cfg.color}`}>
                                        Why {event.verdict.replace("_", " ")}?
                                      </div>
                                      {isLoading ? (
                                        <div className="flex items-center gap-2 text-zinc-400">
                                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                          </svg>
                                          Analyzing with AI...
                                        </div>
                                      ) : analysis?.verdict_reason ? (
                                        <p className="text-zinc-200">{analysis.verdict_reason}</p>
                                      ) : (
                                        <p className="text-zinc-400 italic">
                                          {event.verdict} signal based on {event.event_type.replace(/_/g, " ")} with score {event.signal_score >= 0 ? "+" : ""}{event.signal_score}.
                                        </p>
                                      )}
                                    </div>

                                    {/* AI Summary */}
                                    {(isLoading || analysis?.summary) && (
                                      <div>
                                        <span className="text-zinc-500 text-xs font-medium">Summary</span>
                                        {isLoading ? (
                                          <div className="mt-1 space-y-2">
                                            <div className="h-3 bg-zinc-800 rounded animate-pulse w-full" />
                                            <div className="h-3 bg-zinc-800 rounded animate-pulse w-4/5" />
                                          </div>
                                        ) : (
                                          <p className="text-zinc-300 mt-1">{analysis!.summary}</p>
                                        )}
                                      </div>
                                    )}

                                    {/* Ticker Impact Table */}
                                    {(isLoading || (analysis?.ticker_impacts && analysis.ticker_impacts.length > 0)) && (
                                      <div>
                                        <span className="text-zinc-500 text-xs font-medium">Ticker Impact</span>
                                        {isLoading ? (
                                          <div className="mt-2 space-y-2">
                                            {[1, 2].map((i) => (
                                              <div key={i} className="h-4 bg-zinc-800 rounded animate-pulse w-3/5" />
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="mt-2 space-y-1.5">
                                            {analysis!.ticker_impacts.map((t, i) => (
                                              <div key={i} className="flex items-center gap-3 text-sm">
                                                <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-200 font-mono w-14 justify-center">
                                                  {t.ticker}
                                                </Badge>
                                                <span className={`font-mono text-xs font-bold w-16 ${
                                                  t.direction === "up" ? "text-emerald-400" : t.direction === "down" ? "text-red-400" : "text-zinc-400"
                                                }`}>
                                                  {t.direction === "up" ? "\u25B2" : t.direction === "down" ? "\u25BC" : "\u25CF"} {t.estimated_pct}
                                                </span>
                                                <span className="text-zinc-400 text-xs">{t.reason}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Metadata row */}
                                    <div className="flex flex-wrap gap-4 pt-2 border-t border-zinc-800">
                                      <div>
                                        <span className="text-zinc-500 text-[10px] font-medium">Direction</span>
                                        <p className="text-zinc-300 text-xs capitalize">{event.impact_direction}</p>
                                      </div>
                                      {event.magnitude && (
                                        <div>
                                          <span className="text-zinc-500 text-[10px] font-medium">Magnitude</span>
                                          <p className="text-zinc-300 text-xs capitalize">{event.magnitude}</p>
                                        </div>
                                      )}
                                      {event.sector_impact && (
                                        <div>
                                          <span className="text-zinc-500 text-[10px] font-medium">Sector</span>
                                          <p className="text-zinc-300 text-xs capitalize">{event.sector_impact}</p>
                                        </div>
                                      )}
                                      {event.novelty && event.novelty !== "standard" && (
                                        <div>
                                          <span className="text-zinc-500 text-[10px] font-medium">Novelty</span>
                                          <p className="text-zinc-300 text-xs capitalize">{event.novelty}</p>
                                        </div>
                                      )}
                                    </div>

                                    {/* Source links */}
                                    {event.articles.length > 0 && (
                                      <div>
                                        <span className="text-zinc-500 text-xs font-medium">Sources ({event.articles.length})</span>
                                        <div className="mt-1 space-y-1">
                                          {event.articles.slice(0, 3).map((url, i) => (
                                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                              className="block text-xs text-emerald-400/80 hover:text-emerald-400 truncate">
                                              {url}
                                            </a>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {isError && (
                                      <p className="text-xs text-zinc-500 italic">AI analysis unavailable — showing heuristic data</p>
                                    )}
                                  </div>
                                );
                              })()}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-4 mt-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <span>FinScrape v0.4.0</span>
          <span>POST /api/events to push signals from the pipeline</span>
        </div>
      </footer>
    </div>
  );
}

function formatTimeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatGMTTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "—";
  const mon = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon}/${day} ${hh}:${mm}`;
}

function formatGMTNow(): string {
  const d = new Date();
  const mon = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon}/${day} ${hh}:${mm}`;
}

function formatDateDisplay(dateStr: string, todayStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  if (dateStr === todayStr) return `${label} (Today)`;
  // Check if yesterday
  const yesterday = new Date(todayStr + "T12:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (dateStr === yesterday.toISOString().split("T")[0]) return `${label} (Yesterday)`;
  return label;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
