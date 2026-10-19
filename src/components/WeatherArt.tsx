import { motion } from 'framer-motion'

/** Пейзаж для карточки погоды: луна, горы и цветущее дерево — нарисовано в SVG. */
export function WeatherArt() {
  return (
    <svg viewBox="0 0 360 170" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="wa-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9ced8" />
          <stop offset="0.6" stopColor="#dfe1e6" />
          <stop offset="1" stopColor="#eceae9" />
        </linearGradient>
        <radialGradient id="wa-moon" cx="0.42" cy="0.38" r="0.6">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#f4f2ef" />
          <stop offset="1" stopColor="#e2dfdc" />
        </radialGradient>
        <radialGradient id="wa-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wa-hill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5c7564" />
          <stop offset="0.55" stopColor="#3b4f43" />
          <stop offset="1" stopColor="#2b3a31" />
        </linearGradient>
        <linearGradient id="wa-hill2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a7b3ad" />
          <stop offset="1" stopColor="#c6cdc8" />
        </linearGradient>
        <filter id="wa-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id="wa-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
      </defs>
      <rect width="360" height="170" fill="url(#wa-sky)" />
      <motion.g animate={{ y: [0, -4, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
        <circle cx="262" cy="64" r="78" fill="url(#wa-glow)" />
        <circle cx="262" cy="64" r="44" fill="url(#wa-moon)" />
      </motion.g>
      <path
        d="M150 170 C190 120 220 112 252 124 C282 136 310 110 360 118 L360 170 Z"
        fill="url(#wa-hill2)"
        filter="url(#wa-blur)"
      />
      <path
        d="M168 170 C186 132 204 96 228 92 C250 88 258 112 270 120 C284 130 300 128 318 138 C334 146 348 160 360 170 Z"
        fill="url(#wa-hill)"
      />
      <g filter="url(#wa-soft)">
        {[
          [214, 96, 14],
          [232, 86, 16],
          [250, 92, 13],
          [262, 104, 11],
          [224, 104, 10],
          [240, 100, 12],
          [300, 116, 12],
          [314, 108, 14],
          [328, 118, 11],
          [306, 126, 9],
        ].map(([x, y, r], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={r}
            fill={i % 3 === 0 ? '#f2c9d3' : i % 3 === 1 ? '#e9b3c2' : '#f7dbe2'}
            opacity={0.92}
          />
        ))}
      </g>
      <path
        d="M234 132 C236 118 238 108 236 98 M312 140 C313 130 314 122 312 112"
        stroke="#3a2f2d"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
