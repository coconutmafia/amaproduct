// Ссылка на Instagram-рилз/пост в любом виде, которым делятся из приложения:
// instagram.com/reel/ID, /reels/ID, /p/ID, /tv/ID, /<автор>/reel/ID, с www и
// без, с хвостом ?igsh=… Одно место для формы трендов, менеджера рилзов и роута.
const REEL_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:[a-z0-9_.]+\/)?(?:reels?|p|tv)\/[A-Za-z0-9_-]+\/?[^\s«»"']*/i

export function isReelUrl(s: string): boolean {
  return REEL_RE.test((s || '').trim())
}

/** Первая ссылка на рилз в любом из текстов (поля формы), нормализованная до https. */
export function findReelUrl(...texts: string[]): string | null {
  for (const t of texts) {
    const m = (t || '').match(REEL_RE)
    if (m) return m[0].startsWith('http') ? m[0] : `https://${m[0]}`
  }
  return null
}
