import { Eye } from 'lucide-react'

// Shown at the top of every project page when the current user is a VIEWER
// (client access — read-only). RLS is the real boundary; this just makes the
// role obvious so a viewer isn't surprised when an edit action is refused.
export function ReadOnlyBanner() {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        Ты просматриваешь этот проект как гость — <b>только чтение</b>. Редактирование и генерация
        доступны владельцу и редакторам проекта.
      </span>
    </div>
  )
}
