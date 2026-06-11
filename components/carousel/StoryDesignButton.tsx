'use client'

// Chat answers that are a STORIES series get this button instead of «Сделать
// картинку поста» (a stories script isn't a post image — owner feedback). It
// hands the script to the story builder via localStorage and navigates there.

import { useRouter } from 'next/navigation'

export function StoryDesignButton({ text, projectId }: { text: string; projectId: string }) {
  const router = useRouter()

  function go() {
    try { localStorage.setItem(`ama_stories_script_${projectId}`, text) } catch { /* ignore */ }
    router.push(`/projects/${projectId}/stories`)
  }

  return (
    <button type="button" onClick={go}
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
      🖼 Оформить сторис
    </button>
  )
}
