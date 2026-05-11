'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    if (error) {
      toast.error(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
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
          {!sent ? (
            <>
              <div className="space-y-1">
                <h2 className="text-2xl font-black uppercase text-[#1A1A1A]">Восстановление</h2>
                <p className="text-sm text-[#888888]">
                  Введи email — мы отправим ссылку для сброса пароля
                </p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-[#1A1A1A]">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                  Отправить ссылку
                </Button>
              </form>
            </>
          ) : (
            <div className="text-center space-y-4 py-4">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-black uppercase text-[#1A1A1A]">Письмо отправлено!</h2>
                <p className="text-sm text-[#888888]">
                  Проверь почту <strong className="text-[#1A1A1A]">{email}</strong> — там будет ссылка для сброса пароля.
                  Не забудь проверить папку «Спам».
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full rounded-full border-[#C5CBA5]"
                asChild
              >
                <Link href="/login">Вернуться ко входу</Link>
              </Button>
            </div>
          )}
        </div>

        <div className="text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-[#888888] hover:text-[#3A8A48] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Назад ко входу
          </Link>
        </div>
      </div>
    </div>
  )
}
