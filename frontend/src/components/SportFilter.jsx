export default function SportFilter({ sports, active, onChange }) {
  const options = ['all', ...sports];

  return (
    <div className="sport-filter">
      {options.map((s) => (
        <button
          key={s}
          type="button"
          className={`sport-btn ${active === s ? 'active' : ''}`}
          onClick={() => onChange(s)}
        >
          {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}