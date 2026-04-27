'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ChevronRight, ChevronLeft, MessageCircle, Globe,
  Plus, X, Check, Loader2, Package, GitBranch,
  Play, Users, Target, Sparkles, Bot, CalendarDays, Wallet,
} from 'lucide-react'

interface Product {
  name: string; product_type: string; price: string
  currency: string; description: string; sales_page_url: string
}
interface Funnel {
  name: string; funnel_type: string; description: string; chatbot_link: string
}

const STEPS = [
  { id: 1, title: 'О блогере',  icon: Users },
  { id: 2, title: 'Продукт',    icon: Package },
  { id: 3, title: 'Воронки',    icon: GitBranch },
]

const HINT = 'text-xs text-muted-foreground mt-1'

export function ProjectWizard() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep]     = useState(1)
  const [loading, setLoading] = useState(false)

  // ── Step 1 ──────────────────────────────────────
  const [name, setName]             = useState('')
  const [niche, setNiche]           = useState('')
  const [description, setDescription] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [contentGoals, setContentGoals]     = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  const [vkUrl, setVkUrl]           = useState('')
  const [telegramUrl, setTelegramUrl] = useState('')
  const [youtubeUrl, setYoutubeUrl]   = useState('')

  // ── Step 2 ──────────────────────────────────────
  const [salesType, setSalesType] = useState<'launch' | 'evergreen'>('launch')
  const [launchDate, setLaunchDate]     = useState('')
  const [launchBudget, setLaunchBudget] = useState('')
  const [launchCurrency, setLaunchCurrency] = useState('RUB')
  const [products, setProducts] = useState<Product[]>([{
    name: '', product_type: 'курс', price: '', currency: 'RUB', description: '', sales_page_url: ''
  }])

  // ── Step 3 ──────────────────────────────────────
  const [funnels, setFunnels] = useState<Funnel[]>([{
    name: '', funnel_type: 'cold', description: '', chatbot_link: ''
  }])

  // ── AI Name ─────────────────────────────────────
  const [aiName, setAiName] = useState('')

  const addProduct = () => setProducts(p => [...p, {
    name: '', product_type: 'курс', price: '', currency: 'RUB', description: '', sales_page_url: ''
  }])
  const removeProduct = (i: number) => setProducts(p => p.filter((_, idx) => idx !== i))
  const updateProduct = (i: number, key: keyof Product, val: string) =>
    setProducts(p => p.map((item, idx) => idx === i ? { ...item, [key]: val } : item))

  const addFunnel = () => setFunnels(f => [...f, {
    name: '', funnel_type: 'cold', description: '', chatbot_link: ''
  }])
  const removeFunnel = (i: number) => setFunnels(f => f.filter((_, idx) => idx !== i))
  const updateFunnel = (i: number, key: keyof Funnel, val: string) =>
    setFunnels(f => f.map((item, idx) => idx === i ? { ...item, [key]: val } : item))

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Введите название проекта'); return }
    setLoading(true)
    try {
      // Use getSession() — reliable, reads from cookie, no network call
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) throw new Error('Сессия истекла — войдите заново')

      const userId = session.user.id

      // Save AI assistant name to profile if set
      if (aiName.trim()) {
        await supabase.from('profiles')
          .update({ ai_assistant_name: aiName.trim() })
          .eq('id', userId)
      }

      // Insert project
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          owner_id:        userId,
          name:            name.trim(),
          niche:           niche.trim()           || null,
          description:     description.trim()     || null,
          target_audience: targetAudience.trim()  || null,
          content_goals:   contentGoals.trim()    || null,
          instagram_url:   instagramUrl.trim()    || null,
          vk_url:          vkUrl.trim()           || null,
          telegram_url:    telegramUrl.trim()     || null,
          youtube_url:     youtubeUrl.trim()      || null,
          launch_date:     launchDate             || null,
          launch_budget:   launchBudget ? parseFloat(launchBudget) : null,
        })
        .select()
        .single()

      if (projectError) {
        throw new Error(projectError.message || JSON.stringify(projectError))
      }

      // Insert products (skip empty)
      const validProducts = products.filter(p => p.name.trim())
      if (validProducts.length > 0) {
        const { error: prodError } = await supabase.from('products').insert(
          validProducts.map(p => ({
            project_id:    project.id,
            name:          p.name.trim(),
            product_type:  p.product_type,
            price:         p.price ? parseFloat(p.price) : null,
            currency:      p.currency,
            description:   p.description.trim() || null,
            sales_page_url: p.sales_page_url.trim() || null,
          }))
        )
        if (prodError) console.error('Products insert error:', prodError.message)
      }

      // Insert funnels (skip empty)
      const validFunnels = funnels.filter(f => f.name.trim())
      if (validFunnels.length > 0) {
        const { error: funnelError } = await supabase.from('funnels').insert(
          validFunnels.map(f => ({
            project_id:   project.id,
            name:         f.name.trim(),
            funnel_type:  f.funnel_type,
            description:  f.description.trim() || null,
            chatbot_link: f.chatbot_link.trim() || null,
          }))
        )
        if (funnelError) console.error('Funnels insert error:', funnelError.message)
      }

      toast.success('Проект создан! 🎉')

      // Auto-scrape social profiles in background — no waiting, user goes straight to project
      const igUrl = instagramUrl.trim()
      const tgUrl = telegramUrl.trim()
      if (igUrl || tgUrl) {
        const scrapeAll = async () => {
          const calls = []
          if (igUrl) calls.push(
            fetch('/api/projects/scrape-social', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: project.id, platform: 'instagram', username: igUrl.replace(/^@/, '').split('/').pop() }),
            }).then(r => r.json()).then((d: { message?: string; error?: string }) => {
              if (d.message) toast.success(d.message)
            }).catch(() => {})
          )
          if (tgUrl) calls.push(
            fetch('/api/projects/scrape-social', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: project.id, platform: 'telegram', username: tgUrl.replace(/^@/, '').split('/').pop() }),
            }).then(r => r.json()).then((d: { message?: string; error?: string }) => {
              if (d.message) toast.success(d.message)
            }).catch(() => {})
          )
          await Promise.all(calls)
        }
        scrapeAll() // fire and forget — don't await, user already navigating
      }

      router.push(`/projects/${project.id}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Неизвестная ошибка'
      toast.error(`Ошибка: ${msg}`)
      console.error('Project creation error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Steps indicator */}
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => step > s.id && setStep(s.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                step === s.id  ? 'gradient-accent text-white shadow-lg shadow-primary/30' :
                step > s.id    ? 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400 cursor-pointer' :
                                 'bg-secondary text-muted-foreground'
              }`}
            >
              {step > s.id ? <Check className="h-4 w-4" /> : s.id}
            </button>
            <span className={`text-sm hidden sm:block ${step === s.id ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {s.title}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-10 sm:w-20 mx-2 transition-colors ${step > s.id ? 'bg-green-400/50' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* ── STEP 1: О блогере ───────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" /> О блогере
            </CardTitle>
            <CardDescription>
              Чем подробнее заполнишь — тем точнее AI SMM-щик адаптирует контент именно под тебя
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* AI Name block */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Дай имя своему AI SMM-щику</span>
                <Badge variant="outline" className="text-xs text-primary border-primary/30">необязательно</Badge>
              </div>
              <Input
                placeholder="Например: Алёша, Вика, Макс..."
                value={aiName}
                onChange={e => setAiName(e.target.value)}
                className="bg-background"
                maxLength={30}
              />
              <p className={HINT}>
                Это имя будет отображаться в интерфейсе вместо «AI SMM-щик» — делает работу теплее и привычнее
              </p>
            </div>

            {/* Main fields */}
            <div className="space-y-1.5">
              <Label>Имя блогера / название проекта<span className="text-destructive ml-0.5">*</span></Label>
              <Input
                placeholder="Анна Иванова — Нутрициолог"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <p className={HINT}>Полное имя или псевдоним, который используется в блоге</p>
            </div>

            <div className="space-y-1.5">
              <Label>Ниша / тема блога</Label>
              <Input
                placeholder="Нутрициология и здоровое питание"
                value={niche}
                onChange={e => setNiche(e.target.value)}
              />
              <p className={HINT}>Чем занимается эксперт? Это помогает AI писать в нужном контексте</p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-primary" /> Целевая аудитория
              </Label>
              <Textarea
                placeholder="Женщины 25-45 лет, мамы в декрете, хотят похудеть после родов без жёстких диет, боятся срывов..."
                value={targetAudience}
                onChange={e => setTargetAudience(e.target.value)}
                rows={3}
                className="resize-none"
              />
              <p className={HINT}>
                Кто читает блог? Возраст, пол, боли, желания. Чем конкретнее — тем точнее контент попадёт в них
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <Target className="h-3.5 w-3.5 text-primary" /> Цели контента
              </Label>
              <Textarea
                placeholder="Прогреть аудиторию к курсу, показать экспертность, повысить доверие через кейсы, получить заявки на консультации..."
                value={contentGoals}
                onChange={e => setContentGoals(e.target.value)}
                rows={2}
                className="resize-none"
              />
              <p className={HINT}>Зачем вообще публикуется контент? Какой результат нужен от блога?</p>
            </div>

            <div className="space-y-1.5">
              <Label>Описание / о чём блог</Label>
              <Textarea
                placeholder="Блог о здоровом питании без жёстких ограничений. Анна — нутрициолог с 7-летним опытом, помогла 500+ клиентам похудеть и сохранить результат. Стиль — живой, честный, с юмором..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="resize-none"
              />
              <p className={HINT}>Свободное описание: о чём пишет, как себя позиционирует, стиль общения с аудиторией</p>
            </div>

            <div className="space-y-3">
              <Label>Социальные сети</Label>
              {[
                { icon: Sparkles, ph: 'https://instagram.com/username', val: instagramUrl, set: setInstagramUrl, label: 'Instagram' },
                { icon: Globe,     ph: 'https://vk.com/username',       val: vkUrl,        set: setVkUrl,        label: 'VK' },
                { icon: MessageCircle, ph: 'https://t.me/username',     val: telegramUrl,  set: setTelegramUrl,  label: 'Telegram' },
                { icon: Play,      ph: 'https://youtube.com/@channel',  val: youtubeUrl,   set: setYoutubeUrl,   label: 'YouTube' },
              ].map(({ icon: Icon, ph, val, set, label }) => (
                <div key={label} className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground w-16">{label}</span>
                  <Icon className="absolute left-20 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={ph}
                    value={val}
                    onChange={e => set(e.target.value)}
                    className="pl-26"
                    style={{ paddingLeft: '6.5rem' }}
                  />
                </div>
              ))}
              <p className={HINT}>Вставь ссылки на активные площадки. AI учтёт специфику каждой</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Продукт и запуск ─────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Package className="h-5 w-5 text-primary" /> Продукт и запуск
            </CardTitle>
            <CardDescription>
              Что продаём и когда? AI выстроит контент-план вокруг твоего продукта и дедлайна
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Sales type selector */}
            <div className="space-y-2">
              <Label>Как вы продаёте?</Label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'launch', label: 'Запуск в определённую дату', desc: 'Продажи открываются один раз в конкретную дату' },
                  { value: 'evergreen', label: 'Постоянные продажи', desc: 'Продукты или услуги продаются постоянно без дедлайнов' },
                ].map(({ value, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSalesType(value as 'launch' | 'evergreen')}
                    className={`text-left p-4 rounded-xl border transition-all ${salesType === value ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`h-4 w-4 rounded-full border-2 shrink-0 ${salesType === value ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                      <span className="text-sm font-medium text-foreground">{label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Launch-specific fields */}
            {salesType === 'launch' && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-primary" /> Дата старта запуска
                  </Label>
                  <Input type="date" value={launchDate} onChange={e => setLaunchDate(e.target.value)} />
                  <p className={HINT}>Когда открываются продажи? AI считает дни прогрева от этой даты</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-primary" /> Ожидаемая выручка запуска
                  </Label>
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      placeholder="500000"
                      value={launchBudget}
                      onChange={e => setLaunchBudget(e.target.value)}
                    />
                    <Select value={launchCurrency} onValueChange={v => { if (v) setLaunchCurrency(v) }}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['RUB', 'USD', 'EUR', 'KZT'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className={HINT}>Сколько планируешь заработать? AI учтёт масштаб при составлении плана</p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{salesType === 'launch' ? 'Продукты для запуска' : 'Продукты / услуги'}</Label>
                <Badge variant="outline" className="text-xs">{products.length} продукт(ов)</Badge>
              </div>

              {products.map((product, i) => (
                <div key={i} className="p-4 rounded-xl border border-border bg-secondary/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs font-medium">Продукт {i + 1}</Badge>
                    {products.length > 1 && (
                      <button onClick={() => removeProduct(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Название продукта</Label>
                    <Input
                      placeholder="Курс «Стройность за 30 дней»"
                      value={product.name}
                      onChange={e => updateProduct(i, 'name', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Тип</Label>
                      <Select value={product.product_type} onValueChange={v => { if (v) updateProduct(i, 'product_type', v) }}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['курс', 'консультация', 'марафон', 'интенсив', 'мастер-класс', 'наставничество', 'подписка', 'другое'].map(t => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Средняя цена</Label>
                      <div className="flex gap-1.5">
                        <Input
                          type="number"
                          placeholder="25000"
                          value={product.price}
                          onChange={e => updateProduct(i, 'price', e.target.value)}
                          className="h-8 text-sm"
                        />
                        <Select value={product.currency} onValueChange={v => { if (v) updateProduct(i, 'currency', v) }}>
                          <SelectTrigger className="h-8 text-sm w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {['RUB', 'USD', 'EUR', 'KZT'].map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Описание продукта</Label>
                    <Textarea
                      placeholder="Что получит клиент? Формат, длительность, результат, бонусы, что входит в программу..."
                      value={product.description}
                      onChange={e => updateProduct(i, 'description', e.target.value)}
                      rows={2}
                      className="text-sm resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Ссылка на страницу продажи</Label>
                    <Input
                      placeholder="https://..."
                      value={product.sales_page_url}
                      onChange={e => updateProduct(i, 'sales_page_url', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={addProduct} className="w-full border-dashed">
                <Plus className="mr-2 h-4 w-4" /> Добавить продукт
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3: Воронки ──────────────────────────── */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <GitBranch className="h-5 w-5 text-primary" /> Воронки продаж
            </CardTitle>
            <CardDescription>
              Как происходит продажа? Опиши путь клиента — можно пропустить и добавить позже
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {funnels.map((funnel, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-secondary/20 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">Воронка {i + 1}</Badge>
                  {funnels.length > 1 && (
                    <button onClick={() => removeFunnel(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Название</Label>
                  <Input
                    placeholder="Воронка через Instagram Stories → бот → продажа"
                    value={funnel.name}
                    onChange={e => updateFunnel(i, 'name', e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Тип аудитории</Label>
                    <Select value={funnel.funnel_type} onValueChange={v => { if (v) updateFunnel(i, 'funnel_type', v) }}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cold">Холодная</SelectItem>
                        <SelectItem value="warm">Тёплая</SelectItem>
                        <SelectItem value="hybrid">Гибридная</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ссылка на чат-бот</Label>
                    <Input
                      placeholder="https://t.me/yourbot"
                      value={funnel.chatbot_link}
                      onChange={e => updateFunnel(i, 'chatbot_link', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Описание воронки</Label>
                  <Textarea
                    placeholder="Подписчик видит Stories → переходит в бот → получает бесплатный гайд → через 3 дня предложение купить курс..."
                    value={funnel.description}
                    onChange={e => updateFunnel(i, 'description', e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addFunnel} className="w-full border-dashed">
              <Plus className="mr-2 h-4 w-4" /> Добавить воронку
            </Button>

            {/* Summary before submit */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2 text-sm">
              <p className="font-medium text-primary flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Всё готово к созданию проекта
              </p>
              <ul className="text-muted-foreground text-xs space-y-1">
                <li>✓ Проект: <span className="text-foreground font-medium">{name}</span></li>
                {niche && <li>✓ Ниша: {niche}</li>}
                {launchDate && <li>✓ Дата запуска: {new Date(launchDate).toLocaleDateString('ru-RU')}</li>}
                <li>✓ Продуктов: {products.filter(p => p.name.trim()).length}</li>
                <li>✓ Воронок: {funnels.filter(f => f.name.trim()).length}</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => { setStep(s => s - 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={step === 1}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Назад
        </Button>

        {step < 3 ? (
          <Button
            onClick={() => {
              if (step === 1 && !name.trim()) { toast.error('Введите имя / название проекта'); return }
              setStep(s => s + 1)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            className="gradient-accent text-white hover:opacity-90"
          >
            Далее <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={loading} className="gradient-accent text-white hover:opacity-90">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Создать проект
          </Button>
        )}
      </div>
    </div>
  )
}
