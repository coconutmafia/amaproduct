import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { KnowledgeUploader } from '@/components/projects/KnowledgeUploader'
import { KnowledgeVaultList } from '@/components/knowledge/KnowledgeVaultList'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { BookOpen, ShieldCheck, Info } from 'lucide-react'

export default async function KnowledgeVaultPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: items } = await supabase
    .from('knowledge_vault')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-foreground">База Знаний Системы</h1>
            <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
              <ShieldCheck className="mr-1 h-3 w-3" />
              Только Admin
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            AI использует эти материалы как Source of Truth для всех проектов
          </p>
        </div>
        <KnowledgeUploader projectId="system" isSystemVault />
      </div>

      {/* Info */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Категории:</span>{' '}
            <span className="text-primary">Методология</span> — основной фреймворк запуска ·{' '}
            <span className="text-primary">Фреймворк прогрева</span> — структура этапов ·{' '}
            <span className="text-primary">TOV</span> — стиль текстов ·{' '}
            <span className="text-primary">Пример</span> — реальные кейсы ·{' '}
            <span className="text-primary">Шаблон</span> — готовые структуры.
            Категории — это просто организация, AI использует всё.
          </div>
        </CardContent>
      </Card>

      {/* List with delete + status */}
      <KnowledgeVaultList items={items || []} />
    </div>
  )
}
