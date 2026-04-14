'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ArrowLeft, AtSign, Sparkles, Loader2, Users, Heart,
  MessageCircle, Plus, X, TrendingUp, CheckCircle, Info,
} from 'lucide-react'

export default function AccountAnalysisPage() {
  const params = useParams()
  const id = params.id as string

  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [followersCount, setFollowersCount] = useState('')
  const [avgLikes, setAvgLikes] = useState('')
  const [avgComments, setAvgComments] = useState('')
  const [posts, setPosts] = useState<string[]>(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<string | null>(null)

  const addPost = () => setPosts([...posts, ''])
  const removePost = (i: number) => setPosts(posts.filter((_, idx) => idx !== i))
  const updatePost = (i: number, value: string) => {
    const next = [...posts]
    next[i] = value
    setPosts(next)
  }

  const handleAnalyze = async () => {
    const filledPosts = posts.filter(p => p.trim())
    if (!username.trim() && filledPosts.length === 0) {
      toast.error('Укажи никнейм или вставь хотя бы один пост')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/ai/analyze-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          instagramUsername: username.replace('@', '').trim(),
          bio,
          followersCount: followersCount ? parseInt(followersCount) : null,
          avgLikes: avgLikes ? parseInt(avgLikes) : null,
          avgComments: avgComments ? parseInt(avgComments) : null,
          posts: filledPosts,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setAnalysis(data.analysis)
      toast.success('Анализ готов!')
    } catch {
      toast.error('Ошибка анализа — проверь API ключи')
    } finally {
      setLoading(false)
    }
  }

  // Parse markdown-like sections for pretty display
  const sections = analysis ? analysis.split(/^## /m).filter(Boolean).map(s => {
    const lines = s.split('\n')
    const title = lines[0].trim()
    const content = lines.slice(1).join('\n').trim()
    return { title, content }
  }) : []

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <AtSign className="h-5 w-5 text-pink-400" />
            Анализ AtSign-аккаунта
          </h1>
          <p className="text-sm text-muted-foreground">AI анализирует твой контент и даёт рекомендации по стратегии запуска</p>
        </div>
      </div>

      {/* Info banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex gap-3">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Как это работает:</span> вставь текст своих постов (не нужны скриншоты) — AI проанализирует стиль, темы, вовлечённость и даст конкретный план улучшений на 30 дней перед запуском. Анализ сохраняется в базу знаний проекта.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input form */}
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Данные аккаунта</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Username */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Никнейм в AtSign</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">@</span>
                  <Input
                    placeholder="username"
                    value={username}
                    onChange={e => setUsername(e.target.value.replace('@', ''))}
                    className="bg-input border-border pl-7"
                  />
                </div>
              </div>

              {/* Bio */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Описание профиля (Bio)</Label>
                <Textarea
                  placeholder="Скопируй описание своего профиля..."
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={3}
                  className="bg-input border-border resize-none text-sm"
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Подписчики
                  </Label>
                  <Input
                    type="number"
                    placeholder="5000"
                    value={followersCount}
                    onChange={e => setFollowersCount(e.target.value)}
                    className="bg-input border-border h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Heart className="h-3 w-3" /> Ср. лайки
                  </Label>
                  <Input
                    type="number"
                    placeholder="120"
                    value={avgLikes}
                    onChange={e => setAvgLikes(e.target.value)}
                    className="bg-input border-border h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" /> Ср. комменты
                  </Label>
                  <Input
                    type="number"
                    placeholder="15"
                    value={avgComments}
                    onChange={e => setAvgComments(e.target.value)}
                    className="bg-input border-border h-8 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Posts */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Последние посты</CardTitle>
                <Badge variant="outline" className="text-xs">{posts.filter(p => p.trim()).length} постов</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Скопируй тексты 5-10 последних постов — чем больше, тем точнее анализ</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {posts.map((post, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Пост {i + 1}</Label>
                    {posts.length > 1 && (
                      <button onClick={() => removePost(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <Textarea
                    placeholder="Вставь текст поста сюда..."
                    value={post}
                    onChange={e => updatePost(i, e.target.value)}
                    rows={4}
                    className="bg-input border-border resize-none text-sm"
                  />
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={addPost}
                className="w-full border-dashed border-border hover:border-primary text-xs"
              >
                <Plus className="mr-1.5 h-3 w-3" />
                Добавить ещё пост
              </Button>
            </CardContent>
          </Card>

          <Button
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full gradient-accent text-white hover:opacity-90"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Анализируем аккаунт...</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Проанализировать аккаунт</>
            )}
          </Button>
        </div>

        {/* Analysis result */}
        <div>
          {!analysis ? (
            <Card className="border-dashed border-border bg-card/50 h-full">
              <CardContent className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-pink-500/10">
                  <TrendingUp className="h-8 w-8 text-pink-400" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Заполни данные и нажми «Анализировать»</p>
                  <p className="text-sm text-muted-foreground mt-1">AI изучит твой контент и выдаст конкретный план</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {username && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-pink-500/20 bg-pink-500/5">
                  <AtSign className="h-4 w-4 text-pink-400" />
                  <span className="text-sm font-medium text-foreground">@{username}</span>
                  <Badge className="ml-auto text-xs bg-green-500/15 text-green-400 border-green-500/25">
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Анализ сохранён в проект
                  </Badge>
                </div>
              )}

              {sections.map(({ title, content }, i) => (
                <Card key={i} className="border-border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {content}
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Button
                variant="outline"
                onClick={() => setAnalysis(null)}
                className="w-full border-border text-sm"
              >
                Сделать новый анализ
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
