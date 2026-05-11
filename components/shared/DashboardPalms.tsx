'use client'

/**
 * Real palm photo backgrounds for the dashboard.
 * Uses the same photos as the landing page.
 */
export function DashboardPalms() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
      {/* Bottom-left — tall palms photo */}
      <div
        className="absolute bottom-0 left-0 w-72 h-96"
        style={{
          backgroundImage: 'url(/palm-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center bottom',
          opacity: 0.12,
          maskImage: 'linear-gradient(to top right, rgba(0,0,0,1) 30%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top right, rgba(0,0,0,1) 30%, transparent 100%)',
        }}
      />
      {/* Bottom-right — mirrored tall palms */}
      <div
        className="absolute bottom-0 right-0 w-72 h-96"
        style={{
          backgroundImage: 'url(/palm-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center bottom',
          opacity: 0.12,
          transform: 'scaleX(-1)',
          maskImage: 'linear-gradient(to top left, rgba(0,0,0,1) 30%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top left, rgba(0,0,0,1) 30%, transparent 100%)',
        }}
      />
      {/* Top-right corner — palm leaves */}
      <div
        className="absolute top-0 right-0 w-64 h-64"
        style={{
          backgroundImage: 'url(/palm-leaves-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          opacity: 0.08,
          maskImage: 'linear-gradient(to bottom left, rgba(0,0,0,1) 20%, transparent 80%)',
          WebkitMaskImage: 'linear-gradient(to bottom left, rgba(0,0,0,1) 20%, transparent 80%)',
        }}
      />
    </div>
  )
}
