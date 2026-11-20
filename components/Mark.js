// Cairn's mark: three stacked stones.
export default function Mark({ size = 36, title = 'Cairn' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title} className="mark-svg">
      <ellipse cx="24" cy="39" rx="17" ry="6.5" fill="var(--slate)" />
      <ellipse cx="23" cy="27.5" rx="12" ry="5.5" fill="var(--stone)" />
      <ellipse cx="24.5" cy="17.5" rx="7.5" ry="4.5" fill="var(--amber)" />
    </svg>
  );
}

export function Wordmark({ size = 34 }) {
  return (
    <span className="wordmark">
      <Mark size={size} />
      <span>Cairn</span>
    </span>
  );
}
