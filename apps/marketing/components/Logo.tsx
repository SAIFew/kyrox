export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="logo-mark" height={size} viewBox="0 0 64 64" width={size}>
      <rect width="64" height="64" rx="14" fill="#0b0e13" />
      <path
        d="M20 16v32M20 34l18-18M20 34l20 14"
        fill="none"
        stroke="#7cf0c1"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="6"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">KYROX</span>
    </span>
  );
}
