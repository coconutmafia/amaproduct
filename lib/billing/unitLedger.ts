import { createAdminClient } from '@/lib/supabase/admin'
import { UNIT_COSTS } from '@/lib/generations-config'

// Лента списаний (миграция 045): каждое списание/возврат единиц — строкой,
// чтобы клиент видел «поговорил с ассистентом — списалось 0,5 ед.», а не
// гадал, куда ушёл лимит (Даша 04.09). Best-effort: до применения миграции
// или при сбое БД запись молча пропускается — лента не смеет ломать гейт.

export const LEDGER_LABELS: Record<string, string> = {
  chat:                 'Сообщение ассистенту',
  content:              'Единица контента (пост, рилз, сторис, карусель)',
  transcribe:           'Расшифровка записи',
  research_table:       'Таблица исследования',
  meanings_map:         'Карта смыслов',
  warmup_plan:          'План прогрева',
  week_brief:           'Недельный бриф',
  competitor_table:     'Таблица конкурентов',
  blog_audit:           'Диагностика блога',
  viral_reels:          'Разбор вирусного рилса',
  instagram_scrape:     'Разбор Instagram-аккаунта',
  image:                'Картинка',
  video_montage:        'Монтаж видео',
  video_overlay:        'Наложение на видео',
  'plan-stories':       'Раскадровка сторис',
  'post-hook':          'Хук для поста',
  'carousel-structure': 'Структура карусели',
  'brand-kit':          'Анализ визуала',
  'transcribe-voice':   'Голосовое сообщение',
  'suggest-trends':     'Подсказка трендов',
  'suggest-angles':     'Подсказка углов',
  'regenerate-fragment':'Перегенерация фрагмента',
  edit:                 'Правка текста',
  'edit-stories':       'Правка сторис',
  'edit-carousel':      'Правка карусели',
  refund:               'Возврат',
}

export function ledgerLabel(action: string): string {
  return LEDGER_LABELS[action] ?? 'Действие'
}

// Доля единицы за одно микро-действие: чат = 1/chat_batch, остальные = 1/micro_batch.
export function microUnits(route: string, batch: number): number {
  const b = batch > 0 ? batch : (route === 'chat' ? UNIT_COSTS.chat_batch : UNIT_COSTS.micro_batch)
  return Math.round((1 / b) * 100) / 100
}

export async function recordUnits(userId: string, action: string, units: number, meta?: Record<string, unknown>): Promise<void> {
  if (!userId || !Number.isFinite(units) || units === 0) return
  try {
    await createAdminClient().from('unit_ledger').insert({
      user_id: userId,
      action,
      units,
      meta: meta ?? null,
    })
  } catch { /* лента — не гейт: молчим */ }
}

export type LedgerRow = { id: number; action: string; label: string; units: number; created_at: string }

export async function recentLedger(userId: string, limit = 30): Promise<LedgerRow[]> {
  try {
    const { data, error } = await createAdminClient()
      .from('unit_ledger')
      .select('id, action, units, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return data.map(r => ({ id: r.id as number, action: r.action as string, label: ledgerLabel(r.action as string), units: Number(r.units), created_at: r.created_at as string }))
  } catch { return [] }
}
