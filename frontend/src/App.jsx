import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './components/Header.jsx';
import MatchCard from './components/MatchCard.jsx';
import Scoreboard from './components/Scoreboard.jsx';
import CommentaryFeed from './components/CommentaryFeed.jsx';
import SportFilter from './components/SportFilter.jsx';
import { useMatches } from './hooks/useMatches.js';
import { useLiveSocket } from './hooks/useLiveSocket.js';
import { fetchCommentary } from './api.js';
import { matchStatus } from './utils.js';

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

  // Periodically re-render so status transitions (live -> finished) and the
  // elapsed live clock update even when no new events arrive.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    let active = true;
    setComments([]);
    fetchCommentary(selectedId)
      .then((data) => {
        if (active) setComments([...data].sort((a, b) => a.id - b.id));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectMatch = useCallback((match) => setSelected(match), []);
  const backToMatches = useCallback(() => setSelected(null), []);

  const sortedMatches = useMemo(() => {
    const byStartTime = (a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '');
    const byEndTime = (a, b) => (b.endTime ?? '').localeCompare(a.endTime ?? '');
    const live = [];
    const rest = [];
    for (const m of matches) {
      if (matchStatus(m, now) === 'live') live.push(m);
      else rest.push(m);
    }
    return [...live.sort(byStartTime), ...rest.sort(byEndTime)];
  }, [matches, now]);


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

  const liveMatches = useMemo(
    () => filteredMatches.filter((m) => matchStatus(m, now) === 'live'),
    [filteredMatches, now],
  );
  const upcomingMatches = useMemo(
    () => filteredMatches.filter((m) => matchStatus(m, now) === 'scheduled'),
    [filteredMatches, now],
  );
  const pastMatches = useMemo(
    () => filteredMatches.filter((m) => matchStatus(m, now) === 'finished'),
    [filteredMatches, now],
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
              <h2>Live & past matches</h2>
              <button type="button" className="refresh-btn" onClick={reload}>
                ↻ Refresh
              </button>
            </div>

            <SportFilter sports={sports} active={sport} onChange={setSport} />

            {loading && <div className="spinner" />}
            {error && <div className="error">⚠ {error}</div>}

            {liveMatches.length > 0 && (
              <div className="section-label">
                <span className="section-dot" /> Live now
              </div>
            )}
            <div className="grid">
              {liveMatches.map((m) => (
                <MatchCard key={m.id} match={m} onSelect={selectMatch} />
              ))}
            </div>

            {upcomingMatches.length > 0 && (
              <div className="section-label">
                <span className="section-dot section-dot-upcoming" /> Upcoming
              </div>
            )}
            <div className="grid">
              {upcomingMatches.map((m) => (
                <MatchCard key={m.id} match={m} onSelect={selectMatch} />
              ))}
            </div>

            {pastMatches.length > 0 && (
              <div className="section-label">Earlier</div>
            )}
            <div className="grid">
              {pastMatches.map((m) => (
                <MatchCard key={m.id} match={m} onSelect={selectMatch} />
              ))}
            </div>

            {!loading && !error && filteredMatches.length === 0 && (
              <div className="empty">
                <p>No matches{matches.length > 0 ? ` in ${sport}` : ''} yet.</p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}