-- Funciones recomendadas para ejecutar en Supabase SQL Editor.
-- Mantienen las operaciones de inventario dentro de una transaccion en la base.

create extension if not exists pgcrypto;

create or replace function public.decrement_inventory(
  p_product_id uuid,
  p_store_id uuid,
  p_qty integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Cantidad invalida';
  end if;

  update public.inventory
  set
    quantity = quantity - p_qty,
    updated_at = now()
  where product_id = p_product_id
    and store_id = p_store_id
    and quantity >= p_qty;

  if not found then
    raise exception 'Stock insuficiente o inventario no encontrado';
  end if;
end;
$$;

create or replace function public.increment_inventory(
  p_store_id uuid,
  p_product_id uuid,
  p_qty integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Cantidad invalida';
  end if;

  insert into public.inventory (store_id, product_id, quantity, min_stock, updated_at)
  values (p_store_id, p_product_id, p_qty, 10, now())
  on conflict (store_id, product_id)
  do update set
    quantity = public.inventory.quantity + excluded.quantity,
    updated_at = now();
end;
$$;

create or replace function public.transfer_inventory(
  p_product_id uuid,
  p_source_store_id uuid,
  p_dest_store_id uuid,
  p_qty integer,
  p_employee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Cantidad invalida';
  end if;

  if p_source_store_id = p_dest_store_id then
    raise exception 'Origen y destino no pueden ser iguales';
  end if;

  update public.inventory
  set
    quantity = quantity - p_qty,
    updated_at = now()
  where product_id = p_product_id
    and store_id = p_source_store_id
    and quantity >= p_qty;

  if not found then
    raise exception 'Stock insuficiente en origen';
  end if;

  insert into public.inventory (store_id, product_id, quantity, min_stock, updated_at)
  values (p_dest_store_id, p_product_id, p_qty, 10, now())
  on conflict (store_id, product_id)
  do update set
    quantity = public.inventory.quantity + excluded.quantity,
    updated_at = now();

  insert into public.inventory_logs
    (store_id, product_id, employee_id, type, quantity, description)
  values
    (p_source_store_id, p_product_id, p_employee_id, 'transferencia', -p_qty, 'Traspaso enviado'),
    (p_dest_store_id, p_product_id, p_employee_id, 'transferencia', p_qty, 'Traspaso recibido');
end;
$$;

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

create or replace function public.process_sale_transaction(
  p_store_id uuid,
  p_employee_id uuid,
  p_customer_id uuid,
  p_total numeric,
  p_payment_method text,
  p_sale_type text,
  p_cash_amount numeric,
  p_card_amount numeric,
  p_transfer_amount numeric,
  p_mixed_method text,
  p_items jsonb
)
returns table (
  id uuid,
  store_id uuid,
  employee_id uuid,
  customer_id uuid,
  total numeric,
  payment_method text,
  sale_date timestamptz,
  sale_type text,
  cash_amount numeric,
  card_amount numeric,
  transfer_amount numeric,
  mixed_method text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_unit_price numeric;
begin
  if p_store_id is null then
    raise exception 'Tienda obligatoria';
  end if;

  if p_total is null or p_total <= 0 then
    raise exception 'Total invalido';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_qty := coalesce((v_item->>'quantity')::integer, 0);

    if v_product_id is null or v_qty <= 0 then
      raise exception 'Producto o cantidad invalida';
    end if;

    perform 1
    from public.inventory i
    where i.store_id = p_store_id
      and i.product_id = v_product_id
      and i.quantity >= v_qty
    for update;

    if not found then
      raise exception 'Stock insuficiente para producto %', v_product_id;
    end if;
  end loop;

  insert into public.sales (
    store_id,
    employee_id,
    customer_id,
    total,
    payment_method,
    sale_date,
    sale_type,
    cash_amount,
    card_amount,
    transfer_amount,
    mixed_method
  )
  values (
    p_store_id,
    p_employee_id,
    p_customer_id,
    p_total,
    p_payment_method,
    now(),
    p_sale_type,
    p_cash_amount,
    p_card_amount,
    p_transfer_amount,
    p_mixed_method
  )
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;

    insert into public.sale_items (
      sale_id,
      product_id,
      quantity,
      unit_price,
      subtotal
    )
    values (
      v_sale.id,
      v_product_id,
      v_qty,
      v_unit_price,
      v_qty * v_unit_price
    );

    update public.inventory
    set
      quantity = quantity - v_qty,
      updated_at = now()
    where public.inventory.store_id = p_store_id
      and public.inventory.product_id = v_product_id;

    insert into public.inventory_logs (
      store_id,
      product_id,
      employee_id,
      type,
      quantity,
      description
    )
    values (
      p_store_id,
      v_product_id,
      p_employee_id,
      'venta',
      -v_qty,
      'Venta ' || upper(right(replace(v_sale.id::text, '-', ''), 8))
    );
  end loop;

  return query
  select
    v_sale.id,
    v_sale.store_id,
    v_sale.employee_id,
    v_sale.customer_id,
    v_sale.total,
    v_sale.payment_method::text,
    v_sale.sale_date,
    v_sale.sale_type::text,
    v_sale.cash_amount,
    v_sale.card_amount,
    v_sale.transfer_amount,
    v_sale.mixed_method::text;
end;
$$;

grant execute on function public.login_employee(text, text) to anon, authenticated;
grant execute on function public.decrement_inventory(uuid, uuid, integer) to anon, authenticated;
grant execute on function public.increment_inventory(uuid, uuid, integer) to anon, authenticated;
grant execute on function public.transfer_inventory(uuid, uuid, uuid, integer, uuid) to anon, authenticated;
grant execute on function public.process_sale_transaction(uuid, uuid, uuid, numeric, text, text, numeric, numeric, numeric, text, jsonb) to anon, authenticated;

-- Despues de cambiar el frontend a login_employee, ejecuta esto para que la clave anon
-- ya no pueda leer contrasenas aunque pueda leer otros datos publicos de empleados.
-- Si alguna pantalla falla por permisos, cambia sus consultas a columnas explicitas
-- como ya se hace en src/scripts/admin.js.
revoke select on public.employees from anon, authenticated;
grant select (
  id,
  organization_id,
  auth_user_id,
  username,
  full_name,
  role,
  is_active,
  created_at,
  updated_at,
  avatar_url,
  module_permissions
) on public.employees to anon, authenticated;
grant update (module_permissions, updated_at) on public.employees to anon, authenticated;
