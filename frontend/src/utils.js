export function matchStatus(match, now = new Date()) {
  const start = new Date(match.startTime);
  const end = new Date(match.endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return match.status ?? 'scheduled';
  }
  if (now < start) return 'scheduled';
  if (now >= end) return 'finished';
  return 'live';
}

export function timeUntil(start) {
  const diff = new Date(start).getTime() - Date.now();
  if (diff <= 0) return null;
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `in ${h}h ${m}m`;
}

export function formatClock(start, end, status) {
  if (status === 'live') {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000));
    return `LIVE ${elapsed}m`;
  }
  if (status === 'scheduled') {
    return new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return 'Full Time';
}

export const EVENT_STYLES = {
  goal: { label: 'GOAL', className: 'evt-goal' },
  own_goal: { label: 'OWN GOAL', className: 'evt-goal' },
  penalty: { label: 'PENALTY', className: 'evt-goal' },
  yellow_card: { label: 'YELLOW', className: 'evt-yellow' },
  red_card: { label: 'RED', className: 'evt-red' },
  substitution: { label: 'SUB', className: 'evt-sub' },
  kickoff: { label: 'KICKOFF', className: 'evt-info' },
  start: { label: 'START', className: 'evt-info' },
  foul: { label: 'FOUL', className: 'evt-foul' },
  shot: { label: 'SHOT', className: 'evt-shot' },
  save: { label: 'SAVE', className: 'evt-save' },
  pass: { label: 'PASS', className: 'evt-pass' },
  six: { label: 'SIX', className: 'evt-six' },
  four: { label: 'FOUR', className: 'evt-four' },
  run: { label: 'RUN', className: 'evt-run' },
  wicket: { label: 'WICKET', className: 'evt-wicket' },
  over_end: { label: 'OVER', className: 'evt-info' },
  boundary: { label: 'BOUNDARY', className: 'evt-four' },
  basket: { label: 'BASKET', className: 'evt-basket' },
  three: { label: 'THREE', className: 'evt-three' },
  tipoff: { label: 'TIPOFF', className: 'evt-info' },
  timeout: { label: 'TIMEOUT', className: 'evt-timeout' },
  default: { label: 'UPDATE', className: 'evt-info' },
};

export function eventStyle(eventType) {
  return EVENT_STYLES[eventType] ?? EVENT_STYLES.default;
}

export const SPORT_EMOJI = {
  football: '⚽',
  cricket: '🏏',
  basketball: '🏀',
  default: '🏆',
};

export function sportEmoji(sport) {
  return SPORT_EMOJI[sport?.toLowerCase()] ?? SPORT_EMOJI.default;
}

export function teamScoreText(match, team) {
  if (match.sport?.toLowerCase() === 'cricket') {
    if (team === match.homeTeam) {
      return `${match.homeRuns ?? 0}/${match.homeWickets ?? 0}`;
    }
    return `${match.awayRuns ?? 0}/${match.awayWickets ?? 0}`;
  }
  return String(team === match.homeTeam ? (match.homeScore ?? 0) : (match.awayScore ?? 0));
}