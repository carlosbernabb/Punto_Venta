-- Permisos por modulo para empleados.
-- Ejecutar una vez en Supabase antes de usar los permisos en varias computadoras.

alter table public.employees
  add column if not exists module_permissions jsonb not null default '{}'::jsonb;

drop function if exists public.login_employee(text, text);

create or replace function public.login_employee(
  p_username text,
  p_password text
)
returns table (
  id uuid,
  username text,
  full_name text,
  role text,
  organization_id uuid,
  store_id uuid,
  avatar_url text,
  module_permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_username), '') is null or nullif(p_password, '') is null then
    raise exception 'Usuario y contrasena son obligatorios';
  end if;

  return query
  select
    e.id,
    e.username::text,
    e.full_name::text,
    e.role::text,
    e.organization_id,
    null::uuid as store_id,
    e.avatar_url::text,
    e.module_permissions
  from public.employees e
  where lower(e.username) = lower(trim(p_username))
    and e.is_active = true
    and e.password = p_password
  limit 1;

  if not found then
    raise exception 'Usuario o contrasena incorrectos';
  end if;
end;
$$;

grant execute on function public.login_employee(text, text) to anon, authenticated;

grant select (module_permissions) on public.employees to anon, authenticated;
grant update (module_permissions, updated_at) on public.employees to anon, authenticated;
