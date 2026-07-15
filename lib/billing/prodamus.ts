// Server-only Продамус (payform) helpers — РФ recurring payments.
// Dormant until env is set: PRODAMUS_SECRET_KEY, PRODAMUS_FORM_URL (default below),
// and a subscription id per plan (PRODAMUS_SUB_SOLO / _PRO / _PRODUCER) created in
// the Продамус личный кабинет (monthly, demo period = our trial).
import crypto from 'node:crypto'
import type { PaidPlan } from '@/lib/generations-config'

// Actual live payform (confirmed 14 июля). Only a fallback — the real value in
// prod comes from env PRODAMUS_FORM_URL / PRODAMUS_LINK_*; keep this in sync so
// the fallback isn't a stale form. (Was sistema-avavasilik.payform.ru.)
const DEFAULT_FORM = 'https://avavasilik.payform.ru/'

export function prodamusFormUrl(): string {
  return process.env.PRODAMUS_FORM_URL || DEFAULT_FORM
}
export function prodamusConfigured(): boolean {
  return !!process.env.PRODAMUS_SECRET_KEY
}
export function prodamusSubId(plan: PaidPlan): string | undefined {
  return {
    solo: process.env.PRODAMUS_SUB_SOLO,
    pro: process.env.PRODAMUS_SUB_PRO,
    producer: process.env.PRODAMUS_SUB_PRODUCER,
  }[plan]
}

// Direct per-subscription payform links (as created in the ЛК, e.g.
// https://payform.ru/k4bMP2U/). Preferred over base-form + subscription id.
export function prodamusLink(plan: PaidPlan): string | undefined {
  return {
    solo: process.env.PRODAMUS_LINK_SOLO,
    pro: process.env.PRODAMUS_LINK_PRO,
    producer: process.env.PRODAMUS_LINK_PRODUCER,
  }[plan]
}

// ── HMAC signature (Продамус Hmac) ────────────────────────────────────────────
// Algorithm (per Продамус docs): cast every value to string, recursively sort by
// key, json_encode with UNESCAPED unicode but ESCAPED slashes, then
// hash_hmac('sha256', json, secret). Sequential-keyed objects must encode as JSON
// arrays (PHP $_POST distinction) — phpNormalize handles that.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function phpNormalize(node: any): any {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const keys = Object.keys(node)
    const isList = keys.length > 0 && keys.every((k, i) => k === String(i))
    if (isList) return keys.map((k) => phpNormalize(node[k]))
    const o: Record<string, unknown> = {}
    for (const k of keys) o[k] = phpNormalize(node[k])
    return o
  }
  return node
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortDeepStringify(node: any): any {
  if (Array.isArray(node)) return node.map(sortDeepStringify)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(node).sort()) out[k] = sortDeepStringify(node[k])
    return out
  }
  return node === null || node === undefined ? '' : String(node)
}

export function prodamusSign(data: Record<string, unknown>, secret = process.env.PRODAMUS_SECRET_KEY || ''): string {
  const normalized = sortDeepStringify(phpNormalize(data))
  // PHP json_encode(JSON_UNESCAPED_UNICODE): raw unicode, but slashes ARE escaped.
  const json = JSON.stringify(normalized).replace(/\//g, '\\/')
  return crypto.createHmac('sha256', secret).update(json, 'utf8').digest('hex')
}

export function prodamusVerify(data: Record<string, unknown>, sign: string, secret = process.env.PRODAMUS_SECRET_KEY || ''): boolean {
  if (!sign || !secret) return false
  const expected = prodamusSign(data, secret)
  const a = Buffer.from(expected)
  const b = Buffer.from(sign)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Deactivate a Продамус subscription via REST setActivity (POST {account}/rest/
// setActivity/). Used when a user switches plans — the previous subscription must
// be cancelled so they aren't billed for both. `active_manager=0` = deactivated by
// the page owner (reversible; user-deactivation is permanent). Best-effort: returns
// false on any failure — the caller logs it and continues (a failed cancel just
// leaves the old sub active, which is the pre-existing state, not a regression).
export async function prodamusDeactivateSubscription(subscriptionId: string, customerEmail?: string): Promise<{ ok: boolean; detail?: string }> {
  if (!prodamusConfigured()) return { ok: false, detail: 'not_configured' }
  try {
    const base = prodamusFormUrl().replace(/\/?$/, '/')
    const payload: Record<string, string> = {
      subscription: String(subscriptionId),
      active_manager: '0',
      ...(customerEmail ? { customer_email: customerEmail } : {}),
    }
    const signature = prodamusSign(payload)
    const body = new URLSearchParams({ ...payload, signature })
    const res = await fetch(`${base}rest/setActivity/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const text = await res.text().catch(() => '')
    return { ok: res.ok, detail: `${res.status} ${text.slice(0, 120)}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'error' }
  }
}

// ── Parse a php-style x-www-form-urlencoded body (products[0][name]=…) ─────────
export function parseFormNested(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body)
  const root: Record<string, unknown> = {}
  for (const [rawKey, value] of params) {
    const head = rawKey.match(/^([^[]+)(.*)$/)
    if (!head) continue
    const path = [head[1]]
    const re = /\[([^\]]*)\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(head[2])) !== null) path.push(m[1])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = root
    for (let i = 0; i < path.length; i++) {
      const key = path[i] || String(Object.keys(node).length)
      if (i === path.length - 1) node[key] = value
      else { if (node[key] == null || typeof node[key] !== 'object') node[key] = {}; node = node[key] }
    }
  }
  return root
}

// order_id encodes who+what so the callback maps back. UUID has no dots; plans are
// letters — so '.' is a safe delimiter.
export function buildOrderId(userId: string, plan: PaidPlan, ts: number): string {
  return `${userId}.${plan}.${ts}`
}
export function parseOrderId(orderId: string): { userId: string; plan: string } | null {
  const p = String(orderId).split('.')
  return p.length >= 2 ? { userId: p[0], plan: p[1] } : null
}

// Продамус payment_status → our subscription_status.
export function mapProdamusStatus(s: string): string {
  const v = (s || '').toLowerCase()
  if (v === 'success') return 'active'
  if (v === 'failed' || v === 'expired') return 'past_due'
  return 'past_due'
}
