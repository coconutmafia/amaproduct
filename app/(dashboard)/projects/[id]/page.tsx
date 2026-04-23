import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import { DeleteContentButton } from '@/components/content/DeleteContentButton'
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
  CheckCircle2,
  ChevronRight,
} from 'lucide-react'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!project) notFound()

  const [{ data: products }, { data: funnels }, { data: warmupPlans }, { data: recentContent }, { count: materialsCount }] =
    await Promise.all([
      supabase.from('products').select('*').eq('project_id', id).eq('is_active', true),
      supabase.from('funnels').select('*').eq('project_id', id).eq('is_active', true),
      supabase.from('warmup_plans').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(3),
      supabase.from('content_items').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(5),
      supabase.from('project_materials').select('*', { count: 'exact', head: true }).eq('project_id', id),
    ])

  // Step completion state
  const hasMaterials = (materialsCount ?? 0) > 0
  const hasWarmupPlan = warmupPlans?.some(p => ['approved', 'active'].includes(p.status)) ?? false
  const hasContentPlan = hasWarmupPlan // content plan depends on warmup plan
  const hasContent = (recentContent?.length ?? 0) > 0
  const allStepsDone = hasMaterials && hasWarmupPlan && hasContent

  const socials = [
    { icon: Instagram, url: project.instagram_url, label: 'Instagram' },
    { icon: Globe, url: project.vk_url, label: 'VK' },
    { icon: MessageCircle, url: project.telegram_url, label: 'Telegram' },
    { icon: Youtube, url: project.youtube_url, label: 'YouTube' },
  ].filter((s) => s.url)

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 md:space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8 shrink-0">
            <Link href="/projects">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Badge className="text-xs bg-green-500 text-white border-transparent shrink-0">
            Активный
          </Badge>
        </div>
        <div className="px-1">
          <h1 className="text-2xl font-bold text-foreground leading-tight">{project.name}</h1>
          {project.niche && (
            <p className="text-sm text-muted-foreground mt-0.5">{project.niche}</p>
          )}
        </div>
      </div>

      {/* Description + target audience */}
      {(project.description || project.target_audience || project.content_goals) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {project.description && (
            <div className="p-4 rounded-xl border border-border bg-card">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">О блогере</p>
              <p className="text-sm text-foreground leading-relaxed">{project.description}</p>
            </div>
          )}
          {project.target_audience && (
            <div className="p-4 rounded-xl border border-border bg-card">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Целевая аудитория</p>
              <p className="text-sm text-foreground leading-relaxed">{project.target_audience}</p>
            </div>
          )}
          {project.content_goals && (
            <div className="p-4 rounded-xl border border-border bg-card sm:col-span-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Цели контента</p>
              <p className="text-sm text-foreground leading-relaxed">{project.content_goals}</p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── Step guide (new users) or Quick actions (returning users) ── */}
          {!allStepsDone ? (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Начало работы</p>
                <h2 className="text-base font-bold text-foreground">Пройди все шаги, чтобы получать максимально эффективный контент</h2>
              </div>
              <div className="space-y-2">
                {/* Step 1 */}
                <Link href={`/projects/${id}/knowledge`} className="group flex items-center gap-4 p-3 rounded-xl border transition-all hover:border-primary/40 hover:bg-secondary/30 cursor-pointer"
                  style={{ borderColor: hasMaterials ? 'rgb(34 197 94 / 0.3)' : undefined,
                           backgroundColor: hasMaterials ? 'rgb(34 197 94 / 0.05)' : undefined }}>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 font-bold text-sm ${hasMaterials ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 text-primary'}`}>
                    {hasMaterials ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : '1'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${hasMaterials ? 'text-green-400' : 'text-foreground'}`}>
                      Загрузи материалы
                    </p>
                    <p className="text-xs text-muted-foreground">Распаковка, кейсы, аудитория — AI учится на твоих данных</p>
                  </div>
                  {!hasMaterials && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />}
                </Link>

                {/* Step 2 */}
                <Link href={`/projects/${id}/strategy`} className="group flex items-center gap-4 p-3 rounded-xl border transition-all hover:border-primary/40 hover:bg-secondary/30 cursor-pointer"
                  style={{ borderColor: hasWarmupPlan ? 'rgb(34 197 94 / 0.3)' : undefined,
                           backgroundColor: hasWarmupPlan ? 'rgb(34 197 94 / 0.05)' : undefined }}>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 font-bold text-sm ${hasWarmupPlan ? 'bg-green-500/15 text-green-400' : hasMaterials ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                    {hasWarmupPlan ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : '2'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${hasWarmupPlan ? 'text-green-400' : hasMaterials ? 'text-foreground' : 'text-muted-foreground'}`}>
                      Создай план прогрева
                    </p>
                    <p className="text-xs text-muted-foreground">Стратегия контента под твой запуск — фазы, аудитория, хуки</p>
                  </div>
                  {!hasWarmupPlan && hasMaterials && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />}
                </Link>

                {/* Step 3 */}
                <Link href={`/projects/${id}/content-plan`} className="group flex items-center gap-4 p-3 rounded-xl border transition-all hover:border-primary/40 hover:bg-secondary/30 cursor-pointer"
                  style={{ borderColor: hasContentPlan && hasWarmupPlan ? 'rgb(34 197 94 / 0.3)' : undefined,
                           backgroundColor: hasContentPlan && hasWarmupPlan ? 'rgb(34 197 94 / 0.05)' : undefined }}>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 font-bold text-sm ${hasContentPlan && hasWarmupPlan ? 'bg-green-500/15 text-green-400' : hasWarmupPlan ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                    {hasContentPlan && hasWarmupPlan ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : '3'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${hasContentPlan && hasWarmupPlan ? 'text-green-400' : hasWarmupPlan ? 'text-foreground' : 'text-muted-foreground'}`}>
                      Открой контент-план
                    </p>
                    <p className="text-xs text-muted-foreground">Расписание постов, рилсов и сториз на каждый день прогрева</p>
                  </div>
                  {!hasContent && hasWarmupPlan && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />}
                </Link>

                {/* Step 4 */}
                <Link href={`/projects/${id}/generator`} className="group flex items-center gap-4 p-3 rounded-xl border transition-all hover:border-primary/40 hover:bg-secondary/30 cursor-pointer"
                  style={{ borderColor: hasContent ? 'rgb(34 197 94 / 0.3)' : undefined,
                           backgroundColor: hasContent ? 'rgb(34 197 94 / 0.05)' : undefined }}>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 font-bold text-sm ${hasContent ? 'bg-green-500/15 text-green-400' : hasContentPlan && hasWarmupPlan ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                    {hasContent ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : '4'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${hasContent ? 'text-green-400' : hasContentPlan && hasWarmupPlan ? 'text-foreground' : 'text-muted-foreground'}`}>
                      Сделай первый контент
                    </p>
                    <p className="text-xs text-muted-foreground">AI напишет пост, рилс или карусель в твоём стиле за секунды</p>
                  </div>
                  {!hasContent && hasContentPlan && hasWarmupPlan && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />}
                </Link>
              </div>
            </div>
          ) : (
            /* ── Returning user: quick action buttons ── */
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { href: `/projects/${id}/content-plan`, icon: Grid3X3, label: 'Контент-план', color: 'text-yellow-400 bg-yellow-400/10', desc: 'Расписание по дням' },
                { href: `/projects/${id}/generator`, icon: Sparkles, label: 'Сделать контент', color: 'text-purple-400 bg-purple-400/10', desc: 'AI пишет пост / рилс' },
                { href: `/projects/${id}/knowledge`, icon: BookOpen, label: 'Материалы', color: 'text-blue-400 bg-blue-400/10', desc: 'База знаний' },
                { href: `/projects/${id}/strategy`, icon: Calendar, label: 'План прогрева', color: 'text-green-400 bg-green-400/10', desc: 'Стратегия запуска' },
                { href: `/projects/${id}/account-analysis`, icon: BarChart2, label: 'Анализ Instagram', color: 'text-pink-400 bg-pink-400/10', desc: 'Статистика аккаунта' },
                { href: `/projects/${id}/style-bank`, icon: Sparkles, label: 'Мой стиль', color: 'text-orange-400 bg-orange-400/10', desc: 'Одобренный контент' },
              ].map(({ href, icon: Icon, label, color, desc }) => (
                <Link key={href} href={href}>
                  <Card className="border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all cursor-pointer h-full">
                    <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="text-xs font-semibold text-foreground">{label}</span>
                      <span className="text-[10px] text-muted-foreground">{desc}</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {/* Recent content */}
          {recentContent && recentContent.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Последний контент</CardTitle>
                  <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground">
                    <Link href={`/projects/${id}/generator`}>Открыть →</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {recentContent.map((item) => (
                  <Link key={item.id} href={`/projects/${id}/generator`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
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
                    <DeleteContentButton itemId={item.id} />
                  </Link>
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
