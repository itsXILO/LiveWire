import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './components/Header.jsx';
import MatchCard from './components/MatchCard.jsx';
import Scoreboard from './components/Scoreboard.jsx';
import CommentaryFeed from './components/CommentaryFeed.jsx';
import SportFilter from './components/SportFilter.jsx';
import { useMatches } from './hooks/useMatches.js';
import { useLiveSocket } from './hooks/useLiveSocket.js';
import { fetchCommentary } from './api.js';

export default function App() {
  const { matches, loading, error, reload, onMatchCreated } = useMatches();
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);
  const [sport, setSport] = useState('all');

  const selectedId = selected?.id ?? null;

  const onCommentary = useCallback((data) => {
    setComments((prev) => {
      if (prev.some((c) => c.id === data.id)) return prev;
      return [...prev, data];
    });
  }, []);

  const onMatchUpdated = useCallback((data) => {
    setMatches((prev) => prev.map((m) => (m.id === data.id ? data : m)));
    setSelected((prev) => (prev && prev.id === data.id ? data : prev));
  }, []);

  const socketStatus = useLiveSocket({
    matchId: selectedId,
    onCommentary,
    onMatchCreated,
    onMatchUpdated,
  });

  useEffect(() => {
    if (selectedId == null) return;
    let active = true;
    setComments([]);
    fetchCommentary(selectedId)
      .then((data) => {
        if (active) setComments(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectMatch = useCallback((match) => setSelected(match), []);
  const backToMatches = useCallback(() => setSelected(null), []);

  const sortedMatches = useMemo(
    () => [...matches].sort((a, b) => b.createdAt?.localeCompare?.(a.createdAt ?? '') ?? 0),
    [matches],
  );

  const sports = useMemo(() => {
    const set = new Set();
    for (const m of matches) set.add(m.sport?.toLowerCase());
    return [...set];
  }, [matches]);

  const filteredMatches = useMemo(
    () =>
      sport === 'all'
        ? sortedMatches
        : sortedMatches.filter((m) => m.sport?.toLowerCase() === sport),
    [sortedMatches, sport],
  );

  return (
    <div className="app">
      <Header connectionStatus={socketStatus} />

      <main>
        {selected ? (
          <section className="view view-match">
            <Scoreboard match={selected} onBack={backToMatches} />
            <CommentaryFeed comments={comments} />
          </section>
        ) : (
          <section className="view view-matches">
            <div className="view-head">
              <h2>Live matches</h2>
              <button type="button" className="refresh-btn" onClick={reload}>
                ↻ Refresh
              </button>
            </div>

            <SportFilter sports={sports} active={sport} onChange={setSport} />

            {loading && <div className="spinner" />}
            {error && <div className="error">⚠ {error}</div>}

            <div className="grid">
              {filteredMatches.map((m) => (
                <MatchCard key={m.id} match={m} onSelect={selectMatch} />
              ))}
            </div>

            {!loading && !error && filteredMatches.length === 0 && (
              <div className="empty">
                <p>No live matches{matches.length > 0 ? ` in ${sport}` : ''} right now.</p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}