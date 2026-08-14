import { useEffect, useRef } from 'react';
import EventBadge from './EventBadge.jsx';

function timeLabel(comment) {
  const parts = [];
  if (comment.period) parts.push(comment.period);
  if (comment.minute != null) parts.push(`${comment.minute}'`);
  return parts.join(' · ');
}

export default function CommentaryFeed({ comments }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [comments.length]);

  if (comments.length === 0) {
    return (
      <div className="feed-empty">
        <span className="feed-empty-icon">📡</span>
        <p>No commentary yet. Connecting to the live feed…</p>
      </div>
    );
  }

  return (
    <div className="feed">
      {comments.map((c) => (
        <article className="entry" key={c.id}>
          <div className="entry-rail">
            <span className="entry-time">{timeLabel(c) || '•'}</span>
          </div>
          <div className="entry-body">
            <div className="entry-head">
              <EventBadge eventType={c.eventType} />
              {c.actor && <span className="entry-actor">{c.actor}</span>}
            </div>
            <p className="entry-msg">{c.message}</p>
            {c.tags?.length > 0 && (
              <div className="entry-tags">
                {c.tags.map((t) => (
                  <span className="tag" key={t}>
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </article>
      ))}
      <div ref={endRef} />
    </div>
  );
}