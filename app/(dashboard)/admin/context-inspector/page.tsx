'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Search, Layers, AlertTriangle, CheckCircle2, XCircle, Circle } from 'lucide-react'

interface ChainLink { material_type: string; present: boolean; rows: number; reaching: number; totalChars: number; note: string }
interface MaterialRow {
  id: string; title: string; material_type: string; processing_status: string | null
  chars: number; includedChars: number; truncated: boolean
  reaches: 'always_include' | 'embedding_only' | 'blocked' | 'empty'; reason: string
}
interface Report {
  project: { id: string; name: string }
  layers: {
    systemKnowledge: { knowledgeChunks: number }
    projectEmbeddings: { chunks: number; note: string }
    alwaysInclude: { chainMap: ChainLink[]; reachingCount: number; totalChars: number }
    style: { styleBank: number; savedContent: number }
    voiceRules: { present: boolean; chars: number }
  }
  materials: MaterialRow[]
  warnings: {
    blocked: Array<{ title: string; material_type: string; reason: string }>
    embeddingOnly: Array<{ title: string; material_type: string; reason: string }>
    missingLinks: string[]
  }
}

const REACH_META: Record<MaterialRow['reaches'], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  always_include: { label: 'доходит', cls: 'text-green-400 border-green-400/30 bg-green-500/10', Icon: CheckCircle2 },
  embedding_only: { label: 'только эмбеддинг', cls: 'text-amber-400 border-amber-400/30 bg-amber-500/10', Icon: Circle },
  blocked:        { label: 'блокирован', cls: 'text-red-400 border-red-400/30 bg-red-500/10', Icon: XCircle },
  empty:          { label: 'пусто', cls: 'text-muted-foreground border-border bg-secondary', Icon: XCircle },
}

export default function ContextInspectorPage() {
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const load = async () => {
    const id = projectId.trim()
    if (!id) { toast.error('Введи ID проекта'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/context-inspector?projectId=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setReport(data as Report)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  const L = report?.layers

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-16">
      <div className="space-y-1">
        <h1 className="text-xl font-bold flex items-center gap-2"><Layers className="h-5 w-5 text-primary" /> Инспектор контекста</h1>
        <p className="text-sm text-muted-foreground">Что реально доходит до генерации по каждому звену цепи. Введи ID проекта.</p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="project id (uuid)"
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <Button onClick={load} disabled={loading} className="gradient-accent text-white shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {report && L && (
        <>
          <p className="text-sm">Проект: <span className="font-medium">{report.project.name}</span></p>

          {/* Слои */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { t: 'Методология (система)', v: `${L.systemKnowledge.knowledgeChunks} чанков` },
              { t: 'Материалы (эмбеддинг)', v: `${L.projectEmbeddings.chunks} чанков` },
              { t: 'ALWAYS_INCLUDE', v: `${L.alwaysInclude.reachingCount} мат. · ${L.alwaysInclude.totalChars.toLocaleString('ru')} симв` },
              { t: 'Стиль-банк', v: `${L.style.styleBank}` },
              { t: '«Готовое»', v: `${L.style.savedContent}` },
              { t: 'Правила голоса', v: L.voiceRules.present ? `${L.voiceRules.chars} симв` : 'нет' },
            ].map(({ t, v }) => (
              <div key={t} className="rounded-xl border border-border bg-card p-3">
                <p className="text-[11px] text-muted-foreground">{t}</p>
                <p className="text-sm font-semibold mt-0.5">{v}</p>
              </div>
            ))}
          </div>

          {/* Предупреждения */}
          {(report.warnings.blocked.length > 0 || report.warnings.embeddingOnly.length > 0 || report.warnings.missingLinks.length > 0) && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-300"><AlertTriangle className="h-4 w-4" /> Разрывы цепи</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {report.warnings.blocked.map((w, i) => (
                  <p key={`b${i}`}><span className="text-red-400 font-medium">блокирован:</span> {w.title} — {w.reason}</p>
                ))}
                {report.warnings.embeddingOnly.map((w, i) => (
                  <p key={`e${i}`}><span className="text-amber-400 font-medium">только эмбеддинг:</span> {w.title} — {w.reason}</p>
                ))}
                {report.warnings.missingLinks.length > 0 && (
                  <p><span className="text-muted-foreground font-medium">нет материала:</span> {report.warnings.missingLinks.join(', ')}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Карта цепи ALWAYS_INCLUDE */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Звенья ALWAYS_INCLUDE</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {L.alwaysInclude.chainMap.map(c => (
                <div key={c.material_type} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                  <span className="text-xs font-mono">{c.material_type}</span>
                  <span className={`text-[11px] ${c.reaching > 0 ? 'text-green-400' : c.present ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {c.reaching > 0 ? `✓ ${c.totalChars.toLocaleString('ru')} симв` : c.present ? '⚠ не доходит' : '— нет'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Все материалы */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Все материалы ({report.materials.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {report.materials.map(m => {
                const meta = REACH_META[m.reaches]
                return (
                  <div key={m.id} className="flex items-start justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{m.title || '(без названия)'}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{m.material_type} · {m.chars.toLocaleString('ru')} симв{m.truncated ? ` → ${m.includedChars.toLocaleString('ru')} (обрезано)` : ''}</p>
                      {m.reason && <p className="text-[11px] text-amber-400/80 mt-0.5">{m.reason}</p>}
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${meta.cls}`}>
                      <meta.Icon className="h-3 w-3 mr-1" /> {meta.label}
                    </Badge>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
