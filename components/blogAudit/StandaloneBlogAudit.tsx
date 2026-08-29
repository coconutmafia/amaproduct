'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2, Sparkles, AtSign, CalendarCheck } from 'lucide-react'
import { toast } from 'sonner'
import { pollJob } from '@/lib/jobs/pollJob'
import { friendlyError } from '@/lib/friendlyError'
import { CONSULT_URL } from '@/lib/consult'
import { BlogAuditScorecard } from '@/components/projects/BlogAuditDialog'
import type { AuditResult } from '@/lib/blogAudit/runBlogAudit'

// Автономная диагностика по введённому @хендлу — для тех, у кого ещё нет проекта.
// Скрейпит профиль на лету (в отличие от проектного аудита по материалу).
export function StandaloneBlogAudit() {
  const [handle, setHandle]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<AuditResult | null>(null)
  // Метка «это прошлый разбор» при восстановлении после выгрузки вкладки.
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null)
  const restoredRef = useRef(false)
  // Финальный экран воронки (список Марины, 29.08): после СВЕЖЕГО отчёта —
  // отдельное окно «разобрать глубже → запись на консультацию». Показывается
  // один раз на разбор; для восстановленного старого отчёта не всплывает
  // (человек его уже видел) — там остаётся CTA внутри скоркарда.
  const [consultOpen, setConsultOpen] = useState(false)

  // Разбор идёт ~1 минуту — телефон успевает выгрузить вкладку. Джоб
  // доделывается на сервере; при открытии страницы догоняем его: живой —
  // продолжаем поллинг, готовый — сразу показываем (раньше результат
  // пропадал для клиента насовсем).
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/blog-audit/standalone')
        if (!res.ok) return
        const d = await res.json() as { job?: { id: string; status: string; result?: AuditResult | null; username?: string | null; createdAt?: string } | null }
        const job = d.job
        if (!job) return
        if (job.username) setHandle(job.username)
        const freshEnough = job.createdAt && Date.now() - new Date(job.createdAt).getTime() < 24 * 3600 * 1000
        if (job.status === 'done' && freshEnough && job.result && typeof job.result.score100 === 'number') {
          setResult(job.result)
          setRestoredFrom(job.username ? `@${job.username}` : 'прошлый разбор')
        } else if (job.status === 'queued' || job.status === 'processing') {
          setLoading(true)
          toast.message('Разбор шёл на сервере, пока страница была закрыта — догоняю…')
          try {
            const audit = await pollJob<AuditResult>(job.id)
            if (audit && typeof audit.score100 === 'number') setResult(audit)
          } catch (e) {
            toast.error(friendlyError(e, 'Не удалось сделать разбор'))
          } finally {
            setLoading(false)
          }
        }
      } catch { /* нет прошлого разбора — обычный экран ввода */ }
    })()
  }, [])

  const run = useCallback(async (h: string) => {
    const clean = h.trim()
    if (!clean) { toast.error('Введи @аккаунт Instagram'); return }
    setLoading(true)
    setRestoredFrom(null)
    try {
      const res = await fetch('/api/blog-audit/standalone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: clean }),
      })
      const body = await res.json().catch(() => ({})) as { jobId?: string; error?: string }
      if (!res.ok || !body.jobId) throw new Error(body.error || 'Не удалось запустить разбор')
      const audit = await pollJob<AuditResult>(body.jobId)
      if (!audit || typeof audit.score100 !== 'number') throw new Error('Пустой результат разбора')
      setResult(audit)
      setConsultOpen(true)
    } catch (e) {
      toast.error(friendlyError(e, 'Не удалось сделать разбор'))
    } finally {
      setLoading(false)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground max-w-xs">
          Загружаю профиль <span className="font-medium">@{handle.replace(/^@/, '')}</span> и анализирую по чек-листу…
          Это займёт ~1 минуту, можно не ждать на экране.
        </p>
      </div>
    )
  }

  if (result) {
    return (
      <div className="space-y-4">
        {restoredFrom && (
          <p className="text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2">
            Это твой последний разбор ({restoredFrom}) — он доделался, пока страница была закрыта. Хочешь свежий — нажми «Проверить заново».
          </p>
        )}
        <BlogAuditScorecard result={result} onRerun={() => run(handle)} rerunning={loading} />
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { setResult(null); setHandle(''); setRestoredFrom(null) }}>
          Проверить другой аккаунт
        </Button>

        {/* Финальный экран воронки: отчёт получен → запись на консультацию */}
        <Dialog open={consultOpen} onOpenChange={setConsultOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-black leading-snug">
                Хочешь разобрать аккаунт глубже?
              </DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Отчёт показывает, что видно с поверхности профиля. На бесплатной консультации
                маркетолог разберёт актуальные, визуал и воронку — и покажет, как довести блог до продаж.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 pt-1">
              <a href={CONSULT_URL} target="_blank" rel="noopener noreferrer" className="block">
                <Button className="w-full gradient-accent text-white border-0 hover:opacity-90">
                  <CalendarCheck className="h-4 w-4 mr-2" />
                  Записаться на консультацию
                </Button>
              </a>
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setConsultOpen(false)}>
                Сначала посмотрю отчёт
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Введи Instagram-аккаунт — проверим его по чек-листу «блог к продажам» (ЦА и смыслы, позиционирование, шапка,
        воронка, контент, прогрев, продающая ясность и др.). На выходе — балл, диагноз и конкретный список того,
        что усилить. Проект для этого не нужен.
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); run(handle) }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <div className="relative flex-1">
          <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="username или ссылка на профиль"
            className="pl-9 h-11"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
        <Button type="submit" className="h-11 gradient-accent text-white border-0 hover:opacity-90 sm:w-auto">
          <Sparkles className="h-4 w-4 mr-2" />
          Проверить блог
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Аккаунт должен быть публичным.</p>
    </div>
  )
}
