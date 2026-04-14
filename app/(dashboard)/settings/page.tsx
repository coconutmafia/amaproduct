import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { User, Shield, Bell, Key, Moon } from 'lucide-react'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-1">Управляйте своим аккаунтом</p>
      </div>

      {/* Profile */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4" />
            Профиль
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
              <p className="font-semibold text-foreground">{profile?.full_name || 'Без имени'}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <Badge className={`mt-1 text-xs ${
                profile?.role === 'admin'
                  ? 'bg-purple-500/15 text-purple-400 border-purple-500/25'
                  : 'bg-secondary text-muted-foreground border-border'
              }`}>
                {profile?.role === 'admin' ? 'Администратор' : profile?.role === 'producer' ? 'Продюсер' : 'Клиент'}
              </Badge>
            </div>
          </div>

          <Separator className="bg-border" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Имя</Label>
              <Input
                defaultValue={profile?.full_name || ''}
                className="bg-input border-border"
                readOnly
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input
                defaultValue={user.email || ''}
                className="bg-input border-border"
                readOnly
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Безопасность
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Пароль</p>
              <p className="text-xs text-muted-foreground">Последнее изменение: неизвестно</p>
            </div>
            <Button variant="outline" size="sm" className="border-border text-xs">
              Изменить
            </Button>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Двухфакторная аутентификация</p>
              <p className="text-xs text-muted-foreground">Не настроена</p>
            </div>
            <Button variant="outline" size="sm" className="border-border text-xs">
              Настроить
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Key className="h-4 w-4" />
            API ключи
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Ключи API настраиваются администратором в файле .env.local на сервере
          </p>
          <div className="grid gap-2">
            {[
              { label: 'Anthropic Claude API', status: process.env.ANTHROPIC_API_KEY ? 'Настроен' : 'Не настроен' },
              { label: 'OpenAI (Whisper + Embeddings)', status: process.env.OPENAI_API_KEY ? 'Настроен' : 'Не настроен' },
              { label: 'Supabase', status: 'Настроен' },
            ].map(({ label, status }) => (
              <div key={label} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 text-sm">
                <span className="text-foreground">{label}</span>
                <Badge variant="outline" className={`text-xs ${
                  status === 'Настроен'
                    ? 'text-green-400 border-green-400/30'
                    : 'text-red-400 border-red-400/30'
                }`}>
                  {status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30 bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-destructive">Опасная зона</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Удалить аккаунт</p>
              <p className="text-xs text-muted-foreground">Это действие необратимо</p>
            </div>
            <Button variant="destructive" size="sm" className="text-xs">
              Удалить
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
