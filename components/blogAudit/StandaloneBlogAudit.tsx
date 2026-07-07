'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Sparkles, AtSign } from 'lucide-react'
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

  const run = useCallback(async (h: string) => {
    const clean = h.trim()
    if (!clean) { toast.error('Введи @аккаунт Instagram'); return }
    setLoading(true)
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
        <BlogAuditScorecard result={result} onRerun={() => run(handle)} rerunning={loading} />
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { setResult(null); setHandle('') }}>
          Проверить другой аккаунт
        </Button>
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
