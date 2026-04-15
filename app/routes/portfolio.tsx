import * as React from "react";
import type { Route } from "./+types/portfolio";
import { data, Link } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

interface Position {
  ticker: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  tags: string[];
}

interface WatchlistItem {
  name: string;
  tickers: string[];
  description: string;
}

interface PortfolioData {
  positions: Position[];
  watchlists: WatchlistItem[];
  total_value: number;
  total_pnl: number;
}

export function meta() {
  return [
    { title: "Portfolio - FinScrape" },
    { name: "description", content: "Portfolio tracking and signal weighting" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const id = env.SIGNALS_DO.idFromName("global");
  const stub = env.SIGNALS_DO.get(id);

  const [portfolio, recentEvents] = await Promise.all([
    stub.getPortfolioSummary(),
    stub.getEvents({ limit: 20 }),
  ]);

  // Filter events relevant to portfolio tickers
  const portfolioTickers = new Set([
    ...portfolio.positions.map((p: Position) => p.ticker),
    ...portfolio.watchlists.flatMap((wl: WatchlistItem) => wl.tickers),
  ]);

  const relevantEvents = recentEvents.filter((e: any) =>
    e.tickers.some((t: string) => portfolioTickers.has(t))
  );

  return data({ portfolio, relevantEvents });
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export default function PortfolioPage({ loaderData }: Route.ComponentProps) {
  const { portfolio, relevantEvents } = loaderData as {
    portfolio: PortfolioData;
    relevantEvents: any[];
  };

  const totalCost = portfolio.positions.reduce((s, p) => s + p.shares * p.avg_cost, 0);
  const totalPnlPct = totalCost > 0 ? (portfolio.total_pnl / totalCost) * 100 : 0;

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
              <Link to="/" className="text-zinc-400 hover:text-zinc-200 transition-colors">Signals</Link>
              <span className="text-zinc-100 font-medium">Portfolio</span>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Portfolio Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">Positions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-100">{portfolio.positions.length}</div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">Total Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-100">{formatCurrency(portfolio.total_value)}</div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">Unrealized P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${portfolio.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {formatCurrency(portfolio.total_pnl)}
              </div>
              <p className="text-xs text-zinc-500 mt-1">{formatPct(totalPnlPct)}</p>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">Watchlists</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-100">{portfolio.watchlists.length}</div>
              <p className="text-xs text-zinc-500 mt-1">
                {portfolio.watchlists.reduce((s, wl) => s + wl.tickers.length, 0)} tickers
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Positions Table */}
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">
              Holdings ({portfolio.positions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {portfolio.positions.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <p className="text-lg">No positions yet</p>
                <p className="text-sm mt-2">
                  Add positions via the API: POST /api/portfolio/position
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Ticker</TableHead>
                      <TableHead className="text-zinc-400 text-right">Shares</TableHead>
                      <TableHead className="text-zinc-400 text-right">Avg Cost</TableHead>
                      <TableHead className="text-zinc-400 text-right">Price</TableHead>
                      <TableHead className="text-zinc-400 text-right">Value</TableHead>
                      <TableHead className="text-zinc-400 text-right">P&L</TableHead>
                      <TableHead className="text-zinc-400 text-right">P&L %</TableHead>
                      <TableHead className="text-zinc-400">Tags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {portfolio.positions.map((pos) => {
                      const value = pos.shares * pos.current_price;
                      const cost = pos.shares * pos.avg_cost;
                      const pnl = value - cost;
                      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                      return (
                        <TableRow key={pos.ticker} className="border-zinc-800 hover:bg-zinc-800/50">
                          <TableCell>
                            <span className="font-mono font-bold text-zinc-200">{pos.ticker}</span>
                          </TableCell>
                          <TableCell className="text-right text-zinc-300">
                            {pos.shares.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-zinc-400">
                            {formatCurrency(pos.avg_cost)}
                          </TableCell>
                          <TableCell className="text-right text-zinc-300">
                            {formatCurrency(pos.current_price)}
                          </TableCell>
                          <TableCell className="text-right text-zinc-200 font-medium">
                            {formatCurrency(value)}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {formatCurrency(pnl)}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${pnlPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {formatPct(pnlPct)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {pos.tags.map((t) => (
                                <Badge key={t} variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Watchlists */}
        {portfolio.watchlists.length > 0 && (
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-zinc-400">Watchlists</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {portfolio.watchlists.map((wl) => (
                  <div key={wl.name} className="flex items-center gap-3">
                    <span className="text-zinc-200 font-medium min-w-[100px]">{wl.name}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {wl.tickers.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] border-zinc-700 text-zinc-300">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    {wl.description && (
                      <span className="text-xs text-zinc-500 ml-auto">{wl.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Relevant Signals */}
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">
              Portfolio-Relevant Signals ({relevantEvents.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {relevantEvents.length === 0 ? (
              <div className="text-center py-8 text-zinc-500">
                <p>No recent signals for your portfolio tickers</p>
              </div>
            ) : (
              <div className="space-y-3">
                {relevantEvents.map((event: any) => {
                  const verdictColors: Record<string, string> = {
                    INVEST: "border-l-emerald-500 bg-emerald-500/5",
                    OBSERVE: "border-l-blue-500 bg-blue-500/5",
                    CAUTIOUS: "border-l-amber-500 bg-amber-500/5",
                    PULL_OUT: "border-l-red-500 bg-red-500/5",
                  };
                  const cls = verdictColors[event.verdict] || verdictColors.OBSERVE;
                  const sign = event.signal_score >= 0 ? "+" : "";
                  return (
                    <div key={event.id} className={`border-l-2 ${cls} p-3 rounded-r`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-zinc-300">{event.verdict}</span>
                        <span className="text-xs font-mono text-zinc-400">{sign}{event.signal_score}</span>
                        <div className="flex gap-1 ml-auto">
                          {event.tickers.slice(0, 3).map((t: string) => (
                            <Badge key={t} variant="outline" className="text-[9px] border-zinc-700 text-zinc-400">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-zinc-300 truncate">{event.subject}</p>
                      <p className="text-xs text-zinc-500 mt-1">
                        {event.event_type.replace(/_/g, " ")} &middot; {event.sources.join(", ")} &middot; {Math.round(event.confidence * 100)}% confidence
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="border-t border-zinc-800 px-6 py-4 mt-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <span>FinScrape v0.4.0</span>
          <span>Manage positions via API or CLI</span>
        </div>
      </footer>
    </div>
  );
}
