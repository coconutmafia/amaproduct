'use client'

import { use, useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/friendlyError'
import { ArrowLeft, TrendingUp, Plus, Trash2, Loader2, Sparkles, Wand2, Check, Globe, Users, Film } from 'lucide-react'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { ViralReelsManager } from '@/components/projects/ViralReelsManager'
import { isRlsError, READ_ONLY_MESSAGE } from '@/lib/projects/access'
import { toast } from 'sonner'

interface Trend {
  id: string
  scope: 'system' | 'project'
  title: string
  description: string
  example: string | null
  format_type: string
  created_at: string
}

interface Candidate {
  title: string
  description: string
  example: string | null
  format_type: string
}

const FORMATS = [
  { v: 'any', label: 'Любой формат' },
  { v: 'post', label: 'Пост' },
  { v: 'reels', label: 'Рилз' },
  { v: 'stories', label: 'Сторис' },
  { v: 'carousel', label: 'Карусель' },
]

export default function ProjectTrendsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()

  const [mine, setMine] = useState<Trend[]>([])
  const [system, setSystem] = useState<Trend[]>([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [example, setExample] = useState('')
  const [formatType, setFormatType] = useState('any')

  // AI-подбор трендов
  const [suggestMode, setSuggestMode] = useState<'niche' | 'popular'>('niche')
  const [suggesting, setSuggesting] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [grounded, setGrounded] = useState<{ web?: boolean; competitors?: boolean; reels?: boolean }>({})
  const [adopting, setAdopting] = useState(false)
  const mineRef = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: proj, error }, { data: sys }] = await Promise.all([
      supabase.from('content_trends').select('id, scope, title, description, example, format_type, created_at')
        .eq('scope', 'project').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('content_trends').select('id, scope, title, description, example, format_type, created_at')
        .eq('scope', 'system').eq('is_active', true).order('created_at', { ascending: false }),
    ])
    if (error && /scope|column|does not exist|relation/i.test(error.message)) setNeedsSetup(true)
    setMine((proj ?? []) as Trend[])
    setSystem((sys ?? []) as Trend[])
    setLoading(false)
  }, [supabase, id])

  useEffect(() => { load() }, [load])

  // After adding trends, scroll to "Мои тренды" and flash it so it's obvious
  // where they landed (the small toast alone was easy to miss).
  const highlightMine = () => {
    setFlash(true)
    setTimeout(() => mineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    setTimeout(() => setFlash(false), 2200)
  }

  const add = async () => {
    if (!title.trim() || !description.trim() || saving) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('content_trends').insert({
        scope: 'project', project_id: id, created_by: user?.id ?? null,
        title: title.trim(), description: description.trim(),
        example: example.trim() || null, format_type: formatType,
      })
      if (error) {
        if (/scope|column|does not exist/i.test(error.message)) { setNeedsSetup(true); throw new Error('Тренды ещё не настроены (нужна миграция БД)') }
        throw new Error(isRlsError(error) ? READ_ONLY_MESSAGE : error.message)
      }
      setTitle(''); setDescription(''); setExample(''); setFormatType('any')
      toast.success('Добавлено в «Мои тренды» — AI вплетёт его в контент-план')
      load(); highlightMine()
    } catch (e) { toast.error(friendlyError(e, 'Не удалось')) }
    finally { setSaving(false) }
  }

  const remove = async (tid: string) => {
    setDeletingId(tid)
    const { error } = await supabase.from('content_trends').delete().eq('id', tid)
    if (error) { toast.error(isRlsError(error) ? READ_ONLY_MESSAGE : 'Не удалось удалить'); setDeletingId(null); return }
    setMine(prev => prev.filter(t => t.id !== tid))
    setDeletingId(null)
    toast.success('Удалено')
  }

  const suggest = async () => {
    if (suggesting) return
    setSuggesting(true)
    setCandidates([]); setPicked(new Set())
    try {
      const res = await fetch('/api/ai/suggest-trends', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, scope: 'project', mode: suggestMode }),
      })
      const data = await res.json() as { trends?: Candidate[]; grounded?: typeof grounded; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Не удалось подобрать тренды')
      setCandidates(data.trends ?? [])
      setGrounded(data.grounded ?? {})
      if ((data.trends ?? []).length === 0) toast.message('Пока ничего не подобралось — попробуй ещё раз')
    } catch (e) { toast.error(friendlyError(e, 'Не удалось')) }
    finally { setSuggesting(false) }
  }

  const togglePick = (i: number) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  })

  const adoptSelected = async () => {
    if (adopting || picked.size === 0) return
    setAdopting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const chosen = [...picked].map(i => candidates[i]).filter(Boolean)
      const rows = chosen.map(c => ({
        scope: 'project', project_id: id, created_by: user?.id ?? null,
        title: c.title, description: c.description, example: c.example, format_type: c.format_type,
      }))
      const { error } = await supabase.from('content_trends').insert(rows)
      if (error) throw new Error(isRlsError(error) ? READ_ONLY_MESSAGE : error.message)
      toast.success(`Добавлено в «Мои тренды»: ${rows.length}. AI вплетёт их в контент-план 👇`)
      // Drop the adopted ones from the candidate list
      setCandidates(prev => prev.filter((_, i) => !picked.has(i)))
      setPicked(new Set())
      load(); highlightMine()
    } catch (e) { toast.error(friendlyError(e, 'Не удалось добавить')) }
    finally { setAdopting(false) }
  }

  const fmtLabel = (v: string) => FORMATS.find(f => f.v === v)?.label ?? v

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${id}`} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary shrink-0"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Тренды месяца</h1>
          <p className="text-xs text-muted-foreground">Тренды, форматы и залетевшие рилз → AI вплетёт их в твой контент-план</p>
        </div>
      </div>

      {needsSetup && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-foreground">
          Раздел почти готов — осталось применить миграцию БД (поля <code>scope</code>/<code>project_id</code> у трендов).
        </div>
      )}

      {/* AI-подбор трендов */}
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Wand2 className="h-4 w-4 text-primary" /> Подобрать тренды автоматически</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">AI проанализирует свежие тренды в интернете, твоих конкурентов и залетевшие рилз — и предложит, что попробовать. Выбери подходящие.</p>
          </div>
          <button onClick={suggest} disabled={suggesting}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold text-white gradient-accent disabled:opacity-50 active:opacity-90">
            {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {suggesting ? 'Подбираю…' : 'Подобрать'}
          </button>
        </div>

        {/* На основе чего подбирать — как селектор в «Создать» */}
        <div className="inline-flex rounded-lg border border-[#E0E0E0] bg-white p-0.5 text-xs">
          <button onClick={() => setSuggestMode('niche')} disabled={suggesting}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${suggestMode === 'niche' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            По моей нише
          </button>
          <button onClick={() => setSuggestMode('popular')} disabled={suggesting}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${suggestMode === 'popular' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            Популярные сейчас
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground -mt-1">
          {suggestMode === 'niche' ? 'Тренды под твою тему, конкурентов и залетевшие рилз.' : 'Популярные тренды в целом — попробовать что-то новое, не из своей ниши.'}
        </p>

        {suggesting && (
          <p className="text-[11px] text-muted-foreground">Ищу свежие тренды в интернете и анализирую нишу — обычно до 1-2 минут. Не закрывай страницу.</p>
        )}

        {candidates.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
              {grounded.web && <span className="inline-flex items-center gap-1 bg-secondary rounded-full px-2 py-0.5"><Globe className="h-3 w-3" /> свежее из интернета</span>}
              {grounded.competitors && <span className="inline-flex items-center gap-1 bg-secondary rounded-full px-2 py-0.5"><Users className="h-3 w-3" /> по твоим конкурентам</span>}
              {grounded.reels && <span className="inline-flex items-center gap-1 bg-secondary rounded-full px-2 py-0.5"><Sparkles className="h-3 w-3" /> по залетевшим рилз</span>}
            </div>
            {candidates.map((c, i) => {
              const sel = picked.has(i)
              return (
                <button key={i} onClick={() => togglePick(i)}
                  className={`w-full text-left rounded-xl border p-3.5 space-y-1.5 transition-all ${sel ? 'border-primary bg-primary/10' : 'border-[#ECECEC] bg-white hover:border-primary/40'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground flex-1">{c.title}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">{fmtLabel(c.format_type)}</span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${sel ? 'bg-primary border-primary text-white' : 'border-[#D4D4D4] text-transparent'}`}><Check className="h-3 w-3" /></span>
                    </div>
                  </div>
                  <p className="text-[13px] text-[#444] leading-relaxed">{c.description}</p>
                  {c.example && <p className="text-[12px] text-muted-foreground">Пример: {c.example}</p>}
                </button>
              )
            })}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={adoptSelected} disabled={adopting || picked.size === 0}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white gradient-accent disabled:opacity-40 active:opacity-90">
                {adopting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Добавить выбранные{picked.size > 0 ? ` (${picked.size})` : ''}
              </button>
              <button onClick={() => { setCandidates([]); setPicked(new Set()) }}
                className="px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground">Скрыть</button>
            </div>
          </div>
        )}
      </div>

      {/* Add form */}
      <div className="rounded-xl border border-[#ECECEC] bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Добавить свой тренд</p>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Название тренда — напр. «Формат вопрос-ответ на экране»"
          className="w-full rounded-xl border border-[#E0E0E0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-primary/50 bg-background" />
        <VoiceTextarea value={description} onChange={setDescription}
          placeholder="Что это и как использовать — надиктуй или впиши" rows={2} />
        <input value={example} onChange={e => setExample(e.target.value)}
          placeholder="Пример (по желанию)"
          className="w-full rounded-xl border border-[#E0E0E0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-primary/50 bg-background" />
        <div className="flex items-center gap-2">
          <select value={formatType} onChange={e => setFormatType(e.target.value)}
            className="flex-1 rounded-xl border border-[#E0E0E0] px-3 py-2.5 text-sm bg-background focus:outline-none focus:border-primary/50">
            {FORMATS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
          <button onClick={add} disabled={!title.trim() || !description.trim() || saving}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white gradient-accent disabled:opacity-40 active:opacity-90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Добавить
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</div>
      ) : (
        <div className="space-y-6">
          {/* My trends */}
          <div ref={mineRef} className={`space-y-2.5 scroll-mt-4 rounded-2xl transition-all duration-500 ${flash ? 'ring-2 ring-primary/60 ring-offset-4 ring-offset-background' : ''}`}>
            <h2 className="text-sm font-bold text-foreground">Мои тренды <span className="text-[11px] font-medium text-muted-foreground bg-secondary rounded-full px-2 py-0.5">{mine.length}</span></h2>
            {mine.length === 0 && <p className="text-sm text-muted-foreground">Пока пусто. Добавь тренд выше — он будет вплетаться в твой контент-план.</p>}
            {mine.map(t => (
              <div key={t.id} className="rounded-xl border border-[#ECECEC] bg-white p-3.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground flex-1">{t.title}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">{fmtLabel(t.format_type)}</span>
                    <button onClick={() => remove(t.id)} disabled={deletingId === t.id}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-muted-foreground hover:text-red-500 hover:border-red-200 transition-colors">
                      {deletingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <p className="text-[13px] text-[#444] leading-relaxed">{t.description}</p>
                {t.example && <p className="text-[12px] text-muted-foreground">Пример: {t.example}</p>}
              </div>
            ))}
          </div>

          {/* System trends (read-only) */}
          {system.length > 0 && (
            <div className="space-y-2.5">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Тренды от AMA
                <span className="text-[11px] font-medium text-muted-foreground bg-secondary rounded-full px-2 py-0.5">{system.length}</span>
              </h2>
              <p className="text-[11px] text-muted-foreground -mt-1">Подобраны командой — уже вплетаются в твой план по нише.</p>
              {system.map(t => (
                <div key={t.id} className="rounded-xl border border-[#ECECEC] bg-secondary/20 p-3.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground flex-1">{t.title}</p>
                    <span className="text-[10px] font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5 shrink-0">{fmtLabel(t.format_type)}</span>
                  </div>
                  <p className="text-[13px] text-[#444] leading-relaxed">{t.description}</p>
                  {t.example && <p className="text-[12px] text-muted-foreground">Пример: {t.example}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Viral reels — merged in (was a separate "Виральные рилз" section) */}
      <div className="space-y-2.5 pt-3 border-t border-[#ECECEC]">
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5"><Film className="h-3.5 w-3.5 text-primary" /> Залетевшие рилз — референсы</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Вставь ссылку на чужой залетевший рилз — AI разберёт, почему он зашёл, и вплетёт такой формат в твой план.</p>
        </div>
        <ViralReelsManager scope="project" projectId={id} />
      </div>
    </div>
  )
}
