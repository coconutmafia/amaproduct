'use client'

// Client-side photo downscale before upload. iPhone photos are 4–12 MB
// (HEIC/JPEG) while Vercel rejects request bodies over ~4.5 MB BEFORE our route
// runs — uploads died with Safari's cryptic «The string did not match the
// expected pattern». Downscaling in the browser fixes that, converts HEIC to
// JPEG (sharp on Vercel can't decode HEIC), and is lossless for our real needs:
// vision analysis reads ≤820px, the slide renderer needs ≤~2000px.
//
// Safari applies EXIF orientation in drawImage (iOS 13.4+), so portrait photos
// stay upright. On any failure we fall back to the original file.
// `outType` lets callers preserve transparency: pass 'image/png' for stickers /
// cut-outs (the default 'image/jpeg' flattens alpha onto black). Omitting it
// keeps the original photo behaviour byte-for-byte.
export async function downscaleImage(
  file: File,
  maxEdge = 2000,
  quality = 0.85,
  outType?: 'image/jpeg' | 'image/png',
): Promise<File> {
  try {
    if (!file.type.startsWith('image/')) return file
    const needsConvert = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
    const target = outType || 'image/jpeg'
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('decode failed'))
        el.src = url
      })
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return file
      const scale = Math.min(1, maxEdge / Math.max(w, h))
      // Already small AND already in the target format AND under the body limit → keep as is.
      const sameFmt = target === 'image/png' ? /png/i.test(file.type) : !needsConvert
      if (scale === 1 && sameFmt && file.size < 3 * 1024 * 1024) return file
      const cw = Math.max(1, Math.round(w * scale))
      const ch = Math.max(1, Math.round(h * scale))
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(img, 0, 0, cw, ch)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, target, quality))
      if (!blob || blob.size === 0) return file
      const ext = target === 'image/png' ? '.png' : '.jpg'
      const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + ext
      return new File([blob], name, { type: target })
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return file
  }
}
