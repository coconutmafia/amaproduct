'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [supabase.auth])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) { toast.error('Пароль должен быть не менее 6 символов'); return }
    if (password !== confirm) { toast.error('Пароли не совпадают'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error(error.message)
    } else {
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 2500)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <Link href="/" className="block text-center space-y-2 hover:opacity-80 transition-opacity">
          <div className="flex items-center justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-accent shadow-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-black uppercase text-[#1A1A1A] tracking-tight">AMAproduct</h1>
          <p className="text-sm text-[#888888]">AI-продюсер для блогеров</p>
        </Link>

        <div className="bg-white border border-[#C5CBA5] rounded-2xl shadow-sm p-8 space-y-5">
          {done ? (
            <div className="text-center space-y-4 py-4">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-black uppercase text-[#1A1A1A]">Пароль обновлён!</h2>
                <p className="text-sm text-[#888888]">Перенаправляем тебя в кабинет...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <h2 className="text-2xl font-black uppercase text-[#1A1A1A]">Новый пароль</h2>
                <p className="text-sm text-[#888888]">Придумай надёжный пароль для входа</p>
              </div>

              {!ready ? (
                <p className="text-sm text-[#888888] text-center py-4">Проверяем ссылку...</p>
              ) : (
                <form onSubmit={handleReset} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-[#1A1A1A]">Новый пароль</Label>
                    <div className="relative">
                      <Input
                        type={showPwd ? 'text' : 'password'}
                        placeholder="Минимум 6 символов"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="border-[#C5CBA5] rounded-xl bg-white h-11 pr-10 focus-visible:ring-[#F5A84A]/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(!showPwd)}
                        className="absolute right-3 top-3 text-[#888888] hover:text-[#1A1A1A] transition-colors"
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-[#1A1A1A]">Повтори пароль</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      className="border-[#C5CBA5] rounded-xl bg-white h-11 focus-visible:ring-[#F5A84A]/30"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full rounded-full bg-gradient-to-r from-[#F5A84A] to-[#D44E7E] text-white font-bold uppercase tracking-wide hover:opacity-90 transition-opacity border-0"
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Сохранить пароль
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
