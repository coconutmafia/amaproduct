'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, TrendingUp, Eye, EyeOff } from 'lucide-react'

interface Trend {
  id: string
  title: string
  description: string
  example: string | null
  format_type: string
  niches: string[] | null
  is_active: boolean
  created_at: string
}

const FORMATS = [
  { value: 'any', label: 'Любой формат' },
  { value: 'post', label: 'Пост' },
  { value: 'reels', label: 'Рилз' },
  { value: 'stories', label: 'Сторис' },
  { value: 'carousel', label: 'Карусель' },
]

export default function AdminTrendsPage() {
  const [trends, setTrends] = useState<Trend[]>([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [form, setForm] = useState({ title: '', description: '', example: '', format_type: 'any', niches: '' })

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/trends')
      if (res.status === 403) { toast.error('Доступ только для администратора'); setLoading(false); return }
      const data = await res.json() as { trends: Trend[]; needsMigration?: boolean }
      setTrends(data.trends || [])
      setNeedsMigration(!!data.needsMigration)
    } catch { toast.error('Ошибка загрузки') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.description.trim()) { toast.error('Заполни название и описание'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/trends', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, description: form.description, example: form.example,
          format_type: form.format_type,
          niches: form.niches.split(',').map(s => s.trim()).filter(Boolean),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setTrends(prev => [data.trend, ...prev])
      setForm({ title: '', description: '', example: '', format_type: 'any', niches: '' })
      toast.success('Тренд добавлен')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка') }
    finally { setCreating(false) }
  }

  const toggle = async (t: Trend) => {
    setBusyId(t.id)
    try {
      const res = await fetch('/api/admin/trends', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, is_active: !t.is_active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTrends(prev => prev.map(x => x.id === t.id ? data.trend : x))
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка') }
    finally { setBusyId(null) }
  }

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/trends?id=${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setTrends(prev => prev.filter(x => x.id !== id))
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка') }
    finally { setBusyId(null) }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Тренды месяца</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Актуальные форматы и идеи контента. AI вплетает активные тренды в контент-планы всех пользователей,
        адаптируя под их нишу и голос. Например: формат «Yes/but», сезонные хуки, залетающие структуры.
      </p>

      {needsMigration && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠️ Таблица трендов ещё не создана в базе. Примени миграцию <b>013_content_trends.sql</b> в Supabase → SQL Editor,
          затем обнови страницу.
        </div>
      )}

      {/* Create form */}
      <Card className="border-border bg-card">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Добавить тренд</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Название *</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Формат «Yes / but»" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Описание — что это и как использовать *</Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Сверху текст «Yes» (то, с чем согласны), снизу «but» (неожиданный поворот). Цепляет на контрасте." rows={3} className="text-sm resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Пример (необязательно)</Label>
              <Textarea value={form.example} onChange={e => setForm({ ...form, example: e.target.value })}
                placeholder="Yes: вырасти аудиторию. But: продаёт система, а не охваты." rows={2} className="text-sm resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Формат</Label>
                <select value={form.format_type} onChange={e => setForm({ ...form, format_type: e.target.value })}
                  className="w-full h-9 rounded-lg border border-input bg-background px-2.5 text-sm">
                  {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ниши (через запятую, пусто = все)</Label>
                <Input value={form.niches} onChange={e => setForm({ ...form, niches: e.target.value })} placeholder="фитнес, психология" className="text-sm" />
              </div>
            </div>
            <Button type="submit" disabled={creating} className="w-full gradient-accent text-white">
              {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Добавляю…</> : <><Plus className="h-4 w-4 mr-2" /> Добавить тренд</>}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : trends.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Трендов пока нет. Добавь первый выше.</p>
      ) : (
        <div className="space-y-2">
          {trends.map(t => (
            <div key={t.id} className={`rounded-xl border p-3.5 space-y-2 ${t.is_active ? 'border-primary/30 bg-primary/5' : 'border-border bg-secondary/20 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t.title}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[10px]">{FORMATS.find(f => f.value === t.format_type)?.label ?? t.format_type}</Badge>
                    {t.niches?.map(n => <Badge key={n} variant="outline" className="text-[10px]">{n}</Badge>)}
                    {!t.niches && <Badge variant="outline" className="text-[10px]">все ниши</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggle(t)} disabled={busyId === t.id}
                    title={t.is_active ? 'Выключить' : 'Включить'}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10">
                    {busyId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => remove(t.id)} disabled={busyId === t.id}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-foreground/80 leading-snug">{t.description}</p>
              {t.example && <p className="text-xs text-muted-foreground italic leading-snug">Пример: {t.example}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
