'use client'

// Панель «Рилз» в студии контента (MVP авто-монтажа, 21 июля):
// сценарий (приходит из чата/плана через handoff или пишется здесь) → клиент
// записывает себя по сценарию и загружает видео → фоновая задача вырезает
// паузы, жжёт субтитры по словам и хук → готовый вертикальный mp4.
// Стоимость: VIDEO_MONTAGE_UNITS юнитов (сервер вернёт их при провале).

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Clapperboard, Download, Upload, RefreshCw } from 'lucide-react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/friendlyError'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { VIDEO_MONTAGE_UNITS } from '@/lib/generations-config'

// ⚠️ Supabase на тарифе Free режет загрузку файла на 50 МБ (подтверждено скрином
// панели 24 июля: org «pro-duct FREE»). Держим 48, чтобы упереться в НАШУ понятную
// ошибку, а не в невнятную ошибку хранилища. Апгрейд до Pro → можно поднять.
const MAX_VIDEO_MB = 48

type Stage = 'idle' | 'uploading' | 'queued' | 'analyze' | 'transcribe' | 'render' | 'done' | 'error'

const STAGE_LABEL: Record<string, string> = {
  queued: 'В очереди...',
  download: 'Забираю видео...',
  analyze: 'Ищу паузы...',
  transcribe: 'Расшифровываю речь...',
  render: 'Монтирую: субтитры и хук...',
}

function firstLine(text: string): string {
  const l = text.split('\n').map((s) => s.trim()).find(Boolean) || ''
  return l.replace(/^[#>\-*\s]+/, '').slice(0, 90)
}

export function ReelsMontagePanel({ projectId, text, onTextChange }: {
  projectId: string
  text: string
  onTextChange: (t: string) => void
}) {
  const [hook, setHook] = useState('')
  const [hookTouched, setHookTouched] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [stageDetail, setStageDetail] = useState('')
  const [result, setResult] = useState<{ url: string; durationBefore: number; durationAfter: number; cuts: number; phrases: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // хук по умолчанию — первая строка сценария, пока пользователь его не правил
  useEffect(() => {
    if (!hookTouched) setHook(firstLine(text))
  }, [text, hookTouched])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const busy = stage !== 'idle' && stage !== 'done' && stage !== 'error'

  async function startMontage(file: File) {
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      toast.error(`Видео больше ${MAX_VIDEO_MB} МБ — это примерно 45-70 секунд с телефона. Обрежь и попробуй снова.`)
      return
    }
    setStage('uploading'); setResult(null); setStageDetail('')
    try {
      // 1. подписанная ссылка + загрузка в audio-temp (тот же путь, что интервью)
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
      const urlRes = await fetch('/api/ai/transcribe/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ext }),
      })
      const urlData = await urlRes.json() as { path?: string; token?: string; error?: string }
      if (!urlRes.ok || !urlData.path || !urlData.token) throw new Error(urlData.error ?? 'Не удалось получить ссылку для загрузки')

      const supabase = createSupabaseClient()
      const { error: upErr } = await supabase.storage.from('audio-temp').uploadToSignedUrl(urlData.path, urlData.token, file)
      if (upErr) throw new Error(`Ошибка загрузки: ${upErr.message}`)

      // 2. поставить задачу монтажа
      const startRes = await fetch('/api/jobs/montage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, storagePath: urlData.path, hookText: hook }),
      })
      const startBody = await startRes.json() as { jobId?: string; error?: string; code?: string }
      if (startRes.status === 402) {
        toast.error(startBody.code === 'payment_required'
          ? 'Подключи тариф, чтобы монтировать видео.'
          : `Не хватает единиц контента: монтаж стоит ${VIDEO_MONTAGE_UNITS}. Лимит обновится 1-го числа.`)
        setStage('idle'); return
      }
      if (!startRes.ok || !startBody.jobId) throw new Error(startBody.error ?? 'Не удалось запустить монтаж')

      // 3. поллинг
      setStage('queued')
      const jobId = startBody.jobId
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/jobs/${jobId}`)
          const d = await r.json() as { job?: { status: string; progress?: { stage?: string }; result?: typeof result; error?: string } }
          const job = d.job
          if (!job) return
          if (job.status === 'done' && job.result) {
            if (pollRef.current) clearInterval(pollRef.current)
            setResult(job.result); setStage('done')
            toast.success('Рилс смонтирован!')
          } else if (job.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current)
            setStage('error'); setStageDetail(job.error || '')
            toast.error(friendlyError(job.error, 'Не удалось смонтировать видео.'))
          } else {
            const s = job.progress?.stage
            if (s && STAGE_LABEL[s]) { setStage(s as Stage); setStageDetail(STAGE_LABEL[s]) }
          }
        } catch { /* сеть мигнула — следующий тик */ }
      }, 2500)
    } catch (e) {
      setStage('error')
      toast.error(friendlyError(e, 'Не удалось загрузить видео. Попробуй ещё раз.'))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-foreground">Сценарий рилза</label>
        <VoiceTextarea value={text} onChange={onTextChange} rows={6}
          placeholder="Вставь сценарий из чата или контент-плана — или напиши свой. По нему запишешь видео."
          className="w-full rounded-xl border border-border bg-card p-3 text-sm" />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-foreground">Хук на первых секундах</label>
        <input value={hook} onChange={(e) => { setHook(e.target.value); setHookTouched(true) }}
          maxLength={90}
          placeholder="Крупный текст, который остановит скролл"
          className="w-full rounded-xl border border-border bg-card p-3 text-sm" />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Запиши себя по сценарию и загрузи видео</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Вертикально, до ~90 секунд (макс {MAX_VIDEO_MB} МБ). Мы вырежем паузы, наложим субтитры и хук.
          Стоимость: {VIDEO_MONTAGE_UNITS} единиц контента.
        </p>
        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) startMontage(f); e.target.value = '' }} />
        <button type="button" disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="mt-3 inline-flex items-center gap-2 rounded-xl gradient-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy
            ? <><Loader2 className="h-4 w-4 animate-spin" /> {stageDetail || 'Обрабатываю...'}</>
            : <><Upload className="h-4 w-4" /> {result ? 'Смонтировать другое видео' : 'Загрузить видео'}</>}
        </button>
        {busy && (
          <p className="mt-2 text-xs text-muted-foreground">
            Обычно 1-3 минуты. Можно уйти со страницы — монтаж продолжится, вернись и проверь.
          </p>
        )}
      </div>

      {stage === 'done' && result && (
        <div className="rounded-xl border border-[#3A8A48]/30 bg-[#3A8A48]/5 p-4">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Clapperboard className="h-4 w-4 text-[#3A8A48]" /> Готово!
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.durationBefore}с → {result.durationAfter}с
            {result.cuts > 0 && <> · вырезано пауз: {result.cuts}</>} · субтитров: {result.phrases}
          </p>
          <video src={result.url} controls playsInline className="mt-3 w-full max-w-[280px] rounded-xl border border-border" />
          <div className="mt-3 flex gap-2">
            <a href={result.url} download="reels.mp4" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">
              <Download className="h-3.5 w-3.5" /> Скачать mp4
            </a>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">
              <RefreshCw className="h-3.5 w-3.5" /> Другое видео
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
