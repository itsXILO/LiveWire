import { useEffect, useState } from 'react';
import { fetchMatches } from '../api.js';

export function useMatches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setError(null);
      const data = await fetchMatches();
      setMatches(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onMatchCreated = (match) => {
    setMatches((prev) => {
      if (prev.some((m) => m.id === match.id)) return prev;
      return [match, ...prev];
    });
  };

  return { matches, loading, error, reload: load, onMatchCreated };
}