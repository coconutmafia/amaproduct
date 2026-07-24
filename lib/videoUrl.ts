// Видео среди материалов сторис. Материалы живут единым массивом строк-URL
// (контракт PhotoUploader + localStorage-черновики), поэтому видео отличаем
// по расширению, а storage-путь для обработки восстанавливаем из public-URL.

const VIDEO_RE = /\.(mp4|mov|m4v|webm)(\?|#|$)/i

export function isVideoUrl(url: string): boolean {
  return VIDEO_RE.test(url)
}

/** public-URL бакета project-brand → путь внутри бакета (для API-обработки). */
export function brandPathFromUrl(url: string): string | null {
  const marker = '/project-brand/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  const path = url.slice(i + marker.length).split(/[?#]/)[0]
  return path || null
}
