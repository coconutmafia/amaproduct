// Test stub for '@/lib/supabase/server'. Smoke tests exercise PURE logic only —
// if a test ever reaches for a real Supabase client, fail loudly instead of
// silently hitting the network.
export async function createClient(): Promise<never> {
  throw new Error('supabase server client is not available in smoke tests')
}
