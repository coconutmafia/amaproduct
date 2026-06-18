// Shared shape primitives for the «free» designer (element library, step b).
// Rendered IDENTICALLY by the server engine (Satori/next-og) and the editor
// preview (DOM), so what you drag is what you export.
//
// Satori SVG support is limited to what the Scheme template already proves in
// production: an <svg> with <path> children (stroke / fill / strokeLinecap /
// cubic «C» curves). Arrowheads are therefore drawn as two extra <path> strokes
// — NOT <marker>/<polygon>, whose Satori support is uncertain. Badges are plain
// flex divs (no SVG), which Satori renders reliably.
//
// This module has NO 'use client' and imports nothing platform-specific, so it
// is safe to import from both the server engine and client components.

import type { ReactElement } from 'react'

export type FreeShape = 'arrow' | 'arrow-curve' | 'badge'

// Natural width/height ratio per shape, so scaling by width keeps proportions.
export const SHAPE_ASPECT: Record<FreeShape, number> = {
  arrow: 3.0,
  'arrow-curve': 1.9,
  badge: 1,
}

// Pick a readable text colour (black/white) for a filled badge of colour `hex`.
function readableOn(hex: string): string {
  const h = (hex || '').replace('#', '')
  if (h.length < 6) return '#FFFFFF'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return '#FFFFFF'
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#1A1A1A' : '#FFFFFF'
}

// Backward arrowhead: two strokes spreading ±~29° from the travel direction.
function head(tipX: number, tipY: number, theta: number, len: number): string[] {
  const a1 = theta + Math.PI - 0.5
  const a2 = theta + Math.PI + 0.5
  return [
    `M ${tipX} ${tipY} L ${Math.round(tipX + len * Math.cos(a1))} ${Math.round(tipY + len * Math.sin(a1))}`,
    `M ${tipX} ${tipY} L ${Math.round(tipX + len * Math.cos(a2))} ${Math.round(tipY + len * Math.sin(a2))}`,
  ]
}

// An arrow drawn inside a w×h box, pointing RIGHT. The block's rotation aims it.
// curve=true → a hand-drawn swoosh (matches the «сторис-схемы» connector feel).
export function ArrowSvg({ w, h, color, curve = false, stroke }: {
  w: number; h: number; color: string; curve?: boolean; stroke?: number
}): ReactElement {
  const sw = stroke ?? Math.max(3, Math.round(h * 0.16))
  const pad = Math.round(sw * 1.6)
  const tipLen = Math.min(Math.round(h * 0.5), Math.round((w - 2 * pad) * 0.42))

  let shaft: string
  let tipX: number, tipY: number, theta: number
  if (curve) {
    const p0x = pad, p0y = h - pad
    const c1x = Math.round(w * 0.34), c1y = h - pad
    const c2x = Math.round(w * 0.52), c2y = pad
    const p3x = w - pad, p3y = Math.round(h * 0.46)
    shaft = `M ${p0x} ${p0y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p3x} ${p3y}`
    tipX = p3x; tipY = p3y; theta = Math.atan2(p3y - c2y, p3x - c2x)
  } else {
    const yMid = Math.round(h / 2)
    shaft = `M ${pad} ${yMid} L ${w - pad} ${yMid}`
    tipX = w - pad; tipY = yMid; theta = 0
  }

  const paths = [shaft, ...head(tipX, tipY, theta, tipLen)]
  return (
    <svg width={w} height={h}>
      {paths.map((d, i) => (
        <path key={i} d={d} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

// A numbered label — a filled circle with a centred number (owner reference:
// «номерные ярлычки»). Plain flex, so it renders the same in Satori and the DOM.
export function Badge({ size, color, label, fontFamily = 'Montserrat', textColor }: {
  size: number; color: string; label: string; fontFamily?: string; textColor?: string
}): ReactElement {
  return (
    <div style={{
      display: 'flex', width: size, height: size, borderRadius: size,
      backgroundColor: color, alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        display: 'flex', fontFamily, fontWeight: 900,
        fontSize: Math.round(size * 0.52), lineHeight: 1,
        color: textColor || readableOn(color),
      }}>{label}</div>
    </div>
  )
}
