import { matchStatus, formatClock, sportEmoji, teamScoreText } from '../utils.js';

export default function MatchCard({ match, score, onSelect }) {
  const status = matchStatus(match);
  const live = status === 'live';

  return (
    <button
      type="button"
      className={`match-card match-${status}`}
      onClick={() => onSelect(match)}
    >
      <div className="card-top">
        <span className="sport-badge">
          {sportEmoji(match.sport)} {match.sport}
        </span>
        {live ? (
          <span className="chip chip-live">
            <span className="live-dot" /> LIVE
          </span>
        ) : status === 'finished' ? (
          <span className="chip chip-done">FINISHED</span>
        ) : (
          <span className="chip chip-sched">UPCOMING</span>
        )}
      </div>

      <div className="card-teams">
        <div className="team">
          <span className="team-name">{match.homeTeam}</span>
          <span className="team-score">{teamScoreText(match, match.homeTeam, score)}</span>
        </div>
        <div className="versus">vs</div>
        <div className="team">
          <span className="team-score">{teamScoreText(match, match.awayTeam, score)}</span>
          <span className="team-name">{match.awayTeam}</span>
        </div>
      </div>

      <div className="card-foot">
        <span className="clock">{formatClock(match.startTime, match.endTime, status)}</span>
        <span className="arrow">→</span>
      </div>
    </button>
  );
}