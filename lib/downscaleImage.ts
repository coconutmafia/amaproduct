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
// Тело запроса на платформе ограничено (~4.5 МБ), поэтому файл ОБЯЗАН уехать
// меньше этого потолка. Прод 27.08: «Failed to parse body as FormData» дважды
// на загрузке в бренд-кит — сюда прилетело фото, которое браузер не смог
// декодировать (типично для HEIC с айфона), и функция МОЛЧА вернула оригинал
// на несколько мегабайт. Молчаливый возврат оригинала и был дырой: до сервера
// доезжал обрезанный multipart, а человек видел «не удалось загрузить».
const BODY_LIMIT = 3.5 * 1024 * 1024
// Ступени ужимания: если после первой картинка всё ещё тяжёлая — жмём сильнее,
// вместо того чтобы отправлять заведомо неподъёмное.
const STEPS: Array<{ edge: number; q: number }> = [
  { edge: 1600, q: 0.75 },
  { edge: 1200, q: 0.7 },
  { edge: 900, q: 0.65 },
]

export class ImageTooLargeError extends Error {
  constructor() {
    super('Фото слишком большое и его не удалось ужать. Пересохрани его как JPEG (или сделай скриншот) и загрузи снова.')
    this.name = 'ImageTooLargeError'
  }
}

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
      if (!w || !h) return guard(file)
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
      if (!ctx) return guard(file)
      ctx.drawImage(img, 0, 0, cw, ch)
      let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, target, quality))
      // Ещё тяжело — дожимаем ступенями, а не отправляем как есть.
      for (const step of STEPS) {
        if (blob && blob.size <= BODY_LIMIT) break
        const s2 = Math.min(1, step.edge / Math.max(w, h))
        canvas.width = Math.max(1, Math.round(w * s2))
        canvas.height = Math.max(1, Math.round(h * s2))
        const c2 = canvas.getContext('2d')
        if (!c2) break
        c2.drawImage(img, 0, 0, canvas.width, canvas.height)
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, target, step.q))
      }
      if (!blob || blob.size === 0) return guard(file)
      if (blob.size > BODY_LIMIT) throw new ImageTooLargeError()
      const ext = target === 'image/png' ? '.png' : '.jpg'
      const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + ext
      return new File([blob], name, { type: target })
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (e) {
    if (e instanceof ImageTooLargeError) throw e
    // Декодировать не вышло (частый случай — HEIC): отдаём оригинал ТОЛЬКО
    // если он влезает в тело запроса, иначе честно говорим, что делать.
    return guard(file)
  }
}

function guard(file: File): File {
  if (file.size > BODY_LIMIT) throw new ImageTooLargeError()
  return file
}
