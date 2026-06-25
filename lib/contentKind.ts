// Heuristics that pick the right «design this» action under a chat answer.
//
// A reels script numbers its scenes «Кадр N» — exactly like a stories series —
// so the «(сторис|stories|кадр) N» test used to mis-tag a reels script as
// stories and show the «Оформить сторис» button on it (owner feedback +
// screenshot, 25 Jun: «СЦЕНАРИЙ РИЛЗА … Кадр 1»). We detect reels explicitly so
// the caller can exclude it: a reels keyword paired with scene/frame numbering,
// or the reels-only «Сцена N» marker (stories/carousels never use «сцена»).
//
// Note: \b word boundaries are ASCII-only in JS regex and don't work around
// Cyrillic, so we match «рилс/рилз» as a plain substring (safe — it isn't a
// substring of unrelated Russian words).
export function isReelsScript(text: string): boolean {
  if (/сцена\s*\d/i.test(text)) return true
  const reelsWord = /рил[сз]/i.test(text) || /reels/i.test(text)
  return reelsWord && /кадр\s*\d/i.test(text)
}
