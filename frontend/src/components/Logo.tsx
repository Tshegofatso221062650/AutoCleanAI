interface LogoProps {
  size?: number;
  className?: string;
  /** true (default) = full branded dark container. false = transparent, bars + spark only (for sidebar). */
  standalone?: boolean;
}

export function Logo({ size = 80, className = "", standalone = true }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="AutoClean AI"
      className={className}
    >
      <defs>
        <linearGradient id="acLogoBarGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#818CF8" />
        </linearGradient>
        <filter id="acLogoSparkGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {standalone && (
        <>
          <rect width="80" height="80" rx="18" fill="#0a0d14" />
          <rect width="80" height="80" rx="18" fill="none" stroke="#22D3EE" strokeWidth="0.75" opacity="0.5" />
        </>
      )}

      <rect x="11" y="14" width="58" height="13" rx="3" fill="url(#acLogoBarGrad)" opacity="1"    transform="rotate(-4,40,20)" />
      <rect x="11" y="34" width="58" height="13" rx="3" fill="url(#acLogoBarGrad)" opacity="0.65" transform="rotate(-4,40,40)" />
      <rect x="11" y="54" width="58" height="13" rx="3" fill="url(#acLogoBarGrad)" opacity="0.35" transform="rotate(-4,40,60)" />

      <circle cx="64" cy="13" r="7" fill="var(--accent, #22D3EE)" opacity="0.18" />
      <g transform="translate(64,13)" filter="url(#acLogoSparkGlow)">
        <polygon
          points="0,-7 1.7,-1.7 7,0 1.7,1.7 0,7 -1.7,1.7 -7,0 -1.7,-1.7"
          fill="var(--accent, #22D3EE)"
        />
      </g>
    </svg>
  );
}
