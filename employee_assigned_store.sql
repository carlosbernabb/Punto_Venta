-- =====================================================================
-- Asignación de tienda a empleados
-- (Ya aplicado en Supabase el 2026-07-12 como migración
--  "add_employee_assigned_store". Este archivo queda como referencia.)
--
-- 1. Agrega employees.assigned_store_id:
--    - NULL  => sin asignación: el usuario elige tienda al iniciar sesión
--    - uuid  => el empleado entra automáticamente a esa tienda
-- 2. Actualiza login_employee para devolver la tienda asignada.
-- =====================================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS assigned_store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL;

-- La tabla employees usa GRANT SELECT por columna (para no exponer password),
-- así que la columna nueva necesita su propio grant de lectura.
GRANT SELECT (assigned_store_id) ON public.employees TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.login_employee(p_username text, p_password text)
 RETURNS TABLE(id uuid, username text, full_name text, role text, organization_id uuid, store_id uuid, avatar_url text, module_permissions jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    e.assigned_store_id as store_id,
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
$function$;
