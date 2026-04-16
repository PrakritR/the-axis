-- Example: grant internal `admin` role to the app_users row for a given email.
-- Run in Supabase SQL Editor after migrations and after that user has synced (app_users row exists).
-- Replace the email literal with your real login email (lowercase to match app_users.email).

insert into public.app_user_roles (app_user_id, role, is_primary)
select u.id, 'admin', true
from public.app_users u
where u.email = lower('your.email@example.com')
on conflict on constraint app_user_roles_user_role_uniq
do update set is_primary = excluded.is_primary;

-- Verify:
-- select * from app_user_roles r join app_users u on u.id = r.app_user_id where u.email = lower('your.email@example.com');
