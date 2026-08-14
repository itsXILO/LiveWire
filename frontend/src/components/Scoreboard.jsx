import { matchStatus, formatClock, sportEmoji } from '../utils.js';

export default function Scoreboard({ match, onBack }) {
  const status = matchStatus(match);
  const live = status === 'live';
  const flashClass = live ? 'score-flash' : '';

  return (
    <section className="scoreboard">
      <button type="button" className="back-btn" onClick={onBack}>
        ← All matches
      </button>

      <div className="scoreboard-inner">
        <div className="sb-sport">
          <span className="sport-badge sb-badge">
            {sportEmoji(match.sport)} {match.sport}
          </span>
          {live && (
            <span className="chip chip-live">
              <span className="live-dot" /> LIVE
            </span>
          )}
        </div>

        <div className="sb-teams">
          <div className="sb-team">
            <span className="sb-name">{match.homeTeam}</span>
            <span key={match.homeScore} className={`sb-score ${flashClass}`}>
              {match.homeScore ?? 0}
            </span>
          </div>
          <div className="sb-mid">
            <span className="sb-verse">vs</span>
            <span className="sb-clock">
              {formatClock(match.startTime, match.endTime, status)}
            </span>
          </div>
          <div className="sb-team">
            <span className={`sb-score ${flashClass}`} key={match.awayScore}>
              {match.awayScore ?? 0}
            </span>
            <span className="sb-name">{match.awayTeam}</span>
          </div>
        </div>
      </div>
    </section>
  );
}