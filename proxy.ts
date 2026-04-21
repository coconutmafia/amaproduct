import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Защищённые маршруты
const PROTECTED = ['/dashboard', '/projects', '/knowledge-vault', '/settings', '/referral', '/pricing', '/admin']

// Публичные маршруты (всегда доступны)
const PUBLIC = ['/login', '/register', '/auth']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED.some(p => pathname.startsWith(p))
  const isPublicAuth = PUBLIC.some(p => pathname.startsWith(p))

  if (!isProtected) {
    return NextResponse.next()
  }

  // Оптимистичная проверка: ищем куки сессии Supabase
  // Supabase SSR хранит сессию в куках вида sb-*-auth-token
  const cookies = request.cookies.getAll()
  const hasSession = cookies.some(
    c => c.name.includes('-auth-token') && c.value.length > 10
  )

  if (!hasSession) {
    // Нет куки сессии → редирект на логин
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Куки есть → пропускаем, Server Component сам проверит сессию
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
