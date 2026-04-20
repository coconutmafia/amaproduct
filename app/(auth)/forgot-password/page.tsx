'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-accent shadow-lg shadow-primary/25">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground">AMAproduct</h1>
          <p className="text-sm text-muted-foreground">AI-продюсер для блогеров</p>
        </div>

        <Card className="border-border bg-card shadow-xl">
          {!sent ? (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl font-semibold">Восстановление пароля</CardTitle>
                <CardDescription>
                  Введи email — мы отправим ссылку для сброса пароля
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-sm">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-input border-border h-11"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full gradient-accent text-white font-medium hover:opacity-90 transition-opacity"
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Отправить ссылку
                  </Button>
                </form>
              </CardContent>
            </>
          ) : (
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Письмо отправлено!</h2>
                <p className="text-sm text-muted-foreground">
                  Проверь почту <strong>{email}</strong> — там будет ссылка для сброса пароля.
                  Не забудь проверить папку «Спам».
                </p>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/login">Вернуться ко входу</Link>
              </Button>
            </CardContent>
          )}
        </Card>

        <div className="text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Назад ко входу
          </Link>
        </div>
      </div>
    </div>
  )
}
