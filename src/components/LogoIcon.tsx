export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-label="Delta"
    >
      <path d="M50 22 L78 76 L22 76 Z" stroke="currentColor" strokeWidth="5.5" fill="none" strokeLinejoin="round"/>
      <path d="M50 22 L78 76" stroke="currentColor" strokeWidth="11" strokeLinecap="round"/>
      <circle cx="50" cy="22" r="8" fill="currentColor"/>
      <circle cx="78" cy="76" r="8" fill="currentColor"/>
      <circle cx="22" cy="76" r="8" fill="currentColor"/>
    </svg>
  );
}
