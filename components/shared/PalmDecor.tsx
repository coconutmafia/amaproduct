'use client'

import { useId } from 'react'

interface PalmDecorProps {
  className?: string
  style?: React.CSSProperties
  flipped?: boolean
}

/**
 * Full-tree palm silhouette — trunk visible from base to crown,
 * natural drooping fronds. Designed as atmospheric background decoration.
 */
export function PalmDecor({ className, style, flipped }: PalmDecorProps) {
  const raw = useId()
  const id = raw.replace(/:/g, '-')

  const tG = `tg-${id}`  // trunk gradient
  const fG = `fg-${id}`  // frond gradient
  const fL = `fl-${id}`  // frond light
  const cG = `cg-${id}`  // coconut

  // Crown center: (160, 110). ViewBox: 0 0 320 560
  // Trunk S-curves from crown (160,110) to base (158, 548)
  // 9 fronds spread in a natural coconut palm fan

  const fronds: Array<{ path: string; rib: string; grad: string; op: number }> = [
    // 1 — Far-left deep droop
    {
      path: 'M 160 110 Q 82 175 8 268 Q 68 198 160 110 Z',
      rib:  'M 160 110 Q 84 188 8 268',
      grad: fG, op: 0.90,
    },
    // 2 — Mid-left droop
    {
      path: 'M 160 110 Q 95 152 32 198 Q 88 160 160 110 Z',
      rib:  'M 160 110 Q 96 158 32 198',
      grad: fL, op: 0.88,
    },
    // 3 — Left horizontal
    {
      path: 'M 160 110 Q 90 105 10 122 Q 88 120 160 110 Z',
      rib:  'M 160 110 Q 90 112 10 122',
      grad: fG, op: 0.85,
    },
    // 4 — Upper-left 45°
    {
      path: 'M 160 110 Q 100 55 48 10 Q 106 68 160 110 Z',
      rib:  'M 160 110 Q 102 60 48 10',
      grad: fL, op: 0.92,
    },
    // 5 — Straight up
    {
      path: 'M 160 110 Q 147 42 155 -8 Q 168 42 160 110 Z',
      rib:  'M 160 110 Q 155 42 155 -8',
      grad: fG, op: 0.94,
    },
    // 6 — Upper-right 45°
    {
      path: 'M 160 110 Q 220 55 272 10 Q 215 68 160 110 Z',
      rib:  'M 160 110 Q 218 60 272 10',
      grad: fL, op: 0.92,
    },
    // 7 — Right horizontal
    {
      path: 'M 160 110 Q 232 105 310 122 Q 232 120 160 110 Z',
      rib:  'M 160 110 Q 230 112 310 122',
      grad: fG, op: 0.85,
    },
    // 8 — Mid-right droop
    {
      path: 'M 160 110 Q 226 152 288 198 Q 232 162 160 110 Z',
      rib:  'M 160 110 Q 225 158 288 198',
      grad: fL, op: 0.88,
    },
    // 9 — Far-right deep droop
    {
      path: 'M 160 110 Q 238 175 312 268 Q 252 198 160 110 Z',
      rib:  'M 160 110 Q 236 188 312 268',
      grad: fG, op: 0.90,
    },
  ]

  // Bark ring horizontal marks along trunk
  const barkRings = [185, 215, 245, 278, 312, 348, 384, 420, 456, 490].map((y, i) => {
    const progress = (y - 130) / (548 - 130)
    const wHalf = 7 + progress * 8           // trunk widens toward base
    const cx = 160 + (i % 3 - 1) * 1.5     // slight S-curve drift
    return { y, xl: Math.round(cx - wHalf), xr: Math.round(cx + wHalf) }
  })

  return (
    <svg
      viewBox="0 0 320 560"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform: flipped ? 'scaleX(-1)' : undefined, ...style }}
      aria-hidden="true"
    >
      <defs>
        {/* Trunk: dark brown gradient */}
        <linearGradient id={tG} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#3A1E06" />
          <stop offset="30%"  stopColor="#6A3C14" />
          <stop offset="65%"  stopColor="#8C5420" />
          <stop offset="100%" stopColor="#4A2A0C" />
        </linearGradient>
        {/* Frond dark green */}
        <linearGradient id={fG} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1A5E20" />
          <stop offset="50%"  stopColor="#2E8028" />
          <stop offset="100%" stopColor="#3D9A38" />
        </linearGradient>
        {/* Frond light green */}
        <linearGradient id={fL} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#256825" />
          <stop offset="50%"  stopColor="#3A9030" />
          <stop offset="100%" stopColor="#55B545" />
        </linearGradient>
        {/* Coconut */}
        <radialGradient id={cG} cx="35%" cy="35%" r="55%">
          <stop offset="0%"   stopColor="#C89050" />
          <stop offset="50%"  stopColor="#9A5E28" />
          <stop offset="100%" stopColor="#663A12" />
        </radialGradient>
      </defs>

      {/* ─── ROOTS ─── */}
      <path d="M 152 540 Q 128 546 105 552 Q 126 542 148 534 Z" fill="#3A1E06" opacity="0.5" />
      <path d="M 168 540 Q 192 546 215 552 Q 194 542 172 534 Z" fill="#3A1E06" opacity="0.5" />
      <path d="M 150 545 Q 132 552 112 556 Q 130 546 146 538 Z" fill="#2A1204" opacity="0.35" />
      <path d="M 170 545 Q 188 552 208 556 Q 190 546 174 538 Z" fill="#2A1204" opacity="0.35" />

      {/* ─── TRUNK (filled S-curve, widens toward base) ─── */}
      <path
        d="M 153 114
           C 147 200 156 300 149 390
           C 144 450 142 500 140 540
           L 163 540
           C 162 500 161 450 158 390
           C 158 300 163 200 167 114
           Z"
        fill={`url(#${tG})`}
      />
      {/* Trunk highlight (light stripe) */}
      <path
        d="M 157 118
           C 154 200 158 300 155 390
           C 153 450 153 500 153 540
           L 157 540
           C 157 500 157 450 157 390
           C 158 300 161 200 161 118
           Z"
        fill="#C8905A"
        opacity="0.22"
      />
      {/* Bark rings */}
      {barkRings.map((r, i) => (
        <path
          key={i}
          d={`M ${r.xl} ${r.y} Q ${(r.xl + r.xr) / 2} ${r.y + 5} ${r.xr} ${r.y}`}
          stroke="#2A1204"
          strokeWidth="1.1"
          fill="none"
          opacity="0.30"
        />
      ))}

      {/* ─── FRONDS ─── */}
      {fronds.map((fr, fi) => (
        <g key={fi} opacity={fr.op}>
          {/* Leaf body */}
          <path d={fr.path} fill={`url(#${fr.grad})`} />
          {/* Central rib */}
          <path d={fr.rib} stroke="#164814" strokeWidth="1.3" fill="none" opacity="0.50" />
          {/* Leaflet pairs along rib — 6 evenly spaced */}
          {[0.22, 0.38, 0.52, 0.65, 0.76, 0.86].map((t, li) => {
            // Approximate point on quadratic bezier at parameter t
            // For rib path M x0 y0 Q cx cy x1 y1:
            const ribData: Record<number, [number, number, number, number, number, number]> = {
              0: [160, 110, 84, 188, 8, 268],
              1: [160, 110, 96, 158, 32, 198],
              2: [160, 110, 90, 112, 10, 122],
              3: [160, 110, 102, 60, 48, 10],
              4: [160, 110, 155, 42, 155, -8],
              5: [160, 110, 218, 60, 272, 10],
              6: [160, 110, 230, 112, 310, 122],
              7: [160, 110, 225, 158, 288, 198],
              8: [160, 110, 236, 188, 312, 268],
            }
            const [x0, y0, cx, cy, x1, y1] = ribData[fi] ?? [160, 110, 160, 50, 160, -10]
            const bx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1
            const by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1
            // Tangent direction
            const tx2 = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx)
            const ty2 = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy)
            const len = Math.sqrt(tx2 * tx2 + ty2 * ty2) || 1
            // Perpendicular
            const px = (-ty2 / len) * 9
            const py = (tx2 / len) * 9
            return (
              <g key={li} opacity={0.65 - li * 0.06}>
                <line x1={bx} y1={by} x2={bx + px} y2={by + py} stroke={`url(#${fr.grad})`} strokeWidth="1.1" strokeLinecap="round" />
                <line x1={bx} y1={by} x2={bx - px} y2={by - py} stroke={`url(#${fr.grad})`} strokeWidth="1.1" strokeLinecap="round" />
              </g>
            )
          })}
        </g>
      ))}

      {/* ─── COCONUTS ─── */}
      <circle cx="168" cy="122" r="8"   fill={`url(#${cG})`} />
      <circle cx="168" cy="122" r="8"   fill="none" stroke="#2A1004" strokeWidth="1.2" opacity="0.4" />
      <circle cx="154" cy="125" r="7.5" fill={`url(#${cG})`} />
      <circle cx="154" cy="125" r="7.5" fill="none" stroke="#2A1004" strokeWidth="1.2" opacity="0.4" />
      <circle cx="172" cy="133" r="7"   fill={`url(#${cG})`} />
      <circle cx="172" cy="133" r="7"   fill="none" stroke="#2A1004" strokeWidth="1.1" opacity="0.4" />
      {/* Crown base leaf cluster */}
      <ellipse cx="160" cy="115" rx="14" ry="8" fill="#3A2A0A" opacity="0.45" />
    </svg>
  )
}
