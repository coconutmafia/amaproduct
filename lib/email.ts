// Transactional email via Resend — DORMANT until RESEND_API_KEY is set (then
// emails just start flowing, no code change). Used by the chain-watch cron for
// trial lifecycle notices; add payment-failed/receipt senders at billing launch.
const FROM = process.env.EMAIL_FROM || 'AMA <hello@amaproduct.com>'

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.error('[email] resend failed:', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return false
    }
    return true
  } catch (e) {
    console.error('[email] send error:', e instanceof Error ? e.message : e)
    return false
  }
}

const wrap = (body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.55">
  ${body}
  <p style="margin-top:28px;font-size:13px;color:#888">Команда AMAproduct · <a href="https://amaproduct.com" style="color:#d44e7e">amaproduct.com</a></p>
</div>`

export function trialEndingEmail(daysLeft: number): { subject: string; html: string } {
  return {
    subject: `Твой пробный период заканчивается через ${daysLeft} дн.`,
    html: wrap(`
      <h2 style="margin:0 0 12px">Пробный период заканчивается</h2>
      <p>Через <b>${daysLeft} дн.</b> закончится твой бесплатный доступ к AI-продюсеру.</p>
      <p>Чтобы контент-план, генерация и все материалы продолжили работать без паузы — выбери тариф:</p>
      <p style="margin:20px 0"><a href="https://amaproduct.com/pricing" style="background:#d44e7e;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Выбрать тариф</a></p>
      <p style="font-size:14px;color:#555">Все твои проекты и материалы сохранятся в любом случае.</p>`),
  }
}

export function trialEndedEmail(): { subject: string; html: string } {
  return {
    subject: 'Пробный период закончился — генерация на паузе',
    html: wrap(`
      <h2 style="margin:0 0 12px">Пробный период закончился</h2>
      <p>Генерация контента поставлена на паузу, но все проекты и материалы на месте — ничего не пропало.</p>
      <p style="margin:20px 0"><a href="https://amaproduct.com/pricing" style="background:#d44e7e;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Продолжить с тарифом</a></p>`),
  }
}
