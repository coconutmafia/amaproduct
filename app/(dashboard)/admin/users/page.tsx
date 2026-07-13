'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Search, Loader2, RefreshCw, Zap, Crown, Shield,
  RotateCcw, Plus, Minus, ChevronDown, ChevronUp, BookMarked, Download, Wallet,
} from 'lucide-react'

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: string | null
  subscription_tier: string
  subscription_status: string
  trial_ends_at: string | null
  current_period_end: string | null
  payment_provider: string | null
  generations_used: number
  bonus_generations: number
  generations_reset_at: string | null
  created_at: string
  last_sign_in_at: string | null
}

// Aligned with migration 016 (generation_limit) — the real, approved tiers.
const PLAN_LIMITS: Record<string, number> = {
  trial: 300, solo: 300, pro: 2000, producer: 8000,
}

const PLAN_LABELS: Record<string, string> = {
  trial: 'Пробный', solo: 'Соло', pro: 'Про', producer: 'Продюсер',
}

const PLAN_COLORS: Record<string, string> = {
  trial: 'bg-secondary text-muted-foreground border-border',
  solo: 'bg-blue-500/10 text-blue-400 border-blue-400/20',
  pro: 'bg-purple-500/10 text-purple-400 border-purple-400/20',
  producer: 'bg-amber-500/10 text-amber-400 border-amber-400/20',
}

// subscription_status (migration 016) → RU label + badge colour.
const STATUS_LABELS: Record<string, string> = {
  trialing: 'Пробный период', active: 'Активна', past_due: 'Просрочена',
  view_only: 'Только просмотр', paused: 'Приостановлена', canceled: 'Отменена',
}
const STATUS_COLORS: Record<string, string> = {
  trialing: 'bg-blue-500/10 text-blue-400 border-blue-400/20',
  active: 'bg-green-500/10 text-green-500 border-green-400/20',
  past_due: 'bg-red-500/10 text-red-400 border-red-400/20',
  view_only: 'bg-secondary text-muted-foreground border-border',
  paused: 'bg-amber-500/10 text-amber-500 border-amber-400/20',
  canceled: 'bg-secondary text-muted-foreground border-border',
}

const fmtDate = (d: string | null): string =>
  d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

export default function AdminUsersPage() {
  const [users, setUsers]           = useState<UserProfile[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving]         = useState<string | null>(null)
  const [total, setTotal]           = useState(0)
  const [exporting, setExporting]   = useState(false)

  // Per-user edit state
  const [bonusAdd, setBonusAdd]     = useState<Record<string, string>>({})
  const [tierEdit, setTierEdit]     = useState<Record<string, string>>({})

  const load = useCallback(async (q = '') => {
    setLoading(true)
    const url = q ? `/api/admin/users?search=${encodeURIComponent(q)}` : '/api/admin/users'
    const res = await fetch(url)
    const data = await res.json()
    if (res.ok) {
      setUsers(data.users)
      setTotal(data.total ?? data.users.length)
    } else if (res.status === 403) {
      toast.error('Доступ только для администратора')
    } else {
      toast.error(`Ошибка: ${data.error || res.status}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    load(search)
  }

  // Export ALL users (not just the 100 shown) to a real .xlsx.
  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/admin/users?all=1')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      const rows = (data.users as UserProfile[]) || []
      const header = [
        'Email', 'Имя', 'Роль', 'Тариф', 'Статус подписки', 'Пробный до',
        'Оплачено до', 'Провайдер', 'Использовано', 'Лимит', 'Бонус',
        'Дата регистрации', 'Последний вход',
      ]
      const aoa: (string | number)[][] = [header]
      for (const u of rows) {
        const limit = u.role === 'admin' ? '∞' : (PLAN_LIMITS[u.subscription_tier] ?? 300)
        aoa.push([
          u.email,
          u.full_name ?? '',
          u.role === 'admin' ? 'Администратор' : 'Клиент',
          PLAN_LABELS[u.subscription_tier] || u.subscription_tier,
          STATUS_LABELS[u.subscription_status] || u.subscription_status,
          fmtDate(u.trial_ends_at),
          fmtDate(u.current_period_end),
          u.payment_provider ?? '',
          u.generations_used || 0,
          limit,
          u.bonus_generations || 0,
          fmtDate(u.created_at),
          fmtDate(u.last_sign_in_at),
        ])
      }
      const { downloadXlsx } = await import('@/lib/utils/xlsxTable')
      await downloadXlsx('Пользователи AMA', 'Пользователи', aoa)
      toast.success(`Выгружено ${rows.length} пользователей`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка выгрузки')
    } finally {
      setExporting(false)
    }
  }

  // Add bonus generations
  const handleAddBonus = async (user: UserProfile) => {
    const add = Number(bonusAdd[user.id] || 0)
    if (!add || add <= 0) { toast.error('Введи количество запросов'); return }
    setSaving(user.id + '_bonus')
    try {
      const newBonus = (user.bonus_generations || 0) + add
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, bonus_generations: newBonus }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`+${add} запросов добавлено пользователю`)
      setBonusAdd(p => ({ ...p, [user.id]: '' }))
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, bonus_generations: newBonus } : u))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(null)
    }
  }

  // Change subscription tier
  const handleChangeTier = async (user: UserProfile) => {
    const tier = tierEdit[user.id]
    if (!tier) return
    setSaving(user.id + '_tier')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, subscription_tier: tier }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Тариф изменён на ${PLAN_LABELS[tier] || tier}`)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, subscription_tier: tier } : u))
      setTierEdit(p => { const n = { ...p }; delete n[user.id]; return n })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(null)
    }
  }

  // Reset monthly usage
  const handleResetUsage = async (user: UserProfile) => {
    if (!confirm(`Сбросить счётчик использований для ${user.email}?`)) return
    setSaving(user.id + '_reset')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Счётчик сброшен — снова 0 использований')
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, generations_used: 0 } : u))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(null)
    }
  }

  // Toggle admin role
  const handleToggleAdmin = async (user: UserProfile) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    if (!confirm(newRole === 'admin'
      ? `Сделать ${user.email} администратором? Это даёт БЕЗЛИМИТНЫЙ доступ.`
      : `Убрать права администратора у ${user.email}?`
    )) return
    setSaving(user.id + '_role')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(newRole === 'admin' ? '✅ Пользователь стал администратором' : 'Права администратора убраны')
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Пользователи</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Управление лимитами и тарифами
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/payments">
            <Button variant="outline" size="sm"><Wallet className="h-4 w-4 mr-2" /> Оплаты</Button>
          </Link>
          <Link href="/admin/style-examples">
            <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
              <BookMarked className="h-4 w-4 mr-2" /> Примеры стиля
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}
            className="border-green-500/30 text-green-600 hover:bg-green-500/10">
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            В Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => load(search)}>
            <RefreshCw className="h-4 w-4 mr-2" /> Обновить
          </Button>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Поиск по email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">Найти</Button>
      </form>

      {/* Users list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : users.length === 0 ? (
        <p className="text-center text-muted-foreground py-16">Пользователи не найдены</p>
      ) : (
        <div className="space-y-2">
          {users.map(user => {
            const limit = user.role === 'admin' ? 999999 : (PLAN_LIMITS[user.subscription_tier] ?? 5)
            const used = user.generations_used || 0
            const bonus = user.bonus_generations || 0
            const remaining = user.role === 'admin' ? '∞' : Math.max(0, limit - used) + bonus
            const isExpanded = expandedId === user.id
            const isSaving = saving?.startsWith(user.id)

            return (
              <Card key={user.id} className="overflow-hidden">
                {/* Header row — always visible */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : user.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {user.full_name && <span className="font-semibold text-sm truncate">{user.full_name}</span>}
                      <span className={`text-sm truncate ${user.full_name ? 'text-muted-foreground' : 'font-medium'}`}>{user.email}</span>
                      {user.role === 'admin' && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-500 border border-amber-400/30">
                          <Crown className="h-2.5 w-2.5 mr-1" />Admin
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${PLAN_COLORS[user.subscription_tier] || PLAN_COLORS.trial}`}>
                        {PLAN_LABELS[user.subscription_tier] || user.subscription_tier}
                      </Badge>
                      <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${STATUS_COLORS[user.subscription_status] || STATUS_COLORS.trialing}`}>
                        {STATUS_LABELS[user.subscription_status] || user.subscription_status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">рег. {fmtDate(user.created_at)}</span>
                      <span className="text-xs text-muted-foreground">
                        Использовано: <span className="text-foreground font-medium">{used}</span>
                        {user.role !== 'admin' && <span className="text-muted-foreground">/{limit}</span>}
                      </span>
                      {bonus > 0 && (
                        <span className="text-xs text-amber-500 flex items-center gap-1">
                          <Zap className="h-3 w-3" />+{bonus} бонус
                        </span>
                      )}
                      <span className="text-xs text-green-500">
                        Осталось: <span className="font-medium">{remaining}</span>
                      </span>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {/* Expanded actions */}
                {isExpanded && (
                  <CardContent className="pt-0 pb-4 px-4 border-t border-border space-y-4">

                    {/* Subscription / account details */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-3 text-xs">
                      <div className="text-muted-foreground">Статус: <span className="text-foreground font-medium">{STATUS_LABELS[user.subscription_status] || user.subscription_status}</span></div>
                      <div className="text-muted-foreground">Регистрация: <span className="text-foreground font-medium">{fmtDate(user.created_at)}</span></div>
                      <div className="text-muted-foreground">Пробный до: <span className="text-foreground font-medium">{fmtDate(user.trial_ends_at)}</span></div>
                      <div className="text-muted-foreground">Оплачено до: <span className="text-foreground font-medium">{fmtDate(user.current_period_end)}</span></div>
                      <div className="text-muted-foreground">Провайдер: <span className="text-foreground font-medium">{user.payment_provider || '—'}</span></div>
                      <div className="text-muted-foreground">Последний вход: <span className="text-foreground font-medium">{fmtDate(user.last_sign_in_at)}</span></div>
                    </div>

                    {/* Add bonus generations */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
                        Добавить бонусные запросы
                      </p>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Zap className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-500 pointer-events-none" />
                          <Input
                            type="number"
                            min={1}
                            max={9999}
                            placeholder="Количество (напр. 50)"
                            value={bonusAdd[user.id] || ''}
                            onChange={e => setBonusAdd(p => ({ ...p, [user.id]: e.target.value }))}
                            className="pl-8 h-9 text-sm"
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleAddBonus(user)}
                          disabled={isSaving}
                          className="shrink-0"
                        >
                          {saving === user.id + '_bonus'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <><Plus className="h-3.5 w-3.5 mr-1" />Добавить</>
                          }
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Текущий бонус: <span className="text-amber-500 font-medium">{bonus}</span> запросов
                      </p>
                    </div>

                    {/* Change tier */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Изменить тариф
                      </p>
                      <div className="flex gap-2">
                        <select
                          value={tierEdit[user.id] ?? user.subscription_tier}
                          onChange={e => setTierEdit(p => ({ ...p, [user.id]: e.target.value }))}
                          className="flex-1 h-9 text-sm rounded-md border border-input bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="trial">Пробный — 300 единиц/мес</option>
                          <option value="solo">Соло — 300 единиц/мес</option>
                          <option value="pro">Про — безлимит (fair use)</option>
                          <option value="producer">Продюсер — безлимит (fair use)</option>
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleChangeTier(user)}
                          disabled={isSaving || !tierEdit[user.id] || tierEdit[user.id] === user.subscription_tier}
                          className="shrink-0"
                        >
                          {saving === user.id + '_tier'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : 'Сохранить'
                          }
                        </Button>
                      </div>
                    </div>

                    {/* Quick actions */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResetUsage(user)}
                        disabled={isSaving}
                        className="text-xs h-8"
                      >
                        {saving === user.id + '_reset'
                          ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                          : <RotateCcw className="h-3 w-3 mr-1.5" />
                        }
                        Сбросить счётчик
                      </Button>
                      <Button
                        size="sm"
                        variant={user.role === 'admin' ? 'destructive' : 'outline'}
                        onClick={() => handleToggleAdmin(user)}
                        disabled={isSaving}
                        className="text-xs h-8"
                      >
                        {saving === user.id + '_role'
                          ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                          : user.role === 'admin'
                            ? <><Minus className="h-3 w-3 mr-1.5" />Убрать права Admin</>
                            : <><Shield className="h-3 w-3 mr-1.5" />Сделать Admin (∞)</>
                        }
                      </Button>
                    </div>

                    {user.role === 'admin' && (
                      <p className="text-xs text-amber-500 flex items-center gap-1.5">
                        <Crown className="h-3 w-3" />
                        Администратор — безлимитный доступ ко всем функциям
                      </p>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pb-4">
        Показано {users.length}{total > users.length ? ` из ${total}` : ''} пользователей
        {total > users.length && ' · выгрузи в Excel, чтобы увидеть всех'}
      </p>
    </div>
  )
}
