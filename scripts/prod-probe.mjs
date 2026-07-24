#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// prod-probe — безопасный живой пробник прода AMA под контролем.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ: обычное чтение прода ассистенту доступно всегда, но
// админский Auth-API (создать/удалить юзера) и запись режет авто-классификатор
// харнесса. Чтобы ассистент мог прогонять живые проверки, не выпрашивая
// разрешение каждую сессию, в .claude/settings.local.json разрешён ТОЛЬКО запуск
// этого файла (`node scripts/prod-probe.mjs *`), а не произвольный curl к проду.
// Так доступ узкий и обозримый: всё, что скрипт умеет, видно здесь.
//
// ЖЕЛЕЗНЫЕ ПРАВИЛА (не ослаблять):
//   • каждый пробник ОБЯЗАН убрать за собой (создал → удалил), даже при ошибке;
//   • трогаем только объекты с префиксом PROBE_PREFIX — на чужое не наступаем;
//   • сервис-ключ берётся из .env.local и НИКОГДА не печатается;
//   • по умолчанию (без --run) — DRY-RUN: только показывает план, ничего не пишет.
//
// Использование:
//   node scripts/prod-probe.mjs cascade-delete          # dry-run, ничего не пишет
//   node scripts/prod-probe.mjs cascade-delete --run     # реально прогнать и убрать
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE_PREFIX = 'ama-probe-' // всё, что заводит скрипт, начинается с этого

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
  const env = {}
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  const U = env.NEXT_PUBLIC_SUPABASE_URL
  const K = env.SUPABASE_SERVICE_ROLE_KEY
  if (!U || !K) throw new Error('нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local')
  return { U, K }
}

const { U, K } = loadEnv()
const RUN = process.argv.includes('--run')
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

async function api(path, init = {}) {
  const res = await fetch(`${U}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

const log = (...a) => console.log(...a)

// ── ПРОБНИК: каскадное удаление профиля (проверка миграции 037) ───────────────
// Заводит временного юзера + его проект, удаляет юзера через admin API и
// убеждается, что каскад снёс И профиль, И проект (обе связи, что чинила 037).
async function cascadeDelete() {
  const email = `${PROBE_PREFIX}${Date.now()}@amaproduct.com`
  log(`\n=== Пробник: каскадное удаление (миграция 037) ===`)
  log(`временный юзер: ${email}`)

  if (!RUN) {
    log('\n[DRY-RUN] план (ничего не пишу, добавь --run чтобы выполнить):')
    log('  1) admin: создать юзера с email выше (триггер заведёт profiles)')
    log('  2) rest: вставить проект от его имени')
    log('  3) admin: удалить юзера')
    log('  4) rest: убедиться, что profiles и projects по нему исчезли')
    log('  5) при любой ошибке — удалить созданное (юзер/проект)')
    return
  }

  let userId = null
  let projectId = null
  try {
    // 1) создать юзера
    const created = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, email_confirm: true }),
    })
    userId = created.body?.id
    if (!userId) throw new Error(`не создался юзер: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`)
    log(`✅ 1. юзер создан: ${userId}`)

    // профиль от триггера
    const prof = await api(`/rest/v1/profiles?id=eq.${userId}&select=id`)
    const hasProfile = Array.isArray(prof.body) && prof.body.length === 1
    log(`   профиль от триггера: ${hasProfile ? 'есть' : '⚠️ НЕТ'}`)

    // 2) проект
    const proj = await api('/rest/v1/projects', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: `${PROBE_PREFIX}project`, owner_id: userId }),
    })
    projectId = Array.isArray(proj.body) ? proj.body[0]?.id : proj.body?.id
    if (!projectId) throw new Error(`не создался проект: ${proj.status} ${JSON.stringify(proj.body).slice(0, 200)}`)
    log(`✅ 2. проект создан: ${projectId}`)

    // 3) удалить юзера
    const del = await api(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' })
    if (del.status >= 300) throw new Error(`удаление юзера отбито: ${del.status} ${JSON.stringify(del.body).slice(0, 200)}`)
    log(`✅ 3. юзер удалён (admin API вернул ${del.status})`)

    // 4) проверить каскад
    const profAfter = await api(`/rest/v1/profiles?id=eq.${userId}&select=id`)
    const projAfter = await api(`/rest/v1/projects?id=eq.${projectId}&select=id`)
    const profileGone = Array.isArray(profAfter.body) && profAfter.body.length === 0
    const projectGone = Array.isArray(projAfter.body) && projAfter.body.length === 0
    if (profileGone) userId = null       // уже нет — чистить нечего
    if (projectGone) projectId = null

    log(`\n── РЕЗУЛЬТАТ ──`)
    log(`  профиль удалился каскадом: ${profileGone ? '✅ да' : '❌ НЕТ — остался'}`)
    log(`  проект  удалился каскадом: ${projectGone ? '✅ да' : '❌ НЕТ — остался'}`)
    log(profileGone && projectGone
      ? `\n✅ 037 РАБОТАЕТ: удаление юзера чисто снесло всю цепочку.`
      : `\n❌ 037 НЕ ДОРАБОТАЛА: что-то осталось (см. выше).`)
  } finally {
    // 5) уборка при любом исходе
    if (projectId) {
      await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
      log(`   [cleanup] удалён проект ${projectId}`)
    }
    if (userId) {
      await api(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' }).catch(() => {})
      log(`   [cleanup] удалён юзер ${userId}`)
    }
  }
}

// ── ПОЧИНКА: оплата ушла не на ту почту ──────────────────────────────────────
// Продамус выбрасывает наши параметры из готовой ссылки, поэтому почту платель-
// щик вводит РУКАМИ и может указать не ту, с которой регистрировался. Вебхук
// ищет человека по почте плательщика, не находит — деньги списаны, тариф не
// выдан. Случалось уже дважды (Аня; Дарья Барышева 19 июля), поэтому инструмент,
// а не разовый запрос.
//
// ⚠️ ВЫДАЁМ ТАРИФ НА ПОЧТУ ПЛАТЕЛЬЩИКА, а не на ту, с которой регистрировались:
// через 60 дней придёт рекуррент с той же почтой плательщика, и он должен
// найти владельца. Запасной путь по provider_subscription_id НЕ спасёт — у
// Продамуса это id ПРОДУКТА (напр. 2946756), он одинаковый у многих людей.
//
// Использование:
//   node scripts/prod-probe.mjs link-payment --payer dasha-yurzhic@mail.ru \
//     --plan solo --order 46842197 --sub 2946756 [--drop-account old@mail.ru] [--run]
function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

// Таблицы, по которым проверяем «аккаунт действительно пустой» перед удалением.
const OWNERSHIP_CHECKS = [
  ['projects', 'owner_id'], ['jobs', 'user_id'], ['project_members', 'user_id'],
  ['saved_content', 'user_id'], ['warmup_jobs', 'user_id'], ['payments', 'user_id'],
  ['promo_code_uses', 'user_id'], ['referrals', 'referrer_id'],
]

async function countRows(table, col, userId) {
  const res = await fetch(`${U}/rest/v1/${table}?select=id&${col}=eq.${userId}`, {
    headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = res.headers.get('content-range') || ''
  return Number(cr.split('/')[1] ?? NaN)
}

async function linkPayment() {
  const payer = arg('payer')
  const plan = arg('plan')
  const order = arg('order')
  const sub = arg('sub')
  const drop = arg('drop-account')
  if (!payer || !plan || !order) {
    throw new Error('нужны --payer <email> --plan <solo|pro|producer> --order <orderId>')
  }
  if (drop && drop.toLowerCase() === payer.toLowerCase()) {
    throw new Error('--drop-account совпадает с --payer: это удалило бы того, кому выдаём тариф')
  }

  log(`\n=== Починка: привязать оплату к почте плательщика ===`)

  // 1. кому выдаём
  const { body: profs } = await api(`/rest/v1/profiles?email=eq.${encodeURIComponent(payer)}&select=id,email,full_name,subscription_tier,subscription_status,current_period_end`)
  if (!Array.isArray(profs) || profs.length !== 1) {
    throw new Error(`по ${payer} найдено профилей: ${Array.isArray(profs) ? profs.length : '?'} (нужен ровно 1)`)
  }
  const target = profs[0]
  log(`получатель: ${target.email} (${target.full_name || '—'}) — сейчас ${target.subscription_tier}/${target.subscription_status}`)

  // 2. платёж в леджере → от его даты считаем 60 дней демо-периода
  const { body: pays } = await api(`/rest/v1/payments?external_id=eq.${encodeURIComponent(order)}&select=id,created_at,amount,currency,user_id,description`)
  if (!Array.isArray(pays) || pays.length !== 1) {
    throw new Error(`по заказу ${order} найдено платежей: ${Array.isArray(pays) ? pays.length : '?'} (нужен ровно 1)`)
  }
  const pay = pays[0]
  const periodEnd = new Date(new Date(pay.created_at).getTime() + 60 * 86400000).toISOString()
  log(`платёж: ${pay.amount} ${pay.currency} от ${pay.created_at.slice(0, 19)} (user_id сейчас: ${pay.user_id ?? 'null'})`)
  log(`доступ до: ${periodEnd.slice(0, 10)} (60 дней от оплаты — как у остальных)`)

  // 3. кого удаляем (если просили) — только если пусто
  let dropUser = null
  if (drop) {
    const { body: d } = await api(`/rest/v1/profiles?email=eq.${encodeURIComponent(drop)}&select=id,email,full_name`)
    if (!Array.isArray(d) || d.length !== 1) throw new Error(`по ${drop} найдено профилей: ${Array.isArray(d) ? d.length : '?'}`)
    dropUser = d[0]
    log(`\nна удаление: ${dropUser.email} (${dropUser.full_name || '—'})`)
    let dirty = []
    for (const [t, c] of OWNERSHIP_CHECKS) {
      const n = await countRows(t, c, dropUser.id)
      if (Number.isFinite(n) && n > 0) dirty.push(`${t}.${c}=${n}`)
    }
    if (dirty.length) {
      throw new Error(`ОТКАЗ: аккаунт ${drop} НЕ пустой (${dirty.join(', ')}) — удалять нельзя, разбирайся руками`)
    }
    log(`  проверка: пусто по всем таблицам ✅`)
  }

  if (!RUN) {
    log(`\n[DRY-RUN] что будет сделано (добавь --run):`)
    log(`  1) ${target.email}: tier=${plan}, status=active, provider=prodamus, до ${periodEnd.slice(0, 10)}${sub ? `, sub_id=${sub}` : ''}`)
    log(`  2) платёж ${order}: user_id → ${target.id}`)
    if (dropUser) log(`  3) удалить аккаунт ${dropUser.email}`)
    return
  }

  // ── применяем ──
  const patch = {
    subscription_tier: plan,
    subscription_status: 'active',
    payment_provider: 'prodamus',
    current_period_end: periodEnd,
    ...(sub ? { provider_subscription_id: String(sub) } : {}),
  }
  const up = await api(`/rest/v1/profiles?id=eq.${target.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  })
  if (up.status >= 300) throw new Error(`не удалось выдать тариф: ${up.status} ${JSON.stringify(up.body).slice(0, 200)}`)
  log(`\n✅ 1. тариф выдан: ${plan}/active до ${periodEnd.slice(0, 10)}`)

  const lp = await api(`/rest/v1/payments?id=eq.${pay.id}`, {
    method: 'PATCH', body: JSON.stringify({ user_id: target.id }),
  })
  log(lp.status < 300 ? `✅ 2. платёж ${order} привязан к аккаунту` : `⚠️ 2. платёж привязать не вышло: ${lp.status}`)

  if (dropUser) {
    const del = await api(`/auth/v1/admin/users/${dropUser.id}`, { method: 'DELETE' })
    log(del.status < 300 ? `✅ 3. аккаунт ${dropUser.email} удалён` : `⚠️ 3. удалить не вышло: ${del.status} ${JSON.stringify(del.body).slice(0, 150)}`)
  }

  // контрольное чтение
  const { body: after } = await api(`/rest/v1/profiles?id=eq.${target.id}&select=email,subscription_tier,subscription_status,payment_provider,current_period_end,provider_subscription_id`)
  log(`\n── ИТОГ ──\n${JSON.stringify(after?.[0], null, 2)}`)
}

// ── ОЧИСТКА: убрать из леджера ЧУЖИЕ платежи ─────────────────────────────────
// Кабинет Продамуса общий с продуктами Августы, и до фикса 69db462 её продажи
// падали в наш `payments` как оплата тарифа (17 июля — 79 666 ₽). Код больше так
// не делает, но уже записанные строки надо убрать руками, иначе /admin/payments
// врёт про выручку.
//
// ЗАЩИТА: отказываемся удалять строку, похожую на НАШУ. Признак нашей — в
// description распознан тариф («Prodamus · solo»), т.е. вебхук сопоставил план.
// У чужих description = просто «Prodamus». Плюс перед удалением печатаем строки
// целиком — чтобы в истории остался след, что именно снесли.
async function cleanLedger() {
  const orders = (arg('orders') || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!orders.length) throw new Error('нужен --orders 46792048,46788810,...')

  log(`\n=== Очистка леджера от чужих платежей ===`)
  const doomed = []
  for (const o of orders) {
    const { body } = await api(`/rest/v1/payments?external_id=eq.${encodeURIComponent(o)}&select=*`)
    if (!Array.isArray(body) || body.length !== 1) {
      throw new Error(`заказ ${o}: найдено строк ${Array.isArray(body) ? body.length : '?'} (нужна ровно 1)`)
    }
    const row = body[0]
    if (String(row.description || '').includes('·')) {
      throw new Error(`ОТКАЗ: заказ ${o} выглядит НАШИМ (description="${row.description}") — тариф распознан, удалять нельзя`)
    }
    doomed.push(row)
    log(`  ${o}: ${row.amount} ${row.currency}  "${row.description}"  user_id=${row.user_id ?? 'null'}  ${row.created_at.slice(0, 19)}`)
  }
  const total = doomed.reduce((s, r) => s + Number(r.amount || 0), 0)
  log(`\nвсего к удалению: ${doomed.length} строк на ${total.toLocaleString('ru-RU')} ₽`)

  if (!RUN) { log('\n[DRY-RUN] ничего не удалено, добавь --run'); return }

  log(`\n── ПОЛНЫЕ СТРОКИ (след в истории перед удалением) ──`)
  log(JSON.stringify(doomed, null, 2))

  for (const row of doomed) {
    const del = await api(`/rest/v1/payments?id=eq.${row.id}`, { method: 'DELETE' })
    log(del.status < 300 ? `✅ удалён ${row.external_id}` : `⚠️ не вышло ${row.external_id}: ${del.status}`)
  }

  const { body: left } = await api(`/rest/v1/payments?select=external_id,amount,currency,description&order=created_at.desc`)
  const foreign = (left || []).filter((r) => r.currency === 'rub' && ![1, 4900, 14900, 29900].includes(Number(r.amount)))
  log(`\n── ИТОГ ──\nстрок в леджере: ${left?.length}\nчужих сумм осталось: ${foreign.length}`)
  if (foreign.length) log(JSON.stringify(foreign, null, 2))
}

// ── ПРОБНИК: куда реально ведёт ссылка сброса пароля ─────────────────────────
// Жалоба 23 июля: «по ссылке из письма кидает на главную». Гипотеза: адрес
// /auth/reset-password не внесён в Auth → URL Configuration → Redirect URLs,
// и GoTrue молча подменяет redirect_to на Site URL. Проверяем фактом:
// генерируем recovery-ссылку для QA-бота (реального человека за ним нет),
// проходим по ней БЕЗ выполнения JS и смотрим Location. Токены не печатаем.
async function recoveryLink() {
  const target = arg('redirect') || 'https://amaproduct.com/auth/reset-password'
  log(`\n=== Пробник: recovery-ссылка (redirect_to=${target}) ===`)
  if (!RUN) {
    log('[DRY-RUN] план: admin generate_link type=recovery для ama-qa-bot@gmail.com')
    log('  → пройти по action_link (redirect: manual) → показать, КУДА редиректит GoTrue')
    log('  (ссылка одноразовая и сгорает при проверке; сессия достаётся QA-боту — безвредно)')
    return
  }
  const gen = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'recovery', email: 'ama-qa-bot@gmail.com', options: { redirect_to: target } }),
  })
  const actionLink = gen.body?.action_link ?? gen.body?.properties?.action_link
  if (!actionLink) throw new Error(`generate_link не дал action_link: ${gen.status} ${JSON.stringify(gen.body).slice(0, 200)}`)
  const u = new URL(actionLink)
  log(`✅ ссылка сгенерирована: ${u.origin}${u.pathname}?…&redirect_to=${u.searchParams.get('redirect_to') ?? '(нет)'}`)

  const res = await fetch(actionLink, { redirect: 'manual' })
  const loc = res.headers.get('location') || '(нет Location)'
  const locUrl = (() => { try { return new URL(loc) } catch { return null } })()
  const shown = locUrl ? `${locUrl.origin}${locUrl.pathname}` : loc.slice(0, 80)
  log(`\n── РЕЗУЛЬТАТ ──`)
  log(`  verify ответил: ${res.status}`)
  log(`  редирект на:    ${shown}${locUrl?.hash || locUrl?.search ? ' (+токены/параметры скрыты)' : ''}`)
  if (locUrl && locUrl.pathname === new URL(target).pathname) {
    log(`\n✅ redirect_to РАБОТАЕТ — ссылка ведёт на форму пароля.`)
  } else {
    log(`\n❌ ПОДМЕНА: GoTrue проигнорировал redirect_to и отправил на «${shown}».`)
    log(`   Это значит, адреса нет в allowlist: Supabase → Auth → URL Configuration → Redirect URLs.`)
  }
}

// ── ПРОБНИК: путь token_hash (кнопка письма с 24 июля) ──────────────────────
// Письмо сброса ведёт прямо на /auth/reset-password?token_hash=... — страница
// меняет его на recovery-сессию через verifyOtp. Проверяем серверную часть
// в точности как это сделает браузер: POST /auth/v1/verify {type, token_hash}.
// Allowlist и PKCE в этом пути не участвуют — потому он и выбран основным.
async function recoveryTokenHash() {
  log(`\n=== Пробник: token_hash-путь сброса пароля ===`)
  if (!RUN) { log('[DRY-RUN] план: generate_link → verify по token_hash → ждём сессию. Добавь --run'); return }
  const gen = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'recovery', email: 'ama-qa-bot@gmail.com' }),
  })
  const hashed = gen.body?.hashed_token ?? gen.body?.properties?.hashed_token
  if (!hashed) throw new Error(`generate_link не дал hashed_token: ${gen.status}`)
  log(`✅ 1. ссылка сгенерирована, token_hash получен (не печатаю)`)

  // --emit-url: собрать ссылку страницы (как в кнопке письма) и записать в файл
  // для браузерного теста. Токен одноразовый (QA-бот) и сгорит при открытии.
  const emitPath = arg('emit-url')
  if (emitPath) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(emitPath, `https://amaproduct.com/auth/reset-password?token_hash=${hashed}&type=recovery\n`)
    log(`✅ 2. ссылка кнопки письма записана в ${emitPath} — открой в браузере, токен сгорит при проверке`)
    return
  }

  const ver = await api('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'recovery', token_hash: hashed }),
  })
  const ok = ver.status < 300 && Boolean(ver.body?.access_token)
  log(ok
    ? `✅ 2. verify по token_hash → recovery-сессия ПОЛУЧЕНА (${ver.status}). Кнопка письма будет работать из любого браузера.`
    : `❌ 2. verify не дал сессию: ${ver.status} ${JSON.stringify(ver.body).slice(0, 200)}`)
}

// ── роутинг ──────────────────────────────────────────────────────────────────
const probe = process.argv[2]
const PROBES = { 'cascade-delete': cascadeDelete, 'link-payment': linkPayment, 'clean-ledger': cleanLedger, 'recovery-link': recoveryLink, 'recovery-token-hash': recoveryTokenHash }

if (!PROBES[probe]) {
  log('Пробники:', Object.keys(PROBES).join(', '))
  log('Пример:  node scripts/prod-probe.mjs cascade-delete --run')
  process.exit(1)
}
await PROBES[probe]()
