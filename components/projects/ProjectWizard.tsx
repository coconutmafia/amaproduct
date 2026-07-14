'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/friendlyError'
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
  Play, Users, Target, Sparkles, Bot, CalendarDays, Wallet, Wand2, RotateCcw,
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

  // ── Autofill (profile) ────────────────────────────
  const [autofillLoading, setAutofillLoading] = useState(false)

  // ── Autofill (product URL) — per product index ────
  const [productFillLoading, setProductFillLoading] = useState<Record<number, boolean>>({})

  // ── Draft: never lose a half-filled new-project form on navigation ─────────
  // The key is scoped to the logged-in USER. A fixed key leaked one account's
  // draft into another account opened in the SAME browser (localStorage is
  // per-browser, not per-user) — a brand-new account showed a previous user's
  // «Анна Иванова — Нутрициолог» draft (tester report). Per-user key + purge of
  // the legacy global key fixes it.
  const LEGACY_DRAFT_KEY = 'ama_new_project_draft'
  const [userId, setUserId] = useState<string | null>(null)
  const draftKey = userId ? `ama_new_project_draft_${userId}` : null
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftLoadedRef = useRef(false)
  const [draftRestored, setDraftRestored] = useState(false)

  // Resolve the current user + purge the legacy per-browser draft key (it leaked
  // drafts across accounts). Runs once on mount.
  useEffect(() => {
    try { localStorage.removeItem(LEGACY_DRAFT_KEY) } catch { /* ignore */ }
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-restore on mount so a partially-filled project isn't lost — but only
  // this user's own draft, once we know who they are.
  useEffect(() => {
    if (!draftKey || draftLoadedRef.current) return
    draftLoadedRef.current = true
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const d = JSON.parse(raw)
      const meaningful = d.name || d.niche || d.description || d.targetAudience || d.contentGoals ||
        (typeof d.step === 'number' && d.step > 1) || (Array.isArray(d.products) && d.products.some((p: Product) => p.name))
      if (!meaningful) return
      if (typeof d.step === 'number') setStep(d.step)
      if (d.name !== undefined) setName(d.name)
      if (d.niche !== undefined) setNiche(d.niche)
      if (d.description !== undefined) setDescription(d.description)
      if (d.targetAudience !== undefined) setTargetAudience(d.targetAudience)
      if (d.contentGoals !== undefined) setContentGoals(d.contentGoals)
      if (d.instagramUrl !== undefined) setInstagramUrl(d.instagramUrl)
      if (d.vkUrl !== undefined) setVkUrl(d.vkUrl)
      if (d.telegramUrl !== undefined) setTelegramUrl(d.telegramUrl)
      if (d.youtubeUrl !== undefined) setYoutubeUrl(d.youtubeUrl)
      if (d.salesType) setSalesType(d.salesType)
      if (d.launchDate !== undefined) setLaunchDate(d.launchDate)
      if (d.launchBudget !== undefined) setLaunchBudget(d.launchBudget)
      if (d.launchCurrency) setLaunchCurrency(d.launchCurrency)
      if (Array.isArray(d.products) && d.products.length) setProducts(d.products)
      if (Array.isArray(d.funnels) && d.funnels.length) setFunnels(d.funnels)
      if (d.aiName !== undefined) setAiName(d.aiName)
      setDraftRestored(true)
      toast.success('Восстановили твою заготовку проекта')
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // Auto-save (debounced) — survives navigation and closing the tab.
  useEffect(() => {
    if (!draftKey) return
    const meaningful = !!(name || niche || description || targetAudience || contentGoals || step > 1 || products.some(p => p.name))
    if (!meaningful) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          step, name, niche, description, targetAudience, contentGoals,
          instagramUrl, vkUrl, telegramUrl, youtubeUrl,
          salesType, launchDate, launchBudget, launchCurrency,
          products, funnels, aiName, savedAt: new Date().toISOString(),
        }))
      } catch { /* ignore */ }
    }, 1500)
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current) }
  }, [draftKey, step, name, niche, description, targetAudience, contentGoals, instagramUrl, vkUrl, telegramUrl, youtubeUrl, salesType, launchDate, launchBudget, launchCurrency, products, funnels, aiName])

  // Once the project is created there is nothing unsaved — the «Leave site?»
  // prompt must not fire on the navigation to the project (tester hit it every
  // time). A ref (not state) so the guard is live immediately, without waiting
  // for a re-render before router.push runs.
  const projectSavedRef = useRef(false)

  // Warn before closing/refreshing the tab with a half-filled project.
  useEffect(() => {
    const meaningful = !!(name || niche || description || targetAudience || contentGoals || products.some(p => p.name))
    if (!meaningful) return
    const handler = (e: BeforeUnloadEvent) => {
      if (projectSavedRef.current) return // already saved → let the navigation through
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [name, niche, description, targetAudience, contentGoals, products])

  // Drop the draft and reset the wizard to a blank state.
  function startOverProject() {
    try { if (draftKey) localStorage.removeItem(draftKey); localStorage.removeItem(LEGACY_DRAFT_KEY) } catch { /* ignore */ }
    setDraftRestored(false)
    setStep(1)
    setName(''); setNiche(''); setDescription(''); setTargetAudience(''); setContentGoals('')
    setInstagramUrl(''); setVkUrl(''); setTelegramUrl(''); setYoutubeUrl('')
    setSalesType('launch'); setLaunchDate(''); setLaunchBudget(''); setLaunchCurrency('RUB')
    setProducts([{ name: '', product_type: 'курс', price: '', currency: 'RUB', description: '', sales_page_url: '' }])
    setFunnels([{ name: '', funnel_type: 'cold', description: '', chatbot_link: '' }])
    setAiName('')
  }

  const handleAutofill = async () => {
    if (!instagramUrl.trim() && !telegramUrl.trim()) {
      toast.error('Сначала введи ссылку на Instagram или Telegram')
      return
    }
    setAutofillLoading(true)
    try {
      const res = await fetch('/api/projects/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagramUrl: instagramUrl.trim(), telegramUrl: telegramUrl.trim() }),
      })
      const data = await res.json() as {
        error?: string
        platform?: string
        niche?: string
        description?: string
        target_audience?: string
        content_goals?: string
      }
      if (!res.ok) throw new Error(data.error || 'Ошибка анализа')
      // Only fill fields that are currently empty
      if (data.niche && !niche.trim()) setNiche(data.niche)
      if (data.description && !description.trim()) setDescription(data.description)
      if (data.target_audience && !targetAudience.trim()) setTargetAudience(data.target_audience)
      if (data.content_goals && !contentGoals.trim()) setContentGoals(data.content_goals)
      toast.success(`Данные заполнены из ${data.platform ?? 'профиля'} — проверь и отредактируй`)
    } catch (err) {
      toast.error(friendlyError(err, 'Не удалось получить данные профиля'))
    } finally {
      setAutofillLoading(false)
    }
  }

  const handleProductFill = async (i: number) => {
    const url = products[i].sales_page_url.trim()
    if (!url) return
    setProductFillLoading(prev => ({ ...prev, [i]: true }))
    try {
      const res = await fetch('/api/projects/scrape-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json() as { error?: string; name?: string; product_type?: string; description?: string }
      if (!res.ok) throw new Error(data.error || 'Ошибка анализа')
      if (data.name && !products[i].name.trim()) updateProduct(i, 'name', data.name)
      if (data.product_type) {
        const valid = ['курс','консультация','марафон','интенсив','мастер-класс','наставничество','подписка','другое']
        if (valid.includes(data.product_type)) updateProduct(i, 'product_type', data.product_type)
      }
      if (data.description && !products[i].description.trim()) updateProduct(i, 'description', data.description)
      toast.success('Описание заполнено из страницы продажи')
    } catch (err) {
      toast.error(friendlyError(err, 'Не удалось загрузить страницу'))
    } finally {
      setProductFillLoading(prev => ({ ...prev, [i]: false }))
    }
  }

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

        // Also persist products as a `product_description` material so the sales
        // offer reaches generation. buildRAGContext (ALWAYS_INCLUDE) reads only
        // project_materials — the `products` table is never fed to the model —
        // so without this the entered/scanned product silently never influenced
        // content. material_type 'product_description' is in ALWAYS_INCLUDE.
        const productMaterials = validProducts.map(p => ({
          project_id:   project.id,
          material_type: 'product_description',
          title:        p.name.trim(),
          raw_content: [
            `Продукт: ${p.name.trim()}`,
            p.product_type            ? `Тип: ${p.product_type}` : '',
            p.price                   ? `Цена: ${p.price} ${p.currency}` : '',
            p.description.trim()      ? `Описание: ${p.description.trim()}` : '',
            p.sales_page_url.trim()   ? `Страница продаж: ${p.sales_page_url.trim()}` : '',
          ].filter(Boolean).join('\n'),
          processing_status: 'ready',
        }))
        const { error: matError } = await supabase.from('project_materials').insert(productMaterials)
        if (matError) console.error('Product material insert error:', matError.message)
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

      // Nothing is unsaved anymore → suppress the browser's «Leave site?» prompt
      // before we navigate to the new project.
      projectSavedRef.current = true
      try { if (draftKey) localStorage.removeItem(draftKey); localStorage.removeItem(LEGACY_DRAFT_KEY) } catch { /* ignore */ }
      toast.success('Проект создан! 🎉')

      // Auto-scrape all social profiles in background — fire and forget
      const socialUrls = [
        { platform: 'instagram', url: instagramUrl.trim() },
        { platform: 'telegram',  url: telegramUrl.trim() },
        { platform: 'youtube',   url: youtubeUrl.trim() },
        { platform: 'vk',        url: vkUrl.trim() },
      ].filter(s => s.url)

      if (socialUrls.length > 0) {
        // Background enrichment — but DON'T swallow failures silently (owner
        // feedback: "загрузил → ничего, и непонятно почему"). Aggregate one
        // gentle, non-blocking note if any profile couldn't be auto-loaded.
        Promise.allSettled(socialUrls.map(({ platform, url }) =>
          fetch('/api/projects/scrape-social', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id, platform, username: url }),
          }).then(async (r) => {
            const d = await r.json().catch(() => ({} as { message?: string; error?: string }))
            if (!r.ok) throw new Error(d.error || platform)
            if (d.message) toast.success(d.message)
          })
        )).then((results) => {
          if (results.some((r) => r.status === 'rejected')) {
            toast.message('Часть профилей не удалось подгрузить автоматически — можно добавить материалы вручную в разделе «Материалы».')
          }
        })
      }

      router.push(`/projects/${project.id}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Неизвестная ошибка'
      console.error('Project creation error:', error)
      // Tester feedback: for TECHNICAL errors (not something the user typed
      // wrong) show a clear "it's us, not you" message so they don't think
      // they filled something incorrectly. Session-expired IS user-actionable,
      // so keep that specific; everything else here is a server/RLS/network
      // failure → friendly generic message.
      if (/сессия истекла/i.test(msg)) {
        toast.error(msg)
      } else {
        toast.error('Упс, ошибка сервиса — это на нашей стороне, не в твоих данных. Скоро починим, попробуй ещё раз чуть позже.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Scroll <main> to top after React re-renders the new step content
  useEffect(() => {
    const main = document.querySelector('main')
    if (main) main.scrollTop = 0
    else window.scrollTo(0, 0)
  }, [step])

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">

      {/* Draft auto-restored — nothing is lost on navigation; offer a fresh start */}
      {draftRestored && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <RotateCcw className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-amber-300">Восстановили твою заготовку</p>
            <p className="text-[10px] text-amber-400/70">Сохранили всё, что ты заполнял. Можно продолжить или начать заново.</p>
          </div>
          <button
            type="button"
            onClick={startOverProject}
            className="h-7 px-2.5 text-xs rounded-lg text-amber-500/70 hover:text-amber-300 shrink-0"
          >
            Начать заново
          </button>
        </div>
      )}

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
        <div className="space-y-4">

          {/* ── Автозаполнение — главный блок ── */}
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
            <CardContent className="pt-5 space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl gradient-accent">
                    <Wand2 className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="font-semibold text-foreground">Уже ведёшь блог?</h3>
                </div>
                <p className="text-sm text-muted-foreground pl-10">
                  Вставь ссылку на Instagram или Telegram — AI SMM-щик сам проанализирует профиль и заполнит всю информацию.
                </p>
                <p className="text-sm text-muted-foreground/70 pl-10">
                  Ты сможешь отредактировать.
                </p>
              </div>

              {/* Quick social inputs — only Instagram + Telegram for autofill */}
              <div className="space-y-2">
                {[
                  { icon: Sparkles, ph: 'https://instagram.com/username или @username', val: instagramUrl, set: setInstagramUrl, label: 'Instagram' },
                  { icon: MessageCircle, ph: 'https://t.me/username или @username', val: telegramUrl, set: setTelegramUrl, label: 'Telegram' },
                ].map(({ icon: Icon, ph, val, set, label }) => (
                  <div key={label} className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground w-[5.5rem]">{label}</span>
                    <Icon className="absolute left-[5.5rem] top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={ph}
                      value={val}
                      onChange={e => set(e.target.value)}
                      className="bg-background/80"
                      style={{ paddingLeft: '6.5rem' }}
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleAutofill}
                disabled={autofillLoading || (!instagramUrl.trim() && !telegramUrl.trim())}
                className="w-full flex items-center justify-center gap-2 rounded-xl gradient-accent text-white text-sm font-medium py-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-primary/20"
              >
                {autofillLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Анализирую профиль…</>
                ) : (
                  <><Wand2 className="h-4 w-4" /> Заполнить автоматически</>
                )}
              </button>
              {!instagramUrl.trim() && !telegramUrl.trim() && (
                <p className="text-xs text-center text-muted-foreground -mt-1">
                  Введи хотя бы одну ссылку выше
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Основные поля ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" /> Или заполни вручную
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* «Имя AI SMM-щика» — глобальная настройка, живёт в «Настройки»
                  аккаунта (SettingsClient), НЕ в создании проекта (тестер). */}

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
                  Кто читает блог? Возраст, пол, боли, желания
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 text-primary" /> Цели контента
                </Label>
                <Textarea
                  placeholder="Прогреть аудиторию к курсу, показать экспертность, получить заявки на консультации..."
                  value={contentGoals}
                  onChange={e => setContentGoals(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
                <p className={HINT}>Зачем вообще публикуется контент?</p>
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

              {/* Additional social links */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Остальные площадки</Label>
                {[
                  { icon: Globe,  ph: 'https://vk.com/username', val: vkUrl,       set: setVkUrl,       label: 'VK' },
                  { icon: Play,   ph: 'https://youtube.com/@channel', val: youtubeUrl, set: setYoutubeUrl, label: 'YouTube' },
                ].map(({ icon: Icon, ph, val, set, label }) => (
                  <div key={label} className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground w-[5.5rem]">{label}</span>
                    <Icon className="absolute left-[5.5rem] top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={ph}
                      value={val}
                      onChange={e => set(e.target.value)}
                      style={{ paddingLeft: '6.5rem' }}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
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
                  {/* Native date — explicit border so iOS Safari renders it correctly */}
                  <input
                    type="date"
                    value={launchDate}
                    onChange={e => setLaunchDate(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                    style={{ WebkitAppearance: 'none' }}
                  />
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

                  {/* Sales URL first — with auto-fill button */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ссылка на страницу продажи</Label>
                    <Input
                      placeholder="https://..."
                      value={product.sales_page_url}
                      onChange={e => updateProduct(i, 'sales_page_url', e.target.value)}
                      className="h-8 text-sm"
                    />
                    {product.sales_page_url.trim() && (
                      <button
                        type="button"
                        onClick={() => handleProductFill(i)}
                        disabled={productFillLoading[i]}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary text-xs font-medium py-1.5 transition-all disabled:opacity-60"
                      >
                        {productFillLoading[i]
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Анализирую страницу…</>
                          : <><Wand2 className="h-3 w-3" /> Заполнить описание из сайта</>
                        }
                      </button>
                    )}
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
        <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={step === 1}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Назад
        </Button>

        {step < 3 ? (
          <Button
            onClick={() => {
              if (step === 1 && !name.trim()) { toast.error('Введите имя / название проекта'); return }
              setStep(s => s + 1)
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
