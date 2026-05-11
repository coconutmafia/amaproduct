'use client'

import { useId } from 'react'

interface PalmDecorProps {
  className?: string
  style?: React.CSSProperties
  flipped?: boolean
}

export function PalmDecor({ className, style, flipped }: PalmDecorProps) {
  const raw = useId()
  const id = raw.replace(/:/g, '-')

  const tG  = `pt-${id}`   // trunk gradient
  const tH  = `th-${id}`   // trunk highlight
  const fA  = `fa-${id}`   // frond dark
  const fB  = `fb-${id}`   // frond mid
  const fC  = `fc-${id}`   // frond light
  const cG  = `cg-${id}`   // coconut

  // Crown is at (140, 158). All frond paths are M 140 158 Q c1 tip Q c2 140 158 Z
  // Trunk runs from crown (140,158) down to (140,480) with S-curve fill.

  const fronds: Array<{
    path: string
    rib: string
    leaflets: string[]
    grad: string
    opacity: number
  }> = [
    // 1 — Far-left drooping
    {
      path: 'M 140 158 Q 62 196 5 260 Q 83 225 140 158 Z',
      rib:  'M 140 158 Q 72 210 5 260',
      leaflets: [
        'M 120 175 L 108 163', 'M 120 175 L 112 188',
        'M 100 191 L 86 178', 'M 100 191 L 93 205',
        'M 79 208 L 65 195', 'M 79 208 L 73 222',
        'M 58 224 L 47 211', 'M 58 224 L 52 238',
      ],
      grad: fA,
      opacity: 0.92,
    },
    // 2 — Left horizontal
    {
      path: 'M 140 158 Q 77 147 15 165 Q 78 178 140 158 Z',
      rib:  'M 140 158 Q 78 162 15 165',
      leaflets: [
        'M 118 154 L 110 145', 'M 118 154 L 115 164',
        'M 97 159 L 88 150', 'M 97 159 L 93 169',
        'M 76 162 L 67 154', 'M 76 162 L 72 172',
        'M 55 164 L 46 157', 'M 55 164 L 51 173',
      ],
      grad: fB,
      opacity: 0.88,
    },
    // 3 — Upper-left
    {
      path: 'M 140 158 Q 92 92 20 50 Q 68 118 140 158 Z',
      rib:  'M 140 158 Q 80 104 20 50',
      leaflets: [
        'M 124 143 L 118 132', 'M 124 143 L 131 138',
        'M 107 128 L 100 117', 'M 107 128 L 115 123',
        'M 89 112 L 82 102', 'M 89 112 L 97 108',
        'M 72 97 L 65 87',  'M 72 97 L 80 93',
        'M 54 81 L 48 72',  'M 54 81 L 62 77',
      ],
      grad: fB,
      opacity: 0.90,
    },
    // 4 — Straight up
    {
      path: 'M 140 158 Q 156 82 135 5 Q 120 83 140 158 Z',
      rib:  'M 140 158 Q 138 82 135 5',
      leaflets: [
        'M 149 137 L 160 130', 'M 149 137 L 136 130',
        'M 145 115 L 157 107', 'M 145 115 L 131 108',
        'M 141 92 L 153 84',  'M 141 92 L 127 85',
        'M 138 68 L 150 62',  'M 138 68 L 124 61',
        'M 136 44 L 146 38',  'M 136 44 L 123 37',
      ],
      grad: fC,
      opacity: 0.92,
    },
    // 5 — Upper-right
    {
      path: 'M 140 158 Q 210 121 255 55 Q 185 94 140 158 Z',
      rib:  'M 140 158 Q 198 108 255 55',
      leaflets: [
        'M 156 143 L 165 131', 'M 156 143 L 149 132',
        'M 173 128 L 182 116', 'M 173 128 L 165 118',
        'M 190 112 L 200 100', 'M 190 112 L 182 102',
        'M 208 96 L 218 84',  'M 208 96 L 200 86',
        'M 227 79 L 236 68',  'M 227 79 L 218 70',
      ],
      grad: fB,
      opacity: 0.90,
    },
    // 6 — Right horizontal
    {
      path: 'M 140 158 Q 207 179 275 165 Q 208 147 140 158 Z',
      rib:  'M 140 158 Q 208 162 275 165',
      leaflets: [
        'M 162 162 L 166 172', 'M 162 162 L 160 151',
        'M 183 165 L 188 176', 'M 183 165 L 180 154',
        'M 205 166 L 211 177', 'M 205 166 L 202 155',
        'M 228 166 L 233 176', 'M 228 166 L 224 155',
        'M 250 165 L 255 175', 'M 250 165 L 247 154',
      ],
      grad: fA,
      opacity: 0.88,
    },
    // 7 — Far-right drooping
    {
      path: 'M 140 158 Q 194 226 270 265 Q 216 199 140 158 Z',
      rib:  'M 140 158 Q 205 212 270 265',
      leaflets: [
        'M 160 174 L 150 182', 'M 160 174 L 166 167',
        'M 180 191 L 169 199', 'M 180 191 L 186 184',
        'M 200 208 L 189 217', 'M 200 208 L 207 202',
        'M 222 224 L 211 233', 'M 222 224 L 228 217',
        'M 244 241 L 234 250', 'M 244 241 L 250 234',
      ],
      grad: fA,
      opacity: 0.88,
    },
    // 8 — Lower-left
    {
      path: 'M 140 158 Q 67 200 15 265 Q 88 225 140 158 Z',
      rib:  'M 140 158 Q 78 212 15 265',
      leaflets: [
        'M 119 172 L 109 166', 'M 119 172 L 117 184',
        'M 99 187 L 88 181',  'M 99 187 L 97 199',
        'M 78 202 L 67 197',  'M 78 202 L 76 214',
        'M 57 218 L 47 213',  'M 57 218 L 56 230',
      ],
      grad: fB,
      opacity: 0.84,
    },
  ]

  // Sub-leaflet rib points helper — 6 points along each frond rib
  const barkRings = [
    { y: 430, xl: 131, xr: 150 },
    { y: 405, xl: 130, xr: 150 },
    { y: 378, xl: 130, xr: 151 },
    { y: 350, xl: 130, xr: 151 },
    { y: 322, xl: 131, xr: 151 },
    { y: 294, xl: 131, xr: 150 },
    { y: 266, xl: 132, xr: 149 },
    { y: 238, xl: 132, xr: 149 },
    { y: 210, xl: 133, xr: 148 },
    { y: 183, xl: 134, xr: 147 },
  ]

  return (
    <svg
      viewBox="0 0 280 480"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform: flipped ? 'scaleX(-1)' : undefined, ...style }}
      aria-hidden="true"
    >
      <defs>
        {/* Trunk */}
        <linearGradient id={tG} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#4A2E0E" />
          <stop offset="30%"  stopColor="#7A5020" />
          <stop offset="65%"  stopColor="#9E6D30" />
          <stop offset="100%" stopColor="#5A3815" />
        </linearGradient>
        <linearGradient id={tH} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#C8935A" stopOpacity="0" />
          <stop offset="45%"  stopColor="#DCA86A" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#C8935A" stopOpacity="0" />
        </linearGradient>
        {/* Frond greens — dark → mid → light */}
        <linearGradient id={fA} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1F5C14" />
          <stop offset="50%"  stopColor="#2E8020" />
          <stop offset="100%" stopColor="#3DA030" />
        </linearGradient>
        <linearGradient id={fB} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#2B7020" />
          <stop offset="50%"  stopColor="#3D9430" />
          <stop offset="100%" stopColor="#55B845" />
        </linearGradient>
        <linearGradient id={fC} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#378228" />
          <stop offset="50%"  stopColor="#4EAA3A" />
          <stop offset="100%" stopColor="#72CC58" />
        </linearGradient>
        {/* Coconut */}
        <radialGradient id={cG} cx="35%" cy="35%" r="55%">
          <stop offset="0%"   stopColor="#C89558" />
          <stop offset="50%"  stopColor="#9A6030" />
          <stop offset="100%" stopColor="#6A3E18" />
        </radialGradient>
      </defs>

      {/* ─── ROOTS ─── */}
      <path d="M 132 468 Q 108 472 88 478 Q 106 470 128 462 Z" fill="#5A3815" opacity="0.55" />
      <path d="M 148 468 Q 172 472 192 478 Q 174 470 152 462 Z" fill="#5A3815" opacity="0.55" />
      <path d="M 130 472 Q 116 478 98 480 Q 114 474 128 466 Z" fill="#4A2E0E" opacity="0.35" />
      <path d="M 150 472 Q 164 478 182 480 Q 166 474 152 466 Z" fill="#4A2E0E" opacity="0.35" />

      {/* ─── TRUNK (filled S-curve shape) ─── */}
      <path
        d="M 133 162
           C 127 230 137 295 131 360
           C 125 410 127 445 128 468
           L 152 468
           C 151 445 150 410 149 360
           C 143 295 153 230 147 162
           Z"
        fill={`url(#${tG})`}
      />
      {/* Highlight */}
      <path
        d="M 138 165
           C 135 230 140 295 138 360
           C 136 410 138 445 139 468
           L 142 468
           C 143 445 142 410 141 360
           C 141 295 145 230 142 165
           Z"
        fill={`url(#${tH})`}
      />
      {/* Bark rings */}
      {barkRings.map((r, i) => (
        <path
          key={i}
          d={`M ${r.xl} ${r.y} Q ${(r.xl + r.xr) / 2} ${r.y + 4} ${r.xr} ${r.y}`}
          stroke="#3A1E08"
          strokeWidth="0.9"
          fill="none"
          opacity="0.28"
        />
      ))}

      {/* ─── FRONDS ─── */}
      {fronds.map((fr, fi) => (
        <g key={fi} opacity={fr.opacity}>
          {/* Filled leaf body */}
          <path d={fr.path} fill={`url(#${fr.grad})`} />
          {/* Central rib */}
          <path d={fr.rib} stroke="#1A4810" strokeWidth="1.2" fill="none" opacity="0.55" />
          {/* Sub-leaflets */}
          {fr.leaflets.map((l, li) => (
            <path
              key={li}
              d={l}
              stroke={`url(#${fr.grad})`}
              strokeWidth="1.3"
              strokeLinecap="round"
              fill="none"
              opacity={0.7 - li * 0.03}
            />
          ))}
        </g>
      ))}

      {/* ─── COCONUTS ─── */}
      <circle cx="148" cy="170" r="7.5" fill={`url(#${cG})`} />
      <circle cx="148" cy="170" r="7.5" fill="none" stroke="#3A1808" strokeWidth="1" opacity="0.35" />
      <circle cx="136" cy="173" r="7"   fill={`url(#${cG})`} />
      <circle cx="136" cy="173" r="7"   fill="none" stroke="#3A1808" strokeWidth="1" opacity="0.35" />
      <circle cx="152" cy="180" r="6.5" fill={`url(#${cG})`} />
      <circle cx="152" cy="180" r="6.5" fill="none" stroke="#3A1808" strokeWidth="1" opacity="0.35" />
      {/* Crown base */}
      <ellipse cx="140" cy="162" rx="12" ry="7" fill="#6A3E18" opacity="0.55" />
    </svg>
  )
}
