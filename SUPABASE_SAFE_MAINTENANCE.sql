-- Mantenimiento seguro propuesto para Supabase.
-- NO ejecutar completo a ciegas. Revisar cada bloque antes de correrlo.
-- Este archivo evita borrar datos existentes y usa operaciones idempotentes.

-- 1) Verificar si existe la organizacion principal.
select *
from public.organizations
where id = '5c433440-9a2b-47d9-9aab-dcdb0303c4ff'::uuid;

-- 2) Si el SELECT anterior no devuelve filas, crear la organizacion principal.
--    Ajusta el nombre si quieres otro texto.
insert into public.organizations (id, name, created_at)
values (
  '5c433440-9a2b-47d9-9aab-dcdb0303c4ff'::uuid,
  'La Casa del Ajo',
  now()
)
on conflict (id) do nothing;

-- 3) Reporte de ventas sin empleado. Solo lectura.
select
  count(*) as ventas_sin_empleado,
  min(sale_date) as primera_venta,
  max(sale_date) as ultima_venta
from public.sales
where employee_id is null;

-- 4) Reporte de cortes sin empleado. Solo lectura.
select
  count(*) as cortes_sin_empleado,
  min(opened_at) as primer_corte,
  max(closed_at) as ultimo_corte
from public.cash_registers
where employee_id is null;

-- 5) Reporte de inventario por tienda. Solo lectura.
select
  s.name as tienda,
  s.type,
  count(i.id) as filas_inventario,
  coalesce(sum(i.quantity), 0) as unidades_totales,
  count(*) filter (where i.quantity = 0) as productos_en_cero,
  count(*) filter (where i.quantity <= i.min_stock) as productos_bajo_minimo,
  count(*) filter (where i.quantity < 0) as productos_negativos
from public.stores s
left join public.inventory i on i.store_id = s.id
group by s.id, s.name, s.type
order by s.name;

-- 6) Reporte de codigos duplicados. Solo lectura.
select
  lower(trim(barcode)) as barcode_normalizado,
  count(*) as cantidad,
  array_agg(name order by name) as productos
from public.products
where nullif(trim(barcode), '') is not null
group by lower(trim(barcode))
having count(*) > 1
order by cantidad desc, barcode_normalizado;

-- 7) Reporte de nombres duplicados. Solo lectura.
select
  lower(trim(name)) as nombre_normalizado,
  count(*) as cantidad,
  array_agg(barcode order by barcode) as codigos
from public.products
where nullif(trim(name), '') is not null
group by lower(trim(name))
having count(*) > 1
order by cantidad desc, nombre_normalizado;

-- 8) Productos sin categoria. Solo lectura.
select id, name, barcode
from public.products
where category_id is null
order by name;

-- 9) Funcion de venta recomendada.
--    Ejecutar solo si confirmas que la funcion actual en Supabase no guarda employee_id.
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

grant execute on function public.process_sale_transaction(
  uuid, uuid, uuid, numeric, text, text, numeric, numeric, numeric, text, jsonb
) to anon, authenticated;

