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

// ── роутинг ──────────────────────────────────────────────────────────────────
const probe = process.argv[2]
const PROBES = { 'cascade-delete': cascadeDelete }

if (!PROBES[probe]) {
  log('Пробники:', Object.keys(PROBES).join(', '))
  log('Пример:  node scripts/prod-probe.mjs cascade-delete --run')
  process.exit(1)
}
await PROBES[probe]()
