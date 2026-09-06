// Геометрия картинки в рамке (кадрирование «зум + сдвиг» внутри фиксированной
// рамки). Один расчёт для превью (DOM) и экспорта (satori): что видишь — то и
// получишь. Все величины в px той системы, в которой заданы w/h.
export interface Crop { zoom: number; x: number; y: number } // zoom ≥ 1; x,y ∈ [-1, 1]

export function clampCrop(c?: Partial<Crop> | null): Crop {
  const zoom = Math.min(4, Math.max(1, Number(c?.zoom) || 1))
  const x = Math.min(1, Math.max(-1, Number(c?.x) || 0))
  const y = Math.min(1, Math.max(-1, Number(c?.y) || 0))
  return { zoom, x, y }
}

/** Картинка cover-ом заполняет рамку w×h, масштабируется zoom-ом и сдвигается в пределах запаса. */
export function cropGeometry(w: number, h: number, srcAspect: number, crop?: Partial<Crop> | null) {
  const c = clampCrop(crop)
  const frame = w / h
  const ia = srcAspect > 0 ? srcAspect : frame
  let iw: number, ih: number
  if (ia > frame) { ih = h; iw = h * ia } else { iw = w; ih = w / ia }
  iw *= c.zoom; ih *= c.zoom
  const slackX = Math.max(0, iw - w), slackY = Math.max(0, ih - h)
  const nz = (n: number) => (Object.is(n, -0) ? 0 : n) // -0 ломает сравнения и JSON
  const left = nz(Math.round(-slackX / 2 - (c.x * slackX) / 2))
  const top = nz(Math.round(-slackY / 2 - (c.y * slackY) / 2))
  return { iw: Math.round(iw), ih: Math.round(ih), left, top }
}

/** Радиус скругления рамки: доля от меньшей стороны, 0.5 = круг/овал. */
export function frameRadius(w: number, h: number, radius?: number | null): number {
  const r = Math.min(0.5, Math.max(0, Number(radius) || 0))
  return Math.round(Math.min(w, h) * r)
}
