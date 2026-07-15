# Stripe → БОЕВОЙ режим (LIVE) — чек-лист для Матвея

> Делает владелец сам (финансовые/учётные данные ассистент не вводит). Код Stripe рабочий и уже
> подготовлен к live (см. коммит «Stripe live-готовность» — устойчивость к тестовым id, лог вебхука
> в /admin/errors, запись оплат в payments). Ниже — ровно те шаги, что нужны на стороне Stripe/Vercel.

## 0. Предпосылка: активировать аккаунт Stripe для live
- В Stripe Dashboard переключатель **Test mode → выключить** (правый верх). Если аккаунт ещё не
  активирован — Stripe попросит **Activate account**: бизнес-данные, реквизиты для выплат (счёт),
  описание бизнеса, сайт `amaproduct.com`. Без активации live-ключи не работают.
- ⚠️ Приём международных карт = аккаунт на юрлицо/резидентство, где Stripe доступен (РФ Stripe не
  обслуживает — обычно это карта/юрлицо Августы или партнёра в поддерживаемой стране). Продамус
  остаётся для РФ-карт; Stripe — для «мира». Это уже так задумано в коде (тумблер регион в /pricing).

## 1. Live-ключи в Vercel (Production env)
В Stripe (LIVE mode) → **Developers → API keys**:
- `STRIPE_SECRET_KEY` = `sk_live_…` (Secret key). Заменить текущий `sk_test_…` в Vercel → Settings →
  Environment Variables → Production.
- Publishable key нам НЕ нужен (checkout — hosted, редиректим на страницу Stripe; ключ на клиенте не используется).

## 2. Вебхук в LIVE (обязательно — иначе тариф не активируется)
Stripe (LIVE mode) → **Developers → Webhooks → Add endpoint**:
- **Endpoint URL:** `https://amaproduct.com/api/billing/stripe/webhook`
- **События** (Select events) — ровно эти 6, что обрабатывает наш код:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`   ← запись оплаты в /admin/payments (добавлено в этой сессии)
  - `invoice.payment_failed`      ← статус past_due при провале списания
- Создать → открыть эндпоинт → **Signing secret** (`whsec_…`) → скопировать в Vercel как
  `STRIPE_WEBHOOK_SECRET` (Production). ⚠️ Секрет LIVE-эндпоинта ОТЛИЧАЕТСЯ от тестового — если оставить
  старый `whsec_` от test-режима, подпись не сойдётся и оплаты не будут активироваться (теперь это видно
  в `/admin/errors` как «stripe webhook: подпись не сошлась»).

## 3. Redeploy
Env применяется только новым деплоем. Vercel → Deployments → **Redeploy** (последний прод-деплой,
Production). Или пуш пустого коммита. Без этого live-ключи не подхватятся.

## 4. Apple Pay / Google Pay — для нашего hosted Checkout НЕ требуется отдельная настройка
- Мы используем **hosted Checkout** (юзера редиректит на `checkout.stripe.com`). Для него Apple Pay
  работает автоматически — доменную регистрацию `amaproduct.com` делать **не обязательно** (она нужна
  только если бы кошельки встраивались на наш сайт через Elements). Достаточно, чтобы в
  **Settings → Payment methods** (LIVE) были включены Cards + Apple Pay + Google Pay (обычно включены по
  умолчанию). Проверить: открыть checkout с iPhone/Safari — кнопка Apple Pay появится сама.
- Если позже захочешь кошельки прямо на своей странице (без редиректа) — тогда зарегистрировать домен в
  Settings → Payment methods → Apple Pay → Add domain. Сейчас не нужно.

## 5. Цены создаются автоматически — проверить суммы
Код при первой оплате в live сам создаёт Product+Price по стабильным lookup-ключам (`ama_solo_monthly`
и т.д.), в **USD**: Соло **$49**, Про **$149**, Продюсер **$299** (из `lib/generations-config.ts`).
Отдельно в дашборде ничего заводить не надо. Если хочешь другие суммы для «мира» — менять `price` в
конфиге ДО первой live-оплаты (после — Stripe закеширует Price под lookup-ключом).
Триал: Stripe даёт **60 дней только на Соло** (Про/Продюсер — списание сразу), как в Продамусе.

## 6. Боевой тест настоящей картой (и возврат)
1. Зайти на `/pricing`, тумблер **«🌍 Зарубежная»**, подключить **Про** ($149) реальной картой.
2. Убедиться: редирект на `?status=success`, тост «Оплата прошла».
3. Проверить активацию (можно попросить меня — read-only запрос к БД по email): `subscription_tier=pro`,
   `subscription_status=active`, `payment_provider=stripe`, `provider_subscription_id=sub_live_…`,
   `current_period_end` = +1 мес.
4. `/admin/payments` — появилась строка оплаты ($149, stripe). `/admin/errors` — пусто (нет провалов вебхука).
5. **Возврат:** Stripe Dashboard → Payments → найти платёж → **Refund**. Подписку → **Cancel** (или через
   кнопку «Управлять подпиской» в Настройках юзера — она открывает Stripe Billing Portal; добавлена в этой сессии).

## 7. Прибраться с тестовыми артефактами (по желанию — не блокер)
В проде 3 профиля с тестовыми Stripe-id (остались от test-режима):
- `dzhikirbalana@gmail.com` — solo/active, тестовый `cus_/sub_`;
- `lana.dzhikirba1@gmail.com` — trial, тестовый `cus_` без подписки;
- `yuliya_joker1@mail.ru` — producer/active до 2027-12-31 (похоже на ручную выдачу, не оплата).
Тестовые `cus_/sub_` в live НЕ существуют. Код это переживёт: при следующем чекауте несуществующий
customer определяется и создаётся заново (фикс этой сессии), портал вернёт «нет подписки» вместо 500.
Т.е. чистить не обязательно. Если хочешь чистое состояние перед запуском — скажи «ок», обнулю этим
трём `payment_provider/provider_customer_id/provider_subscription_id` (кроме ручной выдачи Продюсера, если
она намеренная). **Без твоего явного «ок» прод не трогаю.**

## Итог: что переключить
| Где | Что | Значение |
|---|---|---|
| Stripe | активировать аккаунт (live) | бизнес-данные + выплаты |
| Vercel env | `STRIPE_SECRET_KEY` | `sk_live_…` |
| Vercel env | `STRIPE_WEBHOOK_SECRET` | `whsec_…` от LIVE-эндпоинта |
| Stripe | webhook endpoint (LIVE) | `/api/billing/stripe/webhook` + 6 событий |
| Vercel | Redeploy | Production |
| Stripe | Payment methods (LIVE) | Cards + Apple/Google Pay включены |
| — | тест картой на Про + refund | реальное списание → вернуть |
