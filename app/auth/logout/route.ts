import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Use request.url as base so redirect works in any environment
  return NextResponse.redirect(new URL('/login', request.url))
}
