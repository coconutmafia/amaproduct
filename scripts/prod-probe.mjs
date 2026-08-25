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

// ── ПРОБНИК: лимит загрузки Storage (после Supabase Pro) ─────────────────────
// Проверяет, что глобальный «Upload file size limit» в панели реально поднят:
// заливает синтетический файл --mb N (дефолт 60 — больше старого потолка 50)
// в private-бакет materials под PROBE_PREFIX и тут же удаляет. Free-потолок
// или неподнятый лимит дадут ошибку — увидим её здесь, а не от клиента.
//   node scripts/prod-probe.mjs storage-limit [--mb 60] [--run]
async function storageLimit() {
  const mb = Number(arg('mb') || 60)
  const path = `${PROBE_PREFIX}limit-${Date.now()}.bin`
  log(`\n=== Пробник: лимит Storage (${mb} МБ → materials/${path}) ===`)
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log(`  1) storage: залить ${mb} МБ в materials/${path}`)
    log('  2) storage: удалить файл (чистим за собой всегда)')
    return
  }
  const buf = new Uint8Array(mb * 1024 * 1024) // нули — содержимое не важно
  const up = await fetch(`${U}/storage/v1/object/materials/${path}`, {
    method: 'POST',
    headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/octet-stream' },
    body: buf,
  })
  const upBody = await up.text()
  log(up.ok
    ? `✅ 1. загрузка ${mb} МБ прошла (${up.status}) — лимит панели поднят, файлы больше 50 МБ ходят`
    : `❌ 1. загрузка отбита: ${up.status} ${upBody.slice(0, 200)} — проверь «Upload file size limit» в панели`)
  const del = await fetch(`${U}/storage/v1/object/materials/${path}`, {
    method: 'DELETE',
    headers: { apikey: K, Authorization: `Bearer ${K}` },
  })
  log(del.ok ? '✅ 2. тестовый файл удалён' : `⚠️ 2. не удалился (${del.status}) — удали руками: materials/${path}`)
}

// ── ПРОБНИК: живой смоук шага исследования (table1 + save) ───────────────────
// Родился 31 июля: у клиентки падало «Создать таблицу», телеметрия шага была
// слепой, и причину пришлось ГАДАТЬ. Этот смоук гоняет реальный путь прода
// под QA-ботом: логин без пароля → временный проект → research-analyze
// table1 (живой Claude-вызов, ~$0.05) → save → проверка материалов → уборка.
// Ошибка любого шага печатается целиком (и с 31 июля дублируется в error_events).
//   node scripts/prod-probe.mjs research-smoke [--run]
async function researchSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: живой смоук исследования (table1 + save) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия (пароль не нужен)')
    log('  2) создать временный проект ama-probe-research-*')
    log(`  3) POST ${APP}/api/jobs/research-table (фоновый джоб, как клиент с 24.08) → поллинг`)
    log('  4) step=save → проверить, что материалы появились')
    log('  5) удалить материалы и проект')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  // 1) сессия QA-бота без пароля
  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  // 2) временный проект от имени QA-бота
  const qaId = ver.user?.id
  const projName = `${PROBE_PREFIX}research-${Date.now()}`
  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: qaId, name: projName, niche: 'смоук', status: 'active' }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) { log('❌ 2. проект не создался:', prj.status, JSON.stringify(prj.body).slice(0, 200)); return }
  log(`✅ 2. проект ${projName}`)

  const cleanup = async () => {
    await api(`/rest/v1/project_materials?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: материалы и проект удалены')
  }

  try {
    const transcription = [
      'Участница: Мария, 34 года, Санкт-Петербург.',
      'Вопрос: чем занимаешься? Ответ: преподаю йогу шесть лет, две студии, утренние группы.',
      'Вопрос: что сейчас самое сложное? Ответ: не хватает новых учениц, все приходят по сарафану, соцсети не веду.',
      'Вопрос: что уже пробовала? Ответ: делала таргет через знакомую, слила пятнадцать тысяч, заявок ноль, очень разочаровалась.',
    ].join('\n')

    // 3) table1 — тем же путём, что клиент с 24.08: фоновый джоб + поллинг
    let t0 = Date.now()
    const start = await fetch(`${APP}/api/jobs/research-table`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, parts: [{ name: 'Интервью', text: transcription }] }),
    })
    const startBody = await start.json().catch(() => null)
    if (start.status !== 202 || !startBody?.jobId) {
      log(`❌ 3. research-table job не создался: HTTP ${start.status}`)
      log('   тело:', JSON.stringify(startBody).slice(0, 300))
      return
    }
    let t1body = null
    const deadline = Date.now() + 5 * 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000))
      const st = await fetch(`${APP}/api/jobs/${startBody.jobId}`, { headers: { cookie } })
        .then(r => r.json()).catch(() => null)
      const job = st?.job
      if (!job) continue
      if (job.status === 'done') { t1body = { table1: job.result?.table1 }; break }
      if (job.status === 'error') { log(`❌ 3. джоб упал: ${job.error}`); return }
    }
    if (!t1body?.table1?.respondents?.length) {
      log(`❌ 3. джоб не дособрался за 5 минут или пустая таблица`)
      return
    }
    log(`✅ 3. table1 (джоб+поллинг) ок за ${((Date.now() - t0) / 1000).toFixed(1)}с (участников: ${t1body.table1.respondents?.length})`)

    // 4) save — вставка материалов + мастер-таблица
    t0 = Date.now()
    const sv = await fetch(`${APP}/api/ai/research-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, step: 'save', transcription, table1: t1body.table1 }),
    })
    const svBody = await sv.json().catch(() => null)
    if (!sv.ok) {
      log(`❌ 4. save УПАЛ: HTTP ${sv.status} за ${((Date.now() - t0) / 1000).toFixed(1)}с`)
      log('   тело:', JSON.stringify(svBody).slice(0, 400))
      return
    }
    const mats = await api(`/rest/v1/project_materials?select=title,material_type&project_id=eq.${projectId}`)
    const kinds = (mats.body || []).map((m) => m.material_type).sort().join(', ')
    log(`✅ 4. save ок за ${((Date.now() - t0) / 1000).toFixed(1)}с; материалов: ${mats.body?.length} (${kinds})`)
    log('\n🎉 ПУТЬ ЖИВ: расшифровка → таблица → сохранение работают на проде прямо сейчас.')
  } finally {
    await cleanup()
  }
}

// ── ПРОБНИК: живой смоук карты смыслов (формат урока, форс-тул) ──────────────
// Проверяет НОВЫЙ generate_meanings (3 августа): SSE-стрим → форс-тул →
// материал в формате урока ([БОЛИ] Общая формулировка / — «формулировка» /
// Идея контента: …). Сетап без AI-затрат (кастдев-таблица вставляется через
// REST), сам вызов — один живой Claude (~$0.03).
async function meaningsSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: живой смоук карты смыслов (формат урока) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия')
    log('  2) временный проект ama-probe-meanings-* + синтетическая кастдев-таблица (REST)')
    log(`  3) POST ${APP}/api/ai/research-analyze step=generate_meanings (202 → поллинг meanings_status)`)
    log('  4) проверить материал: формат урока ([БОЛИ] … / — «…» / Идея контента), есть потребности')
    log('  5) удалить материалы и проект')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  const qaId = ver.user?.id
  const projName = `${PROBE_PREFIX}meanings-${Date.now()}`
  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: qaId, name: projName, niche: 'смоук', status: 'active' }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) { log('❌ 2. проект не создался:', prj.status, JSON.stringify(prj.body).slice(0, 200)); return }

  // Синтетическая кастдев-таблица: две участницы с пересекающейся болью —
  // проверяем ГРУППИРОВКУ (одна общая формулировка, две строки формулировок).
  const tableText = [
    'Участник: Мария (Женщина, 34 года, преподаёт йогу)',
    '',
    '  Вопрос: Что тебя не устраивает сейчас?',
    '  Ответ: Не хватает новых учениц, все приходят только по сарафану, соцсети не веду — руки не доходят.',
    '  Цитаты: все по сарафану | соцсети не веду',
    '  Тон: тревога',
    '',
    '  Вопрос: А как ты хочешь, чтобы было?',
    '  Ответ: Хочу стабильный поток заявок из блога, чтобы не зависеть от сарафана.',
    '  Цитаты: стабильный поток заявок',
    '  Тон: желание',
    '',
    '---',
    '',
    'Участник: Ольга (Женщина, 41 год, нутрициолог)',
    '',
    '  Вопрос: Что тебя не устраивает?',
    '  Ответ: Клиенты приходят случайно, через знакомых, блог не ведётся, продвигаться не умею.',
    '  Цитаты: приходят случайно | продвигаться не умею',
    '  Тон: бессилие',
    '',
    '  Вопрос: Что тебе важно при выборе наставника?',
    '  Ответ: Чтобы всё было по шагам и понятно, я боюсь сложных схем и что не справлюсь.',
    '  Цитаты: по шагам и понятно | боюсь что не справлюсь',
    '  Тон: страх',
  ].join('\n')
  const mat = await api('/rest/v1/project_materials', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      project_id: projectId,
      title: 'Таблица исследования · смоук',
      material_type: 'audience_research',
      raw_content: tableText,
      processing_status: 'ready',
    }),
  })
  const matId = Array.isArray(mat.body) ? mat.body[0]?.id : mat.body?.id
  if (!matId) { log('❌ 2b. кастдев-таблица не вставилась:', mat.status); return }
  log(`✅ 2. проект ${projName} + кастдев-таблица`)

  const cleanup = async () => {
    await api(`/rest/v1/project_materials?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: материалы и проект удалены')
  }

  try {
    const t0 = Date.now()
    const res = await fetch(`${APP}/api/ai/research-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, step: 'generate_meanings' }),
    })
    // Контракт 17.08: 202 + фоновая сборка в after(), статус поллится
    // step=meanings_status (переход processing → ready/error).
    if (res.status !== 202) {
      log(`❌ 3. generate_meanings HTTP ${res.status} (ждали 202)`)
      log('   тело:', (await res.text().catch(() => '')).slice(0, 300))
      return
    }
    let done = false, errMsg = ''
    const deadline = Date.now() + 8 * 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000))
      const st = await fetch(`${APP}/api/ai/research-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ projectId, step: 'meanings_status' }),
      }).then(r => r.json()).catch(() => null)
      if (!st) continue
      if (st.status === 'ready') { done = true; break }
      if (st.status === 'error') { errMsg = st.error || 'error'; break }
    }
    if (errMsg) { log(`❌ 3. фоновая сборка упала за ${((Date.now() - t0) / 1000).toFixed(1)}с: ${errMsg}`); return }
    if (!done) { log('❌ 3. карта не дособралась за 8 минут'); return }
    log(`✅ 3. generate_meanings (фон + поллинг) отработал за ${((Date.now() - t0) / 1000).toFixed(1)}с`)

    const check = await api(`/rest/v1/project_materials?select=raw_content,processing_status&project_id=eq.${projectId}&material_type=eq.meanings_map`)
    const map = Array.isArray(check.body) ? check.body[0] : null
    if (!map || map.processing_status !== 'ready') {
      log('❌ 4. материал карты не ready:', JSON.stringify(check.body).slice(0, 200))
      return
    }
    const txt = map.raw_content || ''
    const hasLessonHeader = /\[(БОЛИ|ХОТЕЛКИ, ПОТРЕБНОСТИ|ТРИГГЕРЫ|ВОЗРАЖЕНИЯ|ВАШИ ПРЕИМУЩЕСТВА)\]/.test(txt)
    const rowsCount = (txt.match(/^—\s*«/gm) || []).length
    const ideas = (txt.match(/Идея контента:/g) || []).length
    const hasNeeds = /\[ХОТЕЛКИ, ПОТРЕБНОСТИ\]/.test(txt)
    log(`   формат урока: ${hasLessonHeader ? 'да' : 'НЕТ'}; формулировок-строк: ${rowsCount}; идей: ${ideas}; потребности: ${hasNeeds ? 'есть' : 'НЕТ'}`)
    log('   превью:', txt.slice(0, 220).replace(/\n/g, ' | '))
    if (hasLessonHeader && rowsCount >= 3 && ideas >= 3) {
      log('\n🎉 КАРТА ПО УРОКУ ЖИВА: группировка, строки-формулировки и идеи на месте.')
    } else {
      log('\n⚠️ Карта собралась, но формат неполный — смотри превью выше.')
    }
  } finally {
    await cleanup()
  }
}

// ── ПРОБНИК-МИГРАЦИЯ: пересборка всех карт смыслов по слайд-канону ──────────
// «Да, пересобери все» (Матвей, 3 августа): в проде лежат карты старого
// формата (до правок по видеоурокам). Для каждого проекта с картой пробник
// генерит сессию ВЛАДЕЛЬЦА (magiclink+otp, письмо НЕ отправляется) и зовёт
// ровно тот же серверный generate_meanings, что и кнопка «Обновить карту» —
// промпт/формат/RLS не дублируются. Дубли карт с одинаковым title чистятся
// заранее (upsert падает на maybeSingle при >1 строке).
// ⚠️ Исключение из правила «трогаем только ama-probe-*»: пишет в клиентские
// проекты — на это есть явное «да» владельца продукта в чате 3 августа.
async function rebuildMeanings() {
  const APP = 'https://amaproduct.com'
  // --project <id>: пересобрать ТОЛЬКО один проект (17.08, точечная починка
  // карты Кристины Маринич) — без флага, как раньше, все проекты с картами.
  const onlyProject = arg('project')
  log('\n=== Пробник-миграция: пересборка карт смыслов (слайд-канон) ===')
  if (onlyProject) log(`режим: только проект ${onlyProject}`)

  const { body: maps } = await api('/rest/v1/project_materials?select=id,project_id,title,created_at&material_type=eq.meanings_map&order=created_at.desc')
  const byProject = new Map()
  for (const m of (maps || [])) {
    if (onlyProject && m.project_id !== onlyProject) continue
    if (!byProject.has(m.project_id)) byProject.set(m.project_id, [])
    byProject.get(m.project_id).push(m)
  }
  const { body: projects } = await api('/rest/v1/projects?select=id,name,owner_id&id=in.(' + [...byProject.keys()].join(',') + ')')
  const names = Object.fromEntries((projects || []).map(p => [p.id, p.name]))
  const owners = Object.fromEntries((projects || []).map(p => [p.id, p.owner_id]))

  log(`Проектов с картами: ${byProject.size}, карт всего: ${(maps || []).length}`)
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    for (const [pid, list] of byProject) {
      log(`  • ${names[pid] || pid}: карт ${list.length}${list.length > 1 ? ' (дубли будут подчищены, останется свежая)' : ''} → сессия владельца → generate_meanings → проверка формата`)
    }
    return
  }

  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY'); return }
  const ref = new URL(U).hostname.split('.')[0]

  let ok = 0, fail = 0
  for (const [pid, list] of byProject) {
    const name = names[pid] || pid
    try {
      // 0) дубли одной карты (одинаковый title) — оставить самую свежую
      const byTitle = new Map()
      for (const m of list) {
        if (!byTitle.has(m.title)) byTitle.set(m.title, [])
        byTitle.get(m.title).push(m)
      }
      for (const [, dupes] of byTitle) {
        for (const extra of dupes.slice(1)) { // list отсортирован desc — первый свежий
          await api(`/rest/v1/project_materials?id=eq.${extra.id}`, { method: 'DELETE' })
          log(`  🧹 ${name}: удалён дубль карты ${extra.id} (${extra.created_at.slice(0, 10)})`)
        }
      }

      // 1) сессия владельца (письмо не шлётся — otp приходит в ответе)
      const { body: ownerData } = await api(`/auth/v1/admin/users/${owners[pid]}`)
      const email = ownerData?.email
      if (!email) throw new Error('не нашёл email владельца')
      const gl = await api('/auth/v1/admin/generate_link', {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', email }),
      })
      const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
      if (!otp) throw new Error('generate_link не дал otp')
      const ver = await fetch(`${U}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', email, token: otp }),
      }).then(r => r.json())
      if (!ver?.access_token) throw new Error('verify не дал сессию')
      const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`

      // 2) тот же путь, что кнопка «Обновить карту» (контракт 17.08: 202 +
      //    фоновая сборка, статус — step=meanings_status до ready/error)
      const t0 = Date.now()
      const res = await fetch(`${APP}/api/ai/research-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ projectId: pid, step: 'generate_meanings' }),
      })
      if (res.status !== 202) throw new Error(`HTTP ${res.status} (ждали 202): ${(await res.text().catch(() => '')).slice(0, 120)}`)
      let done = false, errMsg = ''
      const deadline = Date.now() + 8 * 60_000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000))
        const st = await fetch(`${APP}/api/ai/research-analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ projectId: pid, step: 'meanings_status' }),
        }).then(r => r.json()).catch(() => null)
        if (!st) continue
        if (st.status === 'ready') { done = true; break }
        if (st.status === 'error') { errMsg = st.error || 'error'; break }
      }
      if (errMsg) throw new Error(errMsg)
      if (!done) throw new Error('карта не дособралась за 8 минут')

      // 3) проверка формата
      const { body: check } = await api(`/rest/v1/project_materials?select=raw_content,processing_status&project_id=eq.${pid}&material_type=eq.meanings_map&limit=1`)
      const txt = check?.[0]?.raw_content || ''
      const canon = /\[(БОЛИ|ХОТЕЛКИ, ПОТРЕБНОСТИ|ТРИГГЕРЫ|ВОЗРАЖЕНИЯ|ВАШИ ПРЕИМУЩЕСТВА)\]/.test(txt) && /^—\s*«/m.test(txt)
      const rows = (txt.match(/^—\s*«/gm) || []).length
      log(`  ${canon ? '✅' : '⚠️'} ${name}: ${((Date.now() - t0) / 1000).toFixed(0)}с, формулировок ${rows}, слайд-канон: ${canon ? 'да' : 'НЕТ'}`)
      canon ? ok++ : fail++
    } catch (e) {
      fail++
      log(`  ❌ ${name}: ${String(e.message || e).slice(0, 160)}`)
    }
  }
  log(`\nИтог: пересобрано ${ok}, с проблемами ${fail}. Старые карты заменены только там, где сборка прошла.`)
}

// ── ИНСТРУМЕНТ: ручная выдача доступа новому юзеру ──────────────────────────
// Процедура «как мы это делали» (уточнена Матвеем 9 августа после того, как
// ассистент додумал не то): СОЗДАТЬ аккаунт, ЗАДАТЬ ПАРОЛЬ, отдать владельцу
// логин+пароль; условия клиента = 2 МЕСЯЦА ТРИАЛА (trialing / trial /
// trial_ends_at=+60 дней) — как у ручных lana/natalia/arefeva. По истечении
// chain-watch сам переведёт в view_only. НЕ копировать профиль команды
// (producer/2027) — это только для своих, явным флагом --tier producer.
//
// Использование:
//   node scripts/prod-probe.mjs grant-access --email user@mail.com [--days 60] [--tier producer] [--run]
// Пароль генерируется и печатается в конце — передать владельцу.
async function grantAccess() {
  const email = (arg('email') || '').trim().toLowerCase()
  const days = Number(arg('days') || 60)
  const teamTier = arg('tier') // 'producer' — профиль команды, БЕЗ триала
  log('\n=== Инструмент: выдача доступа (аккаунт + пароль) ===')
  if (!email || !email.includes('@')) { log('❌ укажи --email user@mail.com'); return }
  log(`email: ${email} | условия: ${teamTier ? `КОМАНДА (${teamTier}, до 2027-12-31)` : `клиентский триал ${days} дней`}`)

  let user = null
  for (let page = 1; page <= 10 && !user; page++) {
    const { body } = await api(`/auth/v1/admin/users?page=${page}&per_page=100`)
    const users = body?.users || []
    user = users.find(u => (u.email || '').toLowerCase() === email) || null
    if (users.length < 100) break
  }
  log(user ? `auth-юзер уже есть: ${user.id}` : 'auth-юзера нет — будет создан')

  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log(`  1) ${user ? 'обновить пароль существующему' : 'создать аккаунт (email подтверждён)'} + сгенерировать пароль`)
    log(`  2) профиль → ${teamTier ? `active / ${teamTier} / 2027-12-31` : `trialing / trial / +${days} дней`}`)
    log('  3) проверить вход паролем и платный гейт; напечатать логин+пароль')
    return
  }

  const { randomInt } = await import('node:crypto')
  const words = ['Sokol', 'Reka', 'Gora', 'Luna', 'Vetka', 'Polet', 'Zima', 'More', 'Sever', 'Iskra']
  const pw = `${words[randomInt(10)]}-${words[randomInt(10)]}-${randomInt(1000, 9999)}`

  if (!user) {
    const created = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, email_confirm: true, password: pw }),
    })
    if (!created.body?.id) { log(`❌ не создался: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`); return }
    user = created.body
    log(`✅ 1. аккаунт создан: ${user.id}`)
  } else {
    const pr = await api(`/auth/v1/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ password: pw }) })
    if (pr.status >= 300) { log(`❌ пароль не установился: ${pr.status}`); return }
    log('✅ 1. пароль обновлён существующему аккаунту')
  }

  const profile = teamTier
    ? { subscription_status: 'active', subscription_tier: teamTier, trial_ends_at: '2027-12-31T00:00:00+00:00' }
    : { subscription_status: 'trialing', subscription_tier: 'trial', trial_ends_at: new Date(Date.now() + days * 864e5).toISOString() }
  const upd = await api(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(profile),
  })
  const prof = Array.isArray(upd.body) ? upd.body[0] : null
  if (!prof) { log(`❌ профиль не обновился: ${upd.status} ${JSON.stringify(upd.body).slice(0, 200)}`); return }
  log(`✅ 2. профиль: ${prof.subscription_status} / ${prof.subscription_tier} / до ${String(prof.trial_ends_at).slice(0, 10)}`)

  // Проверка фактом: вход паролем
  const anon = (() => {
    const txt2 = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt2.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  const login = await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  }).then(r => r.json())
  log(login.access_token ? '✅ 3. вход по паролю проверен' : `❌ 3. вход не сработал: ${JSON.stringify(login).slice(0, 120)}`)

  log(`\nЛОГИН:  ${email}`)
  log(`ПАРОЛЬ: ${pw}`)
}

// ── ИНСТРУМЕНТ: канонизация вопросов кастдевов проекта ───────────────────────
// Файл Дарьи (11 августа): table1 формулировал один и тот же вопрос по-разному
// в разных кастдевах → сводка 45 колонок с дырами. Промпт-канонизация чинит
// БУДУЩИЕ кастдевы; этот инструмент чистит УЖЕ НАКОПЛЕННЫЕ: Claude группирует
// вопросы проекта в канонические, затем строки «Вопрос: X» переписываются на
// канонические во всех research-материалах проекта (ОТВЕТЫ НЕ ТРОГАЮТСЯ).
//
//   node scripts/prod-probe.mjs canon-questions --project <id> [--run]
async function canonQuestions() {
  const projectId = arg('project')
  log('\n=== Инструмент: канонизация вопросов кастдевов ===')
  if (!projectId) { log('❌ укажи --project <id>'); return }

  const { body: mats } = await api(`/rest/v1/project_materials?select=id,title,raw_content&project_id=eq.${projectId}&material_type=eq.audience_research`)
  if (!Array.isArray(mats) || mats.length === 0) { log('❌ research-материалов нет'); return }
  const norm = (q) => q.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()
  const uniq = new Map()
  for (const m of mats) {
    for (const line of String(m.raw_content || '').matchAll(/^\s*Вопрос:\s*(.+)$/gm)) {
      const q = line[1].trim()
      if (!uniq.has(norm(q))) uniq.set(norm(q), q)
    }
  }
  const questions = [...uniq.values()]
  log(`материалов: ${mats.length}, уникальных формулировок вопросов: ${questions.length}`)
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) Claude (форс-тул): сгруппировать формулировки в канонические (~$0.02)')
    log('  2) заменить строки «Вопрос: X» на канонические во всех research-материалах')
    log('  3) показать колонки/заполненность сводки до и после')
    return
  }

  const anthropicKey = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^ANTHROPIC_API_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anthropicKey) { log('❌ нет ANTHROPIC_API_KEY'); return }

  const tool = {
    name: 'question_groups',
    description: 'Группы формулировок одного и того же вопроса',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              canonical: { type: 'string', description: 'Каноническая формулировка (лучшая из группы, обобщённая)' },
              variants:  { type: 'array', items: { type: 'string' }, description: 'ВСЕ формулировки группы дословно, включая каноническую' },
            },
            required: ['canonical', 'variants'],
          },
        },
      },
      required: ['groups'],
    },
  }
  const prompt = `Ниже — формулировки вопросов из кастдев-интервью ОДНОГО проекта. Модель формулировала один и тот же вопрос по-разному в разных интервью. Сгруппируй формулировки: в одну группу попадают только вопросы С ОДНИМ И ТЕМ ЖЕ СМЫСЛОМ (спрашивают об одном и том же). Вопросы с разным смыслом НЕ объединяй. Для каждой группы выбери каноническую формулировку — самую ясную и обобщённую. Каждая входная формулировка обязана попасть ровно в одну группу (группа из одной формулировки — нормально).

ФОРМУЛИРОВКИ:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 8000,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'question_groups' },
      messages: [{ role: 'user', content: prompt }],
    }),
  }).then(r => r.json())
  const block = (resp.content || []).find(b => b.type === 'tool_use')
  const groups = block?.input?.groups || []
  if (!groups.length) { log('❌ Claude не вернул группы:', JSON.stringify(resp).slice(0, 300)); return }
  const mapping = new Map() // norm(вариант) → каноническая
  let merged = 0
  for (const g of groups) {
    for (const v of (g.variants || [])) {
      if (norm(v) !== norm(g.canonical)) merged++
      mapping.set(norm(v), g.canonical)
    }
  }
  log(`✅ 1. групп: ${groups.length} (слито вариаций: ${merged})`)

  // Замена в материалах — построчно, только строки «Вопрос:»
  let changedMats = 0
  for (const m of mats) {
    const before = String(m.raw_content || '')
    const after = before.replace(/^(\s*Вопрос:\s*)(.+)$/gm, (full, pre, q) => {
      const canon = mapping.get(norm(q.trim()))
      return canon ? `${pre}${canon}` : full
    })
    if (after !== before) {
      const upd = await api(`/rest/v1/project_materials?id=eq.${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ raw_content: after }),
      })
      if (upd.status < 300) changedMats++
      else log(`  ⚠️ не обновился «${m.title}»: ${upd.status}`)
    }
  }
  log(`✅ 2. материалов переписано: ${changedMats} из ${mats.length}`)
  log('Проверь сводку повторным скачиванием — колонки должны схлопнуться.')
}

// ── ПРОБНИК: живой смоук английского языка (задача 13 августа) ───────────────
// Проверяет мандат «на английском ВСЁ работает как на русском»: временный
// проект с content_language='en' → (1) ToV из английских текстов выходит
// АНГЛИЙСКИМ с дословными цитатами; (2) сгенерённый пост — английский, без
// em dash и EN-GPT-измов; (3) рилз — английские реплики; (4) карусель-структура
// не переводит английский текст. Требует применённой миграции 038.
async function englishSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: английский язык первым классом (миграция 038) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия')
    log('  2) временный проект ama-probe-english-* с content_language=en (упадёт, если 038 не применена)')
    log(`  3) POST ${APP}/api/ai/extract-tone-of-voice с 4 английскими текстами → ToV должен выйти английским`)
    log(`  4) POST ${APP}/api/ai/chat genFormat=post (боевой путь) → английский, без «—», без "it's not just"`)
    log(`  5) POST ${APP}/api/ai/chat genFormat=reels → английская раскадровка (Scene 1…)`)
    log(`  6) POST ${APP}/api/carousel/structure с английским текстом → слайды не переведены`)
    log('  7) удалить контент, style_examples, материалы и проект')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  const qaId = ver.user?.id
  const projName = `${PROBE_PREFIX}english-${Date.now()}`
  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_id: qaId, name: projName, status: 'active',
      niche: 'Contemporary abstract painting, acrylic on canvas',
      content_language: 'en',
    }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) {
    const errTxt = JSON.stringify(prj.body || '')
    if (/content_language/.test(errTxt) || prj.status === 400) {
      log(`❌ 2. проект с content_language не создался (HTTP ${prj.status}).`)
      log('   ПОХОЖЕ, МИГРАЦИЯ 038 НЕ ПРИМЕНЕНА: supabase/migrations/038_project_content_language.sql')
      log('   Применить в Supabase SQL editor и перезапустить пробник.')
    } else {
      log('❌ 2. проект не создался:', prj.status, errTxt.slice(0, 200))
    }
    return
  }
  log(`✅ 2. проект ${projName} (content_language=en)`)

  // genFormat-чат метерит юниты и заводит ящики chat_gen — вернуть/убрать в уборке
  const genJobs = []
  const usedRow = await api(`/rest/v1/profiles?select=generations_used&id=eq.${qaId}`)
  const usedBefore = Array.isArray(usedRow.body) ? usedRow.body[0]?.generations_used : null

  const cleanup = async () => {
    await api(`/rest/v1/content_items?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/style_examples?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/project_materials?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    for (const j of genJobs) await api(`/rest/v1/jobs?id=eq.${j}`, { method: 'DELETE' }).catch(() => {})
    if (typeof usedBefore === 'number') {
      await api(`/rest/v1/profiles?id=eq.${qaId}`, { method: 'PATCH', body: JSON.stringify({ generations_used: usedBefore }) }).catch(() => {})
    }
    log('🧹 уборка: контент, примеры стиля, материалы, проект, ящики чата удалены; юниты QA возвращены')
  }

  // Метрики языка/GPT-измов
  const latinShare = (s) => {
    const letters = (String(s).match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length
    return letters ? (String(s).match(/[a-zA-Z]/g) || []).length / letters : 0
  }
  const enTells = (s) => {
    const hits = []
    if (/—/.test(s)) hits.push('em dash «—»')
    if (/it'?s not just/i.test(s)) hits.push('"it\'s not just"')
    if (/here'?s the thing/i.test(s)) hits.push('"here\'s the thing"')
    if (/let'?s dive in/i.test(s)) hits.push('"let\'s dive in"')
    if (/#[a-z0-9_]+/i.test(s)) hits.push('хэштеги')
    return hits
  }
  const readSSE = async (res) => {
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = '', done = false, errMsg = ''
    while (true) {
      const { value, done: end } = await reader.read()
      if (end) break
      buf += dec.decode(value, { stream: true })
      for (const ev of buf.split('\n\n')) {
        const line = ev.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue
        try {
          const m = JSON.parse(line.slice(6))
          if (m.type === 'done') done = true
          if (m.type === 'error') errMsg = m.message || 'error'
        } catch { /* ping */ }
      }
    }
    return { done, errMsg }
  }

  try {
    // ── 3. ToV из английских текстов (сценарий Darina) ──────────────────────
    const units = [
      'Every person has something they can look at endlessly. For me, it is living water: its breath, its shimmer, its quiet movement under the light. I can stand by the sea for an hour and never get bored, watching how the surface keeps rewriting itself.',
      'I like looking at a painting as if I were stepping into it. To sense what it smells like there, whether the wind is moving through my hair, what the colours feel like on my skin. A painting is finished when I can walk inside it and stay a while.',
      'People often ask me why I paint flowers so large. Honestly, I paint them the size they feel. When you really look at a peony, when you give it your full attention, it stops being small. Attention changes the scale of things, and that is what my work is about.',
      'This series took me eight months. Some canvases waited in the corner for weeks until I understood what they were missing. I have learned not to rush them: paintings, like people, open up when they are ready, not when you demand it.',
    ]
    let t0 = Date.now()
    const tovRes = await fetch(`${APP}/api/ai/extract-tone-of-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, units }),
    })
    if (!tovRes.ok) {
      log(`❌ 3. extract-tone-of-voice HTTP ${tovRes.status}:`, (await tovRes.text().catch(() => '')).slice(0, 300))
      return
    }
    // С 24.08 роут отвечает 202 сразу, извлечение идёт в after() — поллим
    // материал, как клиент поллит /api/materials/tov-status (а не читаем SSE).
    let tov = null
    {
      const deadline = Date.now() + 4 * 60_000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 4000))
        const tovMat = await api(`/rest/v1/project_materials?select=raw_content,processing_status&project_id=eq.${projectId}&material_type=eq.tone_of_voice`)
        const m = Array.isArray(tovMat.body) ? tovMat.body[0] : null
        if (m?.processing_status === 'ready') { tov = m; break }
        if (m?.processing_status === 'error') { log('❌ 3. ToV упал:', String(m.raw_content).slice(0, 200)); return }
      }
    }
    if (!tov) { log('❌ 3. ToV не готов за 4 минуты'); return }
    const tovLatin = latinShare(tov.raw_content)
    const tovQuotes = /["“”'‘’«»]/.test(tov.raw_content)
    log(`✅ 3. ToV за ${((Date.now() - t0) / 1000).toFixed(1)}с: ${tov.raw_content.length} симв, латиницы ${(tovLatin * 100).toFixed(0)}%, цитаты: ${tovQuotes ? 'есть' : 'НЕТ'}`)
    log('   превью:', tov.raw_content.slice(0, 180).replace(/\n/g, ' | '))
    if (tovLatin < 0.7) { log('❌ ToV НЕ английский (ожидали ≥70% латиницы) — описание уехало в русский'); return }

    // ── 4-5. Пост и рилз ЧЕРЕЗ ЧАТ (genFormat) — боевой путь клиентов ────────
    // 25.08: сиротский /api/ai/generate удалён; юзеры генерят юниты чатом с
    // 02.06 — смоук обязан ходить тем же путём (правило Матвея: «проверки
    // всегда на актуальных адресах, которые используют юзеры»). genFormat
    // метерится: юниты QA возвращаем в уборке, ящики chat_gen удаляем.
    const chatGen = async (genFormat, ask) => {
      const res = await fetch(`${APP}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ projectId, genFormat, messages: [{ role: 'user', content: ask }] }),
      })
      if (!res.ok || !res.body) return { err: `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` }
      const genJob = res.headers.get('x-gen-job')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let text = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        text += dec.decode(value, { stream: true })
      }
      return { text, genJob }
    }

    t0 = Date.now()
    const post = await chatGen('post', 'Напиши пост для блога про то, почему я перестала писать картины «как продаётся» и что из этого вышло.')
    if (post.err) { log(`❌ 4. чат-пост: ${post.err}`); return }
    if (post.genJob) genJobs.push(post.genJob)
    const postLatin = latinShare(post.text)
    const postTells = enTells(post.text)
    log(`✅ 4. пост (чат) за ${((Date.now() - t0) / 1000).toFixed(1)}с: ${post.text.length} симв, латиницы ${(postLatin * 100).toFixed(0)}%${postTells.length ? `, ⚠️ GPT-измы: ${postTells.join(', ')}` : ', GPT-измов нет'}`)
    log('   превью:', post.text.slice(0, 180).replace(/\n/g, ' | '))
    if (postLatin < 0.7) { log('❌ ПОСТ НЕ АНГЛИЙСКИЙ — язык контента не прокинулся'); return }

    t0 = Date.now()
    const reels = await chatGen('reels', 'Сделай сценарий рилса про мастерскую: как рождается одна большая картина, от пустого холста до выставки.')
    if (reels.err) { log(`❌ 5. чат-рилз: ${reels.err}`); return }
    if (reels.genJob) genJobs.push(reels.genJob)
    const sceneCount = (reels.text.match(/scene\s+\d+|escena\s+\d+|szene\s+\d+|сцена\s+\d+/gi) || []).length
    const reelsLatin = latinShare(reels.text)
    const reelsTells = enTells(reels.text)
    log(`✅ 5. рилз (чат) за ${((Date.now() - t0) / 1000).toFixed(1)}с: сцен ${sceneCount}, латиницы ${(reelsLatin * 100).toFixed(0)}%${reelsTells.length ? `, ⚠️ GPT-измы: ${reelsTells.join(', ')}` : ', GPT-измов нет'}`)
    if (sceneCount < 3) { log('❌ 5. рилз без раскадровки (сцен < 3):', reels.text.slice(0, 160)); return }
    if (reelsLatin < 0.7) { log('❌ РИЛЗ НЕ АНГЛИЙСКИЙ (метки сцен должны быть Scene, не Сцена)'); return }

    // ── 6. Карусель-структура не переводит английский текст ─────────────────
    t0 = Date.now()
    const carText = [
      'Why I stopped painting what sells.',
      'Slide 2: For two years I painted safe bouquets, because they sold well and nobody argued with them.',
      'Slide 3: Then one collector told me she bought my painting because it felt like standing inside the rain. That sentence changed my studio.',
      'Slide 4: Now I paint what I can walk into, and the right people find it.',
    ].join('\n')
    const carRes = await fetch(`${APP}/api/carousel/structure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ text: carText, type: 'carousel' }),
    })
    const carBody = await carRes.json().catch(() => null)
    if (!carRes.ok || !carBody?.carousel) { log(`❌ 6. carousel/structure HTTP ${carRes.status}:`, JSON.stringify(carBody).slice(0, 200)); return }
    const slidesText = JSON.stringify(carBody.carousel)
    const carLatin = latinShare(slidesText.replace(/"(cover|slides|last_slide|headline|subheadline|body|text|action|emoji|slide|total_slides)"/g, ''))
    log(`✅ 6. карусель за ${((Date.now() - t0) / 1000).toFixed(1)}с: слайдов ${carBody.carousel.total_slides}, латиницы ${(carLatin * 100).toFixed(0)}%`)
    if (carLatin < 0.7) { log('❌ СЛАЙДЫ ПЕРЕВЕДЕНЫ НА РУССКИЙ — правило «язык исходника» не сработало'); return }

    log('\n🎉 АНГЛИЙСКИЙ ПЕРВЫМ КЛАССОМ ЖИВ: ToV английский, пост/рилз английские без EN-GPT-измов, карусель не переводит.')
  } finally {
    await cleanup()
  }
}

// ── ПРОБНИК: суggest-angles жив (регрессия инцидента 13.08) ──────────────────
// Инцидент: явный select с колонкой content_language до наката 038 ронял роут
// 404 для всех. Пробник бьёт живой suggest-angles на временном проекте БЕЗ
// content_language — должен вернуть углы, а не 404. Работает и до, и после 038.
async function anglesSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: suggest-angles отвечает (регрессия 13.08) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия')
    log('  2) временный проект ama-probe-angles-* (без content_language)')
    log(`  3) POST ${APP}/api/ai/suggest-angles → ждём текст с вариантами, НЕ 404`)
    log('  4) удалить проект')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }
  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST', body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: ver.user?.id, name: `${PROBE_PREFIX}angles-${Date.now()}`, niche: 'смоук', status: 'active' }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) { log('❌ 2. проект не создался:', prj.status); return }
  log('✅ 2. временный проект создан')
  try {
    const t0 = Date.now()
    const res = await fetch(`${APP}/api/ai/suggest-angles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, type: 'post', brief: 'почему клиенты уходят после первой консультации' }),
    })
    const body = await res.json().catch(() => null)
    if (res.status === 404) {
      log(`❌ 3. РЕГРЕССИЯ ИНЦИДЕНТА: suggest-angles снова 404 (${((Date.now() - t0) / 1000).toFixed(1)}с) — проверь select колонок`)
      return
    }
    if (!res.ok || !body?.text) {
      log(`❌ 3. suggest-angles HTTP ${res.status}:`, JSON.stringify(body).slice(0, 200))
      return
    }
    log(`✅ 3. углы пришли за ${((Date.now() - t0) / 1000).toFixed(1)}с: «${String(body.text).slice(0, 100).replace(/\n/g, ' ')}…»`)
    log('\n🎉 suggest-angles ЖИВ.')
  } finally {
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: проект удалён')
  }
}

// ── ИНСТРУМЕНТ: GET путей приложения глазами юзера (read-only репродукция) ───
// «У клиента не открывается» → смотрим ровно то, что видит его браузер:
// сессия юзера (magiclink+otp, письмо НЕ уходит) → GET страницы/API → статус,
// content-type, кусок тела. НИЧЕГО не пишет.
//   node scripts/prod-probe.mjs as-user <email> <path> [path2 ...] --run
async function asUser() {
  const APP = 'https://amaproduct.com'
  const email = (process.argv[3] || '').trim().toLowerCase()
  const paths = process.argv.slice(4).filter(a => a.startsWith('/') || a.startsWith('POST:'))
  log('\n=== Инструмент: GET/POST глазами юзера ===')
  if (!email || paths.length === 0) {
    log('Использование: node scripts/prod-probe.mjs as-user user@mail.com /dashboard "POST:/api/download-text:filename=a.txt&mime=text/plain&content=hi" --run')
    return
  }
  log(`юзер: ${email}; пути: ${paths.join(', ')}`)
  if (!RUN) { log('\n[DRY-RUN] сессию не создаю. Добавь --run.'); return }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY'); return }
  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST', body: JSON.stringify({ type: 'magiclink', email }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status, JSON.stringify(gl.body).slice(0, 150)); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ сессия получена')
  // Форма POST: путь вида "POST:/api/x:field=v&field2=v2" — воспроизводит
  // скрытую форму downloadTextViaServer (webview-безопасные скачивания 20.08)
  for (const p of paths) {
    const t0 = Date.now()
    const isPost = p.startsWith('POST:')
    const [, postPath, postBody] = isPost ? p.match(/^POST:([^:]+):(.*)$/s) ?? [] : []
    try {
      const res = isPost
        ? await fetch(APP + postPath, {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: postBody,
            redirect: 'manual',
          })
        : await fetch(APP + p, { headers: { cookie }, redirect: 'manual' })
      const ct = res.headers.get('content-type') || ''
      const body = await res.text()
      log(`\n— GET ${p} → ${res.status} (${((Date.now() - t0) / 1000).toFixed(1)}с, ${ct.split(';')[0]}, ${body.length} байт)`)
      if (res.status >= 300 && res.status < 400) log('   → redirect:', res.headers.get('location'))
      const slice = ct.includes('json') ? body.slice(0, 300) : body.replace(/\s+/g, ' ').slice(0, 300)
      log('   тело:', slice)
    } catch (e) {
      log(`\n— GET ${p} → FETCH УПАЛ за ${((Date.now() - t0) / 1000).toFixed(1)}с: ${e.message}`)
    }
  }
}

// ── ИНСТРУМЕНТ: точечная правка текста материала ─────────────────────────────
// ⚠️ Пишет в КЛИЕНТСКИЙ материал — только по явной задаче владельца (прецедент:
// canon-questions). Дефолт — dry-run с диффом; замена СТРОГО одного вхождения.
// Использование:
//   node scripts/prod-probe.mjs patch-material <materialId> <find> <replace> [--run]
// (17.08: профиль Кати у Олеси Солохиной — «мать-одиночка» выдумана моделью,
//  в расшифровке прямо упомянут муж.)
async function patchMaterial() {
  const [, , , materialId, find, replace] = process.argv
  log('\n=== Инструмент: точечная правка материала ===')
  if (!materialId || !find || replace === undefined) {
    log('Использование: node scripts/prod-probe.mjs patch-material <materialId> "<find>" "<replace>" [--run]')
    return
  }
  const { body } = await api(`/rest/v1/project_materials?id=eq.${materialId}&select=id,title,material_type,project_id,raw_content`)
  const mat = Array.isArray(body) ? body[0] : null
  if (!mat) { log('❌ материал не найден:', materialId); return }
  log(`материал: «${mat.title}» (${mat.material_type}), проект ${mat.project_id}`)
  // NFC-нормализация ОБЕИХ сторон: тайтлы/тексты с маков бывают в NFD,
  // и визуально одинаковые строки иначе не совпадут.
  const content = String(mat.raw_content || '').normalize('NFC')
  const needle = String(find).normalize('NFC')
  const count = content.split(needle).length - 1
  if (count === 0) { log('❌ строка не найдена в материале. Первые 200 симв:\n', content.slice(0, 200)); return }
  if (count > 1) { log(`❌ строка встречается ${count} раз — уточни до однозначной.`); return }
  const updated = content.replace(needle, String(replace).normalize('NFC'))
  const at = content.indexOf(needle)
  log('\n— БЫЛО:  …' + content.slice(Math.max(0, at - 60), at + needle.length + 60).replace(/\n/g, ' | ') + '…')
  log('— СТАНЕТ: …' + updated.slice(Math.max(0, at - 60), at + String(replace).length + 60).replace(/\n/g, ' | ') + '…')
  if (!RUN) { log('\n[DRY-RUN] ничего не пишу. Добавь --run чтобы применить.'); return }
  const upd = await api(`/rest/v1/project_materials?id=eq.${materialId}`, {
    method: 'PATCH',
    body: JSON.stringify({ raw_content: updated }),
  })
  if (upd.status >= 300) { log(`❌ не обновилось: ${upd.status}`, JSON.stringify(upd.body).slice(0, 200)); return }
  log('✅ применено.')
}

// ── ПРОБНИК: выставить язык блога клиентскому проекту ────────────────────────
// ⚠️ Пишет в КЛИЕНТСКИЙ проект (исключение из правила ama-probe-*) — запускать
// только по явной задаче владельца (13 августа: «закрепим настройкой» для
// Darina Komorowski). Использование:
//   node scripts/prod-probe.mjs set-language <projectId> <ru|en|es|de|null> --run
async function setLanguage() {
  const projectId = process.argv[3]
  const lang = process.argv[4]
  log('\n=== Пробник: выставить content_language проекту ===')
  if (!projectId || !['ru', 'en', 'es', 'de', 'null'].includes(lang || '')) {
    log('Использование: node scripts/prod-probe.mjs set-language <projectId> <ru|en|es|de|null> [--run]')
    return
  }
  const cur = await api(`/rest/v1/projects?id=eq.${projectId}&select=id,name,content_language`)
  const proj = Array.isArray(cur.body) ? cur.body[0] : null
  if (!proj) { log('❌ проект не найден:', projectId); return }
  log(`проект: «${proj.name}» (${projectId})`)
  log(`язык сейчас: ${proj.content_language ?? 'НЕ ЗАДАН (авто по TOV)'} → станет: ${lang}`)
  if (!RUN) {
    log('\n[DRY-RUN] ничего не пишу. Добавь --run чтобы применить.')
    return
  }
  const upd = await api(`/rest/v1/projects?id=eq.${projectId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ content_language: lang === 'null' ? null : lang }),
  })
  if (upd.status >= 300) { log(`❌ не обновилось: ${upd.status}`, JSON.stringify(upd.body).slice(0, 200)); return }
  const after = Array.isArray(upd.body) ? upd.body[0] : upd.body
  log(`✅ обновлено: content_language = ${after?.content_language ?? 'null'}`)
}

// ── ПРОБНИК: живой смоук плана прогрева (фоновый джоб, 24.08) ────────────────
// Проверяет НОВЫЙ мобильный путь мастера прогрева: POST /api/jobs/warmup-plan
// (202+jobId) → поллинг GET /api/jobs/[id] → planData с фазами. Один живой
// Claude-вызов (~$0.05-0.1). Сетап дешёвый: временный проект без материалов
// (план строится по нише/продукту — та же ветка, что у клиента без загрузок).
//   node scripts/prod-probe.mjs warmup-smoke [--run]
async function warmupSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: живой смоук плана прогрева (джоб + поллинг) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия (пароль не нужен)')
    log('  2) создать временный проект ama-probe-warmup-*')
    log(`  3) POST ${APP}/api/jobs/warmup-plan (evergreen 14 дней) → 202+jobId`)
    log('  4) поллинг /api/jobs/[id] до done → проверить planData.phases')
    log('  5) удалить джоб и проект')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  // 1) сессия QA-бота без пароля
  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  // 2) временный проект
  const qaId = ver.user?.id
  const projName = `${PROBE_PREFIX}warmup-${Date.now()}`
  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: qaId, name: projName, niche: 'йога для занятых мам', status: 'active' }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) { log('❌ 2. проект не создался:', prj.status, JSON.stringify(prj.body).slice(0, 200)); return }
  log(`✅ 2. проект ${projName}`)

  let jobId = null
  const cleanup = async () => {
    if (jobId) await api(`/rest/v1/jobs?id=eq.${jobId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: джоб и проект удалены')
  }

  try {
    // 3) создать джоб — тем же путём, что клиент WarmupWizard с 24.08
    const t0 = Date.now()
    const start = await fetch(`${APP}/api/jobs/warmup-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        projectId,
        productName: 'Онлайн-курс по утренней йоге',
        duration: 14,
        warmupType: 'evergreen',
        funnelDesc: 'Без воронки — прямые продажи',
        warmTypes: ['content_only'],
        useCases: false,
        hooks: [],
      }),
    })
    const startBody = await start.json().catch(() => null)
    if (start.status !== 202 || !startBody?.jobId) {
      log(`❌ 3. джоб не создался: HTTP ${start.status}`)
      log('   тело:', JSON.stringify(startBody).slice(0, 300))
      return
    }
    jobId = startBody.jobId
    log(`✅ 3. джоб создан (${jobId})`)

    // 4) поллинг — как клиент
    let plan = null
    const deadline = Date.now() + 6 * 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000))
      const st = await fetch(`${APP}/api/jobs/${jobId}`, { headers: { cookie } })
        .then(r => r.json()).catch(() => null)
      const job = st?.job
      if (!job) continue
      if (job.status === 'done') { plan = job.result?.planData; break }
      if (job.status === 'error') { log(`❌ 4. джоб упал: ${job.error}`); return }
    }
    const phases = Array.isArray(plan?.phases) ? plan.phases : []
    const days = phases.reduce((n, ph) => n + (Array.isArray(ph.daily_plan) ? ph.daily_plan.length : 0), 0)
    if (phases.length === 0 || days === 0) {
      log('❌ 4. план пустой или не дособрался за 6 минут')
      return
    }
    log(`✅ 4. план готов за ${((Date.now() - t0) / 1000).toFixed(1)}с: фаз ${phases.length}, дней ${days}`)
    log('\n🎉 ПУТЬ ЖИВ: мастер прогрева переживает смерть вкладки — джоб доехал без клиента.')
  } finally {
    await cleanup()
  }
}

// ── ПРОБНИК: живой смоук плана недели (фоновый джоб + серверный персист) ─────
// Проверяет НОВЫЙ мобильный путь «План недели» контент-плана: POST
// /api/jobs/week-brief (202+jobId) → поллинг → брифы в job.result, И ГЛАВНОЕ —
// джоб сам сохранил брифы в warmup_plans.plan_data (клиент мог не вернуться).
// Один живой Claude-вызов (~$0.05).
//   node scripts/prod-probe.mjs week-brief-smoke [--run]
async function weekBriefSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: живой смоук плана недели (джоб + серверный персист) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия')
    log('  2) временный проект ama-probe-brief-* + warmup_plans с планом 7 дней (REST)')
    log(`  3) POST ${APP}/api/jobs/week-brief (3 дня, formats=[post]) → 202+jobId`)
    log('  4) поллинг до done → брифы в result')
    log('  5) ПРОВЕРКА ПЕРСИСТА: plan_data.…daily_plan[день].briefs.post записан ДЖОБОМ')
    log('  6) удалить план, джоб и проект')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  const qaId = ver.user?.id
  const projName = `${PROBE_PREFIX}brief-${Date.now()}`
  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: qaId, name: projName, niche: 'нутрициология', status: 'active' }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) { log('❌ 2. проект не создался:', prj.status, JSON.stringify(prj.body).slice(0, 200)); return }

  // План прогрева с daily_plan на 7 дней — куда джоб будет сохранять брифы
  const dailyPlan = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, meaning: `Смысл дня ${i + 1} про нутрициологию` }))
  const wp = await api('/rest/v1/warmup_plans', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      project_id: projectId,
      name: `${PROBE_PREFIX}план`,
      duration_days: 7,
      status: 'approved',
      plan_data: { warmup_plan: { phases: [{ phase: 'niche', label: 'Прогрев на нишу', daily_plan: dailyPlan }] } },
    }),
  })
  const planId = Array.isArray(wp.body) ? wp.body[0]?.id : wp.body?.id
  if (!planId) { log('❌ 2. warmup_plans не создался:', wp.status, JSON.stringify(wp.body).slice(0, 200)); return }
  log(`✅ 2. проект ${projName} + план прогрева (7 дней)`)

  let jobId = null
  const cleanup = async () => {
    if (jobId) await api(`/rest/v1/jobs?id=eq.${jobId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/warmup_plans?id=eq.${planId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: план, джоб и проект удалены')
  }

  try {
    const t0 = Date.now()
    const days = [1, 2, 3].map(d => ({
      day: d, date: `0${d}.09.2026`, phase: 'awareness',
      meaning: `Смысл дня ${d} про нутрициологию`, formats: ['post'],
    }))
    const start = await fetch(`${APP}/api/jobs/week-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, days, warmupPlanId: planId }),
    })
    const startBody = await start.json().catch(() => null)
    if (start.status !== 202 || !startBody?.jobId) {
      log(`❌ 3. джоб не создался: HTTP ${start.status}`)
      log('   тело:', JSON.stringify(startBody).slice(0, 300))
      return
    }
    jobId = startBody.jobId
    log(`✅ 3. джоб создан (${jobId})`)

    let briefDays = null
    const deadline = Date.now() + 4 * 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000))
      const st = await fetch(`${APP}/api/jobs/${jobId}`, { headers: { cookie } })
        .then(r => r.json()).catch(() => null)
      const job = st?.job
      if (!job) continue
      if (job.status === 'done') { briefDays = job.result?.days; break }
      if (job.status === 'error') { log(`❌ 4. джоб упал: ${job.error}`); return }
    }
    if (!Array.isArray(briefDays) || briefDays.length === 0) {
      log('❌ 4. брифы не дособрались за 4 минуты')
      return
    }
    log(`✅ 4. брифы готовы за ${((Date.now() - t0) / 1000).toFixed(1)}с: дней ${briefDays.length}`)

    // 5) КЛЮЧЕВАЯ проверка класса: джоб сам сохранил брифы в план
    const persisted = await api(`/rest/v1/warmup_plans?id=eq.${planId}&select=plan_data`)
    const pd = Array.isArray(persisted.body) ? persisted.body[0]?.plan_data : null
    const day1 = pd?.warmup_plan?.phases?.[0]?.daily_plan?.find((d) => d.day === 1)
    if (!day1?.briefs?.post) {
      log('❌ 5. ПЕРСИСТ НЕ СРАБОТАЛ: plan_data дня 1 без briefs.post —', JSON.stringify(day1).slice(0, 200))
      return
    }
    log(`✅ 5. джоб сам сохранил брифы в план: день 1 post = «${String(day1.briefs.post).slice(0, 60)}…»`)
    log('\n🎉 ПУТЬ ЖИВ: план недели переживает смерть вкладки — брифы доехали до базы без клиента.')
  } finally {
    await cleanup()
  }
}

// ── ПРОБНИК: живой смоук автозаполнения мастера (фоновый джоб) ───────────────
// Проверяет НОВЫЙ мобильный путь онбординга: POST /api/jobs/project-autofill
// (202+jobId, без projectId — проекта ещё нет) → поллинг → поля профиля.
// Источник — публичный Telegram-канал (скрейп t.me/s бесплатный, без Apify);
// один Claude-вызов ~$0.01.
//   node scripts/prod-probe.mjs autofill-smoke [--run] [--tg=durov]
async function autofillSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  const tgArg = process.argv.find(a => a.startsWith('--tg='))
  const tgHandle = tgArg ? tgArg.slice(5) : 'durov'
  log('\n=== Пробник: живой смоук автозаполнения мастера (джоб) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия')
    log(`  2) POST ${APP}/api/jobs/project-autofill (t.me/${tgHandle}) → 202+jobId`)
    log('  3) поллинг до done → niche/description заполнены')
    log('  4) удалить джоб')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  let jobId = null
  try {
    const t0 = Date.now()
    const start = await fetch(`${APP}/api/jobs/project-autofill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ telegramUrl: `https://t.me/${tgHandle}` }),
    })
    const startBody = await start.json().catch(() => null)
    if (start.status !== 202 || !startBody?.jobId) {
      log(`❌ 2. джоб не создался: HTTP ${start.status}`)
      log('   тело:', JSON.stringify(startBody).slice(0, 300))
      return
    }
    jobId = startBody.jobId
    log(`✅ 2. джоб создан (${jobId})`)

    let result = null
    const deadline = Date.now() + 4 * 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000))
      const st = await fetch(`${APP}/api/jobs/${jobId}`, { headers: { cookie } })
        .then(r => r.json()).catch(() => null)
      const job = st?.job
      if (!job) continue
      if (job.status === 'done') { result = job.result; break }
      if (job.status === 'error') { log(`❌ 3. джоб упал: ${job.error}`); return }
    }
    if (!result?.niche && !result?.description) {
      log('❌ 3. поля не заполнились за 4 минуты —', JSON.stringify(result).slice(0, 200))
      return
    }
    log(`✅ 3. поля готовы за ${((Date.now() - t0) / 1000).toFixed(1)}с из ${result.platform}: ниша «${String(result.niche).slice(0, 60)}…»`)
    log('\n🎉 ПУТЬ ЖИВ: автозаполнение мастера переживает смерть вкладки — джоб доехал без клиента.')
  } finally {
    if (jobId) await api(`/rest/v1/jobs?id=eq.${jobId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: джоб удалён')
  }
}

// ── ПРОБНИК: живой смоук анализа конкурентов (фоновый джоб) ──────────────────
// Проверяет НОВЫЙ мобильный путь «Анализ конкурентов»: синтетический материал
// competitors (REST) → POST /api/jobs/analyze-competitors (202+jobId) →
// поллинг → строки таблицы. Один Claude-вызов ~$0.02.
//   node scripts/prod-probe.mjs competitors-smoke [--run]
async function competitorsSmoke() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: живой смоук анализа конкурентов (джоб) ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: magiclink → verify → сессия')
    log('  2) временный проект ama-probe-comp-* + материал competitors (REST)')
    log(`  3) POST ${APP}/api/jobs/analyze-competitors → 202+jobId`)
    log('  4) поллинг до done → строки таблицы (handle/takeaway)')
    log('  5) удалить материал, джоб и проект')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA-бота получена')

  const qaId = ver.user?.id
  const projName = `${PROBE_PREFIX}comp-${Date.now()}`
  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: qaId, name: projName, niche: 'фитнес-тренер', status: 'active' }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) { log('❌ 2. проект не создался:', prj.status, JSON.stringify(prj.body).slice(0, 200)); return }

  const compText = [
    'Профиль: @fit_marina_pro — 42 300 подписчиков.',
    'Био: тренер по функциональному фитнесу, мама двоих, онлайн-программы.',
    'Пост 1 (4 812 лайков, 214 комментов): «Почему присед не убирает живот — разбор с цифрами».',
    'Пост 2 (2 105 лайков): «Мой день на 1800 ккал — меню без курогрудки».',
    'Рилз 1 (390 000 просмотров): до/после клиентки за 12 недель, быстрый монтаж.',
    'Публикуется почти каждый день, сторис с опросами по утрам.',
  ].join('\n')
  const mat = await api('/rest/v1/project_materials', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      project_id: projectId,
      title: `${PROBE_PREFIX}конкурент @fit_marina_pro`,
      material_type: 'competitors',
      raw_content: compText,
      processing_status: 'ready',
    }),
  })
  const matId = Array.isArray(mat.body) ? mat.body[0]?.id : mat.body?.id
  if (!matId) { log('❌ 2. материал не создался:', mat.status, JSON.stringify(mat.body).slice(0, 200)); return }
  log(`✅ 2. проект ${projName} + материал competitors`)

  let jobId = null
  const cleanup = async () => {
    if (jobId) await api(`/rest/v1/jobs?id=eq.${jobId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/project_materials?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: материал, джоб и проект удалены')
  }

  try {
    const t0 = Date.now()
    const start = await fetch(`${APP}/api/jobs/analyze-competitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId }),
    })
    const startBody = await start.json().catch(() => null)
    if (start.status !== 202 || !startBody?.jobId) {
      log(`❌ 3. джоб не создался: HTTP ${start.status}`)
      log('   тело:', JSON.stringify(startBody).slice(0, 300))
      return
    }
    jobId = startBody.jobId
    log(`✅ 3. джоб создан (${jobId})`)

    let rows = null
    const deadline = Date.now() + 4 * 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000))
      const st = await fetch(`${APP}/api/jobs/${jobId}`, { headers: { cookie } })
        .then(r => r.json()).catch(() => null)
      const job = st?.job
      if (!job) continue
      if (job.status === 'done') { rows = job.result?.competitors; break }
      if (job.status === 'error') { log(`❌ 4. джоб упал: ${job.error}`); return }
    }
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0]?.handle) {
      log('❌ 4. таблица не дособралась за 4 минуты —', JSON.stringify(rows).slice(0, 200))
      return
    }
    log(`✅ 4. таблица готова за ${((Date.now() - t0) / 1000).toFixed(1)}с: строк ${rows.length}, handle ${rows[0].handle}`)
    log('\n🎉 ПУТЬ ЖИВ: анализ конкурентов переживает смерть вкладки — джоб доехал без клиента.')
  } finally {
    await cleanup()
  }
}

// ── ПРОБНИК: судьба юнита в чате при смерти вкладки (диагностика, 24.08) ─────
// Вопрос мандата: genFormat-генерация в чате списывает юнит ДО стрима, а ответ
// летит в открытую вкладку. Что происходит при обрыве клиента на середине:
// (а) списался ли юнит и вернулся ли; (б) ловит ли сервер обрыв (error_events
// where='chat stream' c gotChars) или догенерирует в пустоту. Пробник рвёт
// соединение после первых чанков и замеряет всё это. Юнит QA-боту возвращаем.
//   node scripts/prod-probe.mjs chat-unit-fate [--run]
async function chatUnitFate() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: судьба юнита в чате при смерти вкладки ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: сессия; замер generations_used ДО')
    log(`  2) POST ${APP}/api/ai/chat genFormat=post (standalone) — читаем ~2с и РВЁМ соединение`)
    log('  3) ждём 90с; замер generations_used ПОСЛЕ + error_events (chat stream)')
    log('  4) вернуть юнит QA-боту (PATCH generations_used)')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  const qaId = ver.user?.id
  log('✅ 1. сессия QA-бота получена')

  const readUsed = async () => {
    const r = await api(`/rest/v1/profiles?select=generations_used&id=eq.${qaId}`)
    return Array.isArray(r.body) ? r.body[0]?.generations_used : null
  }
  const usedBefore = await readUsed()
  log(`   generations_used ДО: ${usedBefore}`)

  const t0 = Date.now()
  const controller = new AbortController()
  let gotChars = 0
  let aborted = false
  let genJobId = null
  try {
    const res = await fetch(`${APP}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        genFormat: 'post',
        messages: [{ role: 'user', content: 'Напиши пост про то, как ниша йоги для занятых мам меняет утренние привычки. Подробно, с историей.' }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      log(`❌ 2. чат ответил ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return
    }
    // Почтовый ящик (фикс 24.08): id приходит заголовком до первого байта
    genJobId = res.headers.get('x-gen-job')
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      gotChars += dec.decode(value, { stream: true }).length
      // Получили первые чанки — рвём соединение, как умершая вкладка
      if (gotChars > 50) { aborted = true; controller.abort(); break }
    }
  } catch (e) {
    if (!aborted) { log('❌ 2. обрыв не по плану:', e?.message); return }
  }
  log(`✅ 2. соединение разорвано на ${gotChars} символах через ${((Date.now() - t0) / 1000).toFixed(1)}с; X-Gen-Job: ${genJobId ?? 'НЕТ'}`)

  log('   жду 90с (сервер достримливает в пустоту — ящик должен наполниться)…')
  await new Promise(r => setTimeout(r, 90_000))

  const usedAfter = await readUsed()
  let mailbox = null
  if (genJobId) {
    const jr = await api(`/rest/v1/jobs?select=status,result&id=eq.${genJobId}`)
    mailbox = Array.isArray(jr.body) ? jr.body[0] : null
  }

  log(`\n── ФАКТЫ ──`)
  log(`   generations_used: ${usedBefore} → ${usedAfter} (дельта ${usedAfter - usedBefore})`)
  if (!genJobId) {
    log('   ❌ заголовка X-Gen-Job нет — ящик не создался (деплой не доехал?)')
  } else if (mailbox?.status === 'done' && mailbox?.result?.text) {
    const len = String(mailbox.result.text).length
    log(`   ✅ ЯЩИК ПОЛОН: status=done, текст ${len} символов (клиент получил лишь ${gotChars})`)
    if (len > gotChars * 2) log('   → юнит куплен не зря: полный ответ ждёт клиента при возвращении')
    else log(`   ⚠️ текст в ящике подозрительно короткий (${len}) — глянь content`)
  } else {
    log(`   ❌ ящик не наполнился: ${JSON.stringify(mailbox).slice(0, 200)}`)
  }

  // уборка: вернуть юнит(ы) и удалить ящик
  if (usedAfter > usedBefore) {
    const upd = await api(`/rest/v1/profiles?id=eq.${qaId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ generations_used: usedBefore }),
    })
    const now = Array.isArray(upd.body) ? upd.body[0]?.generations_used : null
    log(`🧹 уборка: generations_used возвращён на ${now}`)
  }
  if (genJobId) {
    await api(`/rest/v1/jobs?id=eq.${genJobId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: ящик удалён')
  }
}

// ── ПРОБНИК: судьба юнита в generate при смерти вкладки (диагностика, 24.08) ─
// Дополняет chat-unit-fate: у generate в КОНЦЕ стрима есть insert в
// content_items — по нему видно, ПЕРЕЖИВАЕТ ли серверная инвокация обрыв
// клиента: строка появилась → достримил в пустоту и сохранил; строки нет и
// юнит вернулся → enqueue кинул (catch с refund); строки нет и юнит не
// вернулся → инвокацию убило на обрыве. Юнит и мусор возвращаем/убираем.
//   node scripts/prod-probe.mjs generate-unit-fate [--run]
async function generateUnitFate() {
  const APP = 'https://amaproduct.com'
  const QA = 'ama-qa-bot@gmail.com'
  log('\n=== Пробник: судьба юнита в generate при смерти вкладки ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: сессия; замер generations_used ДО; временный проект')
    log(`  2) POST ${APP}/api/ai/generate post — читаем первые байты и РВЁМ`)
    log('  3) ждём 120с; content_items появился? юнит вернулся?')
    log('  4) уборка: контент, проект, юнит')
    return
  }
  const anon = (() => {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = txt.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local'); return }

  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log('❌ generate_link не дал email_otp:', gl.status); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  const qaId = ver.user?.id
  log('✅ 1. сессия QA-бота получена')

  const readUsed = async () => {
    const r = await api(`/rest/v1/profiles?select=generations_used&id=eq.${qaId}`)
    return Array.isArray(r.body) ? r.body[0]?.generations_used : null
  }
  const usedBefore = await readUsed()

  const projName = `${PROBE_PREFIX}genfate-${Date.now()}`
  const prj = await api('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: qaId, name: projName, niche: 'йога', status: 'active' }),
  })
  const projectId = Array.isArray(prj.body) ? prj.body[0]?.id : prj.body?.id
  if (!projectId) { log('❌ проект не создался:', prj.status); return }
  log(`   generations_used ДО: ${usedBefore}; проект ${projName}`)

  const cleanup = async () => {
    await api(`/rest/v1/content_items?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    const usedNow = await readUsed()
    if (usedNow > usedBefore) {
      await api(`/rest/v1/profiles?id=eq.${qaId}`, {
        method: 'PATCH',
        body: JSON.stringify({ generations_used: usedBefore }),
      })
    }
    log(`🧹 уборка: контент/проект удалены, generations_used возвращён на ${usedBefore}`)
  }

  try {
    const t0 = Date.now()
    const controller = new AbortController()
    let gotChars = 0
    let aborted = false
    try {
      const res = await fetch(`${APP}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ projectId, contentType: 'post', dayNumber: 1, totalDays: 7, phase: 'awareness', dayMeaning: 'почему утренняя практика меняет день' }),
        signal: controller.signal,
      })
      if (!res.ok) { log(`❌ 2. generate ответил ${res.status}: ${(await res.text()).slice(0, 200)}`); return }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        gotChars += dec.decode(value, { stream: true }).length
        if (gotChars > 30) { aborted = true; controller.abort(); break }
      }
    } catch (e) {
      if (!aborted) { log('❌ 2. обрыв не по плану:', e?.message); return }
    }
    log(`✅ 2. соединение разорвано на ${gotChars} символах через ${((Date.now() - t0) / 1000).toFixed(1)}с`)

    log('   жду 120с…')
    await new Promise(r => setTimeout(r, 120_000))

    const items = await api(`/rest/v1/content_items?select=id,title,created_at&project_id=eq.${projectId}`)
    const usedAfter = await readUsed()
    log(`\n── ФАКТЫ ──`)
    log(`   content_items: ${Array.isArray(items.body) ? items.body.length : '?'} шт.`)
    log(`   generations_used: ${usedBefore} → ${usedAfter} (дельта ${usedAfter - usedBefore})`)
    if ((items.body?.length ?? 0) > 0) {
      log('   → инвокация ПЕРЕЖИЛА обрыв: достримила в пустоту и СОХРАНИЛА контент')
      if (usedAfter - usedBefore < 1) log('   → и после сохранения упавший send(done) вернул юнит (двойная щедрость)')
    } else if (usedAfter - usedBefore < 1) {
      log('   → контента нет, юнит ВЕРНУЛСЯ: enqueue кинул исключение → catch с refund')
    } else {
      log('   → контента нет, юнит НЕ вернулся: инвокацию убило на обрыве клиента')
    }
  } finally {
    await cleanup()
  }
}

// ── ИНСТРУМЕНТ: массовая смена тарифа профилей (решение Августы 25.08) ───────
// Меняет ТОЛЬКО profiles.subscription_tier. Статусы, trialing/trial_ends_at,
// платёжки Stripe/Продамус НЕ трогаются (инцидент 16-17 июля — не повторять).
// Защиты: отказ по admin-роли, отказ по QA-боту (нужен смоукам), список только
// явными --emails (никаких «всех разом» по фильтру). После записи — повторное
// чтение и сверка: тариф сменился, остальные биллинг-поля побайтно те же.
//
//   node scripts/prod-probe.mjs set-tier --to solo --emails "a@b.com,c@d.com" [--run]
const QA_EMAIL = 'ama-qa-bot@gmail.com'
async function setTier() {
  const to = (arg('to') || '').trim()
  const emails = (arg('emails') || '').split(',').map(e => e.trim().toLowerCase().normalize('NFC')).filter(Boolean)
  log('\n=== Инструмент: смена тарифа (только subscription_tier) ===')
  const VALID = ['trial', 'solo', 'pro', 'producer']
  if (!VALID.includes(to)) { log(`❌ --to обязателен и один из: ${VALID.join(', ')}`); return }
  if (!emails.length) { log('❌ укажи --emails "a@b.com,c@d.com" (явный список, не фильтр)'); return }
  log(`цель: ${to} | адресов: ${emails.length}`)

  // Снимок ДО — по нему же после записи сверяем, что лишнего не тронули.
  const FIELDS = 'id,email,role,subscription_tier,subscription_status,trial_ends_at,current_period_end,payment_provider,provider_subscription_id,generations_used,bonus_generations,generations_reset_at'
  const inList = emails.map(e => `"${e}"`).join(',')
  const before = await api(`/rest/v1/profiles?select=${FIELDS}&email=in.(${inList})`)
  if (!Array.isArray(before.body)) { log(`❌ чтение профилей: ${before.status} ${JSON.stringify(before.body).slice(0, 200)}`); return }
  const byEmail = new Map(before.body.map(p => [String(p.email).toLowerCase().normalize('NFC'), p]))

  const plan = []
  let refused = 0
  for (const e of emails) {
    const p = byEmail.get(e)
    if (!p) { log(`  ❌ НЕ НАЙДЕН: ${e} — пропускаю`); refused++; continue }
    if (p.role === 'admin') { log(`  🛑 ОТКАЗ (admin): ${e} — админов не переводим`); refused++; continue }
    if (e === QA_EMAIL) { log(`  🛑 ОТКАЗ (QA-бот): ${e} — нужен смоукам`); refused++; continue }
    if (p.subscription_tier === to) { log(`  ・ уже ${to}: ${e} — нечего менять`); continue }
    plan.push(p)
  }

  log(`\nПлан записи (${plan.length} шт.):`)
  for (const p of plan) {
    log(`  ${p.email}: ${p.subscription_tier} → ${to} | статус ${p.subscription_status} (не трогаем) | юниты ${p.generations_used} | платёжка ${p.payment_provider ?? 'нет'}`)
  }
  if (!plan.length) { log('Менять нечего.'); return }

  if (!RUN) {
    log('\n[DRY-RUN] ничего не записано. Добавь --run чтобы выполнить.')
    return
  }

  let ok = 0
  for (const p of plan) {
    const upd = await api(`/rest/v1/profiles?id=eq.${p.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ subscription_tier: to }),
    })
    const row = Array.isArray(upd.body) ? upd.body[0] : null
    if (row?.subscription_tier === to) { ok++; log(`  ✅ ${p.email}: ${p.subscription_tier} → ${row.subscription_tier}`) }
    else log(`  ❌ ${p.email}: запись не прошла (${upd.status}) ${JSON.stringify(upd.body).slice(0, 150)}`)
  }

  // Сверка ПОСЛЕ: тариф целевой, остальные биллинг-поля не изменились.
  const after = await api(`/rest/v1/profiles?select=${FIELDS}&email=in.(${inList})`)
  const afterBy = new Map((after.body || []).map(p => [p.id, p]))
  const UNTOUCHED = ['subscription_status', 'trial_ends_at', 'current_period_end', 'payment_provider', 'provider_subscription_id', 'generations_used', 'bonus_generations', 'generations_reset_at']
  let clean = true
  for (const p of plan) {
    const a = afterBy.get(p.id)
    if (!a) { log(`  ⚠️ сверка: ${p.email} не читается`); clean = false; continue }
    if (a.subscription_tier !== to) { log(`  ❌ сверка: ${p.email} тариф ${a.subscription_tier}, ждали ${to}`); clean = false }
    for (const f of UNTOUCHED) {
      if (JSON.stringify(a[f] ?? null) !== JSON.stringify(p[f] ?? null)) {
        log(`  ❌ сверка: ${p.email} поле ${f} ИЗМЕНИЛОСЬ: ${JSON.stringify(p[f])} → ${JSON.stringify(a[f])}`)
        clean = false
      }
    }
  }
  log(`\n── ИТОГ ── записано ${ok}/${plan.length}${refused ? `, отказов ${refused}` : ''}; сверка нетронутых полей: ${clean ? '✅ чисто' : '❌ РАСХОЖДЕНИЯ (см. выше)'}`)
}

// ── ПРОБНИК: лимит юнитов глазами клиента (живьём, боевой путь чата) ─────────
// Проверяет РЕАЛЬНЫЙ путь «клиент упёрся в месячный лимит»: QA-боту счётчик
// ставится в потолок тарифа, затем тем же роутом/кукой/телом, что жмёт клиент
// в ассистенте, запрашивается метереная генерация. Ожидание: 402 с
// code=limit_reached («лимит исчерпан»), НЕ payment_required («подключи тариф»)
// — путать их нельзя (у гейта две причины, см. gateContentUnit). Контроль:
// свободный чат (без genFormat) при выбитом лимите обязан работать — fair use
// не метерится. Счётчики возвращаются в исходное в finally при любом исходе.
//
//   node scripts/prod-probe.mjs limit-smoke [--run]
async function limitSmoke() {
  const APP = 'https://amaproduct.com'
  // Потолки тарифов — зеркало lib/generations-config.ts (страж tier-limits-sync
  // держит их в синхроне с БД-функцией generation_limit из миграции 016).
  const LIMITS = { trial: 300, solo: 300, pro: 2000, producer: 8000 }
  log('\n=== Пробник: месячный лимит юнитов глазами клиента ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-бот: снять текущие generations_used/bonus; сессия как у клиента')
    log('  2) выставить счётчик В ПОТОЛОК тарифа (bonus временно 0)')
    log('  3) POST /api/ai/chat genFormat=post → ждём 402 code=limit_reached (не payment_required!)')
    log('  4) контроль: свободный чат без genFormat → обязан отвечать (fair use)')
    log('  5) finally: вернуть счётчики, сверить')
    return
  }

  const prof = await api(`/rest/v1/profiles?select=id,role,subscription_tier,generations_used,bonus_generations,generations_reset_at&email=eq.${QA_EMAIL}`)
  const qa = Array.isArray(prof.body) ? prof.body[0] : null
  if (!qa) { log('❌ QA-бот не найден'); return }
  if (qa.role === 'admin') { log('❌ QA-бот стал admin — смоук бессмысленен (админам лимит не считается)'); return }
  const limit = LIMITS[qa.subscription_tier]
  if (!limit) { log(`❌ неизвестный тариф QA: ${qa.subscription_tier}`); return }
  if (new Date(qa.generations_reset_at).getTime() <= Date.now()) {
    log(`❌ generations_reset_at (${qa.generations_reset_at}) в прошлом — первый же consume сбросит счётчик и смоук соврёт. Прогони позже.`)
    return
  }
  log(`QA: тариф ${qa.subscription_tier} (потолок ${limit}), юниты ${qa.generations_used}, бонусы ${qa.bonus_generations}`)

  const anon = (() => {
    const m = readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY'); return }
  const gl = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: QA_EMAIL }),
  })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log(`❌ generate_link не дал email_otp: ${gl.status}`); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA_EMAIL, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ verify не дал сессию'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA как у клиента')

  const used0 = qa.generations_used, bonus0 = qa.bonus_generations
  let verdictBlocked = false, verdictFree = false
  try {
    const cap = await api(`/rest/v1/profiles?id=eq.${qa.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ generations_used: limit, bonus_generations: 0 }),
    })
    const capped = Array.isArray(cap.body) ? cap.body[0] : null
    if (capped?.generations_used !== limit) { log(`❌ не выставился потолок: ${cap.status}`); return }
    log(`✅ 2. счётчик в потолке: ${limit}/${limit}, бонусы 0`)

    // 3. Метереная генерация — боевой путь клиента (чат-ассистент, genFormat)
    const genRes = await fetch(`${APP}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        genFormat: 'post',
        messages: [{ role: 'user', content: 'Напиши короткий пост про утренние привычки.' }],
      }),
    })
    const genBody = await genRes.json().catch(() => ({}))
    if (genRes.status === 402 && genBody.code === 'limit_reached') {
      verdictBlocked = true
      log(`✅ 3. генерация отбита: 402 code=limit_reached, счёт ${genBody.monthlyUsed}/${genBody.monthlyLimit}`)
      log('   → клиент увидит диалог «Лимит на этот месяц исчерпан» (не «подключи тариф»)')
    } else {
      log(`❌ 3. ждали 402 limit_reached, получили ${genRes.status} ${JSON.stringify(genBody).slice(0, 200)}`)
    }

    // 4. Контроль: свободный чат при выбитом лимите обязан работать (fair use)
    const ctrl = new AbortController()
    const freeRes = await fetch(`${APP}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Привет! Одним словом: как дела?' }] }),
      signal: ctrl.signal,
    })
    if (freeRes.ok && freeRes.body) {
      const reader = freeRes.body.getReader()
      const { value } = await reader.read().catch(() => ({ value: null }))
      verdictFree = true
      ctrl.abort() // первый чанк получен — стрим жив, дальше не читаем
      log(`✅ 4. свободный чат жив при выбитом лимите (200, стрим пошёл${value ? `, ${value.length} байт` : ''})`)
    } else {
      log(`❌ 4. свободный чат отбит: ${freeRes.status} ${(await freeRes.text().catch(() => '')).slice(0, 150)} — fair use сломан!`)
    }
  } finally {
    const back = await api(`/rest/v1/profiles?id=eq.${qa.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ generations_used: used0, bonus_generations: bonus0 }),
    })
    const row = Array.isArray(back.body) ? back.body[0] : null
    const restored = row?.generations_used === used0 && row?.bonus_generations === bonus0
    log(restored
      ? `🧹 уборка: счётчики возвращены (${used0} юн., ${bonus0} бонусов)`
      : `❌ УБОРКА НЕ ПРОШЛА: почини руками profiles.generations_used=${used0}, bonus_generations=${bonus0} у ${QA_EMAIL}`)
  }
  log(`\n── ВЕРДИКТ ── лимит блокирует генерацию: ${verdictBlocked ? '✅' : '❌'}; fair-use чат жив: ${verdictFree ? '✅' : '❌'}`)
}

// ── ПРОБНИК: списывается ровно столько, сколько обещано кнопкой (25.08) ──────
// Прайс-лист UNIT_COSTS теперь берёт юниты за тяжёлые операции. Проверяем на
// БОЕВОМ пути (POST /api/jobs/transcribe под сессией клиента), что:
//   • списывается РОВНО цена типа (не 1 и не дважды);
//   • «Повторить» НЕ списывает второй раз (джоб уже оплачен);
//   • микро-метеринг считает 10 действий = 1 юнит (RPC 039) и роут его зовёт.
// Всё за собой убирает: джоб, материал, проект, файл, счётчики.
//   node scripts/prod-probe.mjs meter-smoke [--run]
async function meterSmoke() {
  const APP = 'https://amaproduct.com'
  const COSTS = { transcribe_castdev: 3, micro_batch: 10 } // зеркало UNIT_COSTS (страж unit-costs)
  log('\n=== Пробник: метеринг тяжёлых операций и микро-действий ===')
  if (!RUN) {
    log('\n[DRY-RUN] план (добавь --run):')
    log('  1) QA-сессия; временный проект; тишина 1с через ffmpeg → audio-temp')
    log(`  2) POST /api/jobs/transcribe → ждём списание РОВНО ${COSTS.transcribe_castdev}`)
    log('  3) POST /api/jobs/transcribe/retry на тот же джоб → повторного списания НЕТ')
    log(`  4) RPC consume_micro_action ×${COSTS.micro_batch} → ровно 1 юнит за пачку`)
    log('  5) один живой вызов микро-роута → micro_actions_count вырос (проводка есть)')
    log('  6) уборка: джоб, материал, проект, файл, счётчики на место')
    return
  }

  const anon = (() => {
    const m = readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)
    return m ? m[1].trim() : null
  })()
  if (!anon) { log('❌ нет NEXT_PUBLIC_SUPABASE_ANON_KEY'); return }

  // ВАЖНО: micro_actions_count запрашиваем ОТДЕЛЬНО. Явный select с колонкой,
  // которой ещё нет (039 не применена), — это PostgREST 42703 на ВЕСЬ запрос;
  // ровно так 13.08 упал suggest-angles у всех клиентов.
  const prof = await api(`/rest/v1/profiles?select=id,role,subscription_tier,generations_used,bonus_generations&email=eq.${QA_EMAIL}`)
  const qa = Array.isArray(prof.body) ? prof.body[0] : null
  if (!qa) { log(`❌ QA-бот не найден (${prof.status}): ${JSON.stringify(prof.body).slice(0, 200)}`); return }
  if (qa.role === 'admin') { log('❌ QA стал admin — метеринг его не считает'); return }
  const used0 = qa.generations_used, bonus0 = qa.bonus_generations
  const microProbe = await api(`/rest/v1/profiles?select=micro_actions_count&id=eq.${qa.id}`)
  const micro0 = Array.isArray(microProbe.body) ? microProbe.body[0]?.micro_actions_count : undefined
  if (micro0 === undefined) log('⚠️ колонки micro_actions_count нет — миграция 039 не применена (микро-часть пропущу)')
  log(`QA: тариф ${qa.subscription_tier}, юниты ${used0}, бонусы ${bonus0}, микро ${micro0 ?? '—'}`)

  const gl = await api('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email: QA_EMAIL }) })
  const otp = gl.body?.properties?.email_otp || gl.body?.email_otp
  if (!otp) { log(`❌ generate_link: ${gl.status}`); return }
  const ver = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: QA_EMAIL, token: otp }),
  }).then(r => r.json())
  if (!ver?.access_token) { log('❌ сессия не получена'); return }
  const ref = new URL(U).hostname.split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ver)).toString('base64url')}`
  log('✅ 1. сессия QA как у клиента')

  // Эффективный расход = списанные юниты минус потраченные бонусы (бонус тратится первым)
  const readSpend = async () => {
    const cols = micro0 === undefined ? 'generations_used,bonus_generations' : 'generations_used,bonus_generations,micro_actions_count'
    const r = await api(`/rest/v1/profiles?select=${cols}&id=eq.${qa.id}`)
    const p = Array.isArray(r.body) ? r.body[0] : {}
    return { spend: (p.generations_used - used0) + (bonus0 - p.bonus_generations), micro: p.micro_actions_count }
  }

  let projectId = null, jobId = null, storagePath = null, materialId = null
  const { execFileSync } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const { writeFileSync, readFileSync: rf, unlinkSync } = await import('node:fs')
  const tmpFile = join(tmpdir(), `${PROBE_PREFIX}silence.mp3`)

  try {
    const proj = await api('/rest/v1/projects', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: `${PROBE_PREFIX}meter`, owner_id: qa.id }),
    })
    projectId = Array.isArray(proj.body) ? proj.body[0]?.id : null
    if (!projectId) { log(`❌ проект не создался: ${proj.status} ${JSON.stringify(proj.body).slice(0, 150)}`); return }

    // 1 секунда тишины — Whisper стоит доли цента, зато путь боевой целиком
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', '-q:a', '9', tmpFile], { stdio: 'ignore' })
    storagePath = `${qa.id}/${PROBE_PREFIX}${Date.now()}.mp3`
    const up = await fetch(`${U}/storage/v1/object/audio-temp/${storagePath}`, {
      method: 'POST', headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'audio/mpeg' },
      body: rf(tmpFile),
    })
    if (!up.ok) { log(`❌ файл не залился: ${up.status} ${(await up.text()).slice(0, 150)}`); return }
    log('✅ 2. временный проект и файл (1с тишины) готовы')

    const res = await fetch(`${APP}/api/jobs/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, storagePath, ext: 'mp3', durationSec: 1, saveTranscriptMaterial: true }),
    })
    const body = await res.json().catch(() => ({}))
    jobId = body.jobId ?? null
    if (!res.ok || !jobId) { log(`❌ 3. транскрибация отбита: ${res.status} ${JSON.stringify(body).slice(0, 200)}`); return }

    await new Promise(r => setTimeout(r, 3000)) // дать списанию долететь
    const afterPost = await readSpend()
    const ok1 = afterPost.spend === COSTS.transcribe_castdev
    log(`${ok1 ? '✅' : '❌'} 3. списано за расшифровку: ${afterPost.spend} (ждали ровно ${COSTS.transcribe_castdev})`)

    // Повтор оплаченного джоба не должен списывать снова
    const retry = await fetch(`${APP}/api/jobs/transcribe/retry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ jobId }),
    })
    await retry.text().catch(() => '')
    await new Promise(r => setTimeout(r, 2000))
    const afterRetry = await readSpend()
    const ok2 = afterRetry.spend === afterPost.spend
    log(`${ok2 ? '✅' : '❌'} 4. «Повторить» повторно НЕ списывает: расход ${afterRetry.spend} (был ${afterPost.spend})`)

    // Микро-метеринг: математика пачки + факт проводки в роуте
    if (micro0 !== undefined) {
      const beforeMicro = await readSpend()
      for (let i = 0; i < COSTS.micro_batch; i++) {
        await api('/rest/v1/rpc/consume_micro_action', { method: 'POST', body: JSON.stringify({ p_user_id: qa.id, p_batch: COSTS.micro_batch }) })
      }
      const afterMicro = await readSpend()
      const delta = afterMicro.spend - beforeMicro.spend
      const ok3 = delta === 1 && afterMicro.micro === beforeMicro.micro + COSTS.micro_batch
      log(`${ok3 ? '✅' : '❌'} 5. ${COSTS.micro_batch} микро-действий = ${delta} юнит (счётчик ${beforeMicro.micro}→${afterMicro.micro})`)

      // 6а) ОТБИТЫЙ запрос считаться НЕ должен: работы не было, денег не
      // потратили. Гейт стоит ниже валидации именно ради этого.
      const bad = await fetch(`${APP}/api/ai/suggest-angles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ topic: 'утренние привычки' }), // без projectId → 400
      })
      await bad.text().catch(() => '')
      const afterBad = await readSpend()
      const ok4 = bad.status === 400 && afterBad.micro === afterMicro.micro
      log(`${ok4 ? '✅' : '❌'} 6а. отбитый запрос (${bad.status}) НЕ считается: счётчик ${afterMicro.micro}→${afterBad.micro}`)

      // 6б) ВАЛИДНЫЙ запрос считаться обязан — иначе проводки нет вовсе.
      const good = await fetch(`${APP}/api/ai/suggest-angles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ projectId, type: 'post', brief: 'утренние привычки' }),
      })
      await good.text().catch(() => '')
      const afterGood = await readSpend()
      const ok5 = afterGood.micro === afterBad.micro + 1
      log(`${ok5 ? '✅' : '❌'} 6б. валидный запрос (${good.status}) считается: счётчик ${afterBad.micro}→${afterGood.micro}`)

      // 7) УЧЁТ ТОКЕНОВ: валидный запрос выше звал Claude — значит в журнале
      // ai_usage обязана появиться строка provider=anthropic. Без этой проверки
      // обёртка молча не логировала (первая версия глушила падение импорта
      // в .catch): строки Whisper шли, строк Claude не было вообще.
      const fresh = new Date(Date.now() - 10 * 60_000).toISOString()
      const usage = await api(`/rest/v1/ai_usage?select=route,provider,model,user_id,input_tokens,output_tokens,created_at&created_at=gte.${fresh}&order=created_at.desc&limit=20`)
      const rows = Array.isArray(usage.body) ? usage.body : []
      const cl = rows.filter(r => r.provider === 'anthropic')
      const wh = rows.filter(r => r.provider === 'openai_whisper')
      const ok6 = cl.length > 0 && (cl[0].input_tokens ?? 0) > 0 && cl[0].route && cl[0].route !== 'unknown'
      log(`${ok6 ? '✅' : '❌'} 7а. токены Claude в ai_usage: ${cl.length ? `${cl[0].route} ${cl[0].model} in ${cl[0].input_tokens}/out ${cl[0].output_tokens}${cl[0].route === 'unknown' ? '  ← роут не определился, отчёт «по фичам» бесполезен' : ''}` : 'СТРОК НЕТ — обёртка не логирует'}`)
      // Канарейка: расшифровка выше писала строку Whisper ИЗ ФОНОВОГО ДЖОБА.
      // Если она пропала — значит after() внутри джоба молча не выполняется,
      // и «починка» одного пути сломала другой.
      log(`${wh.length ? '✅' : '❌'} 7б. канарейка Whisper (запись из фонового джоба): ${wh.length} строк`)
      // Без user_id отчёт «по клиентам с маржой» пустой — а он и есть цель.
      const attributed = rows.filter(r => r.user_id === qa.id).length
      log(`${attributed > 0 ? '✅' : '❌'} 7в. расход привязан к клиенту: ${attributed} из ${rows.length} строк с user_id QA`)
    } else {
      log('・ 5-6. микро-часть пропущена (нет миграции 039)')
    }
  } finally {
    if (jobId) {
      const j = await api(`/rest/v1/jobs?select=result&id=eq.${jobId}`)
      materialId = Array.isArray(j.body) ? j.body[0]?.result?.materialId : null
      await api(`/rest/v1/jobs?id=eq.${jobId}`, { method: 'DELETE' }).catch(() => {})
    }
    if (materialId) await api(`/rest/v1/project_materials?id=eq.${materialId}`, { method: 'DELETE' }).catch(() => {})
    if (projectId) await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    if (storagePath) {
      await fetch(`${U}/storage/v1/object/audio-temp/${storagePath}`, { method: 'DELETE', headers: { apikey: K, Authorization: `Bearer ${K}` } }).catch(() => {})
    }
    try { unlinkSync(tmpFile) } catch { /* уже нет */ }
    const back = await api(`/rest/v1/profiles?id=eq.${qa.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ generations_used: used0, bonus_generations: bonus0, ...(micro0 !== undefined ? { micro_actions_count: micro0 } : {}) }),
    })
    const row = Array.isArray(back.body) ? back.body[0] : null
    log(row?.generations_used === used0
      ? `🧹 уборка: счётчики на месте (${used0} юн., ${bonus0} бон.), временные объекты удалены`
      : `❌ УБОРКА: почини руками generations_used=${used0} у ${QA_EMAIL}`)
  }
}

// ── ОТЧЁТ: куда уходят деньги (ai_usage + метеринг) ─────────────────────────
// Читает журнал ai_usage (миграция 039) и считает РЕАЛЬНУЮ себестоимость по
// фичам и юзерам, чтобы цены прайс-листа (UNIT_COSTS) держались на фактах, а
// не на оценках. Read-only.
//   node scripts/prod-probe.mjs usage-report [--days 14]
//
// Цены провайдеров ($ за 1М токенов / за единицу) — ставка на 25.08.2026.
// Меняются у провайдера — поправить здесь.
const PRICES = {
  'claude-opus-5':     { in: 5,    out: 25 },
  'claude-opus-4-8':   { in: 5,    out: 25 },
  'claude-sonnet-4-6': { in: 3,    out: 15 },
  'claude-sonnet-4-5': { in: 3,    out: 15 },
  'claude-haiku-4-5':  { in: 0.8,  out: 4 },
}
const FLAT = { 'whisper-1': 0.06, 'gpt-image-1': 0.19, 'apify~instagram-scraper': 0.005, 'apify~instagram-profile-scraper': 0.005 }

async function usageReport() {
  const days = Number(arg('days') || 14)
  const since = new Date(Date.now() - days * 864e5).toISOString()
  log(`\n=== Отчёт: куда уходят деньги (последние ${days} дн.) ===`)

  const rows = await api(`/rest/v1/ai_usage?select=created_at,user_id,route,provider,model,input_tokens,output_tokens&created_at=gte.${since}&limit=100000`)
  if (!Array.isArray(rows.body)) {
    log(`❌ ai_usage не читается (${rows.status}) — применена ли миграция 039?`)
    log(`   ${JSON.stringify(rows.body).slice(0, 200)}`)
    return
  }
  if (rows.body.length === 0) {
    log('Журнал пуст: миграция 039 применена только что / деплой ещё не собрал данные.')
    return
  }

  const cost = (r) => {
    const p = PRICES[r.model]
    if (p) return ((r.input_tokens ?? 0) * p.in + (r.output_tokens ?? 0) * p.out) / 1e6
    return FLAT[r.model] ?? 0
  }

  const byRoute = {}, byUser = {}, byProvider = {}
  let total = 0
  for (const r of rows.body) {
    const c = cost(r)
    total += c
    byRoute[r.route] = (byRoute[r.route] ?? 0) + c
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + c
    if (r.user_id) byUser[r.user_id] = (byUser[r.user_id] ?? 0) + c
  }

  const usd = (n) => `$${n.toFixed(2)}`
  log(`\nВСЕГО: ${usd(total)} за ${days} дн. (${rows.body.length} вызовов) ≈ ${usd(total / days * 30)} в месяц`)

  log('\nПО ПРОВАЙДЕРАМ:')
  for (const [k, v] of Object.entries(byProvider).sort((a, b) => b[1] - a[1])) {
    log(`  ${k.padEnd(16)} ${usd(v).padStart(9)}  ${Math.round(v / total * 100)}%`)
  }

  log('\nПО ФИЧАМ (топ-15):')
  for (const [k, v] of Object.entries(byRoute).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    log(`  ${k.padEnd(42)} ${usd(v).padStart(9)}`)
  }

  // Себестоимость на клиента против его выручки — это и есть «плюсовая математика».
  const ids = Object.keys(byUser)
  if (ids.length) {
    const prof = await api(`/rest/v1/profiles?select=id,email,subscription_tier,generations_used&id=in.(${ids.map(i => `"${i}"`).join(',')})`)
    const pmap = new Map((prof.body || []).map(p => [p.id, p]))
    // Выручка = цена тарифа за месяц (модель «2 месяца бесплатно» — считаем
    // ПОТЕНЦИАЛЬНУЮ выручку, деньги пойдут после демо-периода).
    const REVENUE = { trial: 0, solo: 49, pro: 149, producer: 299 }
    log('\nПО КЛИЕНТАМ (топ-15 по расходу; ставка месяца = расход×30/дней):')
    log('  ' + 'email'.padEnd(34) + 'тариф'.padEnd(10) + 'расход'.padStart(9) + '/мес'.padStart(10) + '  выручка   маржа')
    for (const [id, v] of Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      const p = pmap.get(id)
      const tier = p?.subscription_tier ?? '?'
      const monthly = v / days * 30
      const rev = REVENUE[tier] ?? 0
      const margin = rev - monthly
      const flag = rev > 0 && margin < 0 ? '  🔴 В МИНУС' : ''
      log(`  ${(p?.email ?? id).padEnd(34)}${String(tier).padEnd(10)}${usd(v).padStart(9)}${usd(monthly).padStart(10)}  ${usd(rev).padStart(7)} ${usd(margin).padStart(8)}${flag}`)
    }
  }

  log('\n💡 Если у кого-то маржа в минусе — поднять цену операции в UNIT_COSTS')
  log('   (lib/generations-config.ts) или лимит тарифа. Числа отсюда — факт, не оценка.')
}

// ── роутинг ──────────────────────────────────────────────────────────────────
const probe = process.argv[2]
const PROBES = { 'cascade-delete': cascadeDelete, 'link-payment': linkPayment, 'clean-ledger': cleanLedger, 'recovery-link': recoveryLink, 'recovery-token-hash': recoveryTokenHash, 'storage-limit': storageLimit, 'research-smoke': researchSmoke, 'meanings-smoke': meaningsSmoke, 'rebuild-meanings': rebuildMeanings, 'grant-access': grantAccess, 'canon-questions': canonQuestions, 'english-smoke': englishSmoke, 'set-language': setLanguage, 'angles-smoke': anglesSmoke, 'patch-material': patchMaterial, 'as-user': asUser, 'warmup-smoke': warmupSmoke, 'week-brief-smoke': weekBriefSmoke, 'autofill-smoke': autofillSmoke, 'competitors-smoke': competitorsSmoke, 'chat-unit-fate': chatUnitFate, 'generate-unit-fate': generateUnitFate, 'set-tier': setTier, 'limit-smoke': limitSmoke, 'usage-report': usageReport, 'meter-smoke': meterSmoke }

if (!PROBES[probe]) {
  log('Пробники:', Object.keys(PROBES).join(', '))
  log('Пример:  node scripts/prod-probe.mjs cascade-delete --run')
  process.exit(1)
}
await PROBES[probe]()
