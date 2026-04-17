'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { BookOpen, Trash2, Loader2, CheckCircle2, AlertCircle, Clock, RefreshCw } from 'lucide-react'

const CONTENT_TYPE_LABELS: Record<string, string> = {
  methodology:  'Методология запуска',
  framework:    'Фреймворк прогрева',
  tov_system:   'Система TOV',
  example:      'Пример запуска',
  template:     'Шаблон контента',
  additional:   'Дополнительные материалы',
}

interface Item {
  id: string
  title: string
  description: string | null
  content_type: string
  processing_status: string
  created_at: string
}

export function KnowledgeVaultList({ items: initialItems }: { items: Item[] }) {
  const [items, setItems] = useState(initialItems)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const supabase = createClient()

  // Автообновление статусов каждые 5 секунд если есть материалы в обработке
  const hasProcessing = items.some(i =>
    i.processing_status === 'processing' || i.processing_status === 'pending'
  )

  const refreshItems = useCallback(async () => {
    const { data } = await supabase
      .from('knowledge_vault')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setItems(data)
  }, [supabase])

  useEffect(() => {
    if (!hasProcessing) return
    const interval = setInterval(refreshItems, 5000)
    return () => clearInterval(interval)
  }, [hasProcessing, refreshItems])

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Удалить материал "${title}"? Это действие необратимо.`)) return
    setDeletingId(id)
    try {
      const { error } = await supabase
        .from('knowledge_vault')
        .delete()
        .eq('id', id)
      if (error) throw error
      setItems(prev => prev.filter(i => i.id !== id))
      toast.success('Материал удалён')
    } catch {
      toast.error('Ошибка удаления')
    } finally {
      setDeletingId(null)
    }
  }

  const StatusBadge = ({ status }: { status: string }) => {
    const configs = {
      ready: { label: 'Готово', icon: CheckCircle2, className: 'text-green-600 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-400/30 dark:bg-green-400/10' },
      processing: { label: 'Обработка...', icon: Loader2, className: 'text-yellow-600 border-yellow-300 bg-yellow-50 dark:text-yellow-400 dark:border-yellow-400/30 dark:bg-yellow-400/10' },
      pending: { label: 'В очереди', icon: Clock, className: 'text-blue-600 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-400/30 dark:bg-blue-400/10' },
      error: { label: 'Ошибка', icon: AlertCircle, className: 'text-red-600 border-red-300 bg-red-50 dark:text-red-400 dark:border-red-400/30 dark:bg-red-400/10' },
    }
    const config = configs[status as keyof typeof configs] || configs.pending
    const Icon = config.icon
    return (
      <Badge variant="outline" className={`text-xs gap-1 ${config.className}`}>
        <Icon className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
        {config.label}
      </Badge>
    )
  }

  const grouped = items.reduce<Record<string, Item[]>>((acc, item) => {
    if (!acc[item.content_type]) acc[item.content_type] = []
    acc[item.content_type].push(item)
    return acc
  }, {})

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <BookOpen className="h-16 w-16 text-muted-foreground/30" />
        <h2 className="text-lg font-semibold text-foreground">База знаний пуста</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Загрузите методологию, фреймворки и примеры — AI будет использовать их как основу
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Статус обработки */}
      {hasProcessing && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-400/20 dark:bg-yellow-400/5 text-sm text-yellow-700 dark:text-yellow-400">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>
            Идёт обработка материалов — текст разбивается на чанки и векторизуется через OpenAI.
            Обычно занимает <strong>1–3 минуты</strong> на документ. Страница обновляется автоматически.
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto shrink-0" onClick={refreshItems}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Список по категориям */}
      {Object.entries(CONTENT_TYPE_LABELS).map(([type, label]) => {
        const typeItems = grouped[type] || []
        return (
          <Card key={type} className="border-border bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">{label}</CardTitle>
                <Badge variant="outline" className="text-xs">{typeItems.length} материалов</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {typeItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">Нет материалов</p>
              ) : (
                typeItems.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                      <BookOpen className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleDateString('ru-RU', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={item.processing_status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(item.id, item.title)}
                        disabled={deletingId === item.id}
                      >
                        {deletingId === item.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />
                        }
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
