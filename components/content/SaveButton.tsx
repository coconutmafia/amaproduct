'use client'

import { useState } from 'react'
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { saveToLibrary } from '@/lib/saveContent'

interface Props {
  body: string
  title?: string | null
  contentType?: string | null
  projectId?: string | null
  className?: string
}

/** Saves a piece of content to the library ("Готовое") with inline feedback. */
export function SaveButton({ body, title, contentType, projectId, className }: Props) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const onSave = async () => {
    if (state !== 'idle') return
    setState('saving')
    try {
      await saveToLibrary({ body, title, content_type: contentType, project_id: projectId })
      setState('saved')
      toast.success('Сохранено в «Готовое»')
    } catch (e) {
      setState('idle')
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    }
  }

  return (
    <button onClick={onSave} disabled={state !== 'idle'}
      className={cn('flex items-center gap-1 transition-colors', className)}>
      {state === 'saving'
        ? <><Loader2 className="h-3 w-3 animate-spin" /> Сохраняю…</>
        : state === 'saved'
        ? <><BookmarkCheck className="h-3 w-3" /> Сохранено</>
        : <><Bookmark className="h-3 w-3" /> Сохранить</>}
    </button>
  )
}
