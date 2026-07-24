import { describe, it, expect } from 'vitest'
import {
  parseSilences, buildKeepSegments, remapTime, totalDuration,
  wordsToPhrases, escapeAss, assTime, buildAss, escapeFilterPath, buildFilterGraph,
} from '@/lib/video/montage'

// Ядро авто-монтажа рилса. Ошибка здесь = порезанное на полуслове видео или
// субтитры не в такт речи — клиент увидит это сразу, поэтому фиксируем тестами.
describe('parseSilences', () => {
  it('парсит вывод silencedetect', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 3.5',
      'frame= 100',
      '[silencedetect @ 0x1] silence_end: 5.2 | silence_duration: 1.7',
      '[silencedetect @ 0x1] silence_start: 10.0',
      '[silencedetect @ 0x1] silence_end: 11.5 | silence_duration: 1.5',
    ].join('\n')
    expect(parseSilences(stderr)).toEqual([
      { start: 3.5, end: 5.2 },
      { start: 10, end: 11.5 },
    ])
  })
  it('незакрытая пауза в конце не ломает разбор', () => {
    expect(parseSilences('[silencedetect] silence_start: 8.0\n')).toEqual([])
  })
})

describe('buildKeepSegments', () => {
  it('вырезает длинные паузы с отступами, короткие не трогает', () => {
    const keep = buildKeepSegments(
      [{ start: 3, end: 5 }, { start: 8, end: 8.3 }], // вторая короче minSilence
      12,
    )
    // пауза 3-5 вырезана с pad 0.18: остаётся [0..3.18] и [4.82..12]
    expect(keep).toHaveLength(2)
    expect(keep[0].start).toBe(0)
    expect(keep[0].end).toBeCloseTo(3.18, 2)
    expect(keep[1].start).toBeCloseTo(4.82, 2)
    expect(keep[1].end).toBe(12)
  })
  it('без пауз — одно полное видео', () => {
    expect(buildKeepSegments([], 30)).toEqual([{ start: 0, end: 30 }])
  })
})

describe('remapTime', () => {
  const keep = [{ start: 0, end: 3 }, { start: 5, end: 10 }]
  it('до выреза время не меняется', () => expect(remapTime(2, keep)).toBe(2))
  it('после выреза сдвигается на длину вырезанного', () => expect(remapTime(6, keep)).toBe(4))
  it('внутри выреза — null (слово не показываем)', () => expect(remapTime(4, keep)).toBeNull())
  it('итоговая длительность = сумме кусков', () => expect(totalDuration(keep)).toBe(8))
})

describe('wordsToPhrases', () => {
  const keep = [{ start: 0, end: 60 }]
  it('группирует по 2-4 слова и рвёт по паузе в речи', () => {
    const phrases = wordsToPhrases([
      { word: 'привет', start: 0, end: 0.4 },
      { word: 'это', start: 0.5, end: 0.7 },
      { word: 'тест', start: 0.8, end: 1.1 },
      // пауза > maxGap
      { word: 'новая', start: 2.5, end: 2.9 },
      { word: 'фраза', start: 3.0, end: 3.4 },
    ], keep)
    expect(phrases).toHaveLength(2)
    expect(phrases[0].text).toBe('привет это тест')
    expect(phrases[1].text).toBe('новая фраза')
  })
  it('фразы не перекрываются по времени', () => {
    const phrases = wordsToPhrases([
      { word: 'раз', start: 0, end: 1.0 },
      { word: 'два', start: 1.05, end: 1.5 },
      { word: 'три', start: 1.55, end: 2.0 },
      { word: 'четыре', start: 2.05, end: 2.4 },
      { word: 'пять', start: 2.45, end: 2.8 },
    ], keep)
    for (let i = 0; i < phrases.length - 1; i++) {
      expect(phrases[i].end).toBeLessThanOrEqual(phrases[i + 1].start)
    }
  })
  it('длинная фраза режется по maxChars (drawtext не переносит строки)', () => {
    const phrases = wordsToPhrases([
      { word: 'сверхдлинноеслово', start: 0, end: 0.3 },
      { word: 'ещёодносверхслово', start: 0.4, end: 0.7 },
    ], keep)
    expect(phrases).toHaveLength(2)
  })
  it('слова из вырезанной паузы выпадают', () => {
    const phrases = wordsToPhrases(
      [{ word: 'до', start: 1, end: 1.3 }, { word: 'внутри', start: 4, end: 4.3 }, { word: 'после', start: 6, end: 6.3 }],
      [{ start: 0, end: 3 }, { start: 5, end: 10 }],
    )
    expect(phrases.map((p) => p.text).join(' ')).toBe('до после')
  })
})

describe('ASS-субтитры', () => {
  it('время в формате h:mm:ss.cc', () => {
    expect(assTime(0)).toBe('0:00:00.00')
    expect(assTime(3.456)).toBe('0:00:03.46')
    expect(assTime(65.5)).toBe('0:01:05.50')
  })
  it('вычищает служебные скобки и переносы', () => {
    expect(escapeAss('текст {с тегами}\nи переносом')).toBe('текст с тегами\\Nи переносом')
  })
  it('строит стили Sub и Hook + события с кириллицей', () => {
    const ass = buildAss(
      [{ text: 'привет это тест', start: 0.3, end: 1.8 }],
      'почему твой блог не продаёт',
    )
    expect(ass).toContain('Style: Sub,Montserrat,64')
    expect(ass).toContain('Style: Hook,Montserrat,76')
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:02.80,Hook,,0,0,0,,почему твой блог не продаёт')
    expect(ass).toContain('Dialogue: 0,0:00:00.30,0:00:01.80,Sub,,0,0,0,,привет это тест')
  })
  it('фраза нулевой длины выпадает', () => {
    const ass = buildAss([{ text: 'пусто', start: 2, end: 2 }])
    expect(ass).not.toContain('пусто')
  })
})

describe('buildFilterGraph', () => {
  it('собирает граф: trim → concat → scale → subtitles', () => {
    const g = buildFilterGraph({
      keep: [{ start: 0, end: 3 }, { start: 5, end: 8 }],
      hasSubtitles: true,
      assPath: '/tmp/mt-1-subs.ass',
      fontsDir: '/var/task/public/fonts',
    })
    expect(g.filter).toContain('trim=start=0.000:end=3.000')
    expect(g.filter).toContain('concat=n=2:v=1:a=1')
    expect(g.filter).toContain('scale=1080:1920')
    expect(g.filter).toContain("subtitles='/tmp/mt-1-subs.ass':fontsdir='/var/task/public/fonts'")
    expect(g.videoOut).toBe('[vsub]')
    expect(g.audioOut).toBe('[ac]')
  })
  it('без субтитров выход — нормализованное видео', () => {
    const g = buildFilterGraph({ keep: [{ start: 0, end: 5 }], hasSubtitles: false })
    expect(g.videoOut).toBe('[vs]')
    expect(g.filter).not.toContain('subtitles')
  })
  it('экранирует спецсимволы в пути фильтра', () => {
    expect(escapeFilterPath('C:\\tmp\\a.ass')).toBe('C\\:\\\\tmp\\\\a.ass')
  })
})
