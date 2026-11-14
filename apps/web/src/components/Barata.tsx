/** A barata da logo, mascote das telas de estado (docs/acabamento). Desenho em 320x320, sem o fundo. */
export function Barata({ size, className }: { size: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 320 320">
      <g transform="rotate(25 160 160)">
        <g fill="none" stroke="var(--accent)" strokeLinecap="round" strokeLinejoin="round">
          <path d="M150 78 Q 122 40 92 52" strokeWidth="7" />
          <path d="M170 78 Q 198 40 228 52" strokeWidth="7" />
          <g strokeWidth="9">
            <polyline points="120,138 88,124 74,98" />
            <polyline points="112,172 74,174 54,190" />
            <polyline points="120,206 90,226 82,256" />
            <polyline points="200,138 232,124 246,98" />
            <polyline points="208,172 246,174 266,190" />
            <polyline points="200,206 230,226 238,256" />
          </g>
        </g>
        <circle cx="160" cy="92" r="24" fill="var(--accent)" />
        <ellipse cx="160" cy="176" rx="52" ry="74" fill="var(--accent)" />
      </g>
      <polygon
        points="141,152.5 141,196.5 179,174.5"
        fill="var(--bg)"
        stroke="var(--bg)"
        strokeWidth="8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
