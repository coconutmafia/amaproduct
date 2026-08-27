import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Класс, который в этом проекте всплыл ТРИЖДЫ и каждый раз молча:
// внутри after() / фонового джоба пишут СЕССИОННЫМ клиентом, а сессии там уже
// нет — RLS режет запись, и готовая работа клиента пропадает:
//   • эмбеддинги материалов (часть файлов не индексировалась);
//   • «ToV собран, но не сохранился» (прод, 25.08) — минута ожидания и
//     оплаченная генерация в никуда;
//   • карта смыслов — тот же путь.
// Правило: доступ проверяем в ЗАПРОСЕ, а пишем из фона сервис-ролью.

const ROOT = join(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.next', '.git'].includes(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p)
  }
  return out
}

// Тело каждого after(() => { … }) с балансировкой скобок.
function afterBodies(src: string): string[] {
  const bodies: string[] = []
  const re = /after\(\s*(?:async\s*)?\(\)\s*=>\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1, i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    bodies.push(src.slice(m.index + m[0].length, i))
  }
  return bodies
}

const WRITE = /(upsertProjectMaterial\(\s*supabase|supabase\s*\.\s*from\([^)]*\)\s*\.\s*(?:insert|update|upsert|delete)\s*\()/

describe('фоновая запись идёт сервис-ролью, а не сессией', () => {
  const files = [...walk(join(ROOT, 'app', 'api')), ...walk(join(ROOT, 'lib'))]

  it('внутри after() никто не пишет сессионным клиентом', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('after(')) continue
      for (const body of afterBodies(src)) {
        if (WRITE.test(body)) offenders.push(f.replace(ROOT + '/', ''))
      }
    }
    expect(offenders, 'RLS зарежет эту запись — работа клиента пропадёт').toEqual([])
  })

  it('раннеры фоновых джобов не пишут сессионным клиентом', () => {
    const offenders: string[] = []
    for (const f of walk(join(ROOT, 'lib', 'jobs'))) {
      const src = readFileSync(f, 'utf8')
      if (WRITE.test(src)) offenders.push(f.replace(ROOT + '/', ''))
    }
    expect(offenders).toEqual([])
  })

  it('эмбеддинги материалов пишутся сервис-ролью (починено 26.08)', () => {
    const src = readFileSync(join(ROOT, 'lib', 'ai', 'embed.ts'), 'utf8')
    expect(src).toMatch(/createAdminClient\(\)/)
    expect(src, 'ошибку вставки нельзя глотать — она и прятала проблему').toMatch(/insErr/)
  })
})
