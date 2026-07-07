import Link from 'next/link'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { BlogAuditPanel } from '@/components/projects/BlogAuditDialog'

// Отдельная страница диагностики блога — вход с карточки на дашборде проекта
// (тестер не находил кнопку, спрятанную в «Материалах»). Клиентская логика —
// в BlogAuditPanel; здесь только заголовок + контейнер.
export default async function BlogAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${id}`}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-secondary/50 transition-colors"
          aria-label="Назад к проекту"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-black flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Диагностика блога к продажам
          </h1>
          <p className="text-sm text-muted-foreground">Балл, диагноз и что усилить — по чек-листу из 10 блоков</p>
        </div>
      </div>

      <BlogAuditPanel projectId={id} />
    </div>
  )
}
