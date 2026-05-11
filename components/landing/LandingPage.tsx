'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Check, Minus, Star, Sparkles, Zap,
  BookOpen, Calendar, Mic2, ChevronRight, Menu, X, ArrowRight,
} from 'lucide-react'

// ── Декоративная пальма ───────────────────────────────────────────────────────
function PalmLeft({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 260 520" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Trunk */}
      <path d="M130 520 C127 480 133 420 128 340 C123 260 135 180 130 100" stroke="#B5C985" strokeWidth="10" strokeLinecap="round"/>
      {/* Left fronds */}
      <path d="M130 100 C110 75 75 60 20 72" stroke="#B5C985" strokeWidth="7" strokeLinecap="round"/>
      <path d="M130 112 C100 105 58 120 10 148" stroke="#9DBB6E" strokeWidth="6" strokeLinecap="round"/>
      <path d="M130 124 C108 148 80 178 52 218" stroke="#B5C985" strokeWidth="5" strokeLinecap="round"/>
      <path d="M130 116 C95 128 55 155 18 195" stroke="#A8C278" strokeWidth="5" strokeLinecap="round"/>
      {/* Right fronds */}
      <path d="M130 100 C150 75 185 60 240 72" stroke="#B5C985" strokeWidth="7" strokeLinecap="round"/>
      <path d="M130 112 C160 105 202 120 250 148" stroke="#9DBB6E" strokeWidth="6" strokeLinecap="round"/>
      <path d="M130 124 C152 148 180 178 208 218" stroke="#B5C985" strokeWidth="5" strokeLinecap="round"/>
      <path d="M130 116 C165 128 205 155 242 195" stroke="#A8C278" strokeWidth="5" strokeLinecap="round"/>
      {/* Top frond */}
      <path d="M130 100 C126 68 120 38 114 10" stroke="#B5C985" strokeWidth="6" strokeLinecap="round"/>
      <path d="M130 100 C134 68 140 38 146 10" stroke="#9DBB6E" strokeWidth="5" strokeLinecap="round"/>
      {/* Coconuts */}
      <circle cx="130" cy="104" r="6" fill="#C8A96E" opacity="0.6"/>
      <circle cx="122" cy="110" r="5" fill="#C8A96E" opacity="0.5"/>
      <circle cx="138" cy="108" r="5" fill="#C8A96E" opacity="0.5"/>
    </svg>
  )
}
import {
  motion, useInView, useMotionValue, useSpring,
  useTransform, animate, AnimatePresence,
} from 'framer-motion'

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

// ── Утилиты анимаций ──────────────────────────────────────────────────────────
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: EASE },
  }),
}

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
}

function RevealSection({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      variants={stagger}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Анимированный счётчик ─────────────────────────────────────────────────────
function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  const motionVal = useMotionValue(0)
  const [display, setDisplay] = useState('0')

  useEffect(() => {
    if (!inView) return
    const controls = animate(motionVal, value, {
      duration: 2.2,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v).toLocaleString('ru-RU')),
    })
    return controls.stop
  }, [inView, value, motionVal])

  return <span ref={ref}>{display}{suffix}</span>
}

// ── 3D-наклон карточки ────────────────────────────────────────────────────────
function TiltCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [6, -6]), { stiffness: 300, damping: 30 })
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-6, 6]), { stiffness: 300, damping: 30 })

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    x.set((e.clientX - rect.left) / rect.width - 0.5)
    y.set((e.clientY - rect.top) / rect.height - 0.5)
  }, [x, y])

  const handleMouseLeave = useCallback(() => {
    x.set(0); y.set(0)
  }, [x, y])

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      whileHover={{ scale: 1.02 }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Кнопка CTA ────────────────────────────────────────────────────────────────
function GradientButton({ href, children, className = '', large = false }: {
  href: string; children: React.ReactNode; className?: string; large?: boolean
}) {
  return (
    <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
      <Link
        href={href}
        className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto ${large ? 'px-9 h-16 text-base' : 'px-8 h-14 text-sm'} rounded-[50px] gradient-accent text-white font-bold uppercase tracking-wide hover:opacity-95 transition-opacity shadow-lg shadow-[#E86BA0]/30 hover:shadow-xl hover:shadow-[#E86BA0]/40 ${className}`}
      >
        {children}
        <ChevronRight className={large ? 'h-5 w-5' : 'h-4 w-4'} />
      </Link>
    </motion.div>
  )
}

// ── Лейбл секции ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: string }) {
  return (
    <motion.div variants={fadeUp} className="flex items-center justify-center gap-3 mb-5">
      <div className="h-px w-10" style={{ background: 'linear-gradient(135deg, #3A9A50, #F5A84A)' }} />
      <span className="text-[11px] font-bold tracking-[0.18em] uppercase gradient-text">{children}</span>
      <div className="h-px w-10" style={{ background: 'linear-gradient(135deg, #3A9A50, #F5A84A)' }} />
    </motion.div>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────
function Navbar() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: EASE }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/85 backdrop-blur-xl border-b border-[#C5CBA5]/60 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <motion.span
          whileHover={{ scale: 1.05 }}
          className="text-xl font-black text-[#1A1A1A] tracking-tight cursor-default"
        >
          AMA<span className="gradient-text">product</span>
        </motion.span>

        <nav className="hidden md:flex items-center gap-8">
          {[['Возможности', '#features'], ['Процесс', '#process'], ['Тарифы', '#pricing']].map(([label, href]) => (
            <a key={href} href={href} className="text-sm text-[#555] hover:text-[#1A1A1A] transition-colors font-medium">
              {label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm text-[#888] hover:text-[#1A1A1A] transition-colors font-medium">
            Войти
          </Link>
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <Link
              href="/register"
              className="h-10 px-5 rounded-[50px] text-sm font-bold uppercase text-white gradient-accent hover:opacity-90 transition-opacity flex items-center gap-1 shadow-md shadow-[#E86BA0]/25"
            >
              Попробовать бесплатно <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>
        </div>

        <motion.button
          whileTap={{ scale: 0.9 }}
          className="md:hidden text-[#444]"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </motion.button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-[#C5CBA5]/60 bg-white/95 backdrop-blur-xl px-5 py-4 space-y-3"
          >
            {[['Возможности', '#features'], ['Процесс', '#process'], ['Тарифы', '#pricing']].map(([label, href]) => (
              <a key={href} href={href} className="block text-sm text-[#444] py-1" onClick={() => setOpen(false)}>
                {label}
              </a>
            ))}
            <div className="pt-2 flex flex-col gap-2">
              <Link href="/login" className="text-sm text-[#888] py-1">Войти</Link>
              <Link href="/register" className="h-12 w-full rounded-[50px] text-sm font-bold uppercase text-white gradient-accent flex items-center justify-center gap-1">
                Попробовать бесплатно <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function HeroSection() {
  const mouseX = useMotionValue(0.5)
  const mouseY = useMotionValue(0.5)
  const spotX = useSpring(useTransform(mouseX, [0, 1], ['-10%', '10%']), { stiffness: 50, damping: 20 })
  const spotY = useSpring(useTransform(mouseY, [0, 1], ['-10%', '10%']), { stiffness: 50, damping: 20 })

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    mouseX.set(e.clientX / rect.width)
    mouseY.set(e.clientY / rect.height)
  }

  const words = ['Твой', 'личный', 'AI', 'SMM-щик']

  return (
    <section
      className="relative pt-28 sm:pt-36 pb-20 sm:pb-28 px-5 text-center overflow-hidden bg-white"
      onMouseMove={handleMouseMove}
    >
      {/* Dot grid background */}
      <div className="absolute inset-0 dot-grid opacity-30 pointer-events-none" />

      {/* Palm photo background — real leaves against white */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          backgroundImage: 'url(/palm-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center bottom',
          opacity: 0.18,
        }}
      />

      {/* Floating blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full animate-float"
          style={{
            background: 'radial-gradient(circle at center, #F5A84A40 0%, #E86BA020 50%, transparent 70%)',
            x: spotX, y: spotY,
          }}
        />
        <motion.div
          className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full animate-float-reverse"
          style={{
            background: 'radial-gradient(circle at center, #3A9A5030 0%, #5CB86015 50%, transparent 70%)',
          }}
        />
        {/* Spinning ring */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-[#C5CBA5]/20 animate-spin-slow pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full border border-[#3A9A50]/10 animate-spin-slow pointer-events-none" style={{ animationDirection: 'reverse', animationDuration: '30s' }} />
      </div>

      <div className="relative max-w-4xl mx-auto space-y-8">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.5, type: 'spring', stiffness: 200 }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider text-white gradient-animated shadow-lg shadow-[#E86BA0]/30"
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI-ассистент для запусков
        </motion.div>

        {/* Headline — word by word */}
        <div className="space-y-2">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.12, delayChildren: 0.3 } } }}
            className="flex flex-wrap justify-center gap-x-4 gap-y-1"
          >
            {words.map((word) => (
              <motion.span
                key={word}
                variants={{
                  hidden: { opacity: 0, y: 60, rotateX: -40 },
                  visible: { opacity: 1, y: 0, rotateX: 0, transition: { duration: 0.7, ease: EASE } },
                }}
                className={`text-[2.5rem] sm:text-6xl lg:text-[5.5rem] font-black uppercase leading-none tracking-tight ${
                  word === 'AI' ? 'gradient-text' : word === 'SMM-щик' ? 'text-outline-lg' : 'text-[#1A1A1A]'
                }`}
                style={{ display: 'inline-block', transformOrigin: 'bottom' }}
              >
                {word}
              </motion.span>
            ))}
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.7, ease: EASE }}
            className="text-[2rem] sm:text-5xl lg:text-7xl font-black uppercase leading-none tracking-tight text-[#1A1A1A]"
          >
            который пишет{' '}
            <span className="gradient-text">как ты</span>
          </motion.div>
        </div>

        {/* Sub */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          className="text-[#555] text-xl sm:text-2xl max-w-2xl mx-auto leading-relaxed"
        >
          AMA изучает твой голос, нишу и аудиторию — и создаёт контент,
          который звучит именно как ты. Plan прогрева за{' '}
          <span className="font-bold text-[#1A1A1A]">8 минут</span>.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3, duration: 0.6 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2 w-full sm:w-auto px-2 sm:px-0"
        >
          <GradientButton href="/register" large>
            Попробовать бесплатно
          </GradientButton>
          <motion.a
            href="#features"
            whileHover={{ scale: 1.03, borderColor: '#C5CBA5' }}
            whileTap={{ scale: 0.97 }}
            className="h-14 sm:h-16 px-9 w-full sm:w-auto justify-center rounded-[50px] font-bold text-[#444] border-2 border-[#E8E8E8] hover:border-[#C5CBA5] hover:text-[#1A1A1A] transition-colors flex items-center gap-2 text-sm uppercase tracking-wide"
          >
            Смотреть демо
          </motion.a>
        </motion.div>

        {/* Trust strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[#888] pt-2"
        >
          <span className="flex items-center gap-1.5">✓ Бесплатно</span>
          <span className="hidden sm:block w-px h-4 bg-[#E0E0E0]" />
          <span className="flex items-center gap-1.5">✓ Без карты</span>
          <span className="hidden sm:block w-px h-4 bg-[#E0E0E0]" />
          <span className="flex items-center gap-1.5">✓ Первый план за 8 мин</span>
        </motion.div>
      </div>
    </section>
  )
}

// ── Бегущая строка ────────────────────────────────────────────────────────────
function MarqueeBar() {
  const items = ['AI SMM-щик', 'Контент-план', 'Прогрев', 'Рилсы', 'Сториз', 'Посты', 'Карусели', 'Голос бренда']
  const repeated = [...items, ...items]

  return (
    <div className="border-y border-[#C5CBA5]/60 bg-[#F7F7F7] py-3 overflow-hidden">
      <div className="flex gap-0 animate-marquee whitespace-nowrap" style={{ width: 'max-content' }}>
        {repeated.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-3 px-6 text-sm font-semibold uppercase tracking-widest text-[#888]">
            <span className="w-1.5 h-1.5 rounded-full gradient-accent inline-block" />
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function StatsSection() {
  const STATS = [
    { value: 2847, suffix: '+', label: 'экспертов уже используют' },
    { value: 8, suffix: '', label: 'минут на первый план прогрева' },
    { value: 47, suffix: '', label: 'минут экономится каждый день' },
  ]

  return (
    <section className="py-14 sm:py-24 px-5 bg-white border-b border-[#C5CBA5]/50">
      <RevealSection className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#C5CBA5]/50">
        {STATS.map((s, i) => (
          <motion.div key={i} variants={fadeUp} custom={i} className="py-10 sm:py-0 px-4 sm:px-10 text-center first:pt-0 last:pb-0">
            <div className="text-6xl sm:text-7xl font-black gradient-text leading-none mb-3">
              <AnimatedCounter value={s.value} suffix={s.suffix} />
            </div>
            <div className="text-sm text-[#888] max-w-[200px] mx-auto leading-snug">{s.label}</div>
          </motion.div>
        ))}
      </RevealSection>
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
    <section className="py-16 sm:py-28 px-5 bg-[#F7F7F7] border-b border-[#C5CBA5]/50">
      <div className="max-w-2xl mx-auto">
        <RevealSection>
          <SectionLabel>Проблема</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-12 uppercase leading-tight">
            Узнаёшь себя?
          </motion.h2>
          <div className="space-y-4">
            {PAINS.map((p, i) => (
              <TiltCard key={i}>
                <motion.div
                  variants={fadeUp}
                  custom={i}
                  className="flex items-center gap-4 p-5 sm:p-7 rounded-2xl bg-white border border-[#C5CBA5] shadow-md cursor-default"
                >
                  <span className="text-4xl shrink-0">{p.emoji}</span>
                  <p className="text-base font-medium text-[#444]">{p.text}</p>
                </motion.div>
              </TiltCard>
            ))}
          </div>
        </RevealSection>
      </div>
    </section>
  )
}

// ── Solution ──────────────────────────────────────────────────────────────────
function SolutionSection() {
  return (
    <section className="py-16 sm:py-28 px-5 bg-white border-b border-[#C5CBA5]/50">
      <div className="max-w-4xl mx-auto">
        <RevealSection>
          <SectionLabel>Решение</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-6xl font-black text-[#1A1A1A] text-center mb-4 leading-tight uppercase">
            AMA знает твою нишу,<br />аудиторию, стиль.
          </motion.h2>
          <motion.p variants={fadeUp} className="text-2xl sm:text-3xl font-bold text-center gradient-text mb-14">
            И пишет именно как ты.
          </motion.p>

          <div className="grid sm:grid-cols-2 gap-5">
            <TiltCard>
              <motion.div variants={fadeUp} className="p-5 sm:p-8 rounded-2xl bg-[#F7F7F7] border border-[#C5CBA5] h-full shadow-md">
                <p className="text-xs font-bold text-red-400 uppercase tracking-widest flex items-center gap-2 mb-5">
                  <X className="h-3.5 w-3.5" /> Без AMA
                </p>
                <div className="space-y-3">
                  {['Часами смотришь в пустой экран', 'Контент-план теряется в заметках', 'Нейросеть пишет не своим голосом', 'Каждый запуск — стресс с нуля'].map((t, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Minus className="h-4 w-4 text-[#C5CBA5] mt-0.5 shrink-0" />
                      <span className="text-sm text-[#888]">{t}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </TiltCard>
            <TiltCard>
              <motion.div variants={fadeUp} custom={1} className="p-8 rounded-2xl bg-[#F7F7F7] border border-[#C5CBA5] h-full shadow-md">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-2 mb-5">
                  <Check className="h-3.5 w-3.5" /> С AMA
                </p>
                <div className="space-y-3">
                  {['Контент за 20 минут в твоём голосе', 'Чёткий план по 4 фазам прогрева', 'AI помнит всё о тебе и аудитории', 'Каждый запуск — система, не хаос'].map((t, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span className="text-sm text-[#444]">{t}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </TiltCard>
          </div>
        </RevealSection>
      </div>
    </section>
  )
}

// ── Features ──────────────────────────────────────────────────────────────────
function FeaturesSection() {
  const PHASES = [
    { label: 'Нишу', color: '#F5A84A', width: '65%' },
    { label: 'Эксперта', color: '#E86BA0', width: '78%' },
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
    <section id="features" className="py-16 sm:py-28 px-5 bg-[#F7F7F7] border-b border-[#C5CBA5]/50">
      <div className="max-w-5xl mx-auto">
        <RevealSection>
          <SectionLabel>Возможности</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-14 uppercase">
            Всё для запуска —<br className="hidden sm:block" />
            в{' '}
            <span className="gradient-text">одном месте</span>
          </motion.h2>

          <div className="grid sm:grid-cols-2 gap-5">
            {/* Прогрев */}
            <TiltCard>
              <motion.div variants={fadeUp} className="p-5 sm:p-8 rounded-2xl bg-white border border-[#C5CBA5] space-y-5 shadow-md h-full">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2 gradient-text">
                    <Zap className="h-3 w-3" /> Мастер прогрева
                  </p>
                  <p className="text-lg font-black text-[#1A1A1A]">План прогрева за 8 минут</p>
                </div>
                <div className="space-y-2.5">
                  {PHASES.map((p) => (
                    <div key={p.label} className="flex items-center gap-3">
                      <span className="text-xs w-24 shrink-0 text-[#555]">{p.label}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-[#F0F0F0]">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: p.width }}
                          viewport={{ once: true }}
                          transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
                          className="h-full rounded-full gradient-accent"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[#888]">AI собирает стратегию из твоих материалов, продукта и воронки.</p>
              </motion.div>
            </TiltCard>

            {/* Голос */}
            <TiltCard>
              <motion.div variants={fadeUp} custom={1} className="p-8 rounded-2xl bg-white border border-[#C5CBA5] space-y-5 shadow-md h-full">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2 gradient-text">
                    <Mic2 className="h-3 w-3" /> Голос
                  </p>
                  <p className="text-lg font-black text-[#1A1A1A]">Пишет в твоём голосе</p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-2 sm:gap-3">
                  <div className="flex-1 px-3 py-3 rounded-xl bg-[#F7F7F7] border border-[#E0E0E0] text-xs text-[#888]">
                    Хочу рассказать про осознанность и как она помогает...
                  </div>
                  <ArrowRight className="h-5 w-5 mx-auto sm:mt-3 sm:mx-0 shrink-0 rotate-90 sm:rotate-0" style={{ color: '#3A9A50' }} />
                  <div className="flex-1 px-3 py-3 rounded-xl bg-white border border-[#C5CBA5] text-xs text-[#444]">
                    Год назад я выгорела настолько, что не могла открыть ноутбук. Именно тогда я поняла...
                  </div>
                </div>
                <p className="text-xs text-[#888]">Загружаешь распаковку, кейсы, Tone of Voice — AI запоминает как ты думаешь.</p>
              </motion.div>
            </TiltCard>

            {/* Контент-план */}
            <TiltCard>
              <motion.div variants={fadeUp} custom={2} className="p-8 rounded-2xl bg-white border border-[#C5CBA5] space-y-5 shadow-md h-full">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2 gradient-text">
                    <Calendar className="h-3 w-3" /> Планирование
                  </p>
                  <p className="text-lg font-black text-[#1A1A1A]">Контент-план на каждый день</p>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {CALENDAR_COLORS.map((c, i) => (
                    <motion.div
                      key={i}
                      initial={{ scale: 0, opacity: 0 }}
                      whileInView={{ scale: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.04, type: 'spring', stiffness: 300 }}
                      className="aspect-square rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: c }}
                    >
                      <span className="text-[9px] font-bold text-[#888]">{i + 2}</span>
                    </motion.div>
                  ))}
                </div>
                <p className="text-xs text-[#888]">Расписание по дням с конкретными смыслами.</p>
              </motion.div>
            </TiltCard>

            {/* База знаний */}
            <TiltCard>
              <motion.div variants={fadeUp} custom={3} className="p-8 rounded-2xl bg-white border border-[#C5CBA5] space-y-5 shadow-md h-full">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2 gradient-text">
                    <BookOpen className="h-3 w-3" /> База знаний
                  </p>
                  <p className="text-lg font-black text-[#1A1A1A]">Умная база проекта</p>
                </div>
                <div className="space-y-2.5">
                  {FILES.map((f, i) => (
                    <motion.div
                      key={i}
                      initial={{ x: -20, opacity: 0 }}
                      whileInView={{ x: 0, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.15 + 0.2 }}
                      className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#F7F7F7] border border-[#E8E8E8]"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{f.emoji}</span>
                        <span className="text-sm text-[#444]">{f.name}</span>
                      </div>
                      {f.done
                        ? <Check className="h-4 w-4 text-emerald-500" />
                        : <div className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: 'linear-gradient(135deg, #3A9A50, #F5A84A)' }} />}
                    </motion.div>
                  ))}
                </div>
                <p className="text-xs text-[#888]">AI помнит всё. Качество текстов растёт автоматически.</p>
              </motion.div>
            </TiltCard>
          </div>
        </RevealSection>
      </div>
    </section>
  )
}

// ── Process ───────────────────────────────────────────────────────────────────
function ProcessSection() {
  const STEPS = [
    {
      num: '01',
      icon: '☁️',
      title: 'Загрузи себя',
      desc: 'Загрузи распаковку личности, материалы о нише, кейсы клиентов. AMA изучит тебя и запомнит навсегда.',
    },
    {
      num: '02',
      icon: '📅',
      title: 'Создай план',
      desc: 'Пройди 8-шаговый мастер прогрева. AI выстроит стратегию по 4 фазам специально под твой продукт.',
    },
    {
      num: '03',
      icon: '✨',
      title: 'Генерируй контент',
      desc: 'Один клик — готовый пост, рилс или сториз. Редактируй, одобряй, публикуй. AI учится на правках.',
    },
  ]

  return (
    <section id="process" className="py-16 sm:py-28 px-5 bg-white border-b border-[#C5CBA5]/50">
      <div className="max-w-3xl mx-auto">
        <RevealSection>
          <SectionLabel>Процесс</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-14 uppercase">
            Запуск за <span className="gradient-text">3 шага</span>
          </motion.h2>
          <div className="relative">
            {/* Connecting line */}
            <motion.div
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
              className="absolute left-5 sm:left-7 top-7 bottom-7 w-px origin-top"
              style={{ background: 'linear-gradient(180deg, #3A9A50, #F5A84A, #E86BA0)' }}
            />
            <div className="space-y-5">
              {STEPS.map((s, i) => (
                <TiltCard key={i}>
                  <motion.div
                    variants={fadeUp}
                    custom={i}
                    className="flex gap-4 sm:gap-6 p-5 sm:p-7 rounded-2xl bg-[#F7F7F7] border border-[#C5CBA5] shadow-md relative"
                  >
                    <div className="shrink-0 z-10">
                      <motion.div
                        whileHover={{ rotate: [0, -10, 10, 0] }}
                        transition={{ duration: 0.4 }}
                        className="w-14 h-14 rounded-full gradient-accent flex items-center justify-center text-white text-sm font-black shadow-lg shadow-[#E86BA0]/30"
                      >
                        {s.num}
                      </motion.div>
                    </div>
                    <div>
                      <h3 className="font-black text-lg text-[#1A1A1A] mb-2">{s.title}</h3>
                      <p className="text-sm text-[#888] leading-relaxed">{s.desc}</p>
                    </div>
                  </motion.div>
                </TiltCard>
              ))}
            </div>
          </div>
        </RevealSection>
      </div>
    </section>
  )
}

// ── Reviews ───────────────────────────────────────────────────────────────────
function ReviewsSection() {
  return (
    <section className="py-16 sm:py-28 px-5 bg-[#F5F5F5] border-b border-[#C5CBA5]/50">
      <div className="max-w-5xl mx-auto">
        <RevealSection>
          <SectionLabel>Отзывы</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-14 uppercase">
            Что говорят <span className="gradient-text">эксперты</span>
          </motion.h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {REVIEWS.map((r, i) => (
              <TiltCard key={i}>
                <motion.div
                  variants={fadeUp}
                  custom={i}
                  className="p-5 sm:p-7 rounded-2xl bg-white border border-[#C5CBA5] space-y-5 shadow-md h-full relative overflow-hidden"
                >
                  {/* Decorative quote */}
                  <div className="absolute -top-2 -right-1 text-[80px] font-black leading-none gradient-text opacity-10 pointer-events-none select-none">
                    "
                  </div>
                  <div className="flex items-center gap-1">
                    {[...Array(r.stars)].map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-[#555] leading-relaxed relative z-10">{r.text}</p>
                  <div className="flex items-center gap-3 pt-1">
                    <div className="w-10 h-10 rounded-full gradient-accent flex items-center justify-center text-sm font-bold text-white shadow-md">
                      {r.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#1A1A1A]">{r.name}</p>
                      <p className="text-[11px] text-[#888]">{r.role}</p>
                    </div>
                  </div>
                </motion.div>
              </TiltCard>
            ))}
          </div>
        </RevealSection>
      </div>
    </section>
  )
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function PricingSection() {
  const [currency, setCurrency] = useState<Currency>('RUB')
  const { symbol, prices } = CURRENCY_CONFIG[currency]

  return (
    <section id="pricing" className="py-16 sm:py-28 px-5 bg-white border-b border-[#C5CBA5]/50">
      <div className="max-w-4xl mx-auto">
        <RevealSection>
          <SectionLabel>Тарифы</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl font-black text-[#1A1A1A] text-center mb-6 uppercase">
            Прозрачные <span className="gradient-text">цены</span>
          </motion.h2>

          <motion.div variants={fadeUp} className="flex items-center justify-center gap-1.5 mb-12">
            {(['RUB', 'USD', 'EUR'] as Currency[]).map((c) => (
              <motion.button
                key={c}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setCurrency(c)}
                className={`px-5 py-2 rounded-[50px] text-xs font-bold transition-all ${
                  currency === c
                    ? 'gradient-accent text-white shadow-md shadow-[#E86BA0]/25'
                    : 'text-[#888] hover:text-[#444] bg-[#F7F7F7] border border-[#E0E0E0]'
                }`}
              >
                {c}
              </motion.button>
            ))}
          </motion.div>

          <div className="grid sm:grid-cols-3 gap-5">
            {PLANS.map((plan, i) => (
              <TiltCard key={plan.name}>
                <motion.div
                  variants={fadeUp}
                  custom={i}
                  className={`relative p-5 sm:p-7 rounded-2xl border space-y-6 h-full ${
                    plan.popular
                      ? 'bg-[#F7F7F7] border-[#3A9A50]/50 shadow-xl shadow-[#3A9A50]/10'
                      : 'bg-[#F7F7F7] border-[#C5CBA5] shadow-md'
                  }`}
                >
                  {plan.popular && (
                    <motion.div
                      initial={{ y: -10, opacity: 0 }}
                      whileInView={{ y: 0, opacity: 1 }}
                      className="absolute -top-3.5 left-1/2 -translate-x-1/2"
                    >
                      <span className="px-4 py-1.5 rounded-full text-[10px] font-black text-white gradient-animated uppercase tracking-wider shadow-lg">
                        ✦ ПОПУЛЯРНЫЙ
                      </span>
                    </motion.div>
                  )}

                  <div>
                    <p className="text-sm font-black text-[#1A1A1A] mb-2 uppercase tracking-wider">{plan.name}</p>
                    <div className="flex items-end gap-1">
                      <span className="text-lg font-bold text-[#888]">{symbol}</span>
                      <span className="text-4xl sm:text-5xl font-black text-[#1A1A1A]">{prices[i].toLocaleString('ru-RU')}</span>
                    </div>
                    <p className="text-xs text-[#888] mt-1">{plan.period}</p>
                  </div>

                  <hr className="border-[#C5CBA5]/50" />

                  <ul className="space-y-3">
                    {plan.features.map((f, j) => (
                      <li key={j} className="flex items-center gap-3">
                        {f.ok
                          ? <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                          : <Minus className="h-4 w-4 text-[#C5CBA5] shrink-0" />}
                        <span className={`text-sm ${f.ok ? 'text-[#444]' : 'text-[#C5CBA5]'}`}>{f.text}</span>
                      </li>
                    ))}
                  </ul>

                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    {plan.gradient ? (
                      <Link href={plan.href} className="w-full h-12 rounded-[50px] flex items-center justify-center text-sm font-bold uppercase text-white gradient-accent hover:opacity-90 transition-opacity gap-1.5 shadow-md shadow-[#E86BA0]/25">
                        {plan.cta} <ChevronRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <Link href={plan.href} className="w-full h-12 rounded-[50px] flex items-center justify-center text-sm font-bold uppercase text-[#444] bg-white border-2 border-[#C5CBA5] hover:border-[#3A9A50] hover:text-[#1A1A1A] transition-all gap-1.5">
                        {plan.cta} <ChevronRight className="h-4 w-4" />
                      </Link>
                    )}
                  </motion.div>
                </motion.div>
              </TiltCard>
            ))}
          </div>
        </RevealSection>
      </div>
    </section>
  )
}

// ── Final CTA ─────────────────────────────────────────────────────────────────
function CtaSection() {
  return (
    <section className="relative py-20 sm:py-32 px-5 text-center overflow-hidden bg-[#1A1A1A]">
      {/* Palm silhouette photo background */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          backgroundImage: 'url(/palm-leaves-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          opacity: 0.15,
        }}
      />
      {/* Colour blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full animate-float opacity-15"
          style={{ background: 'radial-gradient(circle, #F5A84A 0%, transparent 70%)' }} />
        <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] rounded-full animate-float-reverse opacity-15"
          style={{ background: 'radial-gradient(circle, #3A9A50 0%, transparent 70%)' }} />
      </div>
      <div className="absolute inset-0 dot-grid opacity-10 pointer-events-none" />

      <div className="relative max-w-2xl mx-auto space-y-7">
        <RevealSection>
          <SectionLabel>Начни сейчас</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight uppercase">
            <span className="text-white">Начни свой</span>
            <br />
            <span className="gradient-text">первый прогрев</span>
            <br />
            <span className="text-white">сегодня</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-gray-400 text-lg">
            Бесплатно. Без карты. Первый план за 8 минут.
          </motion.p>
          <motion.div variants={fadeUp} className="pt-2 flex justify-center">
            <GradientButton href="/register" large>
              Попробовать бесплатно
            </GradientButton>
          </motion.div>
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-gray-500 pt-2">
            <span>🔒 Данные защищены</span>
            <span className="hidden sm:block w-px h-4 bg-white/10" />
            <span>✓ Отмена в любой момент</span>
            <span className="hidden sm:block w-px h-4 bg-white/10" />
            <span>→ Без кредитной карты</span>
          </motion.div>
        </RevealSection>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="bg-[#111111] border-t border-white/10 py-12 px-5">
      <div className="max-w-6xl mx-auto grid sm:grid-cols-3 gap-8 text-sm">
        <div>
          <span className="text-xl font-black text-white tracking-tight">
            AMA<span className="gradient-text">product</span>
          </span>
          <p className="text-gray-500 text-xs mt-2">AI SMM-ассистент для экспертов</p>
        </div>
        <div className="space-y-2">
          <Link href="#" className="block text-gray-500 hover:text-gray-300 transition-colors text-xs">Политика конфиденциальности</Link>
          <Link href="#" className="block text-gray-500 hover:text-gray-300 transition-colors text-xs">Условия использования</Link>
          <Link href="#" className="block text-gray-500 hover:text-gray-300 transition-colors text-xs">Поддержка</Link>
          <div className="flex gap-4 pt-1">
            <Link href="#" className="text-gray-500 hover:text-gray-300 transition-colors text-xs">Instagram</Link>
            <Link href="#" className="text-gray-500 hover:text-gray-300 transition-colors text-xs">Telegram</Link>
          </div>
        </div>
        <div className="text-gray-600 text-xs sm:text-right">
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
        <MarqueeBar />
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
