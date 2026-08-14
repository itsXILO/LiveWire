import { eventStyle } from '../utils.js';

export default function EventBadge({ eventType }) {
  const style = eventStyle(eventType);
  return (
    <span className={`evt-badge ${style.className}`}>
      {style.label}
      {eventType === 'yellow_card' && <i className="card-icon yellow" />}
      {eventType === 'red_card' && <i className="card-icon red" />}
    </span>
  );
}