export default function Header({ connectionStatus }) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-logo">⬡</span>
        <h1 className="brand-name">
          Live<span>Wire</span>
        </h1>
      </div>
      <div className={`conn-pill conn-${connectionStatus}`}>
        <span className="conn-dot" />
        {connectionStatus === 'connected'
          ? 'Live'
          : connectionStatus === 'reconnecting'
            ? 'Reconnecting'
            : 'Connecting'}
      </div>
    </header>
  );
}