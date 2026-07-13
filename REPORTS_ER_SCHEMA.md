# AMA — ER-диаграмма и таблица сущностей БД (B3)

> Собрано из `supabase/migrations/*` на 13 июля 2026. Источник правды — миграции.
> Для публикации в Google Doc: Mermaid-диаграмму ниже можно вставить через любой Mermaid-рендер
> (mermaid.live → экспорт PNG/SVG), либо через расширение Google Docs с поддержкой Mermaid.
> Таблица сущностей — обычный текст, вставляется как есть.
>
> **Про пользователей:** Supabase Auth хранит юзеров в `auth.users`. Таблица `profiles` расширяет их 1:1
> (`profiles.id = auth.users.id`) и держит роль/тариф/статус подписки. На диаграмме «пользователь» = `profiles`.
> Часть таблиц ссылается напрямую на `auth.users` (помечено в тексте) — по смыслу это тот же пользователь.

---

## ER-диаграмма (Mermaid)

```mermaid
erDiagram
    profiles ||--o{ projects : "владеет"
    profiles ||--o{ knowledge_vault : "ведёт (admin)"
    profiles ||--o{ promo_codes : "создаёт"
    profiles ||--o{ promo_code_uses : "активирует"
    profiles ||--o{ referrals : "реферер/приглашённый"
    profiles ||--o{ saved_content : "сохраняет"
    profiles ||--o{ jobs : "запускает"
    profiles ||--o{ project_members : "участник"

    projects ||--o{ products : ""
    projects ||--o{ funnels : ""
    projects ||--o{ project_materials : ""
    projects ||--o{ project_chunks : ""
    projects ||--o{ warmup_plans : ""
    projects ||--o{ content_plans : ""
    projects ||--o{ content_items : ""
    projects ||--o{ ai_conversations : ""
    projects ||--o{ style_examples : ""
    projects ||--o{ viral_reels : ""
    projects ||--o{ project_members : "доступы"
    projects ||--o{ saved_content : ""

    products ||--o{ warmup_plans : ""
    funnels  ||--o{ warmup_plans : ""
    warmup_plans ||--o{ content_plans : ""
    warmup_plans ||--o{ content_items : ""
    content_plans ||--o{ content_items : ""
    content_items ||--o{ content_versions : "история версий"
    content_items ||--o{ style_examples : "источник (эталон)"

    project_materials ||--o{ project_chunks : "эмбеддинги"
    knowledge_vault   ||--o{ knowledge_chunks : "эмбеддинги"
    promo_codes       ||--o{ promo_code_uses : ""

    profiles {
        uuid id PK "= auth.users.id"
        text email
        text full_name
        text role "admin | producer | client"
        text subscription_tier "trial|solo|pro|producer"
        text subscription_status "trialing|active|past_due|…"
        int  generations_used
        int  bonus_generations
        timestamptz trial_ends_at
        text payment_provider "prodamus | stripe"
    }
    projects {
        uuid id PK
        uuid owner_id FK "-> profiles"
        text name
        text niche
        text instagram_url
        text status "active|archived|draft"
        text brand_accent_color "brand-kit"
        text brand_font_name "brand-kit"
    }
    products {
        uuid id PK
        uuid project_id FK
        text name
        decimal price
        text currency
        text product_type
    }
    funnels {
        uuid id PK
        uuid project_id FK
        text funnel_type
        jsonb steps
        text chatbot_link
    }
    project_materials {
        uuid id PK
        uuid project_id FK
        text material_type "tov|cases|research|…"
        text raw_content
        text file_url
        text processing_status
    }
    project_chunks {
        uuid id PK
        uuid material_id FK
        uuid project_id FK
        text chunk_text
        vector embedding "1536"
    }
    warmup_plans {
        uuid id PK
        uuid project_id FK
        uuid product_id FK
        uuid funnel_id FK
        int  duration_days
        text status "draft|approved|active|completed"
        jsonb plan_data
    }
    content_plans {
        uuid id PK
        uuid project_id FK
        uuid warmup_plan_id FK
        int  week_number
        jsonb plan_data
    }
    content_items {
        uuid id PK
        uuid project_id FK
        uuid content_plan_id FK
        uuid warmup_plan_id FK
        text content_type "post|carousel|reels|stories|…"
        int  day_number
        text warmup_phase "awareness|trust|desire|close"
        text body_text
        jsonb structured_data
    }
    content_versions {
        uuid id PK
        uuid content_item_id FK
        int  version_number
        text body_text
    }
    ai_conversations {
        uuid id PK
        uuid project_id FK
        text conversation_type
        jsonb messages
    }
    style_examples {
        uuid id PK
        uuid project_id FK
        uuid source_content_item_id FK
        text content_type
        text body_text
        int  performance_score
    }
    saved_content {
        uuid id PK
        uuid user_id FK "-> auth.users"
        uuid project_id FK
        text content_type
        text body
    }
    project_members {
        uuid id PK
        uuid project_id FK
        uuid user_id FK "-> auth.users (null до принятия)"
        text invited_email
        text role "editor|viewer"
        text status "pending|active"
    }
    knowledge_vault {
        uuid id PK
        uuid admin_id FK "-> profiles"
        text title
        text content_type "methodology|framework|…"
        text processing_status
    }
    knowledge_chunks {
        uuid id PK
        uuid vault_id FK
        text chunk_text
        vector embedding "1536"
    }
    viral_reels {
        uuid id PK
        text scope "system|project"
        uuid project_id FK
        text transcript
        text analysis
        bigint views
    }
    promo_codes {
        uuid id PK
        text code UK
        int  bonus_generations
        int  max_uses
        uuid created_by FK "-> profiles"
    }
    promo_code_uses {
        uuid id PK
        uuid promo_id FK
        uuid user_id FK "-> profiles"
    }
    referrals {
        uuid id PK
        uuid referrer_id FK "-> profiles"
        uuid referred_id FK "-> profiles"
        text referral_code
        text status
    }
```

**Сущности без внешних ключей** (стоят отдельно — на диаграмме не связаны): `content_trends` (системные тренды,
`created_by` → auth.users), `billing_events` (идемпотентность вебхуков оплат), `rate_limits` (лимиты запросов
по юзеру, без FK), `error_events` (лог ошибок, `user_id` без FK — логирование не должно падать на битой ссылке).

---

## Таблица сущностей (бизнес-смысл)

| Сущность | Бизнес-смысл | Ключевые связи |
|---|---|---|
| **profiles** | Пользователь системы (расширяет `auth.users`): роль (admin/producer/client), тариф и статус подписки, счётчик генераций, платёжный провайдер | 1:1 с `auth.users`; владеет `projects` |
| **projects** | Проект блогера/эксперта — корень всех данных. Ниша, соцсети, **бренд-кит** (цвета/шрифты для визуального движка) | `owner_id`→profiles; родитель почти всего |
| **products** | Продукт эксперта (курс/наставничество/…): цена, тип, страница продаж. Под продукт строится прогрев | `project_id`→projects |
| **funnels** | Воронка проекта: шаги, тип, ссылка на чат-бот | `project_id`→projects |
| **project_materials** | Загруженные материалы проекта (интервью, кейсы, ToV, исследование аудитории и т.д.) — топливо для RAG | `project_id`→projects |
| **project_chunks** | Векторные эмбеддинги кусков материалов проекта (поиск по смыслу, 1536-мерные) | `material_id`→project_materials, `project_id`→projects |
| **warmup_plans** | План прогрева: длительность, фазы/дни (`plan_data` JSONB), статус. Строится под продукт+воронку | `project_id`,`product_id`,`funnel_id` |
| **content_plans** | Недельный контент-план проекта (`plan_data` JSONB), привязан к прогреву | `project_id`,`warmup_plan_id` |
| **content_items** | Единица контента (пост/карусель/рилз/сторис/…): текст, структура, день, фаза прогрева, метрики. Ядро продукта | `project_id`,`content_plan_id`,`warmup_plan_id` |
| **content_versions** | История версий единицы контента (откат правок) | `content_item_id`→content_items |
| **ai_conversations** | Сохранённые диалоги AI-ассистента по проекту (тип, сообщения, использованный контекст) | `project_id`→projects |
| **style_examples** | Банк эталонов стиля — одобренный контент как образец голоса для генерации; может быть создан из единицы контента | `project_id`, `source_content_item_id` |
| **saved_content** | Библиотека «Готовое» пользователя: сохранённый готовый контент | `user_id`→auth.users, `project_id` |
| **project_members** | Доступы к проекту (командная работа): роль editor/viewer, инвайт по email, статус pending/active | `project_id`, `user_id`, `invited_by` |
| **knowledge_vault** | Системная база знаний (методология/фреймворки/шаблоны), ведёт админ — общая для всех проектов | `admin_id`→profiles |
| **knowledge_chunks** | Векторные эмбеддинги системной базы знаний (RAG по методологии) | `vault_id`→knowledge_vault |
| **content_trends** | Актуальные форматы/тренды контента (системные или по нишам) — подсказки для генерации | `created_by`→auth.users |
| **viral_reels** | Разобранные «залетевшие» рилзы (транскрипт + AI-разбор хука/структуры), системные или по проекту | `project_id`→projects |
| **promo_codes** | Промокоды на бонусные генерации (лимит использований, срок) | `created_by`→profiles |
| **promo_code_uses** | Факт использования промокода (один на юзера на код) | `promo_id`, `user_id` |
| **referrals** | Реферальная программа: кто кого привёл, награда, статус | `referrer_id`, `referred_id`→profiles |
| **billing_events** | Идемпотентность вебхуков оплат (id события провайдера) — чтобы повторный вебхук применился один раз | — (пишет только сервис-роль) |
| **jobs** | Фоновые задачи (расшифровка аудио и т.п.): статус, прогресс, результат | `user_id`, `project_id` |
| **rate_limits** | Счётчики лимитов запросов по юзеру/бакету/окну | — (ключ по user_id) |
| **error_events** | Лог ошибок (сервер/джоба/крон + клиентские ошибки тестеров) — читается в `/admin/errors` | — (`user_id` без FK, best-effort) |

---

## Заметки для вики/Google Doc
- Все дочерние таблицы проекта — `ON DELETE CASCADE` от `projects` (удаление проекта чистит его данные).
- Эмбеддинги (`project_chunks`, `knowledge_chunks`) — `vector(1536)` под OpenAI `text-embedding-3-small`.
- Биллинг-поля живут прямо в `profiles` (тариф/статус/провайдер) — отдельной таблицы «подписки» нет.
- Реальной таблицы «оплаты» (юзер/дата/сумма) пока НЕТ — биллинг спит (`BILLING_ENFORCED`), `billing_events`
  хранит только id вебхуков. Появится при активации Prodamus.
