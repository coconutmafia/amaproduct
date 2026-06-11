'use client'

// Client-side photo analysis for story-frame text placement (owner feedback:
// «текст наложил на голову, хотя снизу свободно», «на однотонном небе подложка
// не нужна»). We downsample the photo on a canvas and score three horizontal
// bands (where the text group can sit): the calmest band wins, and if it's
// uniform enough the text goes WITHOUT plates in a colour picked by luminance.
// CORS: Supabase public storage sends `Access-Control-Allow-Origin: *`, so an
// anonymous-crossOrigin image keeps the canvas readable; any failure → null →
// callers fall back to the AI/alternating layout.

export interface BandInfo { variance: number; lum: number }
export interface PhotoBands { top: BandInfo; center: BandInfo; bottom: BandInfo }
export interface Placement { position: 'top' | 'center' | 'bottom'; plate: boolean; textColor: string }

const W = 72
const H = 128

function bandStats(data: Uint8ClampedArray, fromRow: number, toRow: number): BandInfo {
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = fromRow; y < toRow; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      // Perceptual luminance, normalised 0..1
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
      sum += lum
      sumSq += lum * lum
      n++
    }
  }
  const mean = sum / n
  return { variance: sumSq / n - mean * mean, lum: mean }
}

export async function analyzePhotoBands(url: string): Promise<PhotoBands | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('load failed'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    // Bands mirror where the engine's text group actually sits (9:16 frame,
    // padding 190px top / 150px bottom of 1920 → rows ~13..45 / 83..118).
    return {
      top: bandStats(data, 13, 45),
      center: bandStats(data, 48, 82),
      bottom: bandStats(data, 84, 118),
    }
  } catch {
    return null
  }
}

// Variance below this reads as a uniform area (sky, wall) → no plates needed.
const UNIFORM = 0.008

export function pickPlacement(bands: PhotoBands, brandDarkText: string): Placement {
  // Prefer bottom, then top; the center usually holds the face/figure, so it
  // pays a penalty and only wins when it's clearly the calmest area.
  const candidates: Array<{ position: Placement['position']; score: number; band: BandInfo }> = [
    { position: 'bottom', score: bands.bottom.variance, band: bands.bottom },
    { position: 'top', score: bands.top.variance * 1.15, band: bands.top },
    { position: 'center', score: bands.center.variance * 1.6, band: bands.center },
  ]
  candidates.sort((a, b) => a.score - b.score)
  const best = candidates[0]
  const plate = best.band.variance > UNIFORM
  // Clean text: dark brand colour on bright areas, white on dark areas.
  const textColor = best.band.lum > 0.6 ? brandDarkText : '#FFFFFF'
  return { position: best.position, plate, textColor }
}
