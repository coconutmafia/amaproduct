'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Plus, Pencil, Loader2, Archive } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import type { Product } from '@/types'

// Продукты проекта с управлением ПОСЛЕ заведения (жалоба куратора Ланы 03.09:
// «состав продуктов меняется, а внести можно только при создании проекта»).
// Добавление/правка/архив идут через action-роут проектов, который синхронно
// ведёт материал product_description — только через него продукт виден модели.

const TYPES = ['курс', 'наставничество', 'консультация', 'услуга', 'товар', 'подписка', 'другое']

type FormState = {
  name: string; product_type: string; price: string; currency: string
  description: string; sales_page_url: string
}
const EMPTY: FormState = { name: '', product_type: 'курс', price: '', currency: 'RUB', description: '', sales_page_url: '' }

export function ProductsCard({ projectId, products }: { projectId: string; products: Product[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [archivingId, setArchivingId] = useState<string | null>(null)

  const openAdd = () => { setEditing(null); setForm(EMPTY); setOpen(true) }
  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name: p.name,
      product_type: p.product_type ?? 'другое',
      price: p.price != null ? String(p.price) : '',
      currency: p.currency || 'RUB',
      description: p.description ?? '',
      sales_page_url: p.sales_page_url ?? '',
    })
    setOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Введите название продукта'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: editing ? 'update_product' : 'create_product',
          projectId,
          data: {
            ...(editing ? { productId: editing.id } : {}),
            name: form.name.trim(),
            product_type: form.product_type,
            price: form.price ? parseFloat(form.price.replace(',', '.')) : null,
            currency: form.currency,
            description: form.description.trim() || null,
            sales_page_url: form.sales_page_url.trim() || null,
          },
        }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) throw new Error(body.error || 'Не удалось сохранить продукт')
      toast.success(editing ? 'Продукт обновлён' : 'Продукт добавлен')
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(friendlyError(e, 'Не удалось сохранить продукт'))
    } finally {
      setSaving(false)
    }
  }

  const archive = async (p: Product) => {
    if (!confirm(`Убрать «${p.name}» из линейки? AI перестанет упоминать его в контенте.`)) return
    setArchivingId(p.id)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive_product', projectId, data: { productId: p.id } }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) throw new Error(body.error || 'Не удалось убрать продукт')
      toast.success('Продукт убран из линейки')
      router.refresh()
    } catch (e) {
      toast.error(friendlyError(e, 'Не удалось убрать продукт'))
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Package className="h-4 w-4" />
            Продукты{products.length > 0 ? ` (${products.length})` : ''}
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Добавить
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {products.length === 0 && (
          <p className="text-xs text-muted-foreground leading-snug">
            Пока пусто. Добавь продукты — AI будет опираться на них в контенте и прогревах.
          </p>
        )}
        {products.map((p) => (
          <div key={p.id} className="group flex items-center gap-2 text-sm min-w-0">
            <span className="text-foreground truncate min-w-0">{p.name}</span>
            {p.price != null && (
              <span className="text-muted-foreground text-xs shrink-0">
                {p.price.toLocaleString('ru-RU')} {p.currency}
              </span>
            )}
            <span className="ml-auto flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                title="Редактировать"
                onClick={() => openEdit(p)}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Убрать из линейки"
                onClick={() => archive(p)}
                disabled={archivingId === p.id}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-red-600"
              >
                {archivingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
              </button>
            </span>
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактировать продукт' : 'Новый продукт'}</DialogTitle>
            <DialogDescription>
              AI использует это в контенте: называет продукт, цену и ведёт к нему прогревы.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Название *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Наставничество «Система продаж»"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Тип</Label>
                <select
                  value={form.product_type}
                  onChange={e => setForm(f => ({ ...f, product_type: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Цена</Label>
                <div className="flex gap-1.5">
                  <Input
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="15000"
                    inputMode="decimal"
                  />
                  <select
                    value={form.currency}
                    onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                    className="h-9 rounded-md border border-input bg-background px-1.5 text-sm shrink-0"
                  >
                    {['RUB', 'USD', 'EUR'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Что внутри и какой результат</Label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Формат, длительность, что человек получит…"
                className="w-full h-20 rounded-md border border-input bg-background p-2 text-sm resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ссылка на страницу продаж</Label>
              <Input
                value={form.sales_page_url}
                onChange={e => setForm(f => ({ ...f, sales_page_url: e.target.value }))}
                placeholder="https://…"
              />
            </div>
            <Button onClick={submit} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editing ? 'Сохранить' : 'Добавить продукт'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
