'use client'

import { PalmDecor } from './PalmDecor'

export function DashboardPalms() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
      {/* Left palm - bottom left corner peeking in */}
      <PalmDecor
        className="absolute bottom-0 left-0 w-56 h-auto opacity-[0.08]"
      />
      {/* Right palm - bottom right corner, mirrored */}
      <PalmDecor
        flipped
        className="absolute bottom-0 right-0 w-56 h-auto opacity-[0.08]"
      />
    </div>
  )
}
