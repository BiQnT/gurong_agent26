export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark ${large ? 'brand-mark-large' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none">
        <path
          d="M9 25c5-9 10 9 15 0s10 9 15 0M9 33c5-9 10 9 15 0s10 9 15 0"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M20 15a6 6 0 0 1 12 0"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
