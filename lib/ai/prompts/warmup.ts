import type { WarmupPlan, Product, Funnel } from '@/types'

export function buildWarmupSummaryPrompt(
  plan: Partial<WarmupPlan>,
  product: Product | null,
  funnel: Funnel | null,
  hooks: string[]
): string {
  return `На основе следующих данных создай СТРАТЕГИЧЕСКОЕ РЕЗЮМЕ ПРОГРЕВА в формате JSON.

Данные:
- Продукт: ${product?.name || 'не выбран'} (${product?.price || '—'} ${product?.currency || ''})
- Длительность прогрева: ${plan.duration_days} дней
- Тип аудитории: ${plan.audience_type || 'холодная + тёплая'}
- Воронка: ${funnel?.name || 'без воронки'}
- Использовать кейсы: ${plan.use_cases ? 'да' : 'нет'}
- Дополнительные смыслы: ${hooks.join(', ') || 'не указаны'}
- Дополнительные крючки: ${plan.extra_hooks || 'нет'}

Создай структурированный план прогрева со следующими фазами:
- Осознание (awareness): первая треть
- Доверие (trust): вторая треть
- Желание (desire): ближе к концу
- Закрытие (close): последние дни

Верни JSON строго в формате:
{
  "strategic_summary": "краткое текстовое описание стратегии",
  "warmup_plan": {
    "total_days": ${plan.duration_days},
    "phases": [
      {
        "phase": "awareness",
        "days": "1-X",
        "goal": "цель фазы",
        "daily_plan": [
          {
            "day": 1,
            "theme": "тема дня",
            "format": ["post", "stories"],
            "key_message": "ключевое сообщение",
            "warmup_hook": "смысловой крючок",
            "cta": "призыв к действию",
            "visual_mood": "настроение визуала",
            "tov_note": "заметка по стилю"
          }
        ]
      }
    ]
  }
}`
}

export function buildContentPrompt(params: {
  contentType: string
  dayNumber: number
  totalDays: number
  phase: string
  phaseGoal: string
  theme: string
  hook: string
  cta: string
  projectName: string
  niche: string
  ragContext: string
  additionalInstructions?: string
}): string {
  return `ЗАДАЧА: Написать ${params.contentType} для блогера ${params.projectName}

КОНТЕКСТ ИЗ БАЗЫ ПРОЕКТА:
${params.ragContext}

ПАРАМЕТРЫ:
- День прогрева: ${params.dayNumber} из ${params.totalDays}
- Фаза: ${params.phase} (цель фазы: ${params.phaseGoal})
- Тема дня: ${params.theme}
- Смысловой крючок: ${params.hook}

ТРЕБОВАНИЯ:
1. Первые 1–2 строки — крючок (стоп перед "ещё")
2. Тело поста: история / факты / ценность
3. Переход к CTA
4. CTA: ${params.cta}
5. НЕ использовать: "уникальная возможность", "незабываемый результат", "революционный подход"
6. Использовать живой разговорный стиль

${params.additionalInstructions ? `ДОПОЛНИТЕЛЬНО: ${params.additionalInstructions}` : ''}`
}
