'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Check, Minus, Star, Sparkles, Zap,
  BookOpen, Calendar, Mic2, ChevronDown, Menu, X,
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
    color: 'from-violet-500 to-purple-600',
  },
  {
    name: 'Михаил Р.',
    role: 'Эксперт по инвестициям',
    text: 'Наконец-то нейросеть, которая понимает специфику моей ниши. Загрузил материалы — и она пишет как я думаю. Контент-план на запуск готов за несколько минут.',
    stars: 5,
    avatar: 'М',
    color: 'from-blue-500 to-cyan-600',
  },
  {
    name: 'Ольга С.',
    role: 'Нутрициолог',
    text: 'Раньше тратила 3 часа на один пост. Сейчас — 15 минут. AMA помнит все мои кейсы, мой тон и аудиторию. Каждый запуск теперь идёт по чёткой системе.',
    stars: 5,
    avatar: 'О',
    color: 'from-pink-500 to-rose-600',
  },
]

// ── Компонент лейбла секции ───────────────────────────────────────────────────
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-4">
      <div className="h-px w-8 bg-violet-500/40" />
      <span className="text-[11px] font-semibold tracking-[0.15em] uppercase text-violet-400">
        {children}
      </span>
      <div className="h-px w-8 bg-violet-500/40" />
    </div>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────
function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
        {/* Logo */}
        <span className="text-lg font-black text-violet-400 tracking-tight">AMA</span>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-7">
          {[['Возможности', '#features'], ['Процесс', '#process'], ['Тарифы', '#pricing']].map(([label, href]) => (
            <a key={href} href={href} className="text-sm text-white/50 hover:text-white transition-colors">
              {label}
            </a>
          ))}
        </nav>

        {/* CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm text-white/50 hover:text-white transition-colors">
            Войти
          </Link>
          <Link
            href="/register"
            className="h-8 px-4 rounded-full text-sm font-semibold text-white gradient-accent hover:opacity-90 transition-opacity flex items-center"
          >
            Попробовать бесплатно
          </Link>
        </div>

        {/* Mobile burger */}
        <button className="md:hidden text-white/60" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/5 bg-[#0a0a0f] px-5 py-4 space-y-3">
          {[['Возможности', '#features'], ['Процесс', '#process'], ['Тарифы', '#pricing']].map(([label, href]) => (
            <a key={href} href={href} className="block text-sm text-white/60 py-1" onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/login" className="text-sm text-white/50 py-1">Войти</Link>
            <Link href="/register" className="h-10 rounded-full text-sm font-semibold text-white gradient-accent flex items-center justify-center">
              Попробовать бесплатно
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
    <section className="relative pt-32 pb-20 px-5 text-center overflow-hidden">
      {/* Glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[600px] h-[400px] rounded-full bg-violet-600/15 blur-[120px]" />
      </div>

      <div className="relative max-w-3xl mx-auto space-y-6">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/25 bg-violet-500/8 text-xs text-violet-300">
          <Sparkles className="h-3 w-3" />
          AI-ассистент для запусков
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.1] tracking-tight">
          Твой личный{' '}
          <span className="gradient-text">AI SMM-щик</span>
          ,<br />который пишет как ты
        </h1>

        {/* Sub */}
        <p className="text-white/50 text-lg max-w-xl mx-auto leading-relaxed">
          AMA изучает твой голос, нишу и аудиторию — и создаёт контент, который звучит именно как ты. План прогрева за 8 минут. Посты, рилсы, сториз — одним кликом.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/register"
            className="h-12 px-7 rounded-full font-semibold text-white gradient-accent hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
          >
            Попробовать бесплатно <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#features"
            className="h-12 px-7 rounded-full font-semibold text-white/70 border border-white/10 hover:border-white/20 hover:text-white transition-all flex items-center gap-2 text-sm"
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
    { l: 'А', c: 'from-violet-500 to-purple-600' },
    { l: 'М', c: 'from-blue-500 to-cyan-500' },
    { l: 'О', c: 'from-orange-400 to-pink-500' },
    { l: 'Н', c: 'from-green-400 to-teal-500' },
    { l: 'К', c: 'from-pink-400 to-rose-500' },
  ]
  return (
    <div className="border-y border-white/5 py-4 px-5">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-5 sm:gap-8">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {AVATARS.map((a, i) => (
              <div key={i} className={`w-8 h-8 rounded-full bg-gradient-to-br ${a.c} flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-[#0a0a0f]`}>
                {a.l}
              </div>
            ))}
          </div>
          <span className="text-sm text-white/60">
            Уже используют <span className="text-white font-semibold">2 847</span> экспертов
          </span>
        </div>
        <div className="h-px w-px sm:h-4 sm:w-px bg-white/10 hidden sm:block" />
        <div className="flex items-center gap-1.5">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
          ))}
          <span className="text-sm text-white/60 ml-1">4.9 из 5 · 312 отзывов</span>
        </div>
      </div>
    </div>
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
    <section className="py-20 px-5">
      <div className="max-w-2xl mx-auto">
        <SectionLabel>Проблема</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-black text-white text-center mb-10">Знакомо?</h2>
        <div className="space-y-3">
          {PAINS.map((p, i) => (
            <div key={i} className="flex items-center gap-4 p-5 rounded-2xl bg-white/[0.03] border border-white/6">
              <span className="text-2xl shrink-0">{p.emoji}</span>
              <p className="text-sm font-medium text-white/80">{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Solution ──────────────────────────────────────────────────────────────────
function SolutionSection() {
  const STATS = [
    { value: '2 847', label: 'активных экспертов' },
    { value: '47 мин', label: 'экономит в день' },
    { value: '8 мин', label: 'первый план прогрева' },
  ]

  return (
    <section className="py-20 px-5">
      <div className="max-w-4xl mx-auto">
        <SectionLabel>Решение</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-black text-white text-center mb-3 leading-tight">
          AMA знает твою нишу, твою аудиторию, твой стиль.
        </h2>
        <p className="text-xl sm:text-2xl font-bold text-center gradient-text mb-12">
          И пишет контент, который звучит именно как ты.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {STATS.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-2xl sm:text-4xl font-black gradient-text">{s.value}</div>
              <div className="text-xs text-white/40 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Comparison */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/6 space-y-3">
            <p className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
              <X className="h-3.5 w-3.5" /> Без AMA
            </p>
            {['Часами смотришь в пустой экран', 'Контент-план теряется в заметках', 'Нейросеть пишет "не своим голосом"', 'Каждый запуск — стресс с нуля'].map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <Minus className="h-3.5 w-3.5 text-white/20 mt-0.5 shrink-0" />
                <span className="text-sm text-white/40">{t}</span>
              </div>
            ))}
          </div>
          <div className="p-5 rounded-2xl bg-emerald-500/[0.05] border border-emerald-500/15 space-y-3">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> С AMA
            </p>
            {['Контент за 20 минут в твоём голосе', 'Чёткий план по 4 фазам прогрева', 'AI помнит всё о тебе и твоей аудитории', 'Каждый запуск — система, а не хаос'].map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-sm text-white/70">{t}</span>
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
    { label: 'Нишу', color: 'bg-cyan-400', width: 'w-[65%]' },
    { label: 'Эксперта', color: 'bg-violet-400', width: 'w-[75%]' },
    { label: 'Продукт', color: 'bg-pink-400', width: 'w-[60%]' },
    { label: 'Возражения', color: 'bg-orange-400', width: 'w-[45%]' },
  ]

  const CALENDAR_COLORS = [
    'bg-cyan-900/60', 'bg-cyan-900/60', 'bg-cyan-900/60', 'bg-violet-900/60', 'bg-violet-900/60', 'bg-violet-900/60',
    'bg-violet-900/60', 'bg-pink-900/60', 'bg-pink-900/60', 'bg-pink-900/60', 'bg-pink-900/60', 'bg-orange-900/60',
    'bg-orange-900/60', 'bg-orange-900/60',
  ]

  const FILES = [
    { emoji: '🧠', name: 'Распаковка личности', done: true },
    { emoji: '🗂️', name: 'Карта смыслов', done: true },
    { emoji: '⭐', name: 'Кейсы клиентов', done: false },
  ]

  return (
    <section id="features" className="py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>Возможности</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-black text-white text-center mb-12">
          Всё для запуска —<br />в{' '}
          <span className="gradient-text">одном месте</span>
        </h2>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Мастер прогрева */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/6 space-y-4">
            <div>
              <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Zap className="h-3 w-3" /> Мастер прогрева
              </p>
              <p className="text-base font-bold text-white">План прогрева за 8 минут</p>
            </div>
            <div className="space-y-2">
              {PHASES.map((p) => (
                <div key={p.label} className="flex items-center gap-2">
                  <span className="text-xs w-20 shrink-0" style={{ color: p.color.replace('bg-', '').includes('cyan') ? '#67e8f9' : p.color.includes('violet') ? '#c4b5fd' : p.color.includes('pink') ? '#f9a8d4' : '#fdba74' }}>
                    {p.label}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-white/5">
                    <div className={`h-full rounded-full ${p.color} ${p.width}`} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-white/30">AI собирает стратегию из твоих материалов, продукта и воронки.</p>
          </div>

          {/* Голос */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/6 space-y-4">
            <div>
              <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Mic2 className="h-3 w-3" /> Голос
              </p>
              <p className="text-base font-bold text-white">Пишет в твоём голосе</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/8 text-xs text-white/40">
                Хочу рассказать про осознанность и как она помогает...
              </div>
              <ArrowRight className="h-4 w-4 text-violet-400 mt-2 shrink-0" />
              <div className="flex-1 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-white/70">
                Год назад я выгорела настолько, что не могла открыть ноутбук. Именно тогда я поняла...
              </div>
            </div>
            <p className="text-xs text-white/30">Загружаешь распаковку, кейсы, Tone of Voice — AI запоминает как ты думаешь.</p>
          </div>

          {/* Контент-план */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/6 space-y-4">
            <div>
              <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Calendar className="h-3 w-3" /> Планирование
              </p>
              <p className="text-base font-bold text-white">Контент-план на каждый день</p>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {CALENDAR_COLORS.map((c, i) => (
                <div key={i} className={`aspect-square rounded-md ${c} flex items-center justify-center`}>
                  <span className="text-[9px] font-bold text-white/60">{i + 2}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-white/30">Расписание по дням с конкретными смыслами. Нажми на день — получи готовый контент.</p>
          </div>

          {/* База знаний */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/6 space-y-4">
            <div>
              <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <BookOpen className="h-3 w-3" /> База знаний
              </p>
              <p className="text-base font-bold text-white">База знаний проекта</p>
            </div>
            <div className="space-y-2">
              {FILES.map((f, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/6">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{f.emoji}</span>
                    <span className="text-sm text-white/70">{f.name}</span>
                  </div>
                  {f.done
                    ? <Check className="h-4 w-4 text-emerald-400" />
                    : <div className="h-2 w-2 rounded-full bg-violet-400" />
                  }
                </div>
              ))}
            </div>
            <p className="text-xs text-white/30">AI помнит всё. Обновляй материалы — качество текстов растёт автоматически.</p>
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
      num: '①',
      label: 'Шаги 1–3',
      icon: '☁️',
      title: 'Загрузи себя',
      desc: 'Загрузи распаковку личности, материалы о нише, кейсы клиентов. AMA изучит тебя и запомнит навсегда.',
    },
    {
      num: '②',
      label: 'Шаги 4–6',
      icon: '📅',
      title: 'Создай план',
      desc: 'Пройди 8-шаговый мастер прогрева. AI выстроит стратегию по 4 фазам специально под твой продукт и аудиторию.',
    },
    {
      num: '③',
      label: 'Шаги 7–8',
      icon: '✨',
      title: 'Генерируй контент',
      desc: 'Один клик — и у тебя готовый пост, рилс или сториз. Редактируй, одобряй, публикуй. AI учится на твоих правках.',
    },
  ]

  return (
    <section id="process" className="py-20 px-5">
      <div className="max-w-3xl mx-auto">
        <SectionLabel>Процесс</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-black text-white text-center mb-12">
          Запуск за <span className="gradient-text">3 шага</span>
        </h2>
        <div className="space-y-4">
          {STEPS.map((s, i) => (
            <div key={i} className="flex gap-5 p-5 rounded-2xl bg-white/[0.03] border border-white/6">
              <div className="shrink-0 flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-2xl bg-violet-500/15 flex items-center justify-center text-2xl">
                  {s.icon}
                </div>
                <span className="text-[10px] font-bold text-violet-400">{s.label}</span>
              </div>
              <div>
                <h3 className="font-bold text-white mb-1">{s.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{s.desc}</p>
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
    <section className="py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>Отзывы</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-black text-white text-center mb-12">
          Что говорят <span className="gradient-text">эксперты</span>
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {REVIEWS.map((r, i) => (
            <div key={i} className="p-5 rounded-2xl bg-white/[0.03] border border-white/6 space-y-4">
              <div className="flex items-center gap-1">
                {[...Array(r.stars)].map((_, j) => (
                  <Star key={j} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-sm text-white/60 leading-relaxed">{r.text}</p>
              <div className="flex items-center gap-3 pt-1">
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${r.color} flex items-center justify-center text-xs font-bold text-white`}>
                  {r.avatar}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{r.name}</p>
                  <p className="text-[11px] text-white/30">{r.role}</p>
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
    <section id="pricing" className="py-20 px-5">
      <div className="max-w-4xl mx-auto">
        <SectionLabel>Тарифы</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-black text-white text-center mb-6">
          Прозрачные <span className="gradient-text">цены</span>
        </h2>

        {/* Currency switcher */}
        <div className="flex items-center justify-center gap-1 mb-10">
          {(['RUB', 'USD', 'EUR'] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                currency === c
                  ? 'gradient-accent text-white'
                  : 'text-white/40 hover:text-white/70 bg-white/[0.04]'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {PLANS.map((plan, i) => (
            <div
              key={plan.name}
              className={`relative p-5 rounded-2xl border space-y-5 ${
                plan.popular
                  ? 'bg-violet-500/[0.07] border-violet-500/30'
                  : 'bg-white/[0.03] border-white/6'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full text-[10px] font-bold text-white gradient-accent">
                    ПОПУЛЯРНЫЙ
                  </span>
                </div>
              )}

              {/* Price */}
              <div>
                <p className="text-sm font-semibold text-white mb-2">{plan.name}</p>
                <div className="flex items-end gap-1">
                  <span className="text-xl font-bold text-white/50">{symbol}</span>
                  <span className="text-4xl font-black text-white">{prices[i].toLocaleString('ru-RU')}</span>
                </div>
                <p className="text-xs text-white/30 mt-1">{plan.period}</p>
              </div>

              <hr className="border-white/6" />

              {/* Features */}
              <ul className="space-y-2.5">
                {plan.features.map((f, j) => (
                  <li key={j} className="flex items-center gap-2.5">
                    {f.ok
                      ? <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      : <Minus className="h-4 w-4 text-white/15 shrink-0" />
                    }
                    <span className={`text-sm ${f.ok ? 'text-white/70' : 'text-white/20'}`}>{f.text}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href={plan.href}
                className={`w-full h-11 rounded-xl flex items-center justify-center text-sm font-semibold transition-all ${
                  plan.gradient
                    ? 'gradient-accent text-white hover:opacity-90'
                    : 'bg-white/[0.06] text-white/70 hover:bg-white/10 hover:text-white border border-white/8'
                }`}
              >
                {plan.cta}
              </Link>
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
    <section className="py-24 px-5 text-center relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[300px] rounded-full bg-violet-600/10 blur-[100px]" />
      </div>
      <div className="relative max-w-2xl mx-auto space-y-5">
        <SectionLabel>Начни сейчас</SectionLabel>
        <h2 className="text-3xl sm:text-5xl font-black text-white leading-tight">
          Начни свой первый прогрев <span className="gradient-text">сегодня</span>
        </h2>
        <p className="text-white/40">Бесплатно. Без карты. Первый план за 8 минут.</p>
        <div className="pt-2">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 h-12 px-8 rounded-full font-semibold text-white gradient-accent hover:opacity-90 transition-opacity"
          >
            Попробовать бесплатно <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="flex items-center justify-center gap-4 text-xs text-white/25 pt-1">
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
    <footer className="border-t border-white/5 py-10 px-5">
      <div className="max-w-6xl mx-auto grid sm:grid-cols-3 gap-8 text-sm">
        <div>
          <span className="text-lg font-black text-violet-400 tracking-tight">AMA</span>
          <p className="text-white/30 text-xs mt-1.5">AI SMM-ассистент для экспертов</p>
        </div>
        <div className="space-y-2">
          <Link href="#" className="block text-white/30 hover:text-white/60 transition-colors text-xs">Политика конфиденциальности</Link>
          <Link href="#" className="block text-white/30 hover:text-white/60 transition-colors text-xs">Условия использования</Link>
          <Link href="#" className="block text-white/30 hover:text-white/60 transition-colors text-xs">Поддержка</Link>
          <div className="flex gap-3 pt-1">
            <Link href="#" className="text-white/30 hover:text-white/60 transition-colors text-xs">Instagram</Link>
            <Link href="#" className="text-white/30 hover:text-white/60 transition-colors text-xs">Telegram</Link>
          </div>
        </div>
        <div className="text-white/20 text-xs sm:text-right">
          © 2025 AMA. Сделано с ❤️ для экспертов.
        </div>
      </div>
    </footer>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <main>
        <HeroSection />
        <SocialProofBar />
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
