'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Bookmark, Copy, Check, Trash2, Loader2, Plus, X, Pencil, Palette } from 'lucide-react'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { toast } from 'sonner'
import type { SavedContentRow } from '@/lib/saveContent'
import { isReelsScript } from '@/lib/contentKind'

// Group order + Russian labels for the content-type sections.
const TYPE_ORDER = ['post', 'carousel', 'reels', 'stories', 'email', 'live', 'other'] as const
const TYPE_LABELS: Record<string, string> = {
  post: 'Посты', carousel: 'Карусели', reels: 'Рилзы', stories: 'Сторис',
  email: 'Письма', live: 'Эфиры', other: 'Из чата и прочее',
}

export default function LibraryPage() {
  const supabase = createClient()
  const router = useRouter()
  const [items, setItems] = useState<SavedContentRow[]>([])
  const [projects, setProjects] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [urlProject, setUrlProject] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addBody, setAddBody] = useState('')
  const [addType, setAddType] = useState('post')
  const [addProject, setAddProject] = useState('')
  const [savingAdd, setSavingAdd] = useState(false)
  const [viewItem, setViewItem] = useState<SavedContentRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // When opened from a project ("Готовое" tile → /library?project=ID), scope to
    // that project so the user sees this blog's library, not everything.
    const projectFilter = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('project') : null
    setUrlProject(projectFilter)
    const base = supabase.from('saved_content').select('*')
    const scoped = projectFilter ? base.eq('project_id', projectFilter) : base
    const [{ data: rows, error }, { data: projs }] = await Promise.all([
      scoped.order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name'),
    ])
    if (error) {
      if (/relation .*saved_content.* does not exist|could not find the table/i.test(error.message)) setNeedsSetup(true)
      setItems([])
    } else {
      setItems((rows ?? []) as SavedContentRow[])
    }
    setProjects(Object.fromEntries(((projs ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name])))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const copy = (it: SavedContentRow) => {
    navigator.clipboard?.writeText(it.body).then(() => {
      setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1500)
    }).catch(() => toast.error('Не удалось скопировать'))
  }

  const remove = async (id: string) => {
    setDeletingId(id)
    const { error } = await supabase.from('saved_content').delete().eq('id', id)
    if (error) { toast.error('Не удалось удалить'); setDeletingId(null); return }
    setItems(prev => prev.filter(i => i.id !== id))
    setDeletingId(null)
    toast.success('Удалено')
  }

  const openAdd = () => { setAddProject(prev => prev || urlProject || ''); setAdding(true) }

  const addPost = async () => {
    const body = addBody.trim()
    if (!body || savingAdd) return
    setSavingAdd(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Нужно войти')
      const title = body.split('\n').map(s => s.trim()).find(Boolean)?.slice(0, 80) || null
      const { error } = await supabase.from('saved_content').insert({
        user_id: user.id,
        project_id: addProject || null,
        content_type: addType,
        title,
        body,
      })
      if (error) throw new Error(error.message)
      toast.success(addProject ? 'Добавлено в Готовое — AI этого проекта будет учиться на нём' : 'Добавлено в Готовое')
      setAddBody(''); setAdding(false)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось') }
    finally { setSavingAdd(false) }
  }

  const groups = TYPE_ORDER
    .map(key => ({ key, label: TYPE_LABELS[key], rows: items.filter(i => (i.content_type || 'other') === key) }))
    .filter(g => g.rows.length > 0)

  // «кадр N» also numbers reels scenes, so exclude reels from the stories route.
  const isStories = (it: SavedContentRow) => it.content_type === 'stories' || (it.content_type !== 'reels' && !isReelsScript(it.body) && /(сторис|stories|кадр)\s*\d/i.test(it.body))
  const isCarousel = (it: SavedContentRow) => it.content_type === 'carousel' || /слайд\s*\d/i.test(it.body)

  // «Редактировать» → the create chat opens the text and asks what to change
  const editInChat = (it: SavedContentRow) => {
    try { localStorage.setItem('ama_edit_prefill', JSON.stringify({ text: it.body, projectId: it.project_id })) } catch { /* ignore */ }
    router.push('/create')
  }

  // «Оформить визуально» → stories builder for stories, visual page otherwise
  const designVisual = (it: SavedContentRow) => {
    const pid = it.project_id
    if (!pid) { toast.error('У этого текста нет проекта — оформить можно из текста внутри проекта'); return }
    try {
      if (isStories(it)) {
        localStorage.setItem(`ama_stories_script_${pid}`, it.body)
        router.push(`/projects/${pid}/stories`)
      } else {
        localStorage.setItem(`ama_visual_prefill_${pid}`, JSON.stringify({ type: isCarousel(it) ? 'carousel' : 'post', text: it.body }))
        router.push(`/projects/${pid}/visual`)
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="p-4 md:p-6 pb-28 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-accent">
          <Bookmark className="h-4.5 w-4.5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground leading-tight">Готовый контент</h1>
          <p className="text-sm text-muted-foreground leading-tight">Сохранённое — бери и публикуй</p>
        </div>
      </div>

      <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-sm text-foreground flex items-start gap-2.5">
        <span className="text-base leading-none mt-0.5">🎯</span>
        <p className="leading-snug">
          <b>AI учится на этом контенте.</b> Добавляй сюда свои лучшие посты — и ассистент будет писать твоим голосом.
          Каждый проект учится на своём «Готовом»; данные одного проекта не попадают в другой.
        </p>
      </div>

      {/* Manual add — paste your own post so the AI learns your voice */}
      {!adding ? (
        <button onClick={openAdd} className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10">
          <Plus className="h-4 w-4" /> Добавить свой пост
        </button>
      ) : (
        <div className="rounded-xl border border-[#ECECEC] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Свой пост — AI будет на нём учиться</p>
            <button onClick={() => setAdding(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <VoiceTextarea value={addBody} onChange={setAddBody} placeholder="Вставь или надиктуй свой пост — тот, что звучит как ты" rows={5} />
          <div className="flex flex-wrap items-center gap-2">
            {Object.keys(projects).length > 0 && (
              <select value={addProject} onChange={e => setAddProject(e.target.value)}
                className="rounded-xl border border-[#E0E0E0] px-3 py-2.5 text-sm bg-background focus:outline-none focus:border-primary/50">
                <option value="">Без проекта</option>
                {Object.entries(projects).map(([pid, name]) => <option key={pid} value={pid}>{name}</option>)}
              </select>
            )}
            <select value={addType} onChange={e => setAddType(e.target.value)}
              className="rounded-xl border border-[#E0E0E0] px-3 py-2.5 text-sm bg-background focus:outline-none focus:border-primary/50">
              {TYPE_ORDER.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <button onClick={addPost} disabled={!addBody.trim() || savingAdd}
              className="ml-auto flex items-center gap-1.5 rounded-xl gradient-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {savingAdd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Добавить
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">Привяжи к проекту — и ассистент этого проекта будет писать в этом стиле.</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </div>
      ) : needsSetup ? (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-foreground">
          Библиотека почти готова — осталось применить миграцию БД (таблица <code>saved_content</code>).
          После этого сохранённый контент появится здесь.
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <Bookmark className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Тут пока пусто</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Жми «Сохранить» под понравившимся текстом в чате или контент-плане — он появится здесь, разложенный по типам.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.key} className="space-y-2.5">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                {group.label}
                <span className="text-[11px] font-medium text-muted-foreground bg-secondary rounded-full px-2 py-0.5">{group.rows.length}</span>
              </h2>
              {group.rows.map(it => (
                <div key={it.id} className="rounded-xl border border-[#ECECEC] bg-white p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground line-clamp-2 flex-1">{it.title || 'Без названия'}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => copy(it)} title="Копировать"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-muted-foreground hover:text-primary transition-colors">
                        {copiedId === it.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => remove(it.id)} disabled={deletingId === it.id} title="Удалить"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-muted-foreground hover:text-red-500 hover:border-red-200 transition-colors">
                        {deletingId === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  {/* Tap to open — the owner couldn't read a long saved item at all */}
                  <button type="button" onClick={() => setViewItem(it)} className="block w-full text-left">
                    <p className="text-[13px] text-[#444] whitespace-pre-wrap line-clamp-4 leading-relaxed">{it.body}</p>
                    <span className="mt-1 inline-block text-[11px] font-medium text-primary">Открыть →</span>
                  </button>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {it.project_id && projects[it.project_id] && <span className="truncate">{projects[it.project_id]}</span>}
                    <span className="ml-auto shrink-0">{new Date(it.created_at).toLocaleDateString('ru-RU')}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Viewer — full text + edit/design actions (owner flow) */}
      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setViewItem(null)}>
          <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-background shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{viewItem.title || 'Без названия'}</p>
              <button type="button" onClick={() => setViewItem(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/40">Закрыть</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{viewItem.body}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
              <button type="button" onClick={() => copy(viewItem)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary/40">
                {copiedId === viewItem.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />} Копировать
              </button>
              <button type="button" onClick={() => editInChat(viewItem)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary/40">
                <Pencil className="h-3.5 w-3.5" /> Редактировать
              </button>
              <button type="button" onClick={() => designVisual(viewItem)}
                className="flex items-center gap-1.5 rounded-lg gradient-accent px-3 py-2 text-xs font-semibold text-white hover:opacity-90">
                <Palette className="h-3.5 w-3.5" /> Оформить визуально
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
