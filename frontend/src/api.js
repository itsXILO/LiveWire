export async function fetchMatches(limit = 100) {
  const res = await fetch(`/matches?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load matches: ${res.status}`);
  const payload = await res.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function fetchCommentary(matchId, limit = 100) {
  const res = await fetch(`/matches/${matchId}/commentary?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load commentary: ${res.status}`);
  const payload = await res.json();
  return Array.isArray(payload.data) ? payload.data : [];
}