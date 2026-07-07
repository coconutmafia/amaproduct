'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Trash2, UserRound, Mail } from 'lucide-react'

interface Member {
  id: string
  user_id: string | null
  invited_email: string | null
  role: 'editor' | 'viewer'
  status: 'pending' | 'active'
}

interface Props {
  projectId: string
  ownerEmail: string
  seatLimit: number
  initialMembers: Member[]
}

const ROLE_LABEL: Record<Member['role'], string> = { editor: 'Редактор', viewer: 'Просмотр' }

export function TeamMembers({ projectId, ownerEmail, seatLimit, initialMembers }: Props) {
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [inviting, setInviting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const usedSeats = members.length
  const atLimit = usedSeats >= seatLimit

  const invite = async () => {
    const v = email.trim()
    if (!v) { toast.error('Укажи email'); return }
    setInviting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: v, role }),
      })
      const data = await res.json().catch(() => ({})) as { member?: Member; error?: string }
      if (!res.ok || !data.member) throw new Error(data.error ?? 'Ошибка')
      setMembers(prev => [...prev, data.member as Member])
      setEmail('')
      toast.success(data.member.status === 'active' ? 'Добавлен(а) в проект' : 'Приглашение отправлено — активируется, когда человек зайдёт в аккаунт с этим email')
    } catch (e) {
      toast.error(friendlyError(e, 'Ошибка'))
    } finally {
      setInviting(false)
    }
  }

  const changeRole = async (memberId: string, newRole: 'editor' | 'viewer') => {
    setBusyId(memberId)
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? 'Ошибка') }
      setMembers(prev => prev.map(m => (m.id === memberId ? { ...m, role: newRole } : m)))
    } catch (e) {
      toast.error(friendlyError(e, 'Ошибка'))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (memberId: string) => {
    setBusyId(memberId)
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? 'Ошибка') }
      setMembers(prev => prev.filter(m => m.id !== memberId))
    } catch (e) {
      toast.error(friendlyError(e, 'Ошибка'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <UserRound className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium">{ownerEmail}</span>
          <span className="text-xs text-muted-foreground ml-auto">Владелец</span>
        </div>
        <p className="text-xs text-muted-foreground">Мест в команде: {usedSeats}/{seatLimit}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
        <div className="flex gap-2">
          <Input
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={inviting || atLimit}
            placeholder="email@example.com"
            className="text-sm"
          />
          <Select value={role} onValueChange={(v) => v && setRole(v as 'editor' | 'viewer')}>
            <SelectTrigger className="w-36 bg-input border-border shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Редактор</SelectItem>
              <SelectItem value="viewer">Просмотр</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={invite} disabled={inviting || atLimit || !email.trim()} className="w-full gradient-accent text-white">
          {inviting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Приглашаю…</> : <><Plus className="h-4 w-4 mr-2" /> Пригласить</>}
        </Button>
        {atLimit && <p className="text-[11px] text-amber-500">Лимит мест исчерпан — удали кого-то или перейди на тариф выше.</p>}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Пока нет приглашённых — добавь редактора или просмотрщика выше.</p>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.id} className="rounded-xl border border-border bg-card p-3.5 flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground truncate">{m.invited_email ?? '—'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {m.status === 'pending' ? 'Ожидает регистрации' : 'Активен'}
                </p>
              </div>
              <Select value={m.role} onValueChange={(v) => v && changeRole(m.id, v as 'editor' | 'viewer')}>
                <SelectTrigger className="w-32 bg-input border-border shrink-0" disabled={busyId === m.id}>
                  <SelectValue>{ROLE_LABEL[m.role]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Редактор</SelectItem>
                  <SelectItem value="viewer">Просмотр</SelectItem>
                </SelectContent>
              </Select>
              <button onClick={() => remove(m.id)} disabled={busyId === m.id}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0">
                {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
