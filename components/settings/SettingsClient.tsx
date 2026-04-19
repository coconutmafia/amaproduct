'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Bot, Gift, LogOut, Trash2, Loader2, CheckCircle2, Sparkles } from 'lucide-react'

interface Props {
  userId: string
  currentAiName: string | null
}

export function SettingsClient({ userId, currentAiName }: Props) {
  const router  = useRouter()
  const supabase = createClient()

  // AI name
  const [aiName, setAiName]         = useState(currentAiName || '')
  const [savingAi, setSavingAi]     = useState(false)

  // Promo code
  const [promoCode, setPromoCode]   = useState('')
  const [applyingPromo, setApplyingPromo] = useState(false)

  // Delete
  const [deleting, setDeleting]     = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // ── Save AI name ─────────────────────────────────
  const saveAiName = async () => {
    setSavingAi(true)
    const { error } = await supabase
      .from('profiles')
      .update({ ai_assistant_name: aiName.trim() || null })
      .eq('id', userId)
    if (error) {
      toast.error('Не удалось сохранить имя')
    } else {
      toast.success(aiName.trim() ? `Имя «${aiName.trim()}» сохранено!` : 'Имя сброшено')
      router.refresh()
    }
    setSavingAi(false)
  }

  // ── Apply promo code ─────────────────────────────
  const applyPromo = async () => {
    if (!promoCode.trim()) return
    setApplyingPromo(true)
    try {
      const res = await fetch('/api/referral?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: promoCode.trim().toUpperCase() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      toast.success(`Код применён! +${data.bonus_received} генераций начислено 🎉`)
      setPromoCode('')
      router.refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось применить код')
    } finally {
      setApplyingPromo(false)
    }
  }

  // ── Logout ───────────────────────────────────────
  const handleLogout = () => {
    router.push('/auth/logout')
  }

  // ── Delete account ───────────────────────────────
  const handleDelete = async () => {
    if (confirmText !== 'УДАЛИТЬ') {
      toast.error('Введи слово УДАЛИТЬ для подтверждения')
      return
    }
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await supabase.auth.signOut()
      toast.success('Аккаунт удалён')
      router.push('/login')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка удаления')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* AI assistant name */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" /> Имя твоего AI SMM-щика
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Дай своему AI имя — это делает работу теплее. Оно будет отображаться в интерфейсе.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Алёша, Вика, Макс..."
              value={aiName}
              onChange={e => setAiName(e.target.value)}
              maxLength={30}
              className="flex-1"
            />
            <Button onClick={saveAiName} disabled={savingAi} size="sm">
              {savingAi
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CheckCircle2 className="h-4 w-4" />
              }
              <span className="ml-1.5">Сохранить</span>
            </Button>
          </div>
          {aiName && (
            <p className="text-xs text-primary flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Твой AI SMM-щик будет зваться «{aiName}»
            </p>
          )}
        </CardContent>
      </Card>

      {/* Promo code */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Gift className="h-4 w-4 text-amber-500" /> Промо-код или реферальный код
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Получил промо-код от AMAproduct или реферальную ссылку от друга? Введи код — получишь бонусные генерации.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Например: PROMO2025 или ABCD1234"
              value={promoCode}
              onChange={e => setPromoCode(e.target.value.toUpperCase())}
              className="flex-1 font-mono"
              maxLength={20}
            />
            <Button
              onClick={applyPromo}
              disabled={applyingPromo || !promoCode.trim()}
              size="sm"
              variant="outline"
            >
              {applyingPromo
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : 'Применить'
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logout */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Выход из аккаунта</p>
              <p className="text-xs text-muted-foreground mt-0.5">Завершить текущую сессию</p>
            </div>
            <Button variant="outline" onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              Выйти
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-destructive">Опасная зона</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showDeleteConfirm ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Удалить аккаунт</p>
                <p className="text-xs text-muted-foreground">Все данные будут удалены безвозвратно</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Удалить аккаунт
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">Ты уверен? Это действие необратимо.</p>
              <p className="text-xs text-muted-foreground">
                Будут удалены: все проекты, материалы, сгенерированный контент, бонусные генерации.
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">Напиши <strong>УДАЛИТЬ</strong> для подтверждения</Label>
                <Input
                  placeholder="УДАЛИТЬ"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  className="border-destructive/50 bg-background"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setShowDeleteConfirm(false); setConfirmText('') }}
                  className="flex-1"
                >
                  Отмена
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting || confirmText !== 'УДАЛИТЬ'}
                  className="flex-1"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                  Удалить навсегда
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
