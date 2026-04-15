import { useState, useEffect, useCallback, useRef } from "react";

interface RealtimeMessage {
  type: "init" | "new_events" | "ai_updated" | "pong";
  events?: any[];
  stats?: any;
}

interface UseRealtimeOptions {
  /** Called when new events arrive */
  onNewEvents?: (events: any[], stats: any) => void;
  /** Reconnection interval in ms (default: 3000) */
  reconnectInterval?: number;
  /** Whether to connect (default: true) */
  enabled?: boolean;
}

export function useRealtimeSignals(options: UseRealtimeOptions = {}) {
  const { onNewEvents, reconnectInterval = 3000, enabled = true } = options;
  const [connected, setConnected] = useState(false);
  const [newEventCount, setNewEventCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const onNewEventsRef = useRef(onNewEvents);
  onNewEventsRef.current = onNewEvents;

  const connect = useCallback(() => {
    if (!enabled || typeof window === "undefined") return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: RealtimeMessage = JSON.parse(event.data);

          if (data.type === "new_events" && data.events) {
            setNewEventCount((c) => c + data.events!.length);
            onNewEventsRef.current?.(data.events, data.stats);
          }

          if (data.type === "ai_updated") {
            // AI analysis finished — trigger revalidation to pick up updated tickers
            onNewEventsRef.current?.([], data.stats);
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Auto-reconnect
        reconnectTimer.current = setTimeout(connect, reconnectInterval);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {}
  }, [enabled, reconnectInterval]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  // Ping every 30s to keep alive
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [connected]);

  const resetCount = useCallback(() => setNewEventCount(0), []);

  return { connected, newEventCount, resetCount };
}
