'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Pencil, Trash2, X, Check, Loader2 } from 'lucide-react'

interface ProjectInfoSectionProps {
  project: {
    id: string
    name: string
    niche?: string | null
    description?: string | null
    target_audience?: string | null
    content_goals?: string | null
    instagram_url?: string | null
    telegram_url?: string | null
    vk_url?: string | null
    youtube_url?: string | null
  }
}

export function ProjectInfoSection({ project }: ProjectInfoSectionProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Form state (initialised from project)
  const [name, setName] = useState(project.name ?? '')
  const [niche, setNiche] = useState(project.niche ?? '')
  const [description, setDescription] = useState(project.description ?? '')
  const [targetAudience, setTargetAudience] = useState(project.target_audience ?? '')
  const [contentGoals, setContentGoals] = useState(project.content_goals ?? '')
  const [instagram, setInstagram] = useState(project.instagram_url ?? '')
  const [telegram, setTelegram] = useState(project.telegram_url ?? '')
  const [vk, setVk] = useState(project.vk_url ?? '')
  const [youtube, setYoutube] = useState(project.youtube_url ?? '')

  const hasContent = project.description || project.target_audience || project.content_goals

  async function saveChanges() {
    setSaving(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project',
          projectId: project.id,
          fields: {
            name: name.trim() || project.name,
            niche: niche.trim() || null,
            description: description.trim() || null,
            target_audience: targetAudience.trim() || null,
            content_goals: contentGoals.trim() || null,
            instagram_url: instagram.trim() || null,
            telegram_url: telegram.trim() || null,
            vk_url: vk.trim() || null,
            youtube_url: youtube.trim() || null,
          },
        }),
      })
      if (!res.ok) throw new Error('Ошибка сохранения')
      toast.success('Проект обновлён')
      setEditing(false)
      router.refresh()
    } catch {
      toast.error('Не удалось сохранить изменения')
    } finally {
      setSaving(false)
    }
  }

  async function deleteProject() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects?id=${project.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Ошибка удаления')
      toast.success('Проект удалён')
      router.push('/projects')
    } catch {
      toast.error('Не удалось удалить проект')
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row — always visible */}
      <button
        onClick={() => { setOpen(o => !o); setEditing(false) }}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          О проекте
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Collapsed preview — one-line summary */}
      {!open && hasContent && (
        <p className="px-4 pb-3 text-xs text-muted-foreground truncate">
          {project.description || project.target_audience || ''}
        </p>
      )}

      {/* Expanded content */}
      {open && (
        <div className="border-t border-border">
          {!editing ? (
            /* ── Read mode ── */
            <div className="p-4 space-y-3">
              {project.description && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">О блогере</p>
                  <p className="text-sm text-foreground leading-relaxed">{project.description}</p>
                </div>
              )}
              {project.target_audience && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Целевая аудитория</p>
                  <p className="text-sm text-foreground leading-relaxed">{project.target_audience}</p>
                </div>
              )}
              {project.content_goals && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Цели контента</p>
                  <p className="text-sm text-foreground leading-relaxed">{project.content_goals}</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-border"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-1.5 h-3 w-3" />
                  Редактировать
                </Button>
                {!confirmDelete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="mr-1.5 h-3 w-3" />
                    Удалить проект
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-destructive font-medium">Удалить безвозвратно?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs"
                      disabled={deleting}
                      onClick={deleteProject}
                    >
                      {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Да, удалить'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Отмена
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Edit mode ── */
            <div className="p-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Название проекта</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm bg-input border-border" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ниша</Label>
                  <Input value={niche} onChange={e => setNiche(e.target.value)} placeholder="Маркетинг, нутрициология..." className="h-9 text-sm bg-input border-border" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">О блогере</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="text-sm bg-input border-border resize-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Целевая аудитория</Label>
                <Textarea value={targetAudience} onChange={e => setTargetAudience(e.target.value)} rows={2} className="text-sm bg-input border-border resize-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Цели контента</Label>
                <Textarea value={contentGoals} onChange={e => setContentGoals(e.target.value)} rows={2} className="text-sm bg-input border-border resize-none" />
              </div>

              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">Социальные сети</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { label: 'Instagram', val: instagram, set: setInstagram },
                  { label: 'Telegram', val: telegram, set: setTelegram },
                  { label: 'VK', val: vk, set: setVk },
                  { label: 'YouTube', val: youtube, set: setYoutube },
                ].map(({ label, val, set }) => (
                  <div key={label} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input value={val} onChange={e => set(e.target.value)} placeholder="https://..." className="h-9 text-sm bg-input border-border" />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-8 text-xs gradient-accent text-white hover:opacity-90"
                  disabled={saving}
                  onClick={saveChanges}
                >
                  {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Check className="mr-1.5 h-3 w-3" />}
                  Сохранить
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  <X className="mr-1.5 h-3 w-3" />
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
