import Link from 'next/link'
import { ArrowLeft, Gauge } from 'lucide-react'
import { StandaloneBlogAudit } from '@/components/blogAudit/StandaloneBlogAudit'

// Автономная диагностика блога с главной — по введённому @хендлу, без проекта
// (для тех, у кого проектов ещё нет). Логика — в StandaloneBlogAudit.
export default function StandaloneBlogAuditPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-secondary/50 transition-colors"
          aria-label="На главную"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-black flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Диагностика блога к продажам
          </h1>
          <p className="text-sm text-muted-foreground">Проверь любой Instagram по чек-листу из 10 блоков</p>
        </div>
      </div>

      <StandaloneBlogAudit />
    </div>
  )
}
