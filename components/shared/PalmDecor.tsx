'use client'

import { useId } from 'react'

interface PalmDecorProps {
  className?: string
  style?: React.CSSProperties
  flipped?: boolean
}

export function PalmDecor({ className, style, flipped }: PalmDecorProps) {
  const id = useId().replace(/:/g, '-')

  const trunkGradId = `palm-trunk-${id}`
  const trunkHighlightId = `palm-trunk-hi-${id}`
  const frondGradId = `palm-frond-${id}`
  const frondMidId = `palm-frond-mid-${id}`
  const frondLightId = `palm-frond-light-${id}`
  const rootGradId = `palm-root-${id}`
  const coconutGradId = `palm-coconut-${id}`

  return (
    <svg
      viewBox="0 0 220 440"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        ...style,
        transform: flipped ? 'scaleX(-1)' : undefined,
      }}
      aria-hidden="true"
    >
      <defs>
        {/* Trunk gradient - warm brown with depth */}
        <linearGradient id={trunkGradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5C3A1E" />
          <stop offset="30%" stopColor="#8B5E2E" />
          <stop offset="60%" stopColor="#A67C45" />
          <stop offset="100%" stopColor="#6B4520" />
        </linearGradient>
        {/* Trunk highlight strip */}
        <linearGradient id={trunkHighlightId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#C49A5A" stopOpacity="0" />
          <stop offset="50%" stopColor="#D4AA6A" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#C49A5A" stopOpacity="0" />
        </linearGradient>
        {/* Dark base frond gradient */}
        <linearGradient id={frondGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(112, 60%, 22%)" />
          <stop offset="50%" stopColor="hsl(118, 62%, 32%)" />
          <stop offset="100%" stopColor="hsl(125, 58%, 44%)" />
        </linearGradient>
        {/* Mid frond gradient */}
        <linearGradient id={frondMidId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(115, 58%, 28%)" />
          <stop offset="50%" stopColor="hsl(122, 60%, 38%)" />
          <stop offset="100%" stopColor="hsl(130, 56%, 52%)" />
        </linearGradient>
        {/* Light tip frond gradient */}
        <linearGradient id={frondLightId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(118, 55%, 35%)" />
          <stop offset="100%" stopColor="hsl(135, 52%, 60%)" />
        </linearGradient>
        {/* Root gradient */}
        <linearGradient id={rootGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7A5030" />
          <stop offset="100%" stopColor="#4A2E10" />
        </linearGradient>
        {/* Coconut gradient */}
        <linearGradient id={coconutGradId} x1="20%" y1="20%" x2="80%" y2="80%">
          <stop offset="0%" stopColor="#C8955A" />
          <stop offset="50%" stopColor="#9B6535" />
          <stop offset="100%" stopColor="#7A4820" />
        </linearGradient>
      </defs>

      {/* === ROOTS (subtle, at base) === */}
      <g opacity="0.85">
        {/* Left root */}
        <path
          d="M 100 418 Q 75 428 55 435 Q 65 425 85 415 Z"
          fill={`url(#${rootGradId})`}
          opacity="0.7"
        />
        {/* Right root */}
        <path
          d="M 110 418 Q 138 426 158 430 Q 142 422 122 414 Z"
          fill={`url(#${rootGradId})`}
          opacity="0.7"
        />
        {/* Center root spread */}
        <path
          d="M 96 422 Q 88 435 70 440 Q 88 432 100 422 Z"
          fill={`url(#${rootGradId})`}
          opacity="0.5"
        />
        <path
          d="M 114 422 Q 124 433 145 438 Q 128 430 112 420 Z"
          fill={`url(#${rootGradId})`}
          opacity="0.5"
        />
      </g>

      {/* === TRUNK (S-curved, tapered, bark texture) === */}
      {/* Main trunk body — S-curve from wide base to narrow crown */}
      {/* Base ~105,425 wide 28px; crown ~108,155 wide 12px */}
      <path
        d={[
          'M 91 425',       // base left
          'C 78 380 82 330 88 280',  // left edge curving
          'C 92 230 84 190 96 155',  // left edge upper — crown left
          'L 104 150',              // crown top left
          'C 110 160 116 175 118 200', // right edge upper
          'C 122 240 118 295 122 340',
          'C 126 385 120 405 119 425', // base right
          'Z'
        ].join(' ')}
        fill={`url(#${trunkGradId})`}
      />
      {/* Trunk highlight */}
      <path
        d={[
          'M 97 420',
          'C 90 375 93 325 96 275',
          'C 98 230 92 190 100 158',
          'L 104 156',
          'C 108 175 108 220 108 270',
          'C 108 320 110 375 112 420',
          'Z'
        ].join(' ')}
        fill={`url(#${trunkHighlightId})`}
        opacity="0.6"
      />
      {/* Bark texture rings — horizontal lines across trunk at intervals */}
      {[
        { y: 390, xl: 93, xr: 118 },
        { y: 365, xl: 92, xr: 117 },
        { y: 338, xl: 91, xr: 117 },
        { y: 312, xl: 91, xr: 118 },
        { y: 285, xl: 90, xr: 118 },
        { y: 260, xl: 90, xr: 118 },
        { y: 235, xl: 90, xr: 117 },
        { y: 210, xl: 91, xr: 116 },
        { y: 186, xl: 93, xr: 114 },
        { y: 164, xl: 96, xr: 111 },
      ].map((ring, i) => (
        <path
          key={i}
          d={`M ${ring.xl} ${ring.y} Q ${(ring.xl + ring.xr) / 2} ${ring.y + 3} ${ring.xr} ${ring.y}`}
          stroke="#4A2E10"
          strokeWidth="0.8"
          fill="none"
          opacity="0.35"
        />
      ))}

      {/* === FRONDS === */}
      {/* Crown junction point: approximately (102, 152) */}

      {/* --- Frond 1: Far left, drooping down-left --- */}
      <g>
        {/* Main rib */}
        <path
          d="M 102 152 Q 70 140 28 175 Q 15 188 8 205"
          stroke="hsl(112,60%,22%)"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Leaflets along left-drooping frond */}
        {[
          // [cx, cy, angle, w, h] — placed along the rib
          [85, 146, -30, 18, 7],
          [70, 148, -20, 20, 7],
          [55, 154, -10, 22, 7],
          [40, 163, 5, 22, 7],
          [28, 174, 15, 20, 7],
          [18, 185, 25, 18, 6],
          [10, 197, 35, 15, 6],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondGradId})`}
            opacity={0.9 - i * 0.05}
          />
        ))}
        {/* Leaflets opposite side */}
        {[
          [82, 152, -50, 14, 5],
          [67, 157, -40, 16, 5],
          [52, 167, -25, 16, 5],
          [38, 178, -10, 15, 5],
          [25, 189, 5, 14, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.8 - i * 0.05}
          />
        ))}
      </g>

      {/* --- Frond 2: Upper-left, sweeping up and left --- */}
      <g>
        <path
          d="M 102 152 Q 72 118 40 88 Q 22 72 12 52"
          stroke="hsl(115,60%,24%)"
          strokeWidth="1.5"
          fill="none"
        />
        {[
          [88, 139, -55, 20, 7],
          [74, 126, -48, 22, 7],
          [60, 113, -42, 22, 7],
          [46, 100, -38, 20, 7],
          [32, 86, -35, 18, 6],
          [20, 72, -30, 16, 6],
          [14, 60, -28, 14, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.9 - i * 0.04}
          />
        ))}
        {[
          [83, 145, -75, 14, 5],
          [69, 132, -68, 16, 5],
          [55, 119, -62, 16, 5],
          [41, 106, -58, 15, 5],
          [28, 92, -52, 14, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondLightId})`}
            opacity={0.75 - i * 0.04}
          />
        ))}
      </g>

      {/* --- Frond 3: Left-center, sweeping up-left at ~330° --- */}
      <g>
        <path
          d="M 102 152 Q 80 105 68 62 Q 62 40 60 18"
          stroke="hsl(118,60%,26%)"
          strokeWidth="1.5"
          fill="none"
        />
        {[
          [96, 135, -75, 20, 7],
          [88, 117, -70, 22, 7],
          [80, 98, -68, 22, 7],
          [74, 79, -65, 20, 7],
          [68, 60, -62, 18, 6],
          [63, 40, -60, 16, 6],
          [61, 26, -58, 13, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.9 - i * 0.04}
          />
        ))}
        {[
          [98, 128, -95, 14, 5],
          [91, 110, -90, 15, 5],
          [83, 91, -88, 15, 5],
          [76, 72, -85, 14, 5],
          [70, 54, -82, 13, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondLightId})`}
            opacity={0.75 - i * 0.04}
          />
        ))}
      </g>

      {/* --- Frond 4: Nearly straight up, slight left lean --- */}
      <g>
        <path
          d="M 102 152 Q 98 105 100 62 Q 101 35 98 10"
          stroke="hsl(120,62%,26%)"
          strokeWidth="1.5"
          fill="none"
        />
        {[
          [109, 135, 80, 20, 7],
          [106, 116, 82, 22, 7],
          [103, 96, 84, 22, 7],
          [101, 76, 85, 20, 7],
          [100, 57, 86, 18, 6],
          [99, 38, 87, 15, 6],
          [98, 22, 88, 12, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.9 - i * 0.04}
          />
        ))}
        {[
          [95, 130, 60, 14, 5],
          [92, 112, 62, 15, 5],
          [93, 92, 64, 15, 5],
          [94, 73, 65, 14, 5],
          [95, 55, 66, 13, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondLightId})`}
            opacity={0.75 - i * 0.04}
          />
        ))}
      </g>

      {/* --- Frond 5: Upper-right, sweeping up and right --- */}
      <g>
        <path
          d="M 102 152 Q 130 112 158 78 Q 174 58 186 38"
          stroke="hsl(118,60%,26%)"
          strokeWidth="1.5"
          fill="none"
        />
        {[
          [114, 139, 55, 20, 7],
          [128, 126, 48, 22, 7],
          [142, 112, 42, 22, 7],
          [155, 97, 38, 20, 7],
          [167, 80, 34, 18, 6],
          [176, 64, 30, 16, 6],
          [183, 48, 27, 14, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.9 - i * 0.04}
          />
        ))}
        {[
          [118, 145, 75, 14, 5],
          [132, 132, 68, 16, 5],
          [146, 118, 62, 16, 5],
          [158, 103, 58, 15, 5],
          [170, 87, 52, 14, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondLightId})`}
            opacity={0.75 - i * 0.04}
          />
        ))}
      </g>

      {/* --- Frond 6: Right, sweeping to the right --- */}
      <g>
        <path
          d="M 102 152 Q 138 138 170 148 Q 192 156 210 162"
          stroke="hsl(115,60%,24%)"
          strokeWidth="1.5"
          fill="none"
        />
        {[
          [120, 145, 10, 18, 7],
          [136, 142, 5, 20, 7],
          [152, 143, 0, 20, 7],
          [168, 147, -5, 18, 6],
          [183, 153, -10, 16, 6],
          [197, 159, -14, 14, 5],
          [208, 164, -18, 12, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondGradId})`}
            opacity={0.9 - i * 0.05}
          />
        ))}
        {[
          [124, 150, -10, 14, 5],
          [140, 149, -14, 15, 5],
          [157, 150, -18, 15, 5],
          [172, 154, -22, 14, 5],
          [186, 160, -26, 12, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.75 - i * 0.04}
          />
        ))}
      </g>

      {/* --- Frond 7: Far right, drooping down-right --- */}
      <g>
        <path
          d="M 102 152 Q 136 152 168 172 Q 192 186 208 210"
          stroke="hsl(112,60%,22%)"
          strokeWidth="1.5"
          fill="none"
        />
        {[
          [118, 150, 25, 18, 7],
          [134, 154, 18, 20, 7],
          [150, 160, 12, 20, 7],
          [165, 169, 6, 18, 6],
          [180, 181, -2, 16, 6],
          [193, 193, -8, 14, 5],
          [204, 207, -14, 12, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondGradId})`}
            opacity={0.9 - i * 0.05}
          />
        ))}
        {[
          [122, 156, 5, 14, 5],
          [138, 162, -2, 15, 5],
          [154, 170, -8, 15, 5],
          [168, 180, -14, 14, 5],
          [181, 192, -20, 12, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.75 - i * 0.04}
          />
        ))}
      </g>

      {/* --- Frond 8: Left side, drooping down-left at ~200° --- */}
      <g>
        <path
          d="M 102 152 Q 78 162 52 182 Q 32 198 16 222"
          stroke="hsl(112,58%,22%)"
          strokeWidth="1.5"
          fill="none"
        />
        {[
          [88, 155, -20, 18, 7],
          [74, 163, -12, 20, 7],
          [59, 173, -5, 20, 6],
          [45, 185, 3, 18, 6],
          [32, 199, 10, 16, 6],
          [21, 213, 16, 14, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondGradId})`}
            opacity={0.88 - i * 0.05}
          />
        ))}
        {[
          [84, 161, -38, 13, 5],
          [70, 171, -30, 15, 5],
          [55, 182, -22, 15, 5],
          [41, 195, -14, 14, 5],
          [28, 209, -6, 12, 5],
        ].map(([cx, cy, angle, w, h], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
            fill={`url(#${frondMidId})`}
            opacity={0.72 - i * 0.04}
          />
        ))}
      </g>

      {/* === COCONUTS (3 clusters near crown) === */}
      {/* Cluster 1 */}
      <circle cx="107" cy="163" r="6.5" fill={`url(#${coconutGradId})`} />
      <circle cx="107" cy="163" r="6.5" fill="none" stroke="#5A3010" strokeWidth="0.8" opacity="0.4" />
      {/* Cluster 2 */}
      <circle cx="97" cy="165" r="6" fill={`url(#${coconutGradId})`} />
      <circle cx="97" cy="165" r="6" fill="none" stroke="#5A3010" strokeWidth="0.8" opacity="0.4" />
      {/* Cluster 3 */}
      <circle cx="113" cy="170" r="5.5" fill={`url(#${coconutGradId})`} />
      <circle cx="113" cy="170" r="5.5" fill="none" stroke="#5A3010" strokeWidth="0.8" opacity="0.4" />
      {/* Crown base cap — overlaps coconuts to seat fronds */}
      <ellipse cx="103" cy="155" rx="10" ry="6" fill="#7A5030" opacity="0.6" />
    </svg>
  )
}
