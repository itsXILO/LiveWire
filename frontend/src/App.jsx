import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './components/Header.jsx';
import MatchCard from './components/MatchCard.jsx';
import Scoreboard from './components/Scoreboard.jsx';
import CommentaryFeed from './components/CommentaryFeed.jsx';
import { useMatches } from './hooks/useMatches.js';
import { useLiveSocket } from './hooks/useLiveSocket.js';
import { fetchCommentary } from './api.js';

export default function App() {
  const { matches, loading, error, reload, onMatchCreated } = useMatches();
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);

  const selectedId = selected?.id ?? null;

  const onCommentary = useCallback((data) => {
    setComments((prev) => {
      if (prev.some((c) => c.id === data.id)) return prev;
      return [...prev, data];
    });
  }, []);

  const socketStatus = useLiveSocket({ matchId: selectedId, onCommentary, onMatchCreated });

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
              <h2>Live & upcoming matches</h2>
              <button type="button" className="refresh-btn" onClick={reload}>
                ↻ Refresh
              </button>
            </div>

            {loading && <div className="spinner" />}
            {error && <div className="error">⚠ {error}</div>}

            <div className="grid">
              {sortedMatches.map((m) => (
                <MatchCard key={m.id} match={m} onSelect={selectMatch} />
              ))}
            </div>

            {!loading && !error && sortedMatches.length === 0 && (
              <div className="empty">
                <p>No matches yet. They’ll appear here the moment they’re created.</p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}