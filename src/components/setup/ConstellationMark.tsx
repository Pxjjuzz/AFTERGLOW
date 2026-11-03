export function ConstellationMark() {
  return (
    <svg
      className="constellation-mark"
      width="142"
      height="34"
      viewBox="0 0 142 34"
      fill="none"
      aria-hidden="true"
    >
      <path d="M8 24L38 9L66 20L94 5L134 18" stroke="rgba(155,107,255,0.35)" strokeWidth="0.7" />
      <path d="M38 9L94 5" stroke="rgba(155,107,255,0.14)" strokeWidth="0.6" />
      <circle cx="8" cy="24" r="1.2" fill="rgba(245,240,255,0.55)" />
      <circle cx="38" cy="9" r="1.7" fill="rgba(220,203,255,0.9)" />
      <circle cx="66" cy="20" r="1" fill="rgba(245,240,255,0.42)" />
      <circle cx="94" cy="5" r="1.4" fill="rgba(220,203,255,0.8)" />
      <circle cx="134" cy="18" r="1.1" fill="rgba(245,240,255,0.5)" />
      <circle cx="66" cy="20" r="5" stroke="rgba(155,107,255,0.14)" strokeWidth="0.6" />
      <circle cx="94" cy="5" r="6" stroke="rgba(155,107,255,0.1)" strokeWidth="0.6" />
    </svg>
  );
}
