import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { User, Key, Zap, Gift } from 'lucide-react'
import { SettingsClient } from '@/components/settings/SettingsClient'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  const bonusGenerations  = (profile as Record<string, unknown>)?.bonus_generations as number ?? 0
  const generationsUsed   = (profile as Record<string, unknown>)?.generations_used   as number ?? 0
  const subscriptionTier  = (profile as Record<string, unknown>)?.subscription_tier  as string ?? 'free'
  const aiAssistantName   = (profile as Record<string, unknown>)?.ai_assistant_name  as string | null ?? null

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-1">Управляй своим аккаунтом</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4" /> Профиль
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile?.avatar_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-xl font-bold">
                {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold">{profile?.full_name || 'Без имени'}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <Badge className={`mt-1 text-xs ${
                profile?.role === 'admin'
                  ? 'bg-purple-500/15 text-purple-400 border-purple-500/25'
                  : 'bg-secondary text-muted-foreground border-border'
              }`}>
                {profile?.role === 'admin' ? '👑 Администратор' : profile?.role === 'producer' ? 'Продюсер' : 'Пользователь'}
              </Badge>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Имя</Label>
              <Input defaultValue={profile?.full_name || ''} readOnly className="bg-secondary/30" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input defaultValue={user.email || ''} readOnly className="bg-secondary/30" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Subscription & generations */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4" /> Подписка и запросы
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/20">
            <div>
              <p className="text-sm font-medium capitalize">{subscriptionTier === 'free' ? 'Free план' : `${subscriptionTier} план`}</p>
              <p className="text-xs text-muted-foreground">Использовано в этом месяце: {generationsUsed} запросов к AI</p>
            </div>
            <a href="/pricing" className="text-xs text-primary hover:underline font-medium">Улучшить →</a>
          </div>
          {bonusGenerations > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 text-sm">
              <Gift className="h-4 w-4 text-amber-600" />
              <span className="text-amber-700 dark:text-amber-400">
                Бонусных запросов на счету: <strong>+{bonusGenerations}</strong>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Keys status */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Key className="h-4 w-4" /> Статус API
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {[
              { label: 'Claude AI (создание контента)',    ok: !!process.env.ANTHROPIC_API_KEY },
              { label: 'OpenAI (векторизация материалов)', ok: !!process.env.OPENAI_API_KEY },
              { label: 'Supabase (база данных)',            ok: true },
            ].map(({ label, ok }) => (
              <div key={label} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 text-sm">
                <span>{label}</span>
                <Badge variant="outline" className={`text-xs ${ok ? 'text-green-500 border-green-400/30' : 'text-red-400 border-red-400/30'}`}>
                  {ok ? '✓ Подключён' : '✗ Не настроен'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Client-side interactive parts: promo code + AI name + logout + delete */}
      <SettingsClient
        userId={user.id}
        currentAiName={aiAssistantName}
      />
    </div>
  )
}
