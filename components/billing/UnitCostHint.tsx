import { UNIT_COSTS } from '@/lib/generations-config'

// Подпись «сколько стоит это действие» рядом с кнопкой дорогой операции.
// Мандат Матвея 25.08: «не просто урезать, а чтобы человек ПОНИМАЛ». Числа
// берутся только из UNIT_COSTS (страж unit-costs запрещает хардкод цен в UI),
// поэтому правка прайс-листа автоматически меняет и тексты у кнопок.
export function unitsWord(n: number): string {
  const t = n % 10, h = n % 100
  if (t === 1 && h !== 11) return 'единица'
  if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return 'единицы'
  return 'единиц'
}

export function UnitCostHint({ cost, per, className }: { cost: number; per?: string; className?: string }) {
  return (
    <span className={className ?? 'text-[11px] text-muted-foreground'}>
      Списывается {cost} {unitsWord(cost)} контента{per ? ` ${per}` : ''}
    </span>
  )
}

// Готовые подписи для конкретных мест — чтобы не разъезжались формулировки.
export const UNIT_HINTS = {
  transcribe: `Списывается ${UNIT_COSTS.transcribe_castdev} ${unitsWord(UNIT_COSTS.transcribe_castdev)} контента за файл`,
  blogAudit:  `Списывается ${UNIT_COSTS.blog_audit} ${unitsWord(UNIT_COSTS.blog_audit)} контента за разбор`,
  viralReel:  `Списывается ${UNIT_COSTS.viral_reels} ${unitsWord(UNIT_COSTS.viral_reels)} контента за рилз`,
  scrape:     `Списывается ${UNIT_COSTS.instagram_scrape} ${unitsWord(UNIT_COSTS.instagram_scrape)} контента за аккаунт`,
  image:      `Списывается ${UNIT_COSTS.image_generation} ${unitsWord(UNIT_COSTS.image_generation)} контента за генерацию`,
} as const
