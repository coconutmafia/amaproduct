// Куда ведёт запись на консультацию с маркетологом (воронка Августы) — ОДНА
// точка для скоркарда аудита, финального экрана диагностики и .docx-выгрузки.
//
// Настройка без деплоя кода (вопрос Марины «календарь / форма / телеграм-бот»
// решается env-переменной, когда команда выберет сервис):
//   NEXT_PUBLIC_CONSULT_URL      — ПОЛНЫЙ адрес (Calendly, форма, бот) — главный;
//   NEXT_PUBLIC_CONSULT_TELEGRAM — иначе личка в Telegram (дефолт — Августа).
const CONSULT_TG = (process.env.NEXT_PUBLIC_CONSULT_TELEGRAM || 'avavasilik').replace(/^@/, '')
export const CONSULT_URL = process.env.NEXT_PUBLIC_CONSULT_URL || `https://t.me/${CONSULT_TG}`
