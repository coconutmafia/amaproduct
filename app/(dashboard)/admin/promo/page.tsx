'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Plus, Trash2, Copy, Zap, CheckCircle2, XCircle,
  Loader2, RefreshCw, Infinity,
} from 'lucide-react'

interface PromoCode {
  id: string
  code: string
  bonus_generations: number
  description: string | null
  max_uses: number | null
  uses_count: number
  is_active: boolean
  expires_at: string | null
  created_at: string
}

export default function AdminPromoPage() {
  const [codes, setCodes]       = useState<PromoCode[]>([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({
    code:              '',
    bonus_generations: '20',
    description:       '',
    max_uses:          '',
    expires_at:        '',
  })

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/promo')
    if (res.ok) {
      const data = await res.json()
      setCodes(data.codes)
    } else if (res.status === 403) {
      toast.error('Доступ только для администратора')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch('/api/admin/promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code:              form.code.trim() || undefined,
          bonus_generations: Number(form.bonus_generations),
          description:       form.description.trim() || undefined,
          max_uses:          form.max_uses ? Number(form.max_uses) : undefined,
          expires_at:        form.expires_at || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Промо-код ${data.code.code} создан!`)
      setForm({ code: '', bonus_generations: '20', description: '', max_uses: '', expires_at: '' })
      load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка создания')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Деактивировать промо-код "${code}"?`)) return
    setDeletingId(id)
    try {
      await fetch('/api/admin/promo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      toast.success('Деактивирован')
      load()
    } finally {
      setDeletingId(null)
    }
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast.success(`Код ${code} скопирован`)
  }

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-[400px]">
      <Loader2 className="animate-spin h-8 w-8 text-primary" />
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Промо-коды</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Создавай коды с любым количеством генераций для тестов и друзей
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-2" /> Обновить
        </Button>
      </div>

      {/* Форма создания */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Создать новый код
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Код <span className="text-muted-foreground">(оставь пустым — сгенерируется)</span></Label>
                <Input
                  placeholder="MYTEST2025"
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                  className="font-mono"
                  maxLength={20}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Генераций <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  required
                  value={form.bonus_generations}
                  onChange={e => setForm(p => ({ ...p, bonus_generations: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Описание</Label>
                <Input
                  placeholder="Для Пети на тест"
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Макс. использований <span className="text-muted-foreground">(пусто = ∞)</span></Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="1"
                  value={form.max_uses}
                  onChange={e => setForm(p => ({ ...p, max_uses: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Дата истечения <span className="text-muted-foreground">(пусто = бессрочно)</span></Label>
                <Input
                  type="date"
                  value={form.expires_at}
                  onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))}
                />
              </div>
            </div>
            <Button type="submit" disabled={creating} className="w-full sm:w-auto">
              {creating
                ? <Loader2 className="animate-spin h-4 w-4 mr-2" />
                : <Plus className="h-4 w-4 mr-2" />
              }
              Создать промо-код
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Список кодов */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Все промо-коды ({codes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Промо-кодов пока нет</p>
          ) : (
            <div className="space-y-2">
              {codes.map(c => (
                <div key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border ${c.is_active ? 'border-border' : 'border-border/50 opacity-50'}`}>
                  {/* Code */}
                  <button
                    onClick={() => copyCode(c.code)}
                    className="flex items-center gap-1.5 font-mono font-bold text-sm text-primary hover:opacity-70 transition-opacity"
                  >
                    {c.code}
                    <Copy className="h-3 w-3" />
                  </button>

                  {/* Generations */}
                  <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-400/10">
                    <Zap className="h-3 w-3" />
                    +{c.bonus_generations} ген.
                  </Badge>

                  {/* Uses */}
                  <span className="text-xs text-muted-foreground">
                    {c.uses_count} / {c.max_uses ?? <Infinity className="inline h-3 w-3" />} использований
                  </span>

                  {/* Description */}
                  {c.description && (
                    <span className="text-xs text-muted-foreground truncate flex-1">{c.description}</span>
                  )}

                  {/* Status */}
                  {c.is_active ? (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-300 ml-auto shrink-0">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Активен
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground ml-auto shrink-0">
                      <XCircle className="h-3 w-3 mr-1" /> Деактивирован
                    </Badge>
                  )}

                  {/* Delete */}
                  {c.is_active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleDelete(c.id, c.code)}
                      disabled={deletingId === c.id}
                    >
                      {deletingId === c.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />
                      }
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
