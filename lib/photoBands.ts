'use client'

// Client-side photo analysis for story-frame text placement (owner feedback:
// «текст наложил на голову, хотя снизу свободно», «на однотонном небе подложка
// не нужна»). We downsample the photo on a canvas and score three horizontal
// bands (where the text group can sit): the calmest band wins, and if it's
// uniform enough the text goes WITHOUT plates in a colour picked by luminance.
// CORS: Supabase public storage sends `Access-Control-Allow-Origin: *`, so an
// anonymous-crossOrigin image keeps the canvas readable; any failure → null →
// callers fall back to the AI/alternating layout.

export interface BandInfo { variance: number; lum: number; skin: number }
export interface PhotoBands { top: BandInfo; center: BandInfo; bottom: BandInfo }
export interface Placement { position: 'top' | 'center' | 'bottom'; plate: boolean; textColor: string }

const W = 72
const H = 128

// Cheap skin-tone test (RGB) — used to keep text OFF faces/skin (owner: «текст
// не должен ложиться на лицо»). Crude but errs toward avoidance: a band with
// lots of skin gets a heavy penalty so the text group goes elsewhere.
function isSkin(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b
}

function bandStats(data: Uint8ClampedArray, fromRow: number, toRow: number): BandInfo {
  let sum = 0
  let sumSq = 0
  let skin = 0
  let n = 0
  for (let y = fromRow; y < toRow; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      // Perceptual luminance, normalised 0..1
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      sum += lum
      sumSq += lum * lum
      if (isSkin(r, g, b)) skin++
      n++
    }
  }
  const mean = sum / n
  return { variance: sumSq / n - mean * mean, lum: mean, skin: skin / n }
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

// A band that's ≥ this fraction skin is treated as a face/figure — text must
// not land there. The penalty is large enough to dominate the variance score.
const SKIN_PENALTY = 0.5

export function pickPlacement(bands: PhotoBands, brandDarkText: string): Placement {
  // Prefer bottom, then top; the center usually holds the face/figure, so it
  // pays a penalty and only wins when it's clearly the calmest area. On top of
  // that, any band with a face/skin gets a heavy penalty so text never sits on
  // a face (owner feedback) — the calmest NON-skin band wins.
  const candidates: Array<{ position: Placement['position']; score: number; band: BandInfo }> = [
    { position: 'bottom', score: bands.bottom.variance + bands.bottom.skin * SKIN_PENALTY, band: bands.bottom },
    { position: 'top', score: bands.top.variance * 1.15 + bands.top.skin * SKIN_PENALTY, band: bands.top },
    { position: 'center', score: bands.center.variance * 1.6 + bands.center.skin * SKIN_PENALTY, band: bands.center },
  ]
  candidates.sort((a, b) => a.score - b.score)
  const best = candidates[0]
  // Plate when the area is busy OR has any skin (keeps text readable if a
  // close-up leaves no fully skin-free band).
  const plate = best.band.variance > UNIFORM || best.band.skin > 0.08
  // Clean text: dark brand colour on bright areas, white on dark areas.
  const textColor = best.band.lum > 0.6 ? brandDarkText : '#FFFFFF'
  return { position: best.position, plate, textColor }
}
