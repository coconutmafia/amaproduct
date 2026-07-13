'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, RefreshCw, Check, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'

// Renders an AI chat answer with two owner-requested editing affordances:
//   1) «✎ Редактировать» — manual inline edit of the whole text (fix a word by
//      hand without asking the AI). Saving replaces the message text in place,
//      so every downstream action (Копировать / В план / Оформить) uses the
//      edited version.
//   2) Select a fragment → «Перегенерировать» — the AI rewrites ONLY the
//      highlighted piece (optionally with a note) and it's spliced back in, then
//      the whole updated text is shown.
//
// The parent owns the message state: onChange(newFullText) persists both kinds
// of edit back into the conversation.

interface Props {
  text: string
  projectId: string | null
  onChange: (newText: string) => void
}

interface Selection {
  start: number
  end: number
  text: string
  x: number
  y: number
}

// Offsets of the current DOM selection within a container that holds a single
// text node (our message bubble). Aligns with the plain `text` string.
function selectionOffsets(container: HTMLElement): { start: number; end: number; text: string } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const pre = range.cloneRange()
  pre.selectNodeContents(container)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  const selText = range.toString()
  return { start, end: start + selText.length, text: selText }
}

export function AssistantMessageBody({ text, projectId, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [sel, setSel] = useState<Selection | null>(null)
  const [note, setNote] = useState('')
  const [regen, setRegen] = useState(false)

  const textRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // Clear the fragment popover on any click outside it (unless we're busy).
  useEffect(() => {
    if (!sel) return
    const onDown = (e: MouseEvent) => {
      if (regen) return
      if (popRef.current?.contains(e.target as Node)) return
      setSel(null); setNote('')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sel, regen])

  const onMouseUp = (e: React.MouseEvent) => {
    if (editing) return
    const el = textRef.current
    if (!el) return
    const off = selectionOffsets(el)
    if (!off || off.text.trim().length < 3) { setSel(null); return }
    setSel({ ...off, x: e.clientX, y: e.clientY })
    setNote('')
  }

  const regenerate = async () => {
    if (!sel || regen) return
    setRegen(true)
    try {
      const res = await fetch('/api/ai/regenerate-fragment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectId || undefined, fullText: text, fragment: sel.text, instruction: note }),
      })
      const j = (await res.json().catch(() => ({}))) as { fragment?: string; error?: string }
      if (!res.ok || !j.fragment) throw new Error(j.error || 'Не удалось перегенерировать')
      // Splice the new fragment back in at the captured offsets (fall back to a
      // first-occurrence replace if the text shifted underneath us).
      let next: string
      if (text.slice(sel.start, sel.end) === sel.text) {
        next = text.slice(0, sel.start) + j.fragment + text.slice(sel.end)
      } else {
        next = text.replace(sel.text, j.fragment)
      }
      onChange(next)
      setSel(null); setNote('')
      toast.success('Фрагмент обновлён')
    } catch (err) {
      toast.error(friendlyError(err, 'Не удалось перегенерировать'))
    } finally {
      setRegen(false)
    }
  }

  if (editing) {
    return (
      <div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          rows={Math.min(24, Math.max(4, draft.split('\n').length + 1))}
          className="w-full resize-y rounded-lg border border-primary/40 bg-white px-3 py-2 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="mt-1.5 flex items-center gap-3">
          <button onClick={() => { onChange(draft.trim()); setEditing(false); toast.success('Изменения сохранены') }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90">
            <Check className="h-3 w-3" /> Сохранить
          </button>
          <button onClick={() => { setDraft(text); setEditing(false) }}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Отмена
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div ref={textRef} onMouseUp={onMouseUp}>{text}</div>

      <button onClick={() => { setDraft(text); setEditing(true); setSel(null) }}
        className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
        <Pencil className="h-3 w-3" /> Редактировать
      </button>

      {sel && (
        <div ref={popRef}
          style={{ position: 'fixed', top: Math.min(sel.y + 8, window.innerHeight - 120), left: Math.min(sel.x, window.innerWidth - 260) }}
          className="z-50 w-[240px] rounded-xl border border-border bg-white p-2 shadow-lg">
          <p className="mb-1.5 px-0.5 text-[10px] text-muted-foreground">Перегенерировать выделенный фрагмент</p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); regenerate() } }}
            placeholder="как переписать? (необязательно)"
            disabled={regen}
            className="mb-1.5 w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setSel(null); setNote('') }} disabled={regen}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">Отмена</button>
            <button onClick={regenerate} disabled={regen}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {regen ? <><Loader2 className="h-3 w-3 animate-spin" /> Пишу…</> : <><RefreshCw className="h-3 w-3" /> Перегенерировать</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
