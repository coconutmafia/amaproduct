import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Sparkles,
  Grid3X3,
  Globe as Instagram,
  Play as Youtube,
  MessageCircle,
  Globe,
  Package,
  GitBranch,
  ExternalLink,
  BarChart2,
} from 'lucide-react'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!project) notFound()

  const [{ data: products }, { data: funnels }, { data: warmupPlans }, { data: recentContent }] =
    await Promise.all([
      supabase.from('products').select('*').eq('project_id', id).eq('is_active', true),
      supabase.from('funnels').select('*').eq('project_id', id).eq('is_active', true),
      supabase.from('warmup_plans').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(1),
      supabase.from('content_items').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(5),
    ])

  const tabs = [
    { href: `/projects/${id}`, label: 'Обзор' },
    { href: `/projects/${id}/knowledge`, label: 'Материалы' },
    { href: `/projects/${id}/strategy`, label: 'Стратегия' },
    { href: `/projects/${id}/content-plan`, label: 'Контент-план' },
    { href: `/projects/${id}/generator`, label: 'Генератор' },
  ]

  const socials = [
    { icon: Instagram, url: project.instagram_url, label: 'Instagram' },
    { icon: Globe, url: project.vk_url, label: 'VK' },
    { icon: MessageCircle, url: project.telegram_url, label: 'Telegram' },
    { icon: Youtube, url: project.youtube_url, label: 'YouTube' },
  ].filter((s) => s.url)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href="/projects">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            {project.niche && (
              <p className="text-sm text-muted-foreground">{project.niche}</p>
            )}
          </div>
        </div>
        <Badge className="text-xs bg-green-500/15 text-green-400 border-green-500/25">
          Активный
        </Badge>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-0 overflow-x-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-primary/50 whitespace-nowrap transition-colors"
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { href: `/projects/${id}/knowledge`, icon: BookOpen, label: 'Материалы', color: 'text-blue-400 bg-blue-400/10' },
              { href: `/projects/${id}/strategy`, icon: Calendar, label: 'Стратегия', color: 'text-green-400 bg-green-400/10' },
              { href: `/projects/${id}/content-plan`, icon: Grid3X3, label: 'Контент-план', color: 'text-yellow-400 bg-yellow-400/10' },
              { href: `/projects/${id}/generator`, icon: Sparkles, label: 'Генератор', color: 'text-purple-400 bg-purple-400/10' },
              { href: `/projects/${id}/account-analysis`, icon: BarChart2, label: 'Анализ Instagram', color: 'text-pink-400 bg-pink-400/10' },
            ].map(({ href, icon: Icon, label, color }) => (
              <Link key={href} href={href}>
                <Card className="border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all cursor-pointer">
                  <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-medium text-foreground">{label}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Recent content */}
          {recentContent && recentContent.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Последний контент</CardTitle>
                  <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground">
                    <Link href={`/projects/${id}/generator`}>Все →</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {recentContent.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 shrink-0">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{item.title || item.content_type}</p>
                      <p className="text-xs text-muted-foreground">День {item.day_number} · {item.warmup_phase}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs ${item.is_approved ? 'text-green-400 border-green-400/30' : 'text-muted-foreground'}`}>
                      {item.is_approved ? 'Одобрен' : 'Черновик'}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Warmup plan */}
          {warmupPlans && warmupPlans.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Последний план прогрева</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{warmupPlans[0].name}</p>
                    <p className="text-xs text-muted-foreground">{warmupPlans[0].duration_days} дней · {warmupPlans[0].status}</p>
                  </div>
                  <Button variant="outline" size="sm" asChild className="border-border">
                    <Link href={`/projects/${id}/strategy`}>Открыть</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          {/* Completeness */}
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <ProgressIndicator score={project.completeness_score} />
              <Button className="w-full mt-4 gradient-accent text-white hover:opacity-90 text-sm" asChild>
                <Link href={`/projects/${id}/knowledge`}>
                  <BookOpen className="mr-2 h-4 w-4" />
                  Загрузить материалы
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Socials */}
          {socials.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Социальные сети</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {socials.map(({ icon: Icon, url, label }) => (
                  <a
                    key={label}
                    href={url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                    <ExternalLink className="h-3 w-3 ml-auto" />
                  </a>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Products */}
          {products && products.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Продукты ({products.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {products.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground truncate">{p.name}</span>
                    {p.price && (
                      <span className="text-muted-foreground text-xs ml-2 shrink-0">
                        {p.price.toLocaleString()} {p.currency}
                      </span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Funnels */}
          {funnels && funnels.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Воронки ({funnels.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {funnels.map((f) => (
                  <div key={f.id} className="text-sm">
                    <span className="text-foreground">{f.name}</span>
                    <Badge variant="outline" className="ml-2 text-xs">
                      {f.funnel_type === 'cold' ? 'Холодная' : f.funnel_type === 'warm' ? 'Тёплая' : 'Гибридная'}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
