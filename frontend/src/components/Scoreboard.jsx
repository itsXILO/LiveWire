import { matchStatus, formatClock, sportEmoji, teamScoreText } from '../utils.js';

export default function Scoreboard({ match, score, onBack }) {
  const status = matchStatus(match);
  const live = status === 'live';
  const flashClass = live ? 'score-flash' : '';
  const homeText = teamScoreText(match, match.homeTeam, score);
  const awayText = teamScoreText(match, match.awayTeam, score);

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
            <span key={homeText} className={`sb-score ${flashClass}`}>
              {homeText}
            </span>
          </div>
          <div className="sb-mid">
            <span className="sb-verse">vs</span>
            <span className="sb-clock">
              {formatClock(match.startTime, match.endTime, status)}
            </span>
          </div>
          <div className="sb-team">
            <span key={awayText} className={`sb-score ${flashClass}`}>
              {awayText}
            </span>
            <span className="sb-name">{match.awayTeam}</span>
          </div>
        </div>
      </div>
    </section>
  );
}