'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Globe, Loader2, Gift, Mail, CheckCircle2, Bot, Zap, Target } from 'lucide-react'
import { toast } from 'sonner'
import { REFERRAL_REWARDS } from '@/lib/generations-config'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [fullName, setFullName] = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [sent, setSent]         = useState(false) // email confirmation sent state

  const refCode = searchParams.get('ref')?.toUpperCase() ?? ''

  useEffect(() => {
    if (refCode) {
      toast.info(`Реферальный код ${refCode} — вы получите +${REFERRAL_REWARDS.invitee_signup} запросов к AI`, { duration: 5000 })
    }
  }, [refCode])

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) { toast.error('Введите ваше имя'); return }
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    // Apply referral code after signup
    if (refCode) {
      try {
        await new Promise(r => setTimeout(r, 1500))
        await fetch('/api/referral?action=register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referral_code: refCode }),
        })
      } catch { /* non-fatal */ }
    }

    setSent(true) // show "check email" screen
    setLoading(false)
  }

  async function handleGoogle() {
    const base = window.location.origin
    const cb = refCode
      ? `${base}/auth/callback?ref=${refCode}`
      : `${base}/auth/callback`
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: cb },
    })
    if (error) toast.error(error.message)
  }

  // ── AFTER SUBMIT: "Check your email" screen ──────────────────────
  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl gradient-accent shadow-xl">
              <Mail className="h-10 w-10 text-white" />
            </div>
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-black uppercase text-[#1A1A1A]">Проверь почту!</h1>
            <p className="text-[#888888]">
              Мы отправили письмо на <span className="font-medium text-[#1A1A1A]">{email}</span>
            </p>
            <p className="text-sm text-[#888888]">
              Перейди по ссылке в письме — и твой AI SMM-щик уже ждёт тебя
            </p>
          </div>
          <div className="rounded-xl border border-[#C5CBA5] bg-white p-4 text-sm text-[#888888] text-left space-y-2">
            <p className="font-semibold text-[#1A1A1A]">Не пришло письмо?</p>
            <ul className="space-y-1 text-xs">
              <li>• Проверь папку «Спам» или «Промоакции»</li>
              <li>• Подожди 1–2 минуты</li>
              <li>• Убедись что email написан правильно</li>
            </ul>
          </div>
          <Button variant="outline" className="w-full rounded-full border-[#C5CBA5]" onClick={() => setSent(false)}>
            Ввести другой email
          </Button>
        </div>
      </div>
    )
  }

  // ── REGISTER FORM ────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex bg-[#F5F5F5]">
      {/* Left: form */}
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">

          {/* Logo — кликабельный, ведёт на главную */}
          <Link href="/" className="block text-center space-y-2 hover:opacity-80 transition-opacity">
            <div className="flex items-center justify-center mb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-accent shadow-xl">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-black uppercase text-[#1A1A1A] tracking-tight">AMAproduct</h1>
            <p className="text-[#888888] text-sm">Твой личный AI SMM-щик для запусков</p>
          </Link>

          {/* Referral banner */}
          {refCode && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 p-3">
              <Gift className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-amber-700 dark:text-amber-400">Тебя пригласили! </span>
                <span className="text-amber-600 dark:text-amber-400/80">После регистрации — </span>
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                  +{REFERRAL_REWARDS.invitee_signup} запросов к AI в подарок
                </Badge>
              </div>
            </div>
          )}

          {/* Form card */}
          <div className="bg-white border border-[#C5CBA5] rounded-2xl shadow-sm p-8 space-y-5">
            <div className="space-y-1">
              <h2 className="text-2xl font-black uppercase text-[#1A1A1A]">Регистрация</h2>
              <p className="text-sm text-[#888888]">Создай аккаунт — это бесплатно</p>
            </div>

          {/* Google */}
          <Button variant="outline" className="w-full h-12 text-base border-[#C5CBA5] rounded-xl hover:bg-[#F5F5F5]" onClick={handleGoogle}>
            <Globe className="mr-2 h-5 w-5" />
            Зарегистрироваться через Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-[#C5CBA5]" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-[#888888]">или заполни форму</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm font-medium text-[#1A1A1A]">Как тебя зовут?</Label>
              <Input
                id="name"
                type="text"
                placeholder="Анна Иванова"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
                className="h-12 text-base border-[#C5CBA5] rounded-xl bg-white focus-visible:ring-[#F5A84A]/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-[#1A1A1A]">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="h-12 text-base border-[#C5CBA5] rounded-xl bg-white focus-visible:ring-[#F5A84A]/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-[#1A1A1A]">Пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="Минимум 8 символов"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                className="h-12 text-base border-[#C5CBA5] rounded-xl bg-white focus-visible:ring-[#F5A84A]/30"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-12 text-base rounded-full bg-gradient-to-r from-[#F5A84A] to-[#D44E7E] text-white font-bold uppercase tracking-wide hover:opacity-90 transition-opacity border-0"
              disabled={loading}
            >
              {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Sparkles className="mr-2 h-5 w-5" />}
              Создать аккаунт
            </Button>
          </form>

          <p className="text-center text-sm text-[#888888]">
            Уже есть аккаунт?{' '}
            <Link href="/login" className="text-[#D44E7E] font-medium hover:underline">Войти</Link>
          </p>
          </div>
        </div>
      </div>

      {/* Right: benefits panel (hidden on mobile) */}
      <div className="hidden lg:flex flex-col justify-center w-96 bg-[#F5F5F5] border-l border-[#C5CBA5] p-10 space-y-8">
        <div>
          <h2 className="text-xl font-black uppercase text-[#1A1A1A] mb-2">Что тебя ждёт</h2>
          <p className="text-sm text-[#888888]">
            AI SMM-щик, который знает твою аудиторию, продукт и стиль — и пишет контент за тебя
          </p>
        </div>
        {[
          {
            icon: Bot,
            title: 'Свой AI SMM-щик',
            desc: 'Дай ему имя, загрузи свои материалы — и получай контент, который звучит как ты',
          },
          {
            icon: Zap,
            title: 'Контент-план за минуты',
            desc: 'Посты, карусели, рилсы, сторис — для всего прогрева от осознания до продажи',
          },
          {
            icon: Target,
            title: 'Под каждый запуск',
            desc: 'AI учитывает продукт, ЦА, дату запуска и бюджет — пишет не абстрактно, а конкретно',
          },
          {
            icon: CheckCircle2,
            title: `${REFERRAL_REWARDS.invitee_signup} запросов к AI бесплатно`,
            desc: 'Сразу после регистрации — попробуй без оплаты',
          },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F5A84A]/10">
              <Icon className="h-4 w-4 text-[#D44E7E]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]">{title}</p>
              <p className="text-xs text-[#888888] mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    }>
      <RegisterForm />
    </Suspense>
  )
}
