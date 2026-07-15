-- ===== MIGRATION 032: pre-launch security lockdown =====
-- Closes holes found in the pre-launch audit that are exploitable with the PUBLIC
-- anon key + any logged-in JWT (registration is open), straight through PostgREST,
-- bypassing the API routes. All were verified live against prod (read-only).
--
-- ⚠️ APPLY ORDER: deploy the paired code commit FIRST, then run this migration.
-- The code moved every server call of consume_generation / add_bonus_generations /
-- referred_by to the service-role (admin) client. If this migration runs BEFORE
-- that code is live, generation/refund/referral would break with a permission
-- error. After the code is live, this migration is safe.
--
-- Idempotent: re-running is safe.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. profiles — stop users escalating their own role / tier / bonuses
-- ────────────────────────────────────────────────────────────────────────────
-- The policy "Users can manage own profile" is FOR ALL USING (auth.uid()=id) with
-- no per-column WITH CHECK, and Supabase grants `authenticated` UPDATE on every
-- column by default. So today any logged-in user can:
--   PATCH /rest/v1/profiles?id=eq.<self> {"role":"admin","subscription_tier":
--   "producer","bonus_generations":999999,"subscription_status":"active"}
-- → self-serve admin + top tier + unlimited generations, one HTTP request.
--
-- Fix: revoke blanket UPDATE and grant it back ONLY on the two columns a user
-- legitimately edits from their own client (verified by grep):
--   * onboarding_done   — components/shared/OnboardingSlides.tsx
--   * ai_assistant_name — components/settings/SettingsClient.tsx, ProjectWizard.tsx
-- Everything else (role, subscription_*, bonus_generations, generations_used,
-- trial_ends_at, provider_*, referred_by, email) is written only by the
-- service-role client (billing webhooks, admin routes, referral route) and by
-- SECURITY DEFINER triggers — none of which depend on the `authenticated` grant.
revoke update on profiles from anon, authenticated;
grant  update (ai_assistant_name, onboarding_done) on profiles to authenticated;
-- SELECT (own row) and the SECURITY DEFINER insert trigger are unaffected.

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Billing/referral RPCs — revoke public EXECUTE (money functions)
-- ────────────────────────────────────────────────────────────────────────────
-- These are SECURITY DEFINER and were never REVOKE'd, so PostgREST exposes them
-- to anon/authenticated (verified live: anon POST /rpc/add_bonus_generations → 204).
--   add_bonus_generations(self, 999999) → unlimited free generations (bypass billing)
--   consume_generation(other_user)      → burn a victim's monthly quota
--   generate_referral_code(other_user)  → overwrite someone's referral code
-- The paired code commit routes every legitimate call through the service-role
-- client, so these can be locked to service_role only.
revoke execute on function add_bonus_generations(uuid, integer) from public, anon, authenticated;
revoke execute on function consume_generation(uuid)             from public, anon, authenticated;
revoke execute on function generate_referral_code(uuid)         from public, anon, authenticated;
grant  execute on function add_bonus_generations(uuid, integer) to service_role;
grant  execute on function consume_generation(uuid)             to service_role;
grant  execute on function generate_referral_code(uuid)         to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. referral_stats view — stop anon enumerating every user
-- ────────────────────────────────────────────────────────────────────────────
-- The view runs with the definer's rights (bypasses RLS), so anon reads ALL rows
-- (verified live: 18 rows of user_id / referral_code / tier / limits). security_invoker
-- makes it respect the querying user's RLS on the underlying profiles/referrals —
-- the GET /api/referral route reads it filtered to the caller's own user_id, so it
-- still works; anon/other users see nothing.
alter view referral_stats set (security_invoker = on);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket `materials` (private) — stop cross-user file deletion
-- ────────────────────────────────────────────────────────────────────────────
-- 020 created insert/delete policies scoped only to bucket_id='materials' with no
-- owner check. A project VIEWER can read a material's storage path (file_url) and
-- DELETE it straight through the Storage API — destroying files they only have
-- read access to. Legitimate deletes go through the admin client (service role,
-- bypasses RLS) in /api/materials, so no client-side delete policy is needed.
drop policy if exists "materials_delete" on storage.objects;
-- Keep client insert (upload uses the session client) but scope it to the uploader
-- so a user can't write objects owned by someone else.
drop policy if exists "materials_insert" on storage.objects;
create policy "materials_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials' and owner = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Trial lifecycle — give NEW users a real 60-day trial_ends_at
-- ────────────────────────────────────────────────────────────────────────────
-- handle_new_user (001) inserts only (id,email,full_name,role); trial_ends_at has
-- no column default and the 60-day value was a ONE-OFF backfill in 016. So every
-- user created after 016 has trial_ends_at = NULL, and isEntitled() treats NULL as
-- "entitled forever" — the trial never ends and BILLING_ENFORCED never bites them.
-- (Verified live: all current trial users have NULL.) Set it at signup.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role, subscription_status, trial_ends_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when new.email = current_setting('app.admin_email', true) then 'admin' else 'client' end,
    'trialing',
    now() + interval '60 days'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Backfill the users who were created after 016 with a NULL trial: give them a
-- fresh 60-day window from now (no lockouts). Only touches trialing/NULL rows —
-- paying users and admins are left alone.
update profiles
  set trial_ends_at = now() + interval '60 days'
  where trial_ends_at is null
    and subscription_status = 'trialing'
    and subscription_tier = 'trial';
