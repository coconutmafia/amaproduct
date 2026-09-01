import React from 'react'
import {
  Document, Page, View, Text, Link, Font, Svg, Defs, LinearGradient, Stop,
  Rect, Path, Circle,
} from '@react-pdf/renderer'
import type { AuditResult, AuditBlockResult } from '@/lib/blogAudit/runBlogAudit'
import { MAX_SCORE } from '@/lib/blogAudit/checklist'
import { zoneBreakdown, ballWord } from '@/lib/blogAudit/auditToText'

// PDF-выгрузка разбора — то же, что человек видит на экране (BlogAuditScorecard).
//
// Почему PDF, а не .docx (инцидент 01.09, Августа/Марина): docx не имеет
// гарантированного рендера — файл пересылают в Telegram, там его открывает
// Quick Look (iOS) и разваливает вёрстку: процентные ширины таблиц схлопываются
// в колонку шириной в один символ, текст идёт вертикально по букве. В Word и
// LibreOffice тот же файл выглядел правильно, поэтому тесты «проходили».
// PDF рендерится одинаково в ЛЮБОМ вьюере (Telegram iOS/Android, браузер,
// почта, десктоп) — это класс-фикс, а не подгонка под один просмотрщик.
//
// Цвета и структура повторяют экран (BlogAuditScorecard / ScoreDot / ZoneLegend /
// bandColor / .gradient-accent) — источник правды там; при изменении экрана
// менять и здесь (страж: tests/smoke/blog-audit-export.test.ts).
const GREEN = '#22C55E'   // bg-green-500 — зона «собрано» и маркер 2 баллов
const GREY = '#CBD5E1'    // bg-slate-300 — зона «нужна оценка эксперта»
const AMBER = '#FBBF24'   // bg-amber-400 — зона роста в полосе и легенде
const AMBER_DOT = '#F59E0B' // bg-amber-500 — маркер пункта на 1 балл
const RED_DOT = '#F87171' // bg-red-400 — маркер пункта на 0 баллов
const INK = '#1F2937'
const MUTED = '#6B7280'
const FAINT = '#9CA3AF'
const BORDER = '#E5E7EB'
const CARD_BG = '#FFFFFF'
const SOFT_BG = '#F9FAFB'
const SUMMARY_BG = '#F3F4F6'
const BRAND = '#D44E7E'
// .gradient-accent: linear-gradient(135deg, #F5A84A 0%, #E86BA0 55%, #D44E7E 100%)
const GRAD_FROM = '#F5A84A'
const GRAD_MID = '#E86BA0'
const GRAD_TO = '#D44E7E'

// bandColor с экрана: цвет счёта блока по проценту набранного.
function bandColor(score100: number): string {
  if (score100 <= 30) return '#DC2626' // red-600
  if (score100 <= 55) return '#EA580C' // orange-600
  if (score100 <= 75) return '#D97706' // amber-600
  if (score100 <= 90) return '#65A30D' // lime-600
  return '#16A34A'                     // green-600
}

// Inter — тот же шрифт, что на сайте (app/layout.tsx, next/font Inter с кириллицей).
// В браузере файлы берутся из /public/fonts, в тестах — с диска.
const fontSrc = (w: number) =>
  typeof window === 'undefined'
    ? `${process.cwd()}/public/fonts/Inter-${w}.ttf`
    : `/fonts/Inter-${w}.ttf`

let fontsReady = false
function registerFonts() {
  if (fontsReady) return
  fontsReady = true
  Font.register({
    family: 'Inter',
    fonts: [
      { src: fontSrc(400), fontWeight: 400 },
      { src: fontSrc(600), fontWeight: 600 },
      { src: fontSrc(700), fontWeight: 700 },
    ],
  })
  // Без этого react-pdf переносит русские слова по английским правилам —
  // «конс-ультации» посреди слова. Переносим только по пробелам.
  Font.registerHyphenationCallback(word => [word])
}

// Inter не содержит эмодзи-глифов: 🔒/🍋 из заметок LLM стали бы пустыми
// квадратами. Внешний emojiSource (CDN-картинки) — сетевой риск в момент
// скачивания, поэтому эмодзи просто вычищаем. Стрелки (→) и геометрические
// маркеры (●) НЕ трогаем — они есть в шрифте и используются в вёрстке.
export function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trimEnd()
}

const Dot = ({ color, size = 6, top = 3 }: { color: string; size?: number; top?: number }) => (
  <View style={{
    width: size, height: size, borderRadius: size / 2, backgroundColor: color,
    marginTop: top, flexShrink: 0,
  }} />
)

// Замок (lucide Lock) для пунктов, которые нельзя оценить автоматически.
const LockIcon = ({ size = 8, color = FAINT }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" style={{ marginTop: 2, flexShrink: 0 }}>
    <Rect x={3} y={11} width={18} height={11} rx={2} stroke={color} strokeWidth={2.2} fill="none" />
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={color} strokeWidth={2.2} fill="none" />
  </Svg>
)

// Галочка в круге (lucide CheckCircle2) у заголовка «Разбор по блокам».
const CheckIcon = ({ size = 11, color = BRAND }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" style={{ marginTop: 1.5, flexShrink: 0 }}>
    <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2} fill="none" />
    <Path d="m9 12 2 2 4-4" stroke={color} strokeWidth={2} fill="none" />
  </Svg>
)

const ZoneLegendRow = ({ color, value, title, desc }: {
  color: string; value: number; title: string; desc: string
}) => (
  <View style={{ flexDirection: 'row', gap: 5, flex: 1 }}>
    <Dot color={color} top={2.5} />
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 8, fontWeight: 600, color: INK }}>
        {value} {ballWord(value)} · {title}
      </Text>
      <Text style={{ fontSize: 7, color: MUTED, marginTop: 1 }}>{desc}</Text>
    </View>
  </View>
)

// Пункт разбора: маркер (цветная точка или замок) + вопрос + заметка.
// wrap=false: пункт не разрывается между страницами — целиком уезжает дальше.
const BlockItem = ({ it }: { it: AuditBlockResult['items'][number] }) => (
  <View wrap={false} style={{ flexDirection: 'row', gap: 5, marginBottom: 4.5 }}>
    {it.score === null
      ? <LockIcon />
      : <Dot color={it.score === 2 ? GREEN : it.score === 1 ? AMBER_DOT : RED_DOT} top={2.5} />}
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 8, color: it.assessable ? INK : MUTED, lineHeight: 1.35 }}>
        {stripEmoji(it.label)}
      </Text>
      {it.note ? (
        <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 1.5, lineHeight: 1.35 }}>{stripEmoji(it.note)}</Text>
      ) : null}
    </View>
  </View>
)

const BlockCardPdf = ({ block }: { block: AuditBlockResult }) => {
  const pct = block.assessableMax > 0 ? Math.round((block.scored / block.assessableMax) * 100) : null
  return (
    <View style={{
      flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 8,
      backgroundColor: CARD_BG, padding: 9,
    }}>
      {/* Шапку и пункты НЕ склеивать в keep-together блоки: wrap=false внутри
          колонок flex-ряда при разрыве страницы накладывает текст слоями
          (проверено на реальном отчёте). Карточка может начаться заголовком у
          низа страницы — это нормальная типографика, а не дефект. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
        <Text style={{ fontSize: 9, fontWeight: 700, color: INK }}>{block.title}</Text>
        {pct !== null ? (
          <Text style={{ fontSize: 8, fontWeight: 600, color: bandColor(pct) }}>
            {block.scored}/{block.assessableMax}
          </Text>
        ) : (
          <Text style={{ fontSize: 7.5, color: MUTED }}>на консультации</Text>
        )}
      </View>
      {block.items.map((it, i) => <BlockItem key={i} it={it} />)}
    </View>
  )
}

export function buildAuditPdfDoc(
  result: AuditResult,
  dateLabel: string,
  consultUrl: string,
) {
  registerFonts()

  const green = Math.max(0, result.scored)
  const grey = Math.max(0, MAX_SCORE - result.assessableMax)
  const yellow = Math.max(0, result.assessableMax - result.scored)
  const zones = zoneBreakdown(result)
  const lockedBlocks = result.blocks
    .filter(b => b.items.some(it => !it.assessable))
    .map(b => b.title)

  const zoneRows = ([
    [GREEN, 'Собрано', zones.green],
    [AMBER, 'Зона роста', zones.yellow],
    [GREY, 'Нужен эксперт', zones.grey],
  ] as const).filter(([, , list]) => list.length > 0)

  // Пары карточек «в две колонки, как на экране».
  const pairs: Array<[AuditBlockResult, AuditBlockResult | null]> = []
  for (let i = 0; i < result.blocks.length; i += 2) {
    pairs.push([result.blocks[i], result.blocks[i + 1] ?? null])
  }

  return (
    <Document title={`Диагностика блога @${result.handle}`} language="ru">
      <Page size="A4" style={{
        fontFamily: 'Inter', fontSize: 8, color: INK,
        paddingTop: 40, paddingBottom: 44, paddingHorizontal: 40,
        backgroundColor: '#FFFFFF',
      }}>
        {/* ── Шапка ── */}
        <Text style={{ fontSize: 17, fontWeight: 700 }}>Экспресс-диагностика блога</Text>
        <Text style={{ fontSize: 9, color: MUTED, marginTop: 3 }}>
          Оцени, насколько хорошо продаёт твой Instagram
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 5, alignItems: 'center' }}>
          <Text style={{ fontSize: 9, fontWeight: 700, color: BRAND }}>@{result.handle}</Text>
          <Text style={{ fontSize: 8, color: FAINT }}>·   {dateLabel}</Text>
        </View>

        {/* ── Диагноз, полоса 100 баллов, легенда зон, «что это значит» ── */}
        <View style={{
          borderWidth: 1, borderColor: BORDER, borderRadius: 10,
          backgroundColor: CARD_BG, padding: 12, marginTop: 14,
        }}>
          <Text style={{ fontSize: 10.5, fontWeight: 700 }}>{stripEmoji(result.diagnosis)}</Text>
          <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 3, lineHeight: 1.45 }}>
            Мы разобрали шапку и последние посты @{result.handle} по чек-листу на 100 баллов.
            Сторис, актуальные и то, куда ведёт ссылка, автоматически увидеть нельзя — эти баллы вынесены отдельно.
          </Text>

          <View style={{
            flexDirection: 'row', height: 9, borderRadius: 4.5, overflow: 'hidden',
            backgroundColor: BORDER, marginTop: 10,
          }}>
            {green > 0 ? <View style={{ width: `${green}%`, backgroundColor: GREEN }} /> : null}
            {grey > 0 ? <View style={{ width: `${grey}%`, backgroundColor: GREY }} /> : null}
            {yellow > 0 ? <View style={{ width: `${yellow}%`, backgroundColor: AMBER }} /> : null}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 9 }}>
            <ZoneLegendRow color={GREEN} value={green} title="собрано" desc="критерии диагностики выполнены" />
            <ZoneLegendRow color={GREY} value={grey} title="нужна оценка эксперта" desc="автоматически проверить невозможно" />
            <ZoneLegendRow color={AMBER} value={yellow} title="зона роста" desc="критерии не выполнены — это можно улучшить" />
          </View>

          {zoneRows.length > 0 ? (
            <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 10, paddingTop: 8 }}>
              <Text style={{ fontSize: 7.5, fontWeight: 600, color: MUTED }}>
                Что это значит для @{result.handle}
              </Text>
              {zoneRows.map(([color, title, list]) => (
                <View key={title} style={{ flexDirection: 'row', gap: 5, marginTop: 4 }}>
                  <Dot color={color} size={5} top={2.5} />
                  <Text style={{ fontSize: 7.5, color: MUTED, flex: 1, lineHeight: 1.4 }}>
                    <Text style={{ fontWeight: 600, color: INK }}>{title}: </Text>
                    {list.join(', ')}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Вердикт ── */}
        {result.summary ? (
          <View style={{ backgroundColor: SUMMARY_BG, borderRadius: 8, padding: 10, marginTop: 10 }}>
            <Text style={{ fontSize: 8.5, lineHeight: 1.5, color: INK }}>{stripEmoji(result.summary)}</Text>
          </View>
        ) : null}

        {/* ── Что усилить в первую очередь ── */}
        {result.topGaps.length > 0 ? (
          <View style={{
            borderWidth: 1, borderColor: '#FDE68A', backgroundColor: '#FFFBEB',
            borderRadius: 8, padding: 10, marginTop: 10,
          }}>
            <Text style={{ fontSize: 9, fontWeight: 700, color: '#B45309' }}>
              Что усилить в первую очередь
            </Text>
            {result.topGaps.map((g, i) => (
              <View key={i} wrap={false} style={{ flexDirection: 'row', gap: 5, marginTop: 5 }}>
                <Text style={{ fontSize: 8, fontWeight: 700, color: '#D97706' }}>→</Text>
                <Text style={{ fontSize: 8, color: INK, flex: 1, lineHeight: 1.4 }}>{stripEmoji(g)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Разбор по блокам ── */}
        <View minPresenceAhead={70} style={{ flexDirection: 'row', gap: 5, marginTop: 14, marginBottom: 8 }}>
          <CheckIcon />
          <Text style={{ fontSize: 11, fontWeight: 700 }}>Разбор по блокам</Text>
        </View>
        {pairs.map(([a, b], i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'stretch' }}>
            <BlockCardPdf block={a} />
            {b ? <BlockCardPdf block={b} /> : <View style={{ flex: 1 }} />}
          </View>
        ))}

        {/* ── Честная подпись про закрытые пункты ── */}
        {result.notAssessableCount > 0 ? (
          <View wrap={false} style={{ flexDirection: 'row', gap: 5, marginTop: 2 }}>
            <LockIcon size={9} />
            <Text style={{ fontSize: 7.5, color: MUTED, flex: 1, lineHeight: 1.4 }}>
              {result.notAssessableCount} пунктов{lockedBlocks.length ? ` (${lockedBlocks.join(', ')})` : ''} обсуждаются
              на консультации — их не посчитать автоматически с поверхности профиля.
            </Text>
          </View>
        ) : null}

        {/* ── Призыв на консультацию: фирменный градиент, как .gradient-accent ── */}
        <View wrap={false} style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden', height: 92 }}>
          <Svg width={515} height={92} style={{ position: 'absolute', top: 0, left: 0 }}>
            <Defs>
              <LinearGradient id="cta" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={GRAD_FROM} />
                <Stop offset="0.55" stopColor={GRAD_MID} />
                <Stop offset="1" stopColor={GRAD_TO} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={515} height={92} fill="url(#cta)" />
          </Svg>
          <View style={{ paddingVertical: 12, paddingHorizontal: 26, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF' }}>
              Хочешь полную стратегию по блогу?
            </Text>
            <Text style={{
              fontSize: 8, color: '#FFFFFF', opacity: 0.92, textAlign: 'center',
              marginTop: 4, lineHeight: 1.45, maxWidth: 380,
            }}>
              На бесплатной консультации маркетолог разберёт актуальные, визуал и воронку и покажет,
              как привести блог в порядок, чтобы он продавал.
            </Text>
            <Link src={consultUrl} style={{ textDecoration: 'none', marginTop: 8 }}>
              <View style={{
                backgroundColor: '#FFFFFF', borderRadius: 7,
                paddingVertical: 6, paddingHorizontal: 14,
              }}>
                <Text style={{ fontSize: 8.5, fontWeight: 700, color: BRAND }}>
                  Записаться на бесплатную консультацию  →
                </Text>
              </View>
            </Link>
          </View>
        </View>
      </Page>
    </Document>
  )
}

// Скачивание: сборка + сохранение. Отдельно от buildAuditPdfDoc, чтобы саму
// вёрстку можно было проверить тестом без браузера (renderToBuffer).
export async function downloadAuditPdf(
  result: AuditResult,
  dateLabel: string,
  filename: string,
  consultUrl: string,
): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer')
  const raw = await pdf(buildAuditPdfDoc(result, dateLabel, consultUrl)).toBlob()
  // toBlob не всегда проставляет MIME, а share-sheet iOS выбирает приложение по нему
  const blob = raw.type === 'application/pdf' ? raw : new Blob([raw], { type: 'application/pdf' })
  const { saveBlobSmart } = await import('@/lib/utils/saveFile')
  await saveBlobSmart(`${filename}.pdf`, blob)
}
