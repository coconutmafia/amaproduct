'use client'

import { use, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, TrendingUp, Plus, Trash2, Loader2, Sparkles } from 'lucide-react'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
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
        throw new Error(error.message)
      }
      setTitle(''); setDescription(''); setExample(''); setFormatType('any')
      toast.success('Тренд добавлен — AI вплетёт его в план')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось') }
    finally { setSaving(false) }
  }

  const remove = async (tid: string) => {
    setDeletingId(tid)
    const { error } = await supabase.from('content_trends').delete().eq('id', tid)
    if (error) { toast.error('Не удалось удалить'); setDeletingId(null); return }
    setMine(prev => prev.filter(t => t.id !== tid))
    setDeletingId(null)
    toast.success('Удалено')
  }

  const fmtLabel = (v: string) => FORMATS.find(f => f.v === v)?.label ?? v

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${id}`} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary shrink-0"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Тренды месяца</h1>
          <p className="text-xs text-muted-foreground">Актуальные форматы и темы → AI вплетёт их в твой контент-план</p>
        </div>
      </div>

      {needsSetup && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-foreground">
          Раздел почти готов — осталось применить миграцию БД (поля <code>scope</code>/<code>project_id</code> у трендов).
        </div>
      )}

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
          <div className="space-y-2.5">
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
    </div>
  )
}
