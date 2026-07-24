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
import { authErrorMessage } from '@/lib/friendlyError'

// Код из письма — 6–10 цифр (у Supabase живьём 8, поле с запасом — как в register).
const OTP_MIN = 6
const OTP_MAX = 10

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  // Запасной путь: почта + код из письма (verifyOtp type=recovery). Работает из
  // ЛЮБОГО браузера — ссылка же требует, чтобы её открыли там, где запрашивали
  // сброс (PKCE), а почтовые приложения открывают свой встроенный браузер.
  // Ровно тот же приём, что для подтверждения почты при регистрации.
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    // Если человек уже залогинен recovery-сессией (пришёл по рабочей ссылке в
    // том же браузере) — событие могло отгреметь до подписки; проверим сессию.
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true) })
    // The PASSWORD_RECOVERY event never fires if the link is stale, already used,
    // or opened in a different browser than it was requested from (PKCE). Without
    // a fallback the page hangs on "Проверяем ссылку..." forever — show a way out.
    const t = setTimeout(() => setReady((r) => { if (!r) setTimedOut(true); return r }), 6000)
    // почту, с которой запрашивали сброс, «Забыли пароль» кладёт в localStorage —
    // в том же браузере поле заполнится само; в чужом человек введёт руками
    try { const saved = localStorage.getItem('ama_reset_email'); if (saved) setEmail(saved) } catch { /* ignore */ }
    return () => { subscription.unsubscribe(); clearTimeout(t) }
  }, [])

  async function handleCodeVerify(e: React.FormEvent) {
    e.preventDefault()
    if (verifying) return
    if (!email.trim()) { toast.error('Введи почту, на которую пришло письмо'); return }
    if (code.length < OTP_MIN) { toast.error('Введи код из письма') ; return }
    setVerifying(true)
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' })
    if (error) {
      toast.error(authErrorMessage(error))
      setVerifying(false)
      return
    }
    // Код принят → есть recovery-сессия, показываем форму нового пароля
    setReady(true)
    setTimedOut(false)
    setVerifying(false)
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) { toast.error('Пароль должен быть не менее 6 символов'); return }
    if (password !== confirm) { toast.error('Пароли не совпадают'); return }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error(authErrorMessage(error))
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
                timedOut ? (
                  <div className="space-y-4 py-2">
                    <p className="text-sm text-[#888888] text-center">
                      Ссылка не открылась — так бывает, если письмо открыто в другом браузере.
                      Ничего страшного: введи <b>код из письма</b>, и всё получится.
                    </p>
                    <form onSubmit={handleCodeVerify} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-[#1A1A1A]">Почта</Label>
                        <Input
                          type="email"
                          placeholder="на неё пришло письмо"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          className="border-[#C5CBA5] rounded-xl bg-white h-11 focus-visible:ring-[#F5A84A]/30"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-[#1A1A1A]">Код из письма</Label>
                        <Input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="8 цифр из письма"
                          value={code}
                          maxLength={OTP_MAX}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                          required
                          className="border-[#C5CBA5] rounded-xl bg-white h-11 tracking-[0.3em] text-center font-bold focus-visible:ring-[#F5A84A]/30"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={verifying || code.length < OTP_MIN}
                        className="w-full rounded-full bg-gradient-to-r from-[#F5A84A] to-[#D44E7E] text-white font-bold uppercase tracking-wide hover:opacity-90 transition-opacity border-0"
                      >
                        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Подтвердить код'}
                      </Button>
                    </form>
                    <p className="text-center">
                      <Link href="/forgot-password" className="text-xs text-[#888888] underline hover:text-[#1A1A1A]">
                        Письмо не пришло? Запросить новое
                      </Link>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[#888888] text-center py-4">Проверяем ссылку...</p>
                )
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
