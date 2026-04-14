'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ChevronRight,
  ChevronLeft,
  MessageCircle,
  Globe,
  Plus,
  X,
  Check,
  Loader2,
  Package,
  GitBranch,
  Play,
} from 'lucide-react'

interface Product {
  name: string
  product_type: string
  price: string
  currency: string
  description: string
  sales_page_url: string
}

interface Funnel {
  name: string
  funnel_type: string
  description: string
  chatbot_link: string
}

const STEPS = [
  { id: 1, title: 'Основное', icon: Globe },
  { id: 2, title: 'Продукты', icon: Package },
  { id: 3, title: 'Воронки', icon: GitBranch },
]

export function ProjectWizard() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  // Step 1
  const [name, setName] = useState('')
  const [niche, setNiche] = useState('')
  const [description, setDescription] = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  const [vkUrl, setVkUrl] = useState('')
  const [telegramUrl, setTelegramUrl] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')

  // Step 2
  const [products, setProducts] = useState<Product[]>([{
    name: '', product_type: 'курс', price: '', currency: 'RUB', description: '', sales_page_url: ''
  }])

  // Step 3
  const [funnels, setFunnels] = useState<Funnel[]>([{
    name: '', funnel_type: 'cold', description: '', chatbot_link: ''
  }])

  const addProduct = () => setProducts([...products, {
    name: '', product_type: 'курс', price: '', currency: 'RUB', description: '', sales_page_url: ''
  }])

  const removeProduct = (i: number) => setProducts(products.filter((_, idx) => idx !== i))

  const addFunnel = () => setFunnels([...funnels, {
    name: '', funnel_type: 'cold', description: '', chatbot_link: ''
  }])

  const removeFunnel = (i: number) => setFunnels(funnels.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Введите название проекта')
      return
    }
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          owner_id: user.id,
          name: name.trim(),
          niche: niche.trim() || null,
          description: description.trim() || null,
          instagram_url: instagramUrl.trim() || null,
          vk_url: vkUrl.trim() || null,
          telegram_url: telegramUrl.trim() || null,
          youtube_url: youtubeUrl.trim() || null,
        })
        .select()
        .single()

      if (projectError) throw projectError

      // Insert products
      const validProducts = products.filter((p) => p.name.trim())
      if (validProducts.length > 0) {
        await supabase.from('products').insert(
          validProducts.map((p) => ({
            project_id: project.id,
            name: p.name,
            product_type: p.product_type,
            price: p.price ? parseFloat(p.price) : null,
            currency: p.currency,
            description: p.description || null,
            sales_page_url: p.sales_page_url || null,
          }))
        )
      }

      // Insert funnels
      const validFunnels = funnels.filter((f) => f.name.trim())
      if (validFunnels.length > 0) {
        await supabase.from('funnels').insert(
          validFunnels.map((f) => ({
            project_id: project.id,
            name: f.name,
            funnel_type: f.funnel_type,
            description: f.description || null,
            chatbot_link: f.chatbot_link || null,
          }))
        )
      }

      toast.success('Проект создан!')
      router.push(`/projects/${project.id}`)
    } catch (error) {
      toast.error('Ошибка создания проекта')
      console.error(error)
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
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                step === s.id
                  ? 'gradient-accent text-white'
                  : step > s.id
                  ? 'bg-green-500/20 text-green-400 cursor-pointer'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {step > s.id ? <Check className="h-4 w-4" /> : s.id}
            </button>
            <span className={`text-sm hidden sm:block ${step === s.id ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {s.title}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-12 sm:w-24 mx-2 ${step > s.id ? 'bg-green-500/40' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Basic info */}
      {step === 1 && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Основная информация</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Имя проекта / блогера *</Label>
              <Input
                placeholder="Анна Иванова — Нутрициолог"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-input border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ниша / тема блога</Label>
              <Input
                placeholder="Нутрициология и здоровое питание"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="bg-input border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Описание</Label>
              <Textarea
                placeholder="Краткое описание эксперта и его аудитории..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="bg-input border-border resize-none"
              />
            </div>
            <div className="space-y-3">
              <Label>Социальные сети</Label>
              {[
                { icon: Globe, value: instagramUrl, set: setInstagramUrl, placeholder: 'https://instagram.com/username' },
                { icon: Globe, value: vkUrl, set: setVkUrl, placeholder: 'https://vk.com/username' },
                { icon: MessageCircle, value: telegramUrl, set: setTelegramUrl, placeholder: 'https://t.me/username' },
                { icon: Play, value: youtubeUrl, set: setYoutubeUrl, placeholder: 'https://youtube.com/@channel' },
              ].map(({ icon: Icon, value, set, placeholder }) => (
                <div key={placeholder} className="relative">
                  <Icon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="bg-input border-border pl-9"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Products */}
      {step === 2 && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Продукты для запуска</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {products.map((product, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-secondary/30 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">Продукт {i + 1}</Badge>
                  {products.length > 1 && (
                    <button onClick={() => removeProduct(i)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">Название</Label>
                    <Input
                      placeholder="Курс «Здоровье за 30 дней»"
                      value={product.name}
                      onChange={(e) => {
                        const p = [...products]
                        p[i].name = e.target.value
                        setProducts(p)
                      }}
                      className="bg-input border-border h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Тип</Label>
                    <Select value={product.product_type} onValueChange={(v) => {
                      if (!v) return; const p = [...products]; p[i].product_type = v; setProducts(p)
                    }}>
                      <SelectTrigger className="h-8 text-sm bg-input border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['курс', 'консультация', 'марафон', 'интенсив', 'мастер-класс', 'другое'].map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Цена</Label>
                    <div className="flex gap-1.5">
                      <Input
                        type="number"
                        placeholder="25000"
                        value={product.price}
                        onChange={(e) => {
                          const p = [...products]; p[i].price = e.target.value; setProducts(p)
                        }}
                        className="bg-input border-border h-8 text-sm"
                      />
                      <Select value={product.currency} onValueChange={(v) => {
                        if (!v) return; const p = [...products]; p[i].currency = v; setProducts(p)
                      }}>
                        <SelectTrigger className="h-8 text-sm bg-input border-border w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['RUB', 'USD', 'EUR'].map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addProduct} className="w-full border-dashed border-border hover:border-primary">
              <Plus className="mr-2 h-4 w-4" />
              Добавить продукт
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Funnels */}
      {step === 3 && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Воронки продаж</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {funnels.map((funnel, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-secondary/30 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">Воронка {i + 1}</Badge>
                  {funnels.length > 1 && (
                    <button onClick={() => removeFunnel(i)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Название</Label>
                    <Input
                      placeholder="Воронка через Instagram Stories"
                      value={funnel.name}
                      onChange={(e) => {
                        const f = [...funnels]; f[i].name = e.target.value; setFunnels(f)
                      }}
                      className="bg-input border-border h-8 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Тип аудитории</Label>
                      <Select value={funnel.funnel_type} onValueChange={(v) => {
                        if (!v) return; const f = [...funnels]; f[i].funnel_type = v; setFunnels(f)
                      }}>
                        <SelectTrigger className="h-8 text-sm bg-input border-border">
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
                        onChange={(e) => {
                          const f = [...funnels]; f[i].chatbot_link = e.target.value; setFunnels(f)
                        }}
                        className="bg-input border-border h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Описание</Label>
                    <Textarea
                      placeholder="Опишите как работает воронка..."
                      value={funnel.description}
                      onChange={(e) => {
                        const f = [...funnels]; f[i].description = e.target.value; setFunnels(f)
                      }}
                      rows={2}
                      className="bg-input border-border resize-none text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addFunnel} className="w-full border-dashed border-border hover:border-primary">
              <Plus className="mr-2 h-4 w-4" />
              Добавить воронку
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(step - 1)}
          disabled={step === 1}
          className="border-border"
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Назад
        </Button>

        {step < 3 ? (
          <Button
            onClick={() => {
              if (step === 1 && !name.trim()) {
                toast.error('Введите название проекта')
                return
              }
              setStep(step + 1)
            }}
            className="gradient-accent text-white hover:opacity-90"
          >
            Далее
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="gradient-accent text-white hover:opacity-90"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Создать проект
          </Button>
        )}
      </div>
    </div>
  )
}
