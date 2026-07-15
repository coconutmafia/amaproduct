'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { authErrorMessage } from '@/lib/friendlyError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sparkles, Globe, Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // The auth callback bounces failed email-confirm / OAuth exchanges to
  // /login?error=… (e.g. a link opened on a different device than it was
  // requested on — PKCE can't complete). Surface it instead of a blank form.
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (!err) return
    setNotice(
      err === 'auth_error'
        ? 'Не удалось подтвердить ссылку. Открой её в том же браузере, где регистрировался, или запроси новую. Если уже подтвердил — просто войди.'
        : 'Что-то пошло не так со ссылкой. Попробуй войти или запроси новую ссылку.',
    )
    // Clean the query so a refresh doesn't keep showing the banner.
    window.history.replaceState({}, '', '/login')
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(authErrorMessage(error))
    } else {
      router.push('/dashboard')
      router.refresh()
    }
    setLoading(false)
  }

  async function handleGoogleLogin() {
    setLoadingGoogle(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) toast.error(authErrorMessage(error))
    setLoadingGoogle(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-4">
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
          <div className="space-y-1">
            <h2 className="text-2xl font-black uppercase text-[#1A1A1A]">Войти</h2>
            <p className="text-sm text-[#888888]">Введите email и пароль для входа</p>
          </div>

          {notice && (
            <div className="rounded-xl border border-[#F5A84A]/40 bg-[#F5A84A]/10 p-3 text-sm text-[#8a5a1a]">
              {notice}{' '}
              <Link href="/forgot-password" className="font-semibold underline">Запросить ссылку</Link>
            </div>
          )}

          <Button
            variant="outline"
            className="w-full border-[#C5CBA5] rounded-xl hover:bg-[#FAFAF8]"
            onClick={handleGoogleLogin}
            disabled={loadingGoogle}
          >
            {loadingGoogle ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Globe className="mr-2 h-4 w-4" />
            )}
            Войти через Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[#C5CBA5]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-[#888888]">или</span>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-[#1A1A1A]">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-[#C5CBA5] rounded-xl bg-white focus-visible:ring-[#F5A84A]/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-[#1A1A1A]">Пароль</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-[#C5CBA5] rounded-xl bg-white pr-10 focus-visible:ring-[#F5A84A]/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-[#888888] hover:text-[#1A1A1A]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full rounded-full bg-gradient-to-r from-[#F5A84A] to-[#D44E7E] text-white font-bold uppercase tracking-wide hover:opacity-90 transition-opacity border-0"
              disabled={loading}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Войти
            </Button>
          </form>

          <div className="flex justify-between text-sm">
            <Link href="/register" className="text-[#3A8A48] hover:underline transition-colors">
              Создать аккаунт
            </Link>
            <Link href="/forgot-password" className="text-[#3A8A48] hover:underline transition-colors">
              Забыли пароль?
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-[#888888]">
          Powered by{' '}
          <span className="gradient-text font-semibold">Ava Marketing Agency</span>
        </p>
      </div>
    </div>
  )
}
