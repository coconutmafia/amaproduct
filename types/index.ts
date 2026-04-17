export type UserRole = 'admin' | 'producer' | 'client'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  owner_id: string
  name: string
  description: string | null
  niche: string | null
  instagram_url: string | null
  vk_url: string | null
  telegram_url: string | null
  youtube_url: string | null
  status: 'active' | 'archived' | 'draft'
  completeness_score: number
  created_at: string
  updated_at: string
}

export type MaterialType =
  | 'audience_survey'
  | 'interview_transcript'
  | 'audience_research'
  | 'competitors'
  | 'unpacking_map'
  | 'meanings_map'
  | 'cases_reviews'
  | 'marketing_strategy'
  | 'marketing_tactics'
  | 'tone_of_voice'
  | 'funnel_description'
  | 'chatbot_description'
  | 'product_description'
  | 'content_reference'
  | 'other'
  | 'additional'

export interface ProjectMaterial {
  id: string
  project_id: string
  material_type: MaterialType
  title: string
  raw_content: string | null
  file_url: string | null
  file_type: string | null
  processing_status: 'pending' | 'processing' | 'ready' | 'error'
  parsed_data: Record<string, unknown> | null
  created_at: string
}

export interface Product {
  id: string
  project_id: string
  name: string
  description: string | null
  price: number | null
  currency: string
  product_type: string | null
  sales_page_url: string | null
  is_active: boolean
  created_at: string
}

export interface Funnel {
  id: string
  project_id: string
  name: string
  description: string | null
  funnel_type: 'cold' | 'warm' | 'hybrid' | null
  steps: Record<string, unknown> | null
  chatbot_link: string | null
  is_active: boolean
  created_at: string
}

export type WarmupPhase = 'awareness' | 'trust' | 'desire' | 'close'

export interface WarmupPlan {
  id: string
  project_id: string
  product_id: string | null
  name: string
  duration_days: number
  audience_type: string | null
  funnel_id: string | null
  events: Record<string, unknown> | null
  use_cases: boolean
  extra_hooks: string | null
  status: 'draft' | 'approved' | 'active' | 'completed'
  strategic_summary: string | null
  summary_approved: boolean
  plan_data: WarmupPlanData | null
  ai_conversation: Message[] | null
  created_at: string
  updated_at: string
}

export interface WarmupPlanData {
  warmup_plan: {
    total_days: number
    phases: WarmupPhaseData[]
  }
}

export interface WarmupPhaseData {
  phase: WarmupPhase
  days: string
  goal: string
  daily_plan: DayPlan[]
}

export interface DayPlan {
  day: number
  theme: string
  format: ContentType[]
  key_message: string
  warmup_hook: string
  cta: string
  visual_mood: string
  tov_note: string
}

export type ContentType = 'post' | 'carousel' | 'reels' | 'stories' | 'live' | 'webinar' | 'email'

export interface ContentItem {
  id: string
  project_id: string
  content_plan_id: string | null
  warmup_plan_id: string | null
  content_type: ContentType
  title: string | null
  day_number: number | null
  warmup_phase: WarmupPhase | null
  body_text: string | null
  structured_data: Record<string, unknown> | null
  cta: string | null
  hashtags: string[] | null
  generation_prompt: string | null
  version_number: number
  is_approved: boolean
  published_at: string | null
  reach: number | null
  reactions: number | null
  saves: number | null
  performance_notes: string | null
  created_at: string
  updated_at: string
}

export interface ContentPlan {
  id: string
  project_id: string
  warmup_plan_id: string | null
  week_number: number
  start_date: string | null
  end_date: string | null
  status: string
  plan_data: Record<string, unknown> | null
  created_at: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type KnowledgeContentType = 'methodology' | 'framework' | 'example' | 'template' | 'tov_system'

export interface KnowledgeVaultItem {
  id: string
  admin_id: string
  title: string
  description: string | null
  content_type: KnowledgeContentType
  raw_content: string | null
  file_url: string | null
  file_type: string | null
  processing_status: 'pending' | 'processing' | 'ready' | 'error'
  created_at: string
}

export interface CompletenessResult {
  score: number
  missing: string[]
  breakdown: Record<string, number>
}

// ===== STYLE BANK =====
export interface StyleExample {
  id: string
  project_id: string
  content_type: ContentType
  title: string | null
  body_text: string
  warmup_phase: WarmupPhase | null
  performance_score: number
  tags: string[] | null
  is_active: boolean
  source_content_item_id: string | null
  created_at: string
}

// ===== REFERRAL SYSTEM =====
export type ReferralStatus = 'registered' | 'active' | 'rewarded' | 'expired'
export type SubscriptionTier = 'free' | 'pro' | 'agency'

export interface Referral {
  id: string
  referrer_id: string
  referred_id: string
  referral_code: string
  status: ReferralStatus
  referrer_reward_type: 'bonus_days' | 'cash' | 'none'
  referrer_reward_value: number
  referrer_reward_given: boolean
  referred_discount_percent: number
  utm_source: string | null
  utm_medium: string | null
  created_at: string
  activated_at: string | null
  rewarded_at: string | null
  // joined data
  referred_profile?: { full_name: string | null; email: string }
}

export interface ReferralStats {
  user_id: string
  referral_code: string
  total_referrals: number
  active_referrals: number
  rewards_earned: number
  total_bonus_days: number
}

export interface ProfileWithReferral extends Profile {
  referral_code: string | null
  referred_by: string | null
  subscription_tier: SubscriptionTier
  subscription_expires_at: string | null
  bonus_days_earned: number
}
