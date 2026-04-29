'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface Project {
  id: string
  name: string
  [key: string]: unknown
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
        {projects.map((project) => (
          <div key={project.id} className="relative group">
            <ProjectCard project={project as never} />
            {/* Delete button — appears on hover */}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmId(project.id) }}
              disabled={deletingId === project.id}
              className="absolute bottom-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all opacity-0 group-hover:opacity-100"
              title="Удалить проект"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <Link href="/projects/new">
          <div className="flex items-center justify-center h-full min-h-[140px] rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
            <div className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary transition-colors p-6">
              <Plus className="h-8 w-8" />
              <span className="text-sm font-medium">Создать проект</span>
            </div>
          </div>
        </Link>
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
