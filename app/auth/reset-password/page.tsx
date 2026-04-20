'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

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
    // Supabase sets the session from the URL hash after the link click
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-accent shadow-lg shadow-primary/25">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">AMAproduct</h1>
          <p className="text-sm text-muted-foreground">AI-продюсер для блогеров</p>
        </div>

        <Card className="border-border bg-card shadow-xl">
          {done ? (
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Пароль обновлён!</h2>
                <p className="text-sm text-muted-foreground">Перенаправляем тебя в кабинет...</p>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-semibold">Новый пароль</CardTitle>
                <CardDescription>Придумай надёжный пароль для входа</CardDescription>
              </CardHeader>
              <CardContent>
                {!ready && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Проверяем ссылку...
                  </p>
                )}
                {ready && (
                  <form onSubmit={handleReset} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm">Новый пароль</Label>
                      <div className="relative">
                        <Input
                          type={showPwd ? 'text' : 'password'}
                          placeholder="Минимум 6 символов"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="bg-input border-border h-11 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPwd(!showPwd)}
                          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                        >
                          {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Повтори пароль</Label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        className="bg-input border-border h-11"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full gradient-accent text-white font-medium hover:opacity-90"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Сохранить пароль
                    </Button>
                  </form>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
