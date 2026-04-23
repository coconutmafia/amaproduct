'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function DeletePlanButton({ planId, projectId }: { planId: string; projectId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    if (!confirm('Удалить план прогрева? Это действие нельзя отменить.')) return
    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_warmup_plan',
          projectId,
          data: { planId },
        }),
      })
      if (!res.ok) throw new Error('Ошибка удаления')
      toast.success('План удалён')
      router.refresh()
    } catch {
      toast.error('Не удалось удалить план')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
      onClick={handleDelete}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  )
}
