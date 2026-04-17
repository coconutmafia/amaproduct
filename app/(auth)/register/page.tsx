'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Globe, Loader2, Gift } from 'lucide-react'
import { toast } from 'sonner'
import { REFERRAL_REWARDS } from '@/lib/generations-config'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // Capture referral code from URL ?ref=CODE
  const refCode = searchParams.get('ref')?.toUpperCase() ?? ''

  useEffect(() => {
    if (refCode) {
      toast.info(`Реферальный код ${refCode} применён — вы получите +${REFERRAL_REWARDS.invitee_signup} генераций после регистрации`, {
        duration: 5000,
      })
    }
  }, [refCode])

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    // Apply referral code if present
    if (refCode) {
      try {
        // Small delay to let the profile trigger create the profile row
        await new Promise(r => setTimeout(r, 1500))
        const res = await fetch('/api/referral?action=register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referral_code: refCode }),
        })
        const data = await res.json()
        if (res.ok) {
          toast.success(`+${data.bonus_received} бонусных генераций начислено!`)
        }
      } catch {
        // Non-fatal — registration still succeeded
      }
    }

    toast.success('Аккаунт создан! Выполняется вход...')
    router.push('/dashboard')
    setLoading(false)
  }

  async function handleGoogleLogin() {
    const callbackUrl = refCode
      ? `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?ref=${refCode}`
      : `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl },
    })
    if (error) toast.error(error.message)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-accent shadow-lg shadow-primary/25">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground">AMAproduct</h1>
          <p className="text-sm text-muted-foreground">Создай аккаунт продюсера</p>
        </div>

        {/* Referral banner */}
        {refCode && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 p-3">
            <Gift className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-amber-700 dark:text-amber-400">Приглашение принято!</span>
              <span className="text-amber-600 dark:text-amber-400/80"> После регистрации вам начислится </span>
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                +{REFERRAL_REWARDS.invitee_signup} генераций
              </Badge>
            </div>
          </div>
        )}

        <Card className="border-border bg-card shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl font-semibold">Регистрация</CardTitle>
            <CardDescription>Заполните данные для создания аккаунта</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full border-border hover:bg-secondary"
              onClick={handleGoogleLogin}
            >
              <Globe className="mr-2 h-4 w-4" />
              Зарегистрироваться через Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">или</span>
              </div>
            </div>

            <form onSubmit={handleRegister} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm">Имя</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Ваше имя"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="bg-input border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-input border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Минимум 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="bg-input border-border"
                />
              </div>
              <Button
                type="submit"
                className="w-full gradient-accent text-white font-medium hover:opacity-90 transition-opacity"
                disabled={loading}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Создать аккаунт
              </Button>
            </form>
          </CardContent>
          <CardFooter className="pt-0">
            <p className="text-sm text-muted-foreground">
              Уже есть аккаунт?{' '}
              <Link href="/login" className="text-primary hover:underline">
                Войти
              </Link>
            </p>
          </CardFooter>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Powered by{' '}
          <span className="gradient-text font-semibold">Ava Marketing Agency</span>
        </p>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
      <RegisterForm />
    </Suspense>
  )
}
