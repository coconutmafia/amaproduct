'use client'

import { PalmDecor } from './PalmDecor'

export function DashboardPalms() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
      {/* Bottom-left — large, main palm */}
      <PalmDecor
        className="absolute bottom-0 left-[-20px] w-72 h-auto"
        style={{ opacity: 0.16 }}
      />
      {/* Bottom-right — large, flipped */}
      <PalmDecor
        flipped
        className="absolute bottom-0 right-[-20px] w-72 h-auto"
        style={{ opacity: 0.16 }}
      />
      {/* Mid-right — smaller, peeking from right edge, rotated */}
      <PalmDecor
        flipped
        className="absolute top-[15%] right-[-60px] w-52 h-auto"
        style={{ opacity: 0.09, transform: 'scaleX(-1) rotate(-15deg)', transformOrigin: 'bottom right' }}
      />
      {/* Top-left — tiny, rotated, adds depth */}
      <PalmDecor
        className="absolute top-[-60px] left-[-30px] w-48 h-auto"
        style={{ opacity: 0.07, transform: 'rotate(12deg)', transformOrigin: 'bottom left' }}
      />
    </div>
  )
}
