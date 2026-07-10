'use client'

// Thin wrapper — the whole story builder now lives in the shared <StoriesPanel/>
// so the unified content studio (/projects/[id]/create) and this page render the
// exact same thing. See UNIFY_EDITOR.md (Фаза 3).

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { StoriesPanel } from '@/components/content/StoriesPanel'

export default function StoriesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  return (
    <div className="mx-auto max-w-3xl p-5 pb-24">
      <Link href={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К проекту
      </Link>
      <h1 className="text-xl font-bold text-foreground">Оформление сторис</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">Загрузи фото и напиши сценарий — AI разложит его на кадры сторис в твоём фирменном стиле.</p>
      <StoriesPanel projectId={projectId} />
    </div>
  )
}
