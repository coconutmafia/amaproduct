import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { rateLimit } from '@/lib/rateLimit'
import { amoConfigured, sendLeadToAmo } from '@/lib/leads/amocrm'

// POST /api/diagnostic-lead — заявка на консультацию из воронки диагностики
// (спека ассистентки 29.08: форма имя/Telegram/Instagram после отчёта; бота
// НЕ используем — заявка уходит менеджеру). Заявка ВСЕГДА сохраняется в БД
// (лид не теряется), доставка наружу — best-effort в after():
//   • Telegram-чат заявок (тот же, куда приходят с Tilda): env
//     TG_LEADS_BOT_TOKEN + TG_LEADS_CHAT_ID — бот должен быть добавлен в чат;
//   • amoCRM: env AMOCRM_WEBHOOK_URL (интеграционный URL — как настроена
//     Tilda; передаём контакты + метку источника «Заявка с диагностики»).
// Пока env не заданы — заявки копятся в diagnostic_leads с delivered_*=false,
// их видно сервис-ролью; после настройки env новые уходят сразу.
export const dynamic = 'force-dynamic'

const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/^@/, '').slice(0, max)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'diagnostic-lead')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  let body: { name?: string; telegram?: string; instagram?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const name = String(body.name ?? '').trim().slice(0, 80)
  const telegram = clean(body.telegram, 64)
  const instagram = clean(body.instagram, 64)
  if (!name || !telegram || !instagram) {
    return NextResponse.json({ error: 'Заполни все три поля — имя, Telegram и Instagram.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: lead, error } = await admin
    .from('diagnostic_leads')
    .insert({ user_id: user.id, user_email: user.email ?? null, name, telegram, instagram, source: 'diagnostic' })
    .select('id')
    .single()
  if (error || !lead) {
    await captureException(new Error(error?.message || 'lead insert failed'), { where: 'diagnostic-lead POST' })
    // Таблицы может не быть до наката 041 — заявка важнее формы: даём прямой запасной ход.
    return NextResponse.json(
      { error: 'Форма пока настраивается — напиши маркетологу напрямую в Telegram: @avavasilik' },
      { status: 503 },
    )
  }

  const leadId = lead.id as string
  after(async () => {
    // Telegram-чат заявок
    try {
      const token = process.env.TG_LEADS_BOT_TOKEN
      const chatId = process.env.TG_LEADS_CHAT_ID
      if (token && chatId) {
        const text = [
          '🔥 Заявка с диагностики',
          `Имя: ${name}`,
          `Telegram: @${telegram}`,
          `Instagram: @${instagram}`,
          `Аккаунт AVA: ${user.email ?? '—'}`,
        ].join('\n')
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        })
        if (r.ok) await admin.from('diagnostic_leads').update({ delivered_tg: true }).eq('id', leadId)
        else await captureException(new Error(`tg sendMessage ${r.status}`), { where: 'diagnostic-lead tg' })
      }
    } catch (e) { await captureException(e, { where: 'diagnostic-lead tg' }) }
    // amoCRM: основной путь — API v4 с долгосрочным токеном (lib/leads/amocrm,
    // env AMOCRM_SUBDOMAIN + AMOCRM_TOKEN); запасной — произвольный
    // AMOCRM_WEBHOOK_URL, если команда даст готовый коннектор.
    try {
      if (amoConfigured()) {
        const ok = await sendLeadToAmo({ name, telegram, instagram, email: user.email ?? '' })
        if (ok) await admin.from('diagnostic_leads').update({ delivered_amo: true }).eq('id', leadId)
      } else if (process.env.AMOCRM_WEBHOOK_URL) {
        const r = await fetch(process.env.AMOCRM_WEBHOOK_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, telegram: `@${telegram}`, instagram: `@${instagram}`, email: user.email ?? '', source: 'Заявка с диагностики' }),
        })
        if (r.ok) await admin.from('diagnostic_leads').update({ delivered_amo: true }).eq('id', leadId)
        else await captureException(new Error(`amo webhook ${r.status}`), { where: 'diagnostic-lead amo' })
      }
    } catch (e) { await captureException(e, { where: 'diagnostic-lead amo' }) }
  })

  return NextResponse.json({ ok: true })
}
