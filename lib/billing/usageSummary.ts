import { createAdminClient } from '@/lib/supabase/admin'
import { PLAN_CONFIG, UNIT_COSTS, type SubscriptionTier } from '@/lib/generations-config'
import { tierBudgetUsd, usageRowCostUsd, activeBoostUsd, type UsageRow } from '@/lib/billing/costCap'
import { recentLedger, type LedgerRow } from '@/lib/billing/unitLedger'

// «Тариф и расход» — прозрачная картина для клиента (мандат Матвея 04.09:
// Даша упёрлась в лимит при 29/300 единиц и не понимала, за что; закрыл её
// ВТОРОЙ ограничитель — себестоимость AI (кап), которого она не видела).
// Здесь — одна правда для настроек, главной и окна лимита:
//   • единицы контента: списано / лимит тарифа / бонус / когда обновится;
//   • ресурс AI: доля исчерпания капа (без долларов наружу — в процентах);
//   • на что ушёл ресурс: категории действий по журналу ai_usage за месяц;
//   • на что хватит остатка — из UNIT_COSTS, чтобы цены не разъезжались с UI.

export type UsageCategory = {
  key: string
  label: string
  count: number        // штук действий (сообщений, файлов, минут…)
  unit: string         // «сообщений», «минут», «файлов»
  sharePct: number     // доля в ресурсе AI (себестоимости) за месяц
}

export type UsageSummary = {
  tier: SubscriptionTier
  status: string | null
  units: { used: number; limit: number; bonus: number; remaining: number; resetAt: string | null; unlimited: boolean }
  budget: { pct: number; exhausted: boolean; tracked: boolean; boostUntil: string | null }
  breakdown: UsageCategory[]
  fits: { content: number; chatMessages: number; transcribeHours: number; images: number }
  prices: { key: string; label: string; units: number; per: string }[]
  ledger: LedgerRow[]
}

// route ai_usage → категория (имена маршрутов в журнале разнородные: api/ai/chat,
// jobs/transcribe, instagram/scrape, ai/generate-image — сверено с продом 04.09).
const CATEGORIES: { key: string; label: string; unit: string; match: (route: string, provider: string) => boolean }[] = [
  { key: 'chat',       label: 'Сообщения ассистенту',        unit: 'сообщений', match: r => /ai\/chat$/.test(r) },
  { key: 'transcribe', label: 'Расшифровка записей',         unit: 'минут',     match: (r, p) => p === 'openai_whisper' && !/viral/.test(r) },
  { key: 'research',   label: 'Таблицы исследования',        unit: 'сборок',    match: r => /research-table|research-analyze/.test(r) },
  { key: 'audit',      label: 'Диагностика блога',           unit: 'разборов',  match: r => /blog-audit/.test(r) },
  { key: 'scrape',     label: 'Разбор Instagram-аккаунтов',  unit: 'аккаунтов', match: (r, p) => /instagram\/scrape/.test(r) && p === 'apify' },
  { key: 'upload',     label: 'Распознавание файлов и скринов', unit: 'файлов', match: r => /api\/upload/.test(r) },
  { key: 'images',     label: 'Картинки',                    unit: 'штук',      match: (_r, p) => p === 'openai_image' },
  { key: 'plans',      label: 'Прогревы и недельные брифы',  unit: 'штук',      match: r => /warmup-plan|week-brief/.test(r) },
  { key: 'reels',      label: 'Вирусные рилсы и монтаж',     unit: 'штук',      match: r => /viral|montage/.test(r) },
  { key: 'edits',      label: 'Правки, раскадровки, подсказки', unit: 'штук',   match: r => /plan-stories|carousel|suggest-angles|regenerate-fragment|edit$|brand-kit|tone-of-voice/.test(r) },
]

function monthStartIso(): string {
  const d = new Date()
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, email, subscription_tier, subscription_status, generations_used, bonus_generations, generations_reset_at')
    .eq('id', userId)
    .single()
  const tier = ((profile?.subscription_tier ?? 'trial') as SubscriptionTier)
  const plan = PLAN_CONFIG[tier] ?? PLAN_CONFIG.trial
  const used = Number(profile?.generations_used ?? 0)
  const bonus = Number(profile?.bonus_generations ?? 0)
  const limit = plan.generations
  const remaining = plan.unlimited ? Infinity : Math.max(0, limit - used) + bonus

  // Журнал за месяц — категории и доля себестоимости
  const rows: (UsageRow & { route: string; provider: string; meta: Record<string, unknown> | null })[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('ai_usage')
      .select('route, provider, model, input_tokens, output_tokens, meta')
      .eq('user_id', userId)
      .gte('created_at', monthStartIso())
      .range(from, from + 999)
    if (error) break
    rows.push(...((data ?? []) as typeof rows))
    if (!data || data.length < 1000) break
  }
  const byCat = new Map<string, { count: number; usd: number }>()
  let totalUsd = 0
  for (const r of rows) {
    const usd = usageRowCostUsd(r)
    totalUsd += usd
    const cat = CATEGORIES.find(c => c.match(r.route ?? '', r.provider ?? ''))
    const key = cat?.key ?? 'other'
    const cur = byCat.get(key) ?? { count: 0, usd: 0 }
    // Штуки: расшифровка = чанки по 10 минут; картинки = meta.count
    const inc = key === 'transcribe' ? 10 : key === 'images' ? Number((r.meta as { count?: number } | null)?.count ?? 1) : 1
    byCat.set(key, { count: cur.count + inc, usd: cur.usd + usd })
  }
  const breakdown: UsageCategory[] = [...byCat.entries()]
    .map(([key, v]) => {
      const cat = CATEGORIES.find(c => c.key === key)
      return {
        key,
        label: cat?.label ?? 'Другое',
        count: v.count,
        unit: cat?.unit ?? 'действий',
        sharePct: totalUsd > 0 ? Math.round(v.usd / totalUsd * 100) : 0,
      }
    })
    .sort((a, b) => b.sharePct - a.sharePct)

  // Кап: админы и QA вне учёта (как в checkBudgetCap). Временное расширение
  // (budget_boost_*, миграция 044) — «открыть на N дней» для конкретного клиента.
  const exempt = profile?.role === 'admin' || (profile?.email ?? '').toLowerCase() === 'ama-qa-bot@gmail.com'
  const boostUsd = await activeBoostUsd(admin, userId)
  let boostUntil: string | null = null
  if (boostUsd > 0) {
    const { data: b } = await admin.from('profiles').select('budget_boost_until').eq('id', userId).single()
    boostUntil = (b?.budget_boost_until as string | null) ?? null
  }
  const capUsd = tierBudgetUsd(tier) + boostUsd
  const pct = exempt ? 0 : Math.min(999, Math.round(totalUsd / capUsd * 100))

  const rem = plan.unlimited ? 9999 : remaining
  const ledger = await recentLedger(userId, 30)
  return {
    ledger,
    tier,
    status: (profile?.subscription_status as string | null) ?? null,
    // remaining: -1 = безлимит (Infinity не переживает JSON)
    units: { used, limit, bonus, remaining: plan.unlimited ? -1 : remaining, resetAt: (profile?.generations_reset_at as string | null) ?? null, unlimited: plan.unlimited },
    budget: { pct, exhausted: !exempt && totalUsd >= capUsd, tracked: !exempt, boostUntil },
    breakdown,
    fits: {
      content: Math.floor(rem / UNIT_COSTS.content),
      chatMessages: rem * UNIT_COSTS.chat_batch,
      transcribeHours: Math.floor(rem / UNIT_COSTS.transcribe_per_10min * 10 / 60),
      images: Math.floor(rem / UNIT_COSTS.image_per_variant),
    },
    prices: [
      { key: 'content',    label: 'Пост, рилз, карусель или сторис', units: UNIT_COSTS.content, per: 'за единицу контента' },
      { key: 'chat',       label: 'Сообщение ассистенту',            units: UNIT_COSTS.chat_batch / UNIT_COSTS.chat_batch, per: `за ${UNIT_COSTS.chat_batch} сообщения` },
      { key: 'transcribe', label: 'Расшифровка записи',              units: UNIT_COSTS.transcribe_per_10min, per: 'за каждые 10 минут' },
      { key: 'research',   label: 'Таблица исследования',            units: UNIT_COSTS.research_table, per: 'за сборку по всем кастдевам' },
      { key: 'meanings',   label: 'Карта смыслов',                   units: UNIT_COSTS.meanings_map, per: 'за карту' },
      { key: 'warmup',     label: 'План прогрева / недельный бриф',  units: UNIT_COSTS.warmup_plan, per: 'за план' },
      { key: 'image',      label: 'Картинка',                        units: UNIT_COSTS.image_per_variant, per: 'за каждый вариант' },
      { key: 'montage',    label: 'Монтаж видео',                    units: UNIT_COSTS.video_montage, per: 'за ролик' },
      { key: 'audit',      label: 'Диагностика блога',               units: UNIT_COSTS.blog_audit, per: 'за разбор' },
      { key: 'micro',      label: 'Мелкие правки, подсказки, голос', units: UNIT_COSTS.micro_batch / UNIT_COSTS.micro_batch, per: `за ${UNIT_COSTS.micro_batch} действий` },
    ],
  }
}
