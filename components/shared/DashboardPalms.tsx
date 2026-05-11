'use client'

import { PalmDecor } from './PalmDecor'

/**
 * Full-tree palm silhouette background for the dashboard.
 * Multiple trees at different scales create a tropical grove feel.
 */
export function DashboardPalms() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
      {/* Bottom-left — large main tree */}
      <PalmDecor
        className="absolute bottom-0 left-[-30px] w-80 h-auto"
        style={{ opacity: 0.18 }}
      />
      {/* Bottom-right — large, mirrored */}
      <PalmDecor
        flipped
        className="absolute bottom-0 right-[-30px] w-80 h-auto"
        style={{ opacity: 0.18 }}
      />
      {/* Bottom-center-right — medium, slightly behind */}
      <PalmDecor
        className="absolute bottom-0 right-[15%] w-56 h-auto"
        style={{ opacity: 0.08, transform: 'rotate(6deg)', transformOrigin: 'bottom center' }}
      />
      {/* Bottom-center-left — medium, angled */}
      <PalmDecor
        flipped
        className="absolute bottom-0 left-[12%] w-56 h-auto"
        style={{ opacity: 0.08, transform: 'scaleX(-1) rotate(4deg)', transformOrigin: 'bottom center' }}
      />
      {/* Mid-right edge — peeking from right, leaning */}
      <PalmDecor
        flipped
        className="absolute bottom-[5%] right-[-70px] w-48 h-auto"
        style={{ opacity: 0.10, transform: 'scaleX(-1) rotate(-12deg)', transformOrigin: 'bottom right' }}
      />
    </div>
  )
}
