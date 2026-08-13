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
    log(`  3) POST ${APP}/api/ai/research-analyze step=table1 (короткое синтетическое интервью)`)
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

    // 3) table1 — живой Claude-вызов тем же путём, что у клиента
    let t0 = Date.now()
    const t1 = await fetch(`${APP}/api/ai/research-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, step: 'table1', transcription }),
    })
    const t1body = await t1.json().catch(() => null)
    if (!t1.ok || !t1body?.table1) {
      log(`❌ 3. table1 УПАЛ: HTTP ${t1.status} за ${((Date.now() - t0) / 1000).toFixed(1)}с`)
      log('   тело:', JSON.stringify(t1body).slice(0, 400))
      return
    }
    log(`✅ 3. table1 ок за ${((Date.now() - t0) / 1000).toFixed(1)}с (участников: ${t1body.table1.respondents?.length})`)

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
    log(`  3) POST ${APP}/api/ai/research-analyze step=generate_meanings (SSE до конца)`)
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
    if (!res.ok || !res.body) {
      log(`❌ 3. generate_meanings HTTP ${res.status}`)
      log('   тело:', (await res.text().catch(() => '')).slice(0, 300))
      return
    }
    // Дочитываем SSE до конца (done/error)
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
    if (errMsg) { log(`❌ 3. стрим вернул ошибку за ${((Date.now() - t0) / 1000).toFixed(1)}с: ${errMsg}`); return }
    if (!done) { log('⚠️ 3. стрим кончился без done — проверяю материал (сервер мог доделать)') }
    log(`✅ 3. generate_meanings отработал за ${((Date.now() - t0) / 1000).toFixed(1)}с`)

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
  log('\n=== Пробник-миграция: пересборка карт смыслов (слайд-канон) ===')

  const { body: maps } = await api('/rest/v1/project_materials?select=id,project_id,title,created_at&material_type=eq.meanings_map&order=created_at.desc')
  const byProject = new Map()
  for (const m of (maps || [])) {
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

      // 2) тот же путь, что кнопка «Обновить карту»
      const t0 = Date.now()
      const res = await fetch(`${APP}/api/ai/research-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ projectId: pid, step: 'generate_meanings' }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`)
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
      if (errMsg) throw new Error(errMsg)
      if (!done) throw new Error('стрим кончился без done')

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
      model: 'claude-opus-4-8',
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
    log(`  4) POST ${APP}/api/ai/generate post → английский, без «—», без "it's not just"/"here's the thing"`)
    log(`  5) POST ${APP}/api/ai/generate reels → английские реплики сцен`)
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

  const cleanup = async () => {
    await api(`/rest/v1/content_items?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/style_examples?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/project_materials?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    await api(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
    log('🧹 уборка: контент, примеры стиля, материалы и проект удалены')
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
    if (!tovRes.ok || !tovRes.body) {
      log(`❌ 3. extract-tone-of-voice HTTP ${tovRes.status}:`, (await tovRes.text().catch(() => '')).slice(0, 300))
      return
    }
    const tovStream = await readSSE(tovRes)
    if (tovStream.errMsg) { log(`❌ 3. ToV-стрим вернул ошибку: ${tovStream.errMsg}`); return }
    const tovMat = await api(`/rest/v1/project_materials?select=raw_content,processing_status&project_id=eq.${projectId}&material_type=eq.tone_of_voice`)
    const tov = Array.isArray(tovMat.body) ? tovMat.body[0] : null
    if (!tov || tov.processing_status !== 'ready') { log('❌ 3. ToV-материал не ready:', JSON.stringify(tovMat.body).slice(0, 200)); return }
    const tovLatin = latinShare(tov.raw_content)
    const tovQuotes = /["“”'‘’«»]/.test(tov.raw_content)
    log(`✅ 3. ToV за ${((Date.now() - t0) / 1000).toFixed(1)}с: ${tov.raw_content.length} симв, латиницы ${(tovLatin * 100).toFixed(0)}%, цитаты: ${tovQuotes ? 'есть' : 'НЕТ'}`)
    log('   превью:', tov.raw_content.slice(0, 180).replace(/\n/g, ' | '))
    if (tovLatin < 0.7) { log('❌ ToV НЕ английский (ожидали ≥70% латиницы) — описание уехало в русский'); return }

    // ── 4. Пост на английском ────────────────────────────────────────────────
    t0 = Date.now()
    const postRes = await fetch(`${APP}/api/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, contentType: 'post', dayNumber: 1, totalDays: 7, phase: 'awareness' }),
    })
    if (!postRes.ok || !postRes.body) { log(`❌ 4. generate post HTTP ${postRes.status}`); return }
    const postStream = await readSSE(postRes)
    if (postStream.errMsg) { log(`❌ 4. generate post ошибка: ${postStream.errMsg}`); return }
    const postItems = await api(`/rest/v1/content_items?select=body_text,title&project_id=eq.${projectId}&content_type=eq.post&order=created_at.desc&limit=1`)
    const post = Array.isArray(postItems.body) ? postItems.body[0] : null
    if (!post?.body_text) { log('❌ 4. пост не сохранился'); return }
    const postLatin = latinShare(post.body_text)
    const postTells = enTells(post.body_text)
    log(`✅ 4. пост за ${((Date.now() - t0) / 1000).toFixed(1)}с: ${post.body_text.length} симв, латиницы ${(postLatin * 100).toFixed(0)}%${postTells.length ? `, ⚠️ GPT-измы: ${postTells.join(', ')}` : ', GPT-измов нет'}`)
    log('   превью:', post.body_text.slice(0, 180).replace(/\n/g, ' | '))
    if (postLatin < 0.7) { log('❌ ПОСТ НЕ АНГЛИЙСКИЙ — язык контента не прокинулся'); return }

    // ── 5. Рилз на английском ────────────────────────────────────────────────
    t0 = Date.now()
    const reelsRes = await fetch(`${APP}/api/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ projectId, contentType: 'reels', dayNumber: 2, totalDays: 7, phase: 'awareness' }),
    })
    if (!reelsRes.ok || !reelsRes.body) { log(`❌ 5. generate reels HTTP ${reelsRes.status}`); return }
    const reelsStream = await readSSE(reelsRes)
    if (reelsStream.errMsg) { log(`❌ 5. generate reels ошибка: ${reelsStream.errMsg}`); return }
    const reelsItems = await api(`/rest/v1/content_items?select=structured_data,body_text&project_id=eq.${projectId}&content_type=eq.reels&order=created_at.desc&limit=1`)
    const reelsItem = Array.isArray(reelsItems.body) ? reelsItems.body[0] : null
    const reels = reelsItem?.structured_data?.reels
    if (!reels?.scenes?.length) { log('❌ 5. рилз без сцен:', JSON.stringify(reelsItem || {}).slice(0, 200)); return }
    const speech = reels.scenes.map(s => `${s?.audio?.speech || ''} ${s?.text_overlay || ''}`).join(' ')
    const speechLatin = latinShare(speech)
    const speechTells = enTells(speech)
    log(`✅ 5. рилз за ${((Date.now() - t0) / 1000).toFixed(1)}с: сцен ${reels.scenes.length}, латиницы в репликах ${(speechLatin * 100).toFixed(0)}%${speechTells.length ? `, ⚠️ GPT-измы: ${speechTells.join(', ')}` : ', GPT-измов нет'}`)
    if (speechLatin < 0.7) { log('❌ РЕПЛИКИ РИЛЗА НЕ АНГЛИЙСКИЕ'); return }

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

// ── ПРОБНИК: выставить язык блога клиентскому проекту ────────────────────────
// ⚠️ Пишет в КЛИЕНТСКИЙ проект (исключение из правила ama-probe-*) — запускать
// только по явной задаче владельца (13 августа: «закрепим настройкой» для
// Darina Komorowski). Использование:
//   node scripts/prod-probe.mjs set-language <projectId> <ru|en|es|null> --run
async function setLanguage() {
  const projectId = process.argv[3]
  const lang = process.argv[4]
  log('\n=== Пробник: выставить content_language проекту ===')
  if (!projectId || !['ru', 'en', 'es', 'null'].includes(lang || '')) {
    log('Использование: node scripts/prod-probe.mjs set-language <projectId> <ru|en|es|null> [--run]')
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

// ── роутинг ──────────────────────────────────────────────────────────────────
const probe = process.argv[2]
const PROBES = { 'cascade-delete': cascadeDelete, 'link-payment': linkPayment, 'clean-ledger': cleanLedger, 'recovery-link': recoveryLink, 'recovery-token-hash': recoveryTokenHash, 'storage-limit': storageLimit, 'research-smoke': researchSmoke, 'meanings-smoke': meaningsSmoke, 'rebuild-meanings': rebuildMeanings, 'grant-access': grantAccess, 'canon-questions': canonQuestions, 'english-smoke': englishSmoke, 'set-language': setLanguage }

if (!PROBES[probe]) {
  log('Пробники:', Object.keys(PROBES).join(', '))
  log('Пример:  node scripts/prod-probe.mjs cascade-delete --run')
  process.exit(1)
}
await PROBES[probe]()
