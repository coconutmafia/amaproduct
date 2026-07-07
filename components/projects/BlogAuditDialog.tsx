'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Sparkles, CheckCircle2, AlertCircle, Lock, ArrowRight, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { pollJob } from '@/lib/jobs/pollJob'
import { friendlyError } from '@/lib/friendlyError'
import type { AuditResult, AuditBlockResult } from '@/lib/blogAudit/runBlogAudit'

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

  const color = result ? bandColor(result.score100) : null

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
  return (
    <div className="space-y-5">
      {/* Хедлайн-балл */}
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card/50 p-5">
        <div className="text-center shrink-0">
          <div className={`text-4xl font-black ${color!.text}`}>{result.score10.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">из 10</div>
        </div>
        <div className="space-y-1.5 flex-1">
          <p className="font-bold text-sm text-foreground leading-snug">{result.diagnosis}</p>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${color!.bg}`} style={{ width: `${result.score100}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {result.score100}/100 по видимой части профиля (@{result.handle})
          </p>
        </div>
      </div>

      {result.summary && (
        <p className="text-sm text-foreground/90 leading-relaxed bg-muted/40 rounded-xl p-4">{result.summary}</p>
      )}

      {/* Что усилить в первую очередь */}
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

      {/* Разбор по блокам */}
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
          {result.notAssessableCount} пунктов (актуальные, визуал, куда ведёт ссылка) не видны из текста
          профиля — их разберём вручную на консультации.
        </p>
      )}

      {/* CTA на консультацию */}
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

      <Button variant="outline" onClick={runAudit} disabled={loading} className="w-full">
        <RefreshCw className="h-4 w-4 mr-2" />
        Перепроверить
      </Button>
    </div>
  )
}

export function BlogAuditDialog({ projectId, open, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Диагностика блога к продажам
          </DialogTitle>
        </DialogHeader>
        {open && <BlogAuditPanel projectId={projectId} />}
      </DialogContent>
    </Dialog>
  )
}
