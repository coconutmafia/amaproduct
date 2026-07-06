import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALWAYS_INCLUDE, BLOCKED_STATUS } from '@/lib/ai/rag'
import { BILLING_ENFORCED } from '@/lib/generations'
import { emailConfigured, sendEmail, trialEndingEmail, trialEndedEmail } from '@/lib/email'
import { captureMessage } from '@/lib/sentry'

// Daily chain-integrity watchdog (Vercel Cron, see vercel.json).
//
// Almost every launch-audit finding was a SILENT break: a material saved under
// the wrong type, an RLS-denied insert swallowed, an empty layer nobody noticed.
// This cron re-runs the context-inspector checks across active projects every
// day and raises the flag the moment quality degrades — instead of the owner
// discovering it weeks later through «контент стал хуже».
//
// Alerting: warnings go to console.error (visible in Vercel logs / log drains)
// and, if ALERT_WEBHOOK_URL is set, POSTed there as JSON — point it at a
// Telegram-bot bridge / Slack webhook / Zapier when ready.
export const maxDuration = 300

const ALWAYS = new Set<string>(ALWAYS_INCLUDE)

async function handle(request: Request) {
  // ── Auth (same pattern as refresh-trends) ─────────────────────────────────
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  const isVercelCron = request.headers.get('x-vercel-cron') != null
  if (secret) {
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (!isVercelCron) {
    console.warn('[chain-watch] CRON_SECRET not set — set it in env for security.')
    return NextResponse.json({ error: 'Forbidden (set CRON_SECRET)' }, { status: 403 })
  }

  const admin = createAdminClient()
  const warnings: string[] = []

  // ── 1. System methodology layer — the product's foundation ────────────────
  const { count: sysChunks } = await admin
    .from('knowledge_chunks').select('id', { count: 'exact', head: true })
  if (!sysChunks || sysChunks === 0) {
    warnings.push('🔴 knowledge_chunks = 0 — методология сервиса НЕ доходит до генерации (см. миграцию 021 + /api/admin/knowledge-reembed)')
  }

  // ── 2. Per-project chain checks (active in the last 14 days) ──────────────
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
  const { data: projects } = await admin
    .from('projects')
    .select('id, name, updated_at')
    .eq('status', 'active')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(50)

  const oneHourAgo = Date.now() - 3600 * 1000
  let projectsChecked = 0
  for (const p of (projects ?? [])) {
    projectsChecked++
    const { data: mats } = await admin
      .from('project_materials')
      .select('title, material_type, raw_content, processing_status, created_at')
      .eq('project_id', p.id)
    if (!mats) continue

    for (const m of mats) {
      const status = (m.processing_status as string) ?? ''
      const empty = !(m.raw_content ?? '').toString().trim()
      const inChain = ALWAYS.has(m.material_type as string)
      if (status === 'error') {
        warnings.push(`⚠️ [${p.name}] «${m.title}» (${m.material_type}) в статусе error — материал не дойдёт до генерации`)
      } else if (BLOCKED_STATUS.has(status) && new Date(m.created_at as string).getTime() < oneHourAgo) {
        warnings.push(`⚠️ [${p.name}] «${m.title}» (${m.material_type}) завис в «${status}» >1ч`)
      } else if (inChain && empty && !BLOCKED_STATUS.has(status)) {
        warnings.push(`⚠️ [${p.name}] «${m.title}» (${m.material_type}) — пустой raw_content, звено выпадает из цепи`)
      }
    }
  }

  // ── 3. Housekeeping: purge old rate-limit windows ─────────────────────────
  try {
    await admin.from('rate_limits').delete()
      .lt('window_start', new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString())
  } catch { /* table may not exist until migration 022 is applied */ }

  // ── 4. Trial lifecycle ──────────────────────────────────────────────────────
  // (a) State transition trialing→view_only when the trial expired. ONLY when
  //     enforcement is live — flipping it earlier would make the TrialBanner
  //     claim «генерация на паузе» while nothing is actually blocked.
  // (b) Trial emails (dormant until RESEND_API_KEY is set). Idempotent via
  //     billing_events — the same dedupe pattern the payment webhooks use.
  const nowIso = new Date().toISOString()
  let trialTransitions = 0
  let trialEmails = 0
  if (BILLING_ENFORCED) {
    const { data: flipped } = await admin
      .from('profiles')
      .update({ subscription_status: 'view_only' })
      .eq('subscription_status', 'trialing')
      .lt('trial_ends_at', nowIso)
      .select('id')
    trialTransitions = flipped?.length ?? 0

    if (emailConfigured()) {
      for (const p of (flipped ?? [])) {
        const key = `email:trial-ended:${p.id}`
        const { error: dup } = await admin.from('billing_events').insert({ id: key, provider: 'email', type: 'trial-ended' })
        if (dup) continue // already sent
        const { data: u } = await admin.auth.admin.getUserById(p.id as string)
        const addr = u?.user?.email
        if (!addr) continue
        const { subject, html } = trialEndedEmail()
        if (await sendEmail(addr, subject, html)) trialEmails++
      }
    }
  }

  if (emailConfigured()) {
    // «заканчивается через ≤7 дней» — once per user (dedupe key without date)
    const in7d = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const { data: ending } = await admin
      .from('profiles')
      .select('id, trial_ends_at')
      .eq('subscription_status', 'trialing')
      .gt('trial_ends_at', nowIso)
      .lte('trial_ends_at', in7d)
      .limit(200)
    for (const p of (ending ?? [])) {
      const key = `email:trial-ending:${p.id}`
      const { error: dup } = await admin.from('billing_events').insert({ id: key, provider: 'email', type: 'trial-ending' })
      if (dup) continue
      const { data: u } = await admin.auth.admin.getUserById(p.id as string)
      const addr = u?.user?.email
      if (!addr) continue
      const daysLeft = Math.max(1, Math.ceil((new Date(p.trial_ends_at as string).getTime() - Date.now()) / (24 * 3600 * 1000)))
      const { subject, html } = trialEndingEmail(daysLeft)
      if (await sendEmail(addr, subject, html)) trialEmails++
    }
  }

  // ── 5. Report / alert ──────────────────────────────────────────────────────
  const report = { ok: warnings.length === 0, projectsChecked, systemChunks: sysChunks ?? 0, trialTransitions, trialEmails, warnings }
  if (warnings.length > 0) {
    console.error(`[chain-watch] ${warnings.length} warning(s):\n` + warnings.join('\n'))
    // Sentry: the curated «chain broke silently» signal (try/catch'ed paths
    // never reach onRequestError — this is how they surface).
    await captureMessage(`chain-watch: ${warnings.length} предупреждений\n` + warnings.slice(0, 20).join('\n'), 'warning', { projectsChecked })
    const hook = process.env.ALERT_WEBHOOK_URL
    if (hook) {
      try {
        await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'ama chain-watch', ...report }),
          signal: AbortSignal.timeout(10000),
        })
      } catch (e) {
        console.error('[chain-watch] alert webhook failed:', e instanceof Error ? e.message : e)
      }
    }
    // Telegram alert — the owner's native channel. Dormant until
    // TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set in env.
    const tgToken = process.env.TELEGRAM_BOT_TOKEN
    const tgChat = process.env.TELEGRAM_CHAT_ID
    if (tgToken && tgChat) {
      try {
        const text = `⚠️ AMA сторож цепи: ${warnings.length} предупр.\n\n` +
          warnings.slice(0, 15).join('\n').slice(0, 3500) +
          (warnings.length > 15 ? `\n…и ещё ${warnings.length - 15}` : '')
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChat, text }),
          signal: AbortSignal.timeout(10000),
        })
      } catch (e) {
        console.error('[chain-watch] telegram alert failed:', e instanceof Error ? e.message : e)
      }
    }
  } else {
    console.log(`[chain-watch] OK — ${projectsChecked} projects, ${sysChunks} system chunks`)
  }

  return NextResponse.json(report)
}

export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }
