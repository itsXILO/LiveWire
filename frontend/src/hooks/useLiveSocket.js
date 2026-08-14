import { useEffect, useRef, useState } from 'react';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function useLiveSocket({ matchId, onCommentary, onMatchCreated }) {
  const [status, setStatus] = useState('connecting');
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const matchIdRef = useRef(matchId);
  const callbacksRef = useRef({ onCommentary, onMatchCreated });

  matchIdRef.current = matchId;
  callbacksRef.current = { onCommentary, onMatchCreated };

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const connect = () => {
      if (cancelled) return;

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setStatus('connected');
        if (matchIdRef.current != null) {
          ws.send(JSON.stringify({ type: 'subscribe', matchId: matchIdRef.current }));
        }
      };

      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (message.type) {
          case 'welcome':
            if (matchIdRef.current != null) {
              ws.send(JSON.stringify({ type: 'subscribe', matchId: matchIdRef.current }));
            }
            break;
          case 'commentary':
            callbacksRef.current.onCommentary?.(message.data);
            break;
          case 'match_created':
            callbacksRef.current.onMatchCreated?.(message.data);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setStatus('reconnecting');
        if (cancelled) return;
        retryRef.current = Math.min(
          retryRef.current + 1,
          Math.ceil(RECONNECT_MAX_MS / RECONNECT_BASE_MS),
        );
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** retryRef.current, RECONNECT_MAX_MS);
        timer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  return status;
}