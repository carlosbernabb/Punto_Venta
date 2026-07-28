-- Consistencia de inventario QR y cortes de caja.
-- Diseñado para ejecutarse una sola vez en Supabase/PostgreSQL.

begin;

alter table public.inventory_logs
  add column if not exists request_id uuid;

create unique index if not exists inventory_logs_request_id_key
  on public.inventory_logs (request_id)
  where request_id is not null;

alter table public.cash_registers
  add column if not exists withdrawal_amount numeric(12, 2),
  add column if not exists cut_type text,
  add column if not exists request_id uuid,
  add column if not exists notes text;

create unique index if not exists cash_registers_request_id_key
  on public.cash_registers (request_id)
  where request_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.cash_registers'::regclass
      and conname = 'cash_registers_amounts_nonnegative'
  ) then
    alter table public.cash_registers
      add constraint cash_registers_amounts_nonnegative
      check (
        opening_amount >= 0
        and (closing_amount is null or closing_amount >= 0)
        and (expected_amount is null or expected_amount >= 0)
        and (withdrawal_amount is null or withdrawal_amount >= 0)
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.cash_registers'::regclass
      and conname = 'cash_registers_cut_type_valid'
  ) then
    alter table public.cash_registers
      add constraint cash_registers_cut_type_valid
      check (cut_type is null or cut_type in ('cash', 'bank', 'transfer', 'correction'))
      not valid;
  end if;
end
$$;

alter table public.cash_registers
  validate constraint cash_registers_cut_type_valid;

create or replace function public.apply_inventory_count_v2(
  p_store_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_min_stock integer,
  p_employee_id uuid,
  p_expected_updated_at timestamptz,
  p_request_id uuid,
  p_source text default 'qr'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_inventory public.inventory%rowtype;
  v_existing_request public.inventory_logs%rowtype;
  v_old_quantity numeric(12, 3);
  v_new_quantity numeric(12, 3);
  v_delta numeric(12, 3);
  v_description text;
begin
  if p_store_id is null or p_product_id is null or p_request_id is null then
    raise exception 'Faltan identificadores obligatorios';
  end if;

  if p_quantity is null
     or p_quantity < 0
     or p_quantity > 999999999.999
     or round(p_quantity, 3) <> p_quantity then
    raise exception 'La cantidad debe ser positiva y tener maximo tres decimales';
  end if;

  if p_min_stock is null or p_min_stock < 0 then
    raise exception 'El stock minimo no es valido';
  end if;

  if p_source not in ('qr', 'desktop', 'distribution') then
    raise exception 'Origen de ajuste no valido';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );

  select *
    into v_existing_request
  from public.inventory_logs
  where request_id = p_request_id;

  if found then
    if v_existing_request.store_id <> p_store_id
       or v_existing_request.product_id <> p_product_id then
      raise exception 'El identificador de solicitud ya pertenece a otro ajuste';
    end if;

    select *
      into v_inventory
    from public.inventory
    where store_id = p_store_id
      and product_id = p_product_id;

    return pg_catalog.jsonb_build_object(
      'status', 'ok',
      'idempotent', true,
      'quantity', v_inventory.quantity,
      'minStock', v_inventory.min_stock,
      'updatedAt', v_inventory.updated_at,
      'oldQty', v_inventory.quantity - v_existing_request.quantity,
      'deltaQty', v_existing_request.quantity
    );
  end if;

  select *
    into v_inventory
  from public.inventory
  where store_id = p_store_id
    and product_id = p_product_id
  for update;

  if found then
    if p_expected_updated_at is null
       or v_inventory.updated_at <> p_expected_updated_at then
      return pg_catalog.jsonb_build_object(
        'status', 'conflict',
        'quantity', v_inventory.quantity,
        'minStock', v_inventory.min_stock,
        'updatedAt', v_inventory.updated_at
      );
    end if;

    v_old_quantity := v_inventory.quantity;

    update public.inventory
    set quantity = p_quantity,
        min_stock = p_min_stock
    where id = v_inventory.id
    returning * into v_inventory;
  else
    if p_expected_updated_at is not null then
      return pg_catalog.jsonb_build_object(
        'status', 'conflict',
        'quantity', 0,
        'minStock', 10,
        'updatedAt', null
      );
    end if;

    v_old_quantity := 0;

    insert into public.inventory (
      store_id,
      product_id,
      quantity,
      min_stock
    )
    values (
      p_store_id,
      p_product_id,
      p_quantity,
      p_min_stock
    )
    returning * into v_inventory;
  end if;

  v_new_quantity := v_inventory.quantity;
  v_delta := v_new_quantity - v_old_quantity;
  v_description := case p_source
    when 'qr' then 'Conteo desde telefono o iPad por QR'
    when 'distribution' then 'Ajuste desde distribucion de inventario'
    else 'Ajuste manual desde computadora'
  end;

  insert into public.inventory_logs (
    store_id,
    product_id,
    employee_id,
    type,
    quantity,
    description,
    request_id
  )
  values (
    p_store_id,
    p_product_id,
    p_employee_id,
    'ajuste',
    v_delta,
    v_description,
    p_request_id
  );

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'idempotent', false,
    'quantity', v_inventory.quantity,
    'minStock', v_inventory.min_stock,
    'updatedAt', v_inventory.updated_at,
    'oldQty', v_old_quantity,
    'deltaQty', v_delta
  );
end;
$function$;

create or replace function public.register_cash_cut_v2(
  p_store_id uuid,
  p_employee_id uuid,
  p_expected_amount numeric,
  p_withdrawal_amount numeric,
  p_leave_amount numeric,
  p_expected_since timestamptz,
  p_request_id uuid,
  p_cut_type text default 'cash',
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing public.cash_registers%rowtype;
  v_last_cash public.cash_registers%rowtype;
  v_current_expected numeric(12, 2);
  v_actual numeric(12, 2);
  v_difference numeric(12, 2);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_inserted public.cash_registers%rowtype;
begin
  if p_store_id is null or p_request_id is null then
    raise exception 'Faltan identificadores obligatorios';
  end if;

  if p_cut_type not in ('cash', 'bank', 'transfer', 'correction') then
    raise exception 'Tipo de corte no valido';
  end if;

  if p_expected_amount is null
     or p_withdrawal_amount is null
     or p_leave_amount is null
     or p_expected_amount < 0
     or p_withdrawal_amount < 0
     or p_leave_amount < 0 then
    raise exception 'Los montos del corte no son validos';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );

  select *
    into v_existing
  from public.cash_registers
  where request_id = p_request_id;

  if found then
    if v_existing.store_id <> p_store_id then
      raise exception 'El identificador de solicitud ya pertenece a otro corte';
    end if;

    return pg_catalog.jsonb_build_object(
      'status', 'ok',
      'idempotent', true,
      'id', v_existing.id,
      'closedAt', v_existing.closed_at,
      'withdrawalAmount', v_existing.withdrawal_amount,
      'leaveAmount', v_existing.opening_amount,
      'expectedAmount', v_existing.expected_amount,
      'actualAmount', v_existing.closing_amount,
      'difference', v_existing.difference
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_store_id::text, 0)
  );

  if p_cut_type = 'cash' then
    select cr.*
      into v_last_cash
    from public.cash_registers cr
    where cr.store_id = p_store_id
      and cr.is_closed = true
      and (
        cr.cut_type in ('cash', 'correction')
        or (
          cr.cut_type is null
          and not (
            cr.opened_at is not null
            and cr.closed_at is not null
            and cr.closed_at - cr.opened_at < interval '1 second'
            and coalesce(cr.opening_amount, 0) = 0
            and cr.employee_id is null
          )
        )
      )
    order by cr.closed_at desc
    limit 1
    for update;

    if (v_last_cash.id is null and p_expected_since is not null)
       or (v_last_cash.id is not null and p_expected_since is null)
       or (
         v_last_cash.id is not null
         and abs(extract(epoch from (v_last_cash.closed_at - p_expected_since))) > 0.001
       ) then
      return pg_catalog.jsonb_build_object(
        'status', 'conflict',
        'reason', 'cash_cut_changed',
        'latestClosedAt', v_last_cash.closed_at
      );
    end if;

    select round(
      coalesce(v_last_cash.opening_amount, 0)
      + coalesce(sum(
          case
            when s.payment_method = 'efectivo' then s.total
            when s.payment_method = 'mixto' then coalesce(s.cash_amount, 0)
            else 0
          end
        ), 0),
      2
    )
      into v_current_expected
    from public.sales s
    where s.store_id = p_store_id
      and s.payment_method in ('efectivo', 'mixto')
      and (v_last_cash.id is null or s.sale_date > v_last_cash.closed_at);

    if abs(v_current_expected - round(p_expected_amount, 2)) > 0.009 then
      return pg_catalog.jsonb_build_object(
        'status', 'conflict',
        'reason', 'expected_amount_changed',
        'expectedAmount', v_current_expected,
        'latestClosedAt', v_last_cash.closed_at
      );
    end if;
  else
    v_current_expected := round(p_expected_amount, 2);
  end if;

  v_actual := round(p_withdrawal_amount + p_leave_amount, 2);
  v_difference := round(v_actual - v_current_expected, 2);

  insert into public.cash_registers (
    store_id,
    employee_id,
    opening_amount,
    closing_amount,
    expected_amount,
    difference,
    is_closed,
    opened_at,
    closed_at,
    withdrawal_amount,
    cut_type,
    request_id,
    notes
  )
  values (
    p_store_id,
    p_employee_id,
    round(p_leave_amount, 2),
    v_actual,
    v_current_expected,
    v_difference,
    true,
    coalesce(p_expected_since, v_now),
    v_now,
    round(p_withdrawal_amount, 2),
    p_cut_type,
    p_request_id,
    nullif(pg_catalog.btrim(p_notes), '')
  )
  returning * into v_inserted;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'idempotent', false,
    'id', v_inserted.id,
    'closedAt', v_inserted.closed_at,
    'withdrawalAmount', v_inserted.withdrawal_amount,
    'leaveAmount', v_inserted.opening_amount,
    'expectedAmount', v_inserted.expected_amount,
    'actualAmount', v_inserted.closing_amount,
    'difference', v_inserted.difference
  );
end;
$function$;

create or replace function public.transfer_inventory_batch_v2(
  p_source_store_id uuid,
  p_dest_store_id uuid,
  p_employee_id uuid,
  p_items jsonb,
  p_request_id uuid,
  p_transfer_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing_request public.inventory_logs%rowtype;
  v_item record;
  v_source public.inventory%rowtype;
  v_transfer_id text;
  v_first_log boolean := true;
  v_source_lock bigint;
  v_dest_lock bigint;
begin
  if p_source_store_id is null or p_dest_store_id is null or p_request_id is null then
    raise exception 'Faltan identificadores obligatorios';
  end if;

  if p_source_store_id = p_dest_store_id then
    raise exception 'Origen y destino no pueden ser iguales';
  end if;

  if p_items is null
    or pg_catalog.jsonb_typeof(p_items) <> 'array'
    or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene productos';
  end if;

  v_transfer_id := pg_catalog.upper(pg_catalog.btrim(coalesce(p_transfer_id, '')));
  if v_transfer_id = '' or pg_catalog.length(v_transfer_id) > 80 then
    raise exception 'Identificador de transferencia invalido';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );

  select *
  into v_existing_request
  from public.inventory_logs
  where request_id = p_request_id;

  if found then
    if v_existing_request.store_id <> p_source_store_id
      or v_existing_request.type <> 'transferencia' then
      raise exception 'El identificador de solicitud ya pertenece a otro movimiento';
    end if;

    return pg_catalog.jsonb_build_object(
      'status', 'ok',
      'idempotent', true,
      'transferId', v_transfer_id
    );
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
    where item.product_id is null
      or item.quantity is null
      or item.quantity <= 0
      or item.quantity <> pg_catalog.trunc(item.quantity)
  ) then
    raise exception 'La transferencia contiene productos o cantidades invalidas';
  end if;

  if exists (
    select item.product_id
    from pg_catalog.jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
    group by item.product_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'La transferencia contiene productos repetidos';
  end if;

  v_source_lock := pg_catalog.hashtextextended(p_source_store_id::text, 0);
  v_dest_lock := pg_catalog.hashtextextended(p_dest_store_id::text, 0);
  perform pg_catalog.pg_advisory_xact_lock(least(v_source_lock, v_dest_lock));
  perform pg_catalog.pg_advisory_xact_lock(greatest(v_source_lock, v_dest_lock));

  for v_item in
    select item.product_id, item.quantity::integer as quantity
    from pg_catalog.jsonb_to_recordset(p_items) as item(product_id uuid, quantity numeric)
    order by item.product_id
  loop
    select *
    into v_source
    from public.inventory
    where store_id = p_source_store_id
      and product_id = v_item.product_id
    for update;

    if not found or coalesce(v_source.quantity, 0) < v_item.quantity then
      raise exception 'Stock insuficiente en origen para producto %', v_item.product_id;
    end if;

    update public.inventory
    set
      quantity = quantity - v_item.quantity,
      updated_at = pg_catalog.clock_timestamp()
    where id = v_source.id;

    insert into public.inventory (
      store_id,
      product_id,
      quantity,
      min_stock,
      updated_at
    )
    values (
      p_dest_store_id,
      v_item.product_id,
      v_item.quantity,
      coalesce(v_source.min_stock, 10),
      pg_catalog.clock_timestamp()
    )
    on conflict (store_id, product_id)
    do update set
      quantity = public.inventory.quantity + excluded.quantity,
      updated_at = excluded.updated_at;

    insert into public.inventory_logs (
      store_id,
      product_id,
      employee_id,
      type,
      quantity,
      description,
      request_id
    )
    values (
      p_source_store_id,
      v_item.product_id,
      p_employee_id,
      'transferencia',
      -v_item.quantity,
      'Transferencia ' || v_transfer_id || ' | Enviado | Estado: completada',
      case when v_first_log then p_request_id else null end
    );

    v_first_log := false;

    insert into public.inventory_logs (
      store_id,
      product_id,
      employee_id,
      type,
      quantity,
      description
    )
    values (
      p_dest_store_id,
      v_item.product_id,
      p_employee_id,
      'transferencia',
      v_item.quantity,
      'Transferencia ' || v_transfer_id || ' | Recibido | Estado: completada'
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'idempotent', false,
    'transferId', v_transfer_id,
    'itemCount', pg_catalog.jsonb_array_length(p_items)
  );
end;
$function$;

revoke all on function public.apply_inventory_count_v2(
  uuid, uuid, numeric, integer, uuid, timestamptz, uuid, text
) from public;
grant execute on function public.apply_inventory_count_v2(
  uuid, uuid, numeric, integer, uuid, timestamptz, uuid, text
) to anon, authenticated;

revoke all on function public.register_cash_cut_v2(
  uuid, uuid, numeric, numeric, numeric, timestamptz, uuid, text, text
) from public;
grant execute on function public.register_cash_cut_v2(
  uuid, uuid, numeric, numeric, numeric, timestamptz, uuid, text, text
) to anon, authenticated;

revoke all on function public.transfer_inventory_batch_v2(
  uuid, uuid, uuid, jsonb, uuid, text
) from public;
grant execute on function public.transfer_inventory_batch_v2(
  uuid, uuid, uuid, jsonb, uuid, text
) to anon, authenticated;

commit;
