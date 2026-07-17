'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Sparkles, CheckCircle2, AlertCircle, Lock, ArrowRight, RefreshCw, Download } from 'lucide-react'
import { toast } from 'sonner'
import { pollJob } from '@/lib/jobs/pollJob'
import { friendlyError } from '@/lib/friendlyError'
import type { AuditResult, AuditBlockResult } from '@/lib/blogAudit/runBlogAudit'
import { MAX_SCORE } from '@/lib/blogAudit/checklist'
import { auditToText, zoneBreakdown } from '@/lib/blogAudit/auditToText'

// Куда ведёт CTA «бесплатная консультация с маркетологом». Настраивается через
// env (можно сменить без деплоя кода); дефолт — телеграм Августы.
const CONSULT_TG = (process.env.NEXT_PUBLIC_CONSULT_TELEGRAM || 'avavasilik').replace(/^@/, '')
const CONSULT_URL = `https://t.me/${CONSULT_TG}`

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

// Цвет по нормализованному баллу (0–100) — совпадает с логикой диапазонов диагноза.
function bandColor(score100: number): { text: string; bg: string; ring: string } {
  if (score100 <= 30) return { text: 'text-red-600',    bg: 'bg-red-500',    ring: 'text-red-500' }
  if (score100 <= 55) return { text: 'text-orange-600', bg: 'bg-orange-500', ring: 'text-orange-500' }
  if (score100 <= 75) return { text: 'text-amber-600',  bg: 'bg-amber-500',  ring: 'text-amber-500' }
  if (score100 <= 90) return { text: 'text-lime-600',   bg: 'bg-lime-500',   ring: 'text-lime-500' }
  return { text: 'text-green-600', bg: 'bg-green-500', ring: 'text-green-500' }
}

function ScoreDot({ score }: { score: number | null }) {
  if (score === null) return <Lock className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
  const color = score === 2 ? 'bg-green-500' : score === 1 ? 'bg-amber-500' : 'bg-red-400'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 mt-1.5 ${color}`} />
}

// Русское склонение слова «балл» по числу.
function ballWord(n: number): string {
  const a = Math.abs(n) % 100
  const b = n % 10
  if (a > 10 && a < 20) return 'баллов'
  if (b === 1) return 'балл'
  if (b > 1 && b < 5) return 'балла'
  return 'баллов'
}

// Легенда одной из трёх зон разложения балла (зелёная/серая/жёлтая).
function ZoneLegend({ dot, value, title, desc }: { dot: string; value: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 mt-1 ${dot}`} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground leading-tight">
          <span className="tabular-nums">{value}</span> {ballWord(value)} · {title}
        </p>
        <p className="text-[11px] text-muted-foreground leading-tight">{desc}</p>
      </div>
    </div>
  )
}

function BlockCard({ block }: { block: AuditBlockResult }) {
  const pct = block.assessableMax > 0 ? Math.round((block.scored / block.assessableMax) * 100) : null
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-bold text-sm text-foreground">{block.title}</h4>
        {pct !== null ? (
          <span className={`text-xs font-semibold ${bandColor(pct).text}`}>{block.scored}/{block.assessableMax}</span>
        ) : (
          <span className="text-xs text-muted-foreground">на консультации</span>
        )}
      </div>
      <ul className="space-y-2">
        {block.items.map((it, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <ScoreDot score={it.score} />
            <div className="space-y-0.5">
              <span className={it.assessable ? 'text-foreground' : 'text-muted-foreground'}>{it.label}</span>
              {it.note && <p className="text-muted-foreground leading-snug">{it.note}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Чистый рендер результата — переиспользуется проектным аудитом (по материалу)
// и автономным (по введённому @хендлу на главной). onRerun опционален.
export function BlogAuditScorecard({ result, onRerun, rerunning }: {
  result: AuditResult; onRerun?: () => void; rerunning?: boolean
}) {
  // Блоки, где хоть один пункт не оценивался (для честной подписи внизу) — так
  // список не врёт: если визуал оценён по картинкам, его тут уже НЕ будет.
  const lockedBlocks = result.blocks.filter(b => b.items.some(it => !it.assessable)).map(b => b.title)
  // Разложение 100 баллов чек-листа на 3 зоны (по фидбэку тестера — серая зона это
  // «пока неизвестно», а НЕ «плохо», поэтому она не занижает балл, а показывается
  // отдельно). green — набрано по видимой части; grey — пункты, которые честно
  // нельзя оценить с поверхности профиля (кейсы/актуальные/визуал/воронка) → на
  // консультации; yellow — оценимая зона роста. green + grey + yellow = 100.
  const green = Math.max(0, result.scored)
  const grey = Math.max(0, MAX_SCORE - result.assessableMax)
  const yellow = Math.max(0, result.assessableMax - result.scored)
  const zones = zoneBreakdown(result)

  const [downloading, setDownloading] = useState(false)
  const downloadReport = async () => {
    setDownloading(true)
    try {
      const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      const { downloadDocx } = await import('@/lib/utils/docxText')
      await downloadDocx(
        `Диагностика блога @${result.handle}`,
        `Экспресс-диагностика блога @${result.handle}`,
        auditToText(result, date),
      )
    } catch (e) {
      toast.error(friendlyError(e, 'Не удалось скачать разбор'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Разложение балла на 3 зоны вместо одной пугающей оценки «X из 10». */}
      <div className="rounded-2xl border border-border bg-card/50 p-5 space-y-4">
        <div>
          <p className="font-bold text-sm text-foreground leading-snug">{result.diagnosis}</p>
          {/* Владелец 17 июля: «зелёное поле ясно, а остальное — неясно объяснено, что это».
              Поэтому прямо говорим, ЧТО мы смотрели (шапка + посты) и почему часть баллов
              вообще нельзя посчитать — иначе «видимая часть профиля» читается как жаргон. */}
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Мы разобрали шапку и последние посты @{result.handle} по чек-листу на 100 баллов.
            Сторис, актуальные и то, куда ведёт ссылка, автоматически увидеть нельзя — эти баллы вынесены отдельно.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
            {green > 0 && <div className="h-full bg-green-500" style={{ width: `${green}%` }} />}
            {grey > 0 && <div className="h-full bg-slate-300 dark:bg-slate-600" style={{ width: `${grey}%` }} />}
            {yellow > 0 && <div className="h-full bg-amber-400" style={{ width: `${yellow}%` }} />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Формулировки согласованы с Ланой/Августой 17 июля. */}
            <ZoneLegend dot="bg-green-500" value={green} title="собрано" desc="критерии диагностики выполнены" />
            <ZoneLegend dot="bg-slate-300 dark:bg-slate-600" value={grey} title="нужна оценка эксперта" desc="автоматически проверить невозможно" />
            <ZoneLegend dot="bg-amber-400" value={yellow} title="зона роста" desc="критерии не выполнены — это можно улучшить" />
          </div>
        </div>

        {/* «Надо пояснить снизу, что для ЭТОГО блога зелёное, что жёлтое, что серое.
            Вкратце» (Августа, 17 июля) — иначе зоны остаются абстракцией. */}
        <div className="border-t border-border pt-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">Что это значит для @{result.handle}</p>
          {([
            ['bg-green-500', 'Собрано', zones.green],
            ['bg-amber-400', 'Зона роста', zones.yellow],
            ['bg-slate-300 dark:bg-slate-600', 'Нужен эксперт', zones.grey],
          ] as const).map(([dot, title, list]) => (
            list.length > 0 && (
              <p key={title} className="flex gap-2 text-[11px] leading-snug">
                <span className={`inline-block h-2 w-2 rounded-full shrink-0 mt-1 ${dot}`} />
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{title}:</span> {list.join(', ')}
                </span>
              </p>
            )
          ))}
        </div>
      </div>

      {result.summary && (
        <p className="text-sm text-foreground/90 leading-relaxed bg-muted/40 rounded-xl p-4">{result.summary}</p>
      )}

      {result.topGaps.length > 0 && (
        <div className="rounded-xl border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-2">
          <h4 className="font-bold text-sm flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-4 w-4" /> Что усилить в первую очередь
          </h4>
          <ul className="space-y-1.5">
            {result.topGaps.map((g, i) => (
              <li key={i} className="flex gap-2 text-xs text-foreground/90">
                <ArrowRight className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-primary" /> Разбор по блокам
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {result.blocks.map(b => <BlockCard key={b.key} block={b} />)}
        </div>
      </div>

      {result.notAssessableCount > 0 && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {result.notAssessableCount} пунктов{lockedBlocks.length ? ` (${lockedBlocks.join(', ')})` : ''} обсуждаются
          на консультации — их не считать автоматически с поверхности профиля{result.blocks.some(b => b.key === 'highlights' && b.assessableMax === 0)
            ? ' (напр. содержимое актуальных Instagram не отдаёт)' : ''}.
        </p>
      )}

      <div className="rounded-2xl gradient-accent p-5 text-white text-center space-y-2">
        <p className="font-bold text-base">Хочешь полную стратегию по блогу?</p>
        <p className="text-sm text-white/90 leading-snug">
          На бесплатной консультации маркетолог разберёт актуальные, визуал и воронку и покажет, как
          привести блог в порядок, чтобы он продавал.
        </p>
        <a href={CONSULT_URL} target="_blank" rel="noopener noreferrer" className="inline-block pt-1">
          <Button className="bg-white text-[#D44E7E] hover:bg-white/90 border-0 font-bold">
            Записаться на бесплатную консультацию
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </a>
      </div>

      {/* Разбор длинный, и его пересылали скриншотами по кускам (фидбэк владельца
          17 июля) — даём выгрузку одним документом: можно отправить маркетологу
          или открыть с телефона. */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button variant="outline" onClick={downloadReport} disabled={downloading} className="flex-1">
          {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Скачать разбор
        </Button>
        {onRerun && (
          <Button variant="outline" onClick={onRerun} disabled={rerunning} className="flex-1">
            <RefreshCw className="h-4 w-4 mr-2" />
            Перепроверить
          </Button>
        )}
      </div>
    </div>
  )
}

// Ядро диагностики (без обёртки) — используется и в диалоге (кнопка в
// «Материалах»), и на отдельной странице /blog-audit (вход с дашборда проекта).
export function BlogAuditPanel({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false)   // running the audit
  const [fetching, setFetching] = useState(true)   // loading cached result
  const [result, setResult] = useState<AuditResult | null>(null)

  // Подтянуть кэш последнего разбора при монтировании.
  useEffect(() => {
    let alive = true
    setFetching(true)
    fetch(`/api/blog-audit?projectId=${projectId}`)
      .then(r => r.json())
      .then((d: { result?: AuditResult | null }) => { if (alive) setResult(d.result ?? null) })
      .catch(() => { /* нет кэша — просто покажем экран запуска */ })
      .finally(() => { if (alive) setFetching(false) })
    return () => { alive = false }
  }, [projectId])

  const runAudit = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/blog-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const body = await res.json().catch(() => ({})) as { jobId?: string; error?: string }
      if (!res.ok || !body.jobId) throw new Error(body.error || 'Не удалось запустить разбор')
      const audit = await pollJob<AuditResult>(body.jobId)
      if (!audit || typeof audit.score100 !== 'number') throw new Error('Пустой результат разбора')
      setResult(audit)
    } catch (e) {
      toast.error(friendlyError(e, 'Не удалось сделать разбор'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  if (fetching) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground max-w-xs">
          Анализирую твой блог по чек-листу из 10 блоков… Это займёт ~20–40 секунд, можно не ждать на экране.
        </p>
      </div>
    )
  }
  if (!result) {
    return (
      <div className="py-6 space-y-5">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Проверим твой Instagram по чек-листу «блог к продажам»: ЦА и смыслы, позиционирование, шапка,
          воронка, контент, прогрев, продающая ясность и др. На выходе — балл, диагноз и конкретный список
          того, что усилить. Разбор идёт по подключённому аккаунту, тексту шапки и последним постам.
        </p>
        <Button onClick={runAudit} className="w-full gradient-accent text-white border-0 hover:opacity-90">
          <Sparkles className="h-4 w-4 mr-2" />
          Проверить блог к продажам
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Нужен подключённый Instagram — подключить можно в разделе «Материалы».
        </p>
      </div>
    )
  }
  return <BlogAuditScorecard result={result} onRerun={runAudit} rerunning={loading} />
}

export function BlogAuditDialog({ projectId, open, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Экспресс-диагностика блога
          </DialogTitle>
        </DialogHeader>
        {open && <BlogAuditPanel projectId={projectId} />}
      </DialogContent>
    </Dialog>
  )
}
