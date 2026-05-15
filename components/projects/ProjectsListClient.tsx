'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ProjectCard } from './ProjectCard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Trash2, MoreVertical } from 'lucide-react'
import { toast } from 'sonner'

interface Project {
  id: string
  name: string
  [key: string]: unknown
}

function CardMenu({ projectId, onDelete }: { projectId: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/90 backdrop-blur-sm border border-border text-muted-foreground hover:bg-secondary transition-all"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 min-w-[140px] rounded-xl border border-border bg-card shadow-lg py-1">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onDelete() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Удалить проект
          </button>
        </div>
      )}
    </div>
  )
}

export function ProjectsListClient({ projects: initial }: { projects: Project[] }) {
  const router = useRouter()
  const [projects, setProjects] = useState(initial)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const confirmProject = projects.find(p => p.id === confirmId)

  async function handleDelete(id: string) {
    setDeletingId(id)
    setConfirmId(null)
    try {
      const res = await fetch(`/api/projects?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Ошибка удаления')
      setProjects(prev => prev.filter(p => p.id !== id))
      toast.success('Проект удалён')
      router.refresh()
    } catch {
      toast.error('Не удалось удалить проект')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project, i) => (
          <div key={project.id} className="relative">
            <ProjectCard project={project as never} index={i} />
            {/* Always-visible ⋯ menu in top-right corner */}
            <div className="absolute top-3 right-3 z-10">
              <CardMenu
                projectId={project.id}
                onDelete={() => setConfirmId(project.id)}
              />
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!confirmId} onOpenChange={(open: boolean) => !open && setConfirmId(null)}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle>Удалить проект?</DialogTitle>
            <DialogDescription>
              Проект <span className="font-medium text-foreground">«{confirmProject?.name}»</span> будет удалён безвозвратно вместе со всеми материалами, контент-планом и историей.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmId && handleDelete(confirmId)}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
