-- ---------------------------------------------------------------------------
-- Migration 003: force a password change on first sign-in.
--
-- Run this ONCE in the Supabase SQL Editor, after 002. Re-runnable.
--
-- WHY
--   The six accounts were provisioned by hand with a shared, guessable
--   pattern (Firstname2026). Supabase's own reset flow is unusable here --
--   district mail filtering blocks the email -- so instead of relying on
--   people to change it voluntarily, the app refuses to open until they do.
--   supabase.auth.updateUser({ password }) works for an already-signed-in
--   user with no email round-trip, which is what makes this possible.
--
-- SECURITY NOTE
--   Clearing the flag deliberately goes through a security-definer function
--   rather than an RLS update policy on profiles. A policy like
--   "using (auth.uid() = id)" would let any user PATCH their own profile
--   row -- including their own `role` -- and self-promote to coach. The
--   function below can only ever touch must_change_password, and only for
--   the caller's own row.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The flag. Defaults true so any future hand-provisioned account is
--    forced through the same gate without anyone remembering to set it.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. Require it of the six existing accounts. They are all currently on the
--    shared Firstname2026 pattern, so every one of them must rotate.
-- ---------------------------------------------------------------------------
update public.profiles
set must_change_password = true
where lower(email) in (
  'stacys@susd12.org',
  'scott23henderson@gmail.com',
  'angelicae@susd12.org',
  'vickis@susd12.org',
  'shaneb@susd12.org',
  'kerrir@susd12.org'
);

-- ---------------------------------------------------------------------------
-- 3. New sign-ins also start out needing to set their own password.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, must_change_password)
  values (
    new.id,
    coalesce(new.email, 'unknown'),
    coalesce(new.raw_user_meta_data ->> 'name', new.email, 'New user'),
    'pending',
    true
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The only way to clear the flag. Touches one column, own row only.
--    Note this does NOT itself change the password -- the client calls
--    supabase.auth.updateUser({password}) first (which Supabase validates
--    against the project's password policy) and calls this on success.
-- ---------------------------------------------------------------------------
create or replace function public.mark_password_changed()
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles
  set must_change_password = false
  where id = auth.uid();
$$;

revoke all on function public.mark_password_changed() from public, anon;
grant execute on function public.mark_password_changed() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Verify. Expect all six listed with must_change_password = true.
-- ---------------------------------------------------------------------------
select email, name, role, must_change_password from public.profiles order by role, email;
