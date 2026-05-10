'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Check, Minus, Star, Sparkles, Zap,
  BookOpen, Calendar, Mic2, ChevronRight, Menu, X,
} from 'lucide-react'

// ── Валюты ───────────────────────────────────────────────────────────────────
type Currency = 'RUB' | 'USD' | 'EUR'

const CURRENCY_CONFIG: Record<Currency, { symbol: string; prices: [number, number, number] }> = {
  RUB: { symbol: '₽', prices: [0, 2990, 5990] },
  USD: { symbol: '$', prices: [0, 29, 59] },
  EUR: { symbol: '€', prices: [0, 27, 54] },
}

// ── Тарифы ───────────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: 'Старт',
    period: 'навсегда бесплатно',
    popular: false,
    features: [
      { text: '1 прогрев в месяц', ok: true },
      { text: '30 AI-генераций постов', ok: true },
      { text: 'База знаний до 3 материалов', ok: true },
      { text: 'Контент-план на месяц', ok: false },
      { text: 'Приоритетная поддержка', ok: false },
      { text: 'Рилс и сториз', ok: false },
    ],
    cta: 'Начать бесплатно',
    href: '/register',
    gradient: false,
  },
  {
    name: 'Про',
    period: 'в месяц · 14 дней бесплатно',
    popular: true,
    features: [
      { text: 'Безлимитные прогревы', ok: true },
      { text: 'Безлимитные AI-генерации', ok: true },
      { text: 'База знаний без ограничений', ok: true },
      { text: 'Контент-план на месяц', ok: true },
      { text: 'Рилс, сториз, карусели', ok: true },
      { text: 'Выделенный менеджер', ok: false },
    ],
    cta: 'Попробовать 14 дней',
    href: '/register',
    gradient: true,
  },
  {
    name: 'Эксперт',
    period: 'в месяц',
    popular: false,
    features: [
      { text: 'Всё из тарифа Про', ok: true },
      { text: 'Несколько проектов / ниш', ok: true },
      { text: 'Аналитика контента', ok: true },
      { text: 'Выделенный менеджер', ok: true },
      { text: 'Обучение команды (до 3 чел.)', ok: true },
      { text: 'White-label опция', ok: true },
    ],
    cta: 'Подключить',
    href: '/register',
    gradient: false,
  },
]

// ── Отзывы ───────────────────────────────────────────────────────────────────
const REVIEWS = [
  {
    name: 'Анна К.',
    role: 'Коуч по отношениям',
    text: 'За 8 минут получила полный план прогрева на 45 дней. Раньше на такое уходила неделя. AMA пишет именно в моём голосе — подписчики не замечают разницы.',
    stars: 5,
    avatar: 'А',
  },
  {
    name: 'Михаил Р.',
    role: 'Эксперт по инвестициям',
    text: 'Наконец-то нейросеть, которая понимает специфику моей ниши. Загрузил материалы — и она пишет как я думаю. Контент-план на запуск готов за несколько минут.',
    stars: 5,
    avatar: 'М',
  },
  {
    name: 'Ольга С.',
    role: 'Нутрициолог',
    text: 'Раньше тратила 3 часа на один пост. Сейчас — 15 минут. AMA помнит все мои кейсы, мой тон и аудиторию. Каждый запуск теперь идёт по чёткой системе.',
    stars: 5,
    avatar: 'О',
  },
]

// ── Кнопка CTA ────────────────────────────────────────────────────────────────
function GradientButton({
  href,
  children,
  className = '',
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 px-8 h-14 rounded-[50px] gradient-accent text-white font-bold uppercase text-sm tracking-wide hover:opacity-90 transition-opacity shadow-lg hover:shadow-xl ${className}`}
    >
      {children}
      <ChevronRight className="h-4 w-4" />
    </Link>
  )
}

// ── Компонент лейбла секции ───────────────────────────────────────────────────
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-5">
      <div className="h-px w-10" style={{ background: 'linear-gradient(135deg, #F5A84A, #E86BA0)' }} />
      <span className="text-[11px] font-semibold tracking-[0.18em] uppercase gradient-text">
        {children}
      </span>
      <div className="h-px w-10" style={{ background: 'linear-gradient(135deg, #F5A84A, #E86BA0)' }} />
    </div>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────
function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#EBEBEB] bg-white/95 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
        {/* Logo */}
        <span className="text-lg font-black text-[#1A1A1A] tracking-tight">AMA</span>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-7">
          {[['Возможности', '#features'], ['Процесс', '#process'], ['Тарифы', '#pricing']].map(([label, href]) => (
            <a key={href} href={href} className="text-sm text-[#444444] hover:text-[#1A1A1A] transition-colors">
              {label}
            </a>
          ))}
        </nav>

        {/* CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm text-[#888888] hover:text-[#1A1A1A] transition-colors">
            Войти
          </Link>
          <Link
            href="/register"
            className="h-9 px-5 rounded-[50px] text-sm font-bold uppercase text-white gradient-accent hover:opacity-90 transition-opacity flex items-center gap-1"
          >
            Попробовать бесплатно <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Mobile burger */}
        <button className="md:hidden text-[#444444]" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-[#EBEBEB] bg-white px-5 py-4 space-y-3">
          {[['Возможности', '#features'], ['Процесс', '#process'], ['Тарифы', '#pricing']].map(([label, href]) => (
            <a key={href} href={href} className="block text-sm text-[#444444] py-1" onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/login" className="text-sm text-[#888888] py-1">Войти</Link>
            <Link
              href="/register"
              className="h-11 w-full rounded-[50px] text-sm font-bold uppercase text-white gradient-accent flex items-center justify-center gap-1"
            >
              Попробовать бесплатно <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section className="relative pt-36 pb-28 px-5 text-center overflow-hidden bg-white">
      {/* Decorative gradient blobs */}
      <div
        className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #F5A84A 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #D44E7E 0%, transparent 70%)' }}
      />

      <div className="relative max-w-4xl mx-auto space-y-7">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest text-white gradient-accent shadow-lg">
          <Sparkles className="h-3.5 w-3.5" />
          AI-ассистент для запусков
        </div>

        {/* Headline */}
        <h1 className="text-6xl sm:text-7xl lg:text-[5.5rem] font-black text-[#1A1A1A] leading-[1.05] tracking-tight uppercase">
          Твой личный{' '}
          <span className="gradient-text">AI SMM-щик</span>
          ,<br />который пишет как ты
        </h1>

        {/* Sub */}
        <p className="text-xl sm:text-2xl text-[#444444] max-w-2xl mx-auto leading-relaxed">
          AMA изучает твой голос, нишу и аудиторию — и создаёт контент, который звучит именно как ты. План прогрева за 8 минут. Посты, рилсы, сториз — одним кликом.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-3">
          <GradientButton href="/register" className="w-full sm:w-auto justify-center">
            Попробовать бесплатно
          </GradientButton>
          <a
            href="#features"
            className="h-14 px-8 w-full sm:w-auto justify-center rounded-[50px] font-semibold text-[#444444] border border-[#EBEBEB] hover:border-[#C5CBA5] hover:text-[#1A1A1A] transition-all flex items-center gap-2 text-sm"
          >
            Смотреть демо
          </a>
        </div>
      </div>
    </section>
  )
}

// ── Social proof ──────────────────────────────────────────────────────────────
function SocialProofBar() {
  const AVATARS = [
    { l: 'А' },
    { l: 'М' },
    { l: 'О' },
    { l: 'Н' },
    { l: 'К' },
  ]
  return (
    <div className="border-y border-[#C5CBA5] py-5 px-5 bg-[#FAFAF8]">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-5 sm:gap-8">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {AVATARS.map((a, i) => (
              <div
                key={i}
                className="w-9 h-9 rounded-full gradient-accent flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-white"
              >
                {a.l}
              </div>
            ))}
          </div>
          <span className="text-sm text-[#888888]">
            Уже используют <span className="text-[#1A1A1A] font-semibold">2 847</span> экспертов
          </span>
        </div>
        <div className="h-px w-px sm:h-4 sm:w-px bg-[#C5CBA5] hidden sm:block" />
        <div className="flex items-center gap-1.5">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
          ))}
          <span className="text-sm text-[#888888] ml-1">4.9 из 5 · 312 отзывов</span>
        </div>
      </div>
    </div>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function StatsSection() {
  const STATS = [
    { value: '2 847', label: 'экспертов уже используют', suffix: '+' },
    { value: '8', label: 'минут на первый план прогрева', suffix: '' },
    { value: '47', label: 'минут экономится каждый день', suffix: '' },
  ]
  return (
    <section className="py-20 px-5 bg-[#FAFAF8] border-y border-[#C5CBA5]">
      <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#C5CBA5]">
        {STATS.map((s, i) => (
          <div key={i} className="py-10 sm:py-0 px-8 text-center first:pt-0 last:pb-0">
            <div className="text-6xl sm:text-7xl font-black gradient-text leading-none">
              {s.value}{s.suffix}
            </div>
            <div className="text-sm text-[#888888] mt-3 max-w-[180px] mx-auto">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Problem ───────────────────────────────────────────────────────────────────
function ProblemSection() {
  const PAINS = [
    { emoji: '😩', text: 'Сидишь 3 часа над одним постом — и всё равно не то' },
    { emoji: '📅', text: 'Запуск горит, а контент-план не готов и в голове хаос' },
    { emoji: '🤖', text: 'Нейросети пишут безликий текст — не твой голос совсем' },
  ]

  return (
    <section className="py-28 px-5 bg-white">
      <div className="max-w-2xl mx-auto">
        <SectionLabel>Проблема</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-12 uppercase">Знакомо?</h2>
        <div className="space-y-4">
          {PAINS.map((p, i) => (
            <div key={i} className="flex items-center gap-5 p-6 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all">
              <span className="text-3xl shrink-0">{p.emoji}</span>
              <p className="text-base font-medium text-[#444444]">{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Solution ──────────────────────────────────────────────────────────────────
function SolutionSection() {
  return (
    <section className="py-28 px-5 bg-white border-t border-[#C5CBA5]">
      <div className="max-w-4xl mx-auto">
        <SectionLabel>Решение</SectionLabel>
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black text-[#1A1A1A] text-center mb-3 leading-tight uppercase">
          AMA знает твою нишу, твою аудиторию, твой стиль.
        </h2>
        <p className="text-xl sm:text-2xl font-bold text-center gradient-text mb-14">
          И пишет контент, который звучит именно как ты.
        </p>

        {/* Comparison */}
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="p-7 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] space-y-4 shadow-lg h-full">
            <p className="text-xs font-bold text-red-500 uppercase tracking-wider flex items-center gap-1.5">
              <X className="h-3.5 w-3.5" /> Без AMA
            </p>
            {['Часами смотришь в пустой экран', 'Контент-план теряется в заметках', 'Нейросеть пишет "не своим голосом"', 'Каждый запуск — стресс с нуля'].map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <Minus className="h-4 w-4 text-[#C5CBA5] mt-0.5 shrink-0" />
                <span className="text-sm text-[#888888]">{t}</span>
              </div>
            ))}
          </div>
          <div className="p-7 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] space-y-4 shadow-lg h-full">
            <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> С AMA
            </p>
            {['Контент за 20 минут в твоём голосе', 'Чёткий план по 4 фазам прогрева', 'AI помнит всё о тебе и твоей аудитории', 'Каждый запуск — система, а не хаос'].map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span className="text-sm text-[#444444]">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Features ──────────────────────────────────────────────────────────────────
function FeaturesSection() {
  const PHASES = [
    { label: 'Нишу', color: '#F5A84A', width: '65%' },
    { label: 'Эксперта', color: '#E86BA0', width: '75%' },
    { label: 'Продукт', color: '#D44E7E', width: '60%' },
    { label: 'Возражения', color: '#F5A84A', width: '45%' },
  ]

  const CALENDAR_COLORS = [
    '#FDE9CE', '#FDE9CE', '#FDE9CE', '#FADADF', '#FADADF', '#FADADF',
    '#FADADF', '#F9C8D8', '#F9C8D8', '#F9C8D8', '#F9C8D8', '#FDE9CE',
    '#FDE9CE', '#FDE9CE',
  ]

  const FILES = [
    { emoji: '🧠', name: 'Распаковка личности', done: true },
    { emoji: '🗂️', name: 'Карта смыслов', done: true },
    { emoji: '⭐', name: 'Кейсы клиентов', done: false },
  ]

  return (
    <section id="features" className="py-28 px-5 bg-white border-t border-[#C5CBA5]">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>Возможности</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-14 uppercase">
          Всё для запуска —<br />в{' '}
          <span className="gradient-text">одном месте</span>
        </h2>

        <div className="grid sm:grid-cols-2 gap-5">
          {/* Мастер прогрева */}
          <div className="p-7 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] space-y-5 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 mb-2 gradient-text">
                <Zap className="h-3.5 w-3.5" /> Мастер прогрева
              </p>
              <p className="text-lg font-black text-[#1A1A1A]">План прогрева за 8 минут</p>
            </div>
            <div className="space-y-2.5">
              {PHASES.map((p) => (
                <div key={p.label} className="flex items-center gap-2">
                  <span className="text-xs w-20 shrink-0 text-[#444444]">{p.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-[#EBEBEB]">
                    <div
                      className="h-full rounded-full gradient-accent"
                      style={{ width: p.width }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#888888]">AI собирает стратегию из твоих материалов, продукта и воронки.</p>
          </div>

          {/* Голос */}
          <div className="p-7 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] space-y-5 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 mb-2 gradient-text">
                <Mic2 className="h-3.5 w-3.5" /> Голос
              </p>
              <p className="text-lg font-black text-[#1A1A1A]">Пишет в твоём голосе</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#EBEBEB] text-xs text-[#888888]">
                Хочу рассказать про осознанность и как она помогает...
              </div>
              <ArrowRight className="h-4 w-4 mt-2 shrink-0" style={{ color: '#E86BA0' }} />
              <div className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#C5CBA5] text-xs text-[#444444]">
                Год назад я выгорела настолько, что не могла открыть ноутбук. Именно тогда я поняла...
              </div>
            </div>
            <p className="text-xs text-[#888888]">Загружаешь распаковку, кейсы, Tone of Voice — AI запоминает как ты думаешь.</p>
          </div>

          {/* Контент-план */}
          <div className="p-7 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] space-y-5 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 mb-2 gradient-text">
                <Calendar className="h-3.5 w-3.5" /> Планирование
              </p>
              <p className="text-lg font-black text-[#1A1A1A]">Контент-план на каждый день</p>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {CALENDAR_COLORS.map((c, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-md flex items-center justify-center"
                  style={{ backgroundColor: c }}
                >
                  <span className="text-[9px] font-bold text-[#888888]">{i + 2}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#888888]">Расписание по дням с конкретными смыслами. Нажми на день — получи готовый контент.</p>
          </div>

          {/* База знаний */}
          <div className="p-7 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] space-y-5 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 mb-2 gradient-text">
                <BookOpen className="h-3.5 w-3.5" /> База знаний
              </p>
              <p className="text-lg font-black text-[#1A1A1A]">База знаний проекта</p>
            </div>
            <div className="space-y-2">
              {FILES.map((f, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-3 rounded-xl bg-white border border-[#EBEBEB]">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{f.emoji}</span>
                    <span className="text-sm text-[#444444]">{f.name}</span>
                  </div>
                  {f.done
                    ? <Check className="h-4 w-4 text-emerald-500" />
                    : <div className="h-2 w-2 rounded-full" style={{ background: 'linear-gradient(135deg, #F5A84A, #E86BA0)' }} />
                  }
                </div>
              ))}
            </div>
            <p className="text-xs text-[#888888]">AI помнит всё. Обновляй материалы — качество текстов растёт автоматически.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Process ───────────────────────────────────────────────────────────────────
function ProcessSection() {
  const STEPS = [
    {
      num: '01',
      label: 'Шаги 1–3',
      icon: '☁️',
      title: 'Загрузи себя',
      desc: 'Загрузи распаковку личности, материалы о нише, кейсы клиентов. AMA изучит тебя и запомнит навсегда.',
    },
    {
      num: '02',
      label: 'Шаги 4–6',
      icon: '📅',
      title: 'Создай план',
      desc: 'Пройди 8-шаговый мастер прогрева. AI выстроит стратегию по 4 фазам специально под твой продукт и аудиторию.',
    },
    {
      num: '03',
      label: 'Шаги 7–8',
      icon: '✨',
      title: 'Генерируй контент',
      desc: 'Один клик — и у тебя готовый пост, рилс или сториз. Редактируй, одобряй, публикуй. AI учится на твоих правках.',
    },
  ]

  return (
    <section id="process" className="py-28 px-5 bg-white border-t border-[#C5CBA5]">
      <div className="max-w-3xl mx-auto">
        <SectionLabel>Процесс</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-14 uppercase">
          Запуск за <span className="gradient-text">3 шага</span>
        </h2>
        <div className="space-y-5">
          {STEPS.map((s, i) => (
            <div key={i} className="relative flex gap-6 p-7 rounded-2xl bg-[#FAFAF8] border border-[#C5CBA5] shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <div className="shrink-0 flex flex-col items-center gap-1">
                {/* Gradient number badge */}
                <div
                  className="w-14 h-14 rounded-full gradient-accent flex items-center justify-center text-white text-lg font-black shadow-lg"
                >
                  {s.num}
                </div>
                <span className="text-[10px] font-bold text-[#888888] mt-1">{s.label}</span>
                {/* Connecting dotted line */}
                {i < STEPS.length - 1 && (
                  <div
                    className="absolute left-[2.75rem] top-[5.5rem] w-px border-l-2 border-dashed border-[#C5CBA5]"
                    style={{ height: 'calc(100% - 1rem)' }}
                  />
                )}
              </div>
              <div className="pt-2">
                <h3 className="text-lg font-black text-[#1A1A1A] mb-2">{s.title}</h3>
                <p className="text-sm text-[#888888] leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Reviews ───────────────────────────────────────────────────────────────────
function ReviewsSection() {
  return (
    <section className="py-28 px-5 bg-[#F5F6EF] border-y border-[#C5CBA5]">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>Отзывы</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-14 uppercase">
          Что говорят <span className="gradient-text">эксперты</span>
        </h2>
        <div className="grid sm:grid-cols-3 gap-5">
          {REVIEWS.map((r, i) => (
            <div key={i} className="p-7 rounded-2xl bg-white border border-[#C5CBA5] space-y-4 shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all relative">
              {/* Decorative quote mark */}
              <div className="text-5xl font-black gradient-text leading-none select-none" aria-hidden="true">&ldquo;</div>
              <div className="flex items-center gap-1 -mt-2">
                {[...Array(r.stars)].map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-sm text-[#444444] leading-relaxed">{r.text}</p>
              <div className="flex items-center gap-3 pt-2">
                <div className="w-10 h-10 rounded-full gradient-accent flex items-center justify-center text-sm font-bold text-white">
                  {r.avatar}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#1A1A1A]">{r.name}</p>
                  <p className="text-[11px] text-[#888888]">{r.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function PricingSection() {
  const [currency, setCurrency] = useState<Currency>('RUB')
  const { symbol, prices } = CURRENCY_CONFIG[currency]

  return (
    <section id="pricing" className="py-28 px-5 bg-white border-t border-[#C5CBA5]">
      <div className="max-w-4xl mx-auto">
        <SectionLabel>Тарифы</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-6 uppercase">
          Прозрачные <span className="gradient-text">цены</span>
        </h2>

        {/* Currency switcher */}
        <div className="flex items-center justify-center gap-1 mb-12">
          {(['RUB', 'USD', 'EUR'] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`px-4 py-1.5 rounded-[50px] text-xs font-semibold transition-all ${
                currency === c
                  ? 'gradient-accent text-white'
                  : 'text-[#888888] hover:text-[#444444] bg-[#FAFAF8] border border-[#EBEBEB]'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-3 gap-5">
          {PLANS.map((plan, i) => (
            <div
              key={plan.name}
              className="relative p-6 rounded-2xl border border-[#C5CBA5] bg-[#FAFAF8] space-y-5 shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all"
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1 rounded-full text-[10px] font-bold text-white gradient-accent uppercase shadow-lg">
                    ПОПУЛЯРНЫЙ
                  </span>
                </div>
              )}

              {/* Price */}
              <div>
                <p className="text-sm font-black text-[#1A1A1A] mb-2 uppercase tracking-wide">{plan.name}</p>
                <div className="flex items-end gap-1">
                  <span className="text-xl font-bold text-[#888888]">{symbol}</span>
                  <span className="text-4xl font-black text-[#1A1A1A]">{prices[i].toLocaleString('ru-RU')}</span>
                </div>
                <p className="text-xs text-[#888888] mt-1">{plan.period}</p>
              </div>

              <hr className="border-[#C5CBA5]" />

              {/* Features */}
              <ul className="space-y-2.5">
                {plan.features.map((f, j) => (
                  <li key={j} className="flex items-center gap-2.5">
                    {f.ok
                      ? <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <Minus className="h-4 w-4 text-[#C5CBA5] shrink-0" />
                    }
                    <span className={`text-sm ${f.ok ? 'text-[#444444]' : 'text-[#C5CBA5]'}`}>{f.text}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {plan.gradient ? (
                <Link
                  href={plan.href}
                  className="w-full h-12 rounded-[50px] flex items-center justify-center text-sm font-bold uppercase text-white gradient-accent hover:opacity-90 transition-opacity gap-1 shadow-md"
                >
                  {plan.cta} <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <Link
                  href={plan.href}
                  className="w-full h-12 rounded-[50px] flex items-center justify-center text-sm font-bold uppercase text-[#444444] bg-white border border-[#C5CBA5] hover:border-[#E86BA0] hover:text-[#1A1A1A] transition-all gap-1"
                >
                  {plan.cta} <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Final CTA ─────────────────────────────────────────────────────────────────
function CtaSection() {
  return (
    <section className="py-32 px-5 text-center bg-[#1A1A1A] relative overflow-hidden">
      {/* Decorative blobs */}
      <div
        className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full opacity-10 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #F5A84A 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full opacity-10 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #D44E7E 0%, transparent 70%)' }}
      />
      <div className="relative max-w-2xl mx-auto space-y-6">
        <SectionLabel>Начни сейчас</SectionLabel>
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight uppercase">
          <span className="text-white">Начни свой первый прогрев </span>
          <span className="gradient-text">сегодня</span>
        </h2>
        <p className="text-gray-400 text-lg">Бесплатно. Без карты. Первый план за 8 минут.</p>
        <div className="pt-3 flex justify-center">
          <GradientButton href="/register">
            Попробовать бесплатно
          </GradientButton>
        </div>
        <div className="flex items-center justify-center gap-4 text-xs text-gray-500 pt-1">
          <span>🔒 Данные защищены</span>
          <span>·</span>
          <span>✓ Отмена в любой момент</span>
          <span>·</span>
          <span>→ Без кредитной карты</span>
        </div>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-[#EBEBEB] bg-white py-10 px-5">
      <div className="max-w-6xl mx-auto grid sm:grid-cols-3 gap-8 text-sm">
        <div>
          <span className="text-lg font-black text-[#1A1A1A] tracking-tight">AMA</span>
          <p className="text-[#888888] text-xs mt-1.5">AI SMM-ассистент для экспертов</p>
        </div>
        <div className="space-y-2">
          <Link href="#" className="block text-[#888888] hover:text-[#1A1A1A] transition-colors text-xs">Политика конфиденциальности</Link>
          <Link href="#" className="block text-[#888888] hover:text-[#1A1A1A] transition-colors text-xs">Условия использования</Link>
          <Link href="#" className="block text-[#888888] hover:text-[#1A1A1A] transition-colors text-xs">Поддержка</Link>
          <div className="flex gap-3 pt-1">
            <Link href="#" className="text-[#888888] hover:text-[#1A1A1A] transition-colors text-xs">Instagram</Link>
            <Link href="#" className="text-[#888888] hover:text-[#1A1A1A] transition-colors text-xs">Telegram</Link>
          </div>
        </div>
        <div className="text-[#888888] text-xs sm:text-right">
          © 2025 AMA. Сделано с ❤️ для экспертов.
        </div>
      </div>
    </footer>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#1A1A1A]">
      <Navbar />
      <main>
        <HeroSection />
        <SocialProofBar />
        <StatsSection />
        <ProblemSection />
        <SolutionSection />
        <FeaturesSection />
        <ProcessSection />
        <ReviewsSection />
        <PricingSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  )
}
