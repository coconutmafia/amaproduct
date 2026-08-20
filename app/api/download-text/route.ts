import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST /api/download-text — «эхо-скачивание» текстового файла, собранного на
// клиенте (CSV сводной таблицы, .md контент-плана, .txt распаковки).
//
// ЗАЧЕМ (инцидент 20.08): blob + <a download> молча не работает в
// Telegram-webview и iOS-PWA, а именно оттуда приходят наши юзеры. Скрытая
// форма делает top-level POST сюда, сервер отвечает attachment — такую
// навигацию обрабатывает любой браузер/webview, страница остаётся на месте.
//
// Безопасность: только text/* из белого списка + attachment + nosniff —
// содержимое НИКОГДА не рендерится браузером, XSS-поверхности нет; ≤2МБ;
// только для залогиненных (эндпоинт не хранит и не логирует содержимое).
const ALLOWED_MIME = new Set(['text/csv', 'text/markdown', 'text/plain'])
const MAX_BYTES = 2 * 1024 * 1024

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let filename = '', mime = '', content = ''
  const ct = request.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const b = await request.json().catch(() => ({})) as Record<string, string>
    filename = String(b.filename ?? ''); mime = String(b.mime ?? ''); content = String(b.content ?? '')
  } else {
    const fd = await request.formData().catch(() => null)
    if (!fd) return NextResponse.json({ error: 'Bad form' }, { status: 400 })
    filename = String(fd.get('filename') ?? ''); mime = String(fd.get('mime') ?? ''); content = String(fd.get('content') ?? '')
  }

  if (!ALLOWED_MIME.has(mime)) return NextResponse.json({ error: 'Bad mime' }, { status: 400 })
  if (!content) return NextResponse.json({ error: 'Empty content' }, { status: 400 })
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    return NextResponse.json({ error: 'Too large' }, { status: 413 })
  }
  const safe = filename.replace(/[^\p{L}\p{N}\s._-]/gu, '').trim().slice(0, 100) || 'download.txt'
  const ext = safe.includes('.') ? safe.split('.').pop() : (mime === 'text/csv' ? 'csv' : mime === 'text/markdown' ? 'md' : 'txt')

  return new NextResponse(content, {
    headers: {
      'Content-Type': `${mime}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="download.${ext}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
