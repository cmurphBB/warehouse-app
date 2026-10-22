-- SECURITY: profiles_update_self lets any signed-in user UPDATE any column of
-- their own row, including role → anyone can make themselves ADMIN.
-- Only admins (or the server, which has no auth.uid()) may change role /
-- active / identity columns. Names stay self-editable.
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role / server-side maintenance
  end if;
  if (select role from public.profiles where id = auth.uid()) = 'ADMIN'::user_role then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.created_at is distinct from old.created_at then
    raise exception 'Only an admin can change role, active status or account identity';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();

revoke execute on function public.profiles_guard_privileged_columns() from anon, authenticated, public;
