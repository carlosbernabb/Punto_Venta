-- RLS objetivo para la siguiente etapa: migrar empleados a Supabase Auth.
-- No ejecutes este archivo completo hasta que employees.auth_user_id tenga el UUID
-- real de auth.users para cada empleado; con el login local actual auth.uid() es null.

create or replace function public.current_employee()
returns public.employees
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.employees e
  where e.auth_user_id = auth.uid()
    and e.is_active = true
  limit 1
$$;

create or replace function public.current_employee_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.current_employee()
$$;

create or replace function public.current_employee_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.current_employee()
$$;

create or replace function public.current_employee_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id from public.current_employee()
$$;

-- Ejemplos de politicas. Activalas tabla por tabla despues de probar el login con Auth.
-- alter table public.stores enable row level security;
-- create policy stores_read_same_org on public.stores
--   for select using (organization_id = public.current_employee_org_id());
--
-- alter table public.inventory enable row level security;
-- create policy inventory_read_same_store_or_admin on public.inventory
--   for select using (
--     public.current_employee_role() = 'admin'
--     or store_id = public.current_employee_store_id()
--   );
--
-- create policy inventory_admin_write on public.inventory
--   for all using (public.current_employee_role() = 'admin')
--   with check (public.current_employee_role() = 'admin');
--
-- alter table public.sales enable row level security;
-- create policy sales_read_same_store_or_admin on public.sales
--   for select using (
--     public.current_employee_role() = 'admin'
--     or store_id = public.current_employee_store_id()
--   );
