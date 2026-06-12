'use client'

// 📌 Standing voice rules for a project (owner: «Вика говорит „не пиши так" —
// он сохраняет это как паттерн в её проекте?»). The button opens a tiny modal
// (dictation supported); saved rules reach every generator with top priority.

import { useState } from 'react'
import { toast } from 'sonner'
import { Pin } from 'lucide-react'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'

export async function saveVoiceRule(projectId: string, rule: string): Promise<boolean> {
  try {
    const res = await fetch('/api/voice-rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, rule }),
    })
    return res.ok
  } catch { return false }
}

// Heuristic: a chat message that sounds like a DURABLE style instruction →
// offer one-tap saving as a project rule (non-intrusive toast with action).
const RULE_RE = /(не пиши|никогда не|не используй|не ставь|всегда (пиши|используй|начинай|заканчивай|обращайся)|запомни[:,]|больше так не)/i

export function maybeSuggestRule(text: string, projectId: string | null | undefined) {
  if (!projectId) return
  const t = text.trim()
  if (t.length < 8 || t.length > 300 || !RULE_RE.test(t)) return
  toast('Похоже на постоянное правило стиля', {
    description: t.length > 90 ? t.slice(0, 90) + '…' : t,
    action: {
      label: '📌 Запомнить',
      onClick: () => {
        void saveVoiceRule(projectId, t).then((ok) =>
          ok ? toast.success('📌 Запомнил — AI этого проекта будет соблюдать всегда')
             : toast.error('Не удалось сохранить правило'))
      },
    },
    duration: 8000,
  })
}

export function VoiceRuleButton({ projectId, className }: { projectId?: string | null; className?: string }) {
  const [open, setOpen] = useState(false)
  const [rule, setRule] = useState('')
  const [saving, setSaving] = useState(false)

  if (!projectId) return null

  async function save() {
    const r = rule.trim()
    if (!r || saving) return
    setSaving(true)
    const ok = await saveVoiceRule(projectId!, r)
    setSaving(false)
    if (ok) {
      toast.success('📌 Запомнил — AI этого проекта будет соблюдать всегда')
      setRule(''); setOpen(false)
    } else toast.error('Не удалось сохранить правило')
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Постоянное правило для AI этого проекта"
        className={className ?? 'flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors'}>
        <Pin className="h-3 w-3" /> Правило
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-foreground">📌 Постоянное правило для AI</p>
            <p className="mt-1 text-xs text-muted-foreground">Скажи или впиши, как AI должен (или не должен) писать в этом проекте — он будет соблюдать это во всех генерациях. Например: «не используй слово трансформация», «всегда обращайся на ты».</p>
            <div className="mt-3">
              <VoiceTextarea value={rule} onChange={setRule} rows={3} placeholder="Не пиши… / Всегда…" />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary/40">Отмена</button>
              <button type="button" onClick={save} disabled={saving || !rule.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
                {saving ? 'Сохраняю…' : 'Запомнить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
