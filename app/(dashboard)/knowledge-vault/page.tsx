import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { KnowledgeUploader } from '@/components/projects/KnowledgeUploader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, CheckCircle2, Loader, AlertCircle, ShieldCheck } from 'lucide-react'

const CONTENT_TYPE_LABELS: Record<string, string> = {
  methodology: 'Методология запуска',
  framework: 'Фреймворк прогрева',
  tov_system: 'Система TOV',
  example: 'Пример запуска',
  template: 'Шаблон контента',
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    ready: { label: 'Готово', className: 'text-green-400 border-green-400/30 bg-green-400/10' },
    processing: { label: 'Обработка', className: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
    error: { label: 'Ошибка', className: 'text-red-400 border-red-400/30 bg-red-400/10' },
    pending: { label: 'Ожидание', className: 'text-muted-foreground border-border' },
  }[status] || { label: status, className: 'text-muted-foreground border-border' }

  return <Badge variant="outline" className={`text-xs ${config.className}`}>{config.label}</Badge>
}

export default async function KnowledgeVaultPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: items } = await supabase
    .from('knowledge_vault')
    .select('*')
    .order('created_at', { ascending: false })

  const grouped = (items || []).reduce<Record<string, typeof items>>((acc, item) => {
    if (!acc[item.content_type]) acc[item.content_type] = []
    acc[item.content_type]!.push(item)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
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
            Методология и знания, которые AI использует как Source of Truth для всех проектов
          </p>
        </div>
        <KnowledgeUploader projectId="system" isSystemVault />
      </div>

      {/* Info card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <BookOpen className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Как работает RAG-система</p>
            <p className="text-xs text-muted-foreground mt-1">
              AI берёт методологию из этой базы как Source of Truth и накладывает на данные конкретного проекта клиента.
              Чем больше качественных материалов здесь — тем точнее генерируется контент.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Items by type */}
      {Object.entries(CONTENT_TYPE_LABELS).map(([type, label]) => {
        const typeItems = grouped[type] || []
        return (
          <Card key={type} className="border-border bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground">{label}</CardTitle>
                <Badge variant="outline" className="text-xs">{typeItems.length} материалов</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {typeItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2 text-center">Нет материалов</p>
              ) : (
                typeItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                      <BookOpen className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={item.processing_status} />
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )
      })}

      {(!items || items.length === 0) && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <BookOpen className="h-16 w-16 text-muted-foreground/30" />
          <h2 className="text-lg font-semibold text-foreground">База знаний пуста</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Загрузите методологию, фреймворки и примеры запусков — AI будет использовать их как основу
          </p>
        </div>
      )}
    </div>
  )
}
