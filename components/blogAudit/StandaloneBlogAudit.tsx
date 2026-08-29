'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2, Sparkles, AtSign, CalendarCheck, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { pollJob } from '@/lib/jobs/pollJob'
import { friendlyError } from '@/lib/friendlyError'
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
  // Воронка v2 (спека ассистентки 29.08): консультацию НЕ предлагаем до
  // отчёта и не всплываем поверх него — два действия стоят ВНИЗУ отчёта как
  // продолжение. Кнопка «Забронировать место» открывает ФОРМУ заявки
  // (имя/Telegram/Instagram) — бота не используем, заявка уходит менеджеру.
  const [formOpen, setFormOpen] = useState(false)
  const [leadName, setLeadName] = useState('')
  const [leadTg, setLeadTg] = useState('')
  const [leadIg, setLeadIg] = useState('')
  const [leadSending, setLeadSending] = useState(false)
  const [leadSent, setLeadSent] = useState(false)

  async function submitLead(e: React.FormEvent) {
    e.preventDefault()
    if (leadSending) return
    if (!leadName.trim() || !leadTg.trim() || !leadIg.trim()) {
      toast.error('Заполни все три поля — имя, Telegram и Instagram.')
      return
    }
    setLeadSending(true)
    try {
      const res = await fetch('/api/diagnostic-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: leadName, telegram: leadTg, instagram: leadIg }),
      })
      const d = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) throw new Error(d.error || 'Не удалось отправить заявку')
      setLeadSent(true)
    } catch (err) {
      toast.error(friendlyError(err, 'Не удалось отправить заявку — попробуй ещё раз'))
    } finally {
      setLeadSending(false)
    }
  }

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
        <BlogAuditScorecard result={result} onRerun={() => run(handle)} rerunning={loading} hideCta />

        {/* ── Продолжение воронки ПОСЛЕ отчёта (спека 29.08): два действия ── */}
        {/* 1. Оффер на консультацию → форма заявки */}
        <div className="rounded-2xl gradient-accent p-5 text-white space-y-2">
          <p className="font-bold text-base">Для тех, кто готов действовать👇🏼</p>
          <p className="text-sm text-white/90 leading-relaxed">
            Отчет показал то, что видно на поверхности профиля. Если ты уже готов к монетизации
            своего блога и хочешь получить индивидуальную систему заработка на блоге, забронируй
            место на бесплатную консультацию к маркетологу команды Августы.
          </p>
          <p className="text-sm text-white/90 leading-relaxed">
            На консультации мы простроим дорожную карту действий, которые приведут тебя к продажам!
          </p>
          <div className="pt-1">
            <Button onClick={() => setFormOpen(true)} className="bg-white text-[#D44E7E] hover:bg-white/90 border-0 font-bold">
              <CalendarCheck className="h-4 w-4 mr-2" />
              Забронировать место
            </Button>
          </div>
        </div>

        {/* 2. Второй CTA — попробовать AI-SMMщика (тарифы) */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
          <p className="font-bold text-base text-foreground">Хочешь попробовать пользоваться AI-SMMщиком?</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Он изучит твой голос и аудиторию — и будет писать контент и делать визуал за тебя.
          </p>
          <Link href="/pricing" className="inline-block pt-1">
            <Button variant="outline" className="font-bold">Попробовать</Button>
          </Link>
        </div>

        <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { setResult(null); setHandle(''); setRestoredFrom(null) }}>
          Проверить другой аккаунт
        </Button>

        {/* Форма заявки (бота не используем): имя / Telegram / Instagram */}
        <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) setLeadSent(false) }}>
          <DialogContent className="sm:max-w-md">
            {leadSent ? (
              <div className="space-y-3 py-2 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
                <DialogTitle className="text-lg font-black">Заявка отправлена!</DialogTitle>
                <DialogDescription className="text-sm">
                  Маркетолог команды Августа свяжется с вами в Telegram.
                </DialogDescription>
                <Button variant="outline" className="w-full" onClick={() => setFormOpen(false)}>Закрыть</Button>
              </div>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="text-lg font-black leading-snug">Бронь места на консультацию</DialogTitle>
                  <DialogDescription className="text-sm">
                    Оставь контакты — маркетолог команды Августы напишет тебе в Telegram.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={submitLead} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Имя</label>
                    <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Как к тебе обращаться" required />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Telegram</label>
                    <Input value={leadTg} onChange={(e) => setLeadTg(e.target.value)} placeholder="@username" required autoCapitalize="none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Instagram</label>
                    <Input value={leadIg} onChange={(e) => setLeadIg(e.target.value)} placeholder="@аккаунт" required autoCapitalize="none" />
                  </div>
                  <Button type="submit" disabled={leadSending} className="w-full gradient-accent text-white border-0 hover:opacity-90">
                    {leadSending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Отправить заявку'}
                  </Button>
                </form>
              </>
            )}
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
