'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function DeleteContentButton({ itemId }: { itemId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    if (!confirm('Удалить этот контент?')) return
    setLoading(true)
    try {
      const res = await fetch(`/api/content?id=${itemId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Ошибка')
      toast.success('Удалено')
      router.refresh()
    } catch {
      toast.error('Не удалось удалить')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 shrink-0"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete() }}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </Button>
  )
}
