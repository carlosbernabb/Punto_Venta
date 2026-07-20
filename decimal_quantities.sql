-- =====================================================================
-- Soporte de cantidades decimales (venta por kilo / gramos)
-- (Ya aplicado en Supabase el 2026-07-13 como migraciones
--  "decimal_quantities_support" y "decrement_inventory_numeric".
--  Este archivo queda como referencia.)
--
-- Las columnas de cantidad pasan de integer a numeric(12,3) => hasta
-- 0.001 (1 gramo dentro de 1 kg). Los RPC que manejaban la cantidad como
-- integer se actualizan a numeric para no truncar 0.5 -> 0.
-- =====================================================================

ALTER TABLE public.inventory      ALTER COLUMN quantity TYPE numeric(12,3);
ALTER TABLE public.sale_items     ALTER COLUMN quantity TYPE numeric(12,3);
ALTER TABLE public.inventory_logs ALTER COLUMN quantity TYPE numeric(12,3);

-- process_sale_transaction: v_qty integer -> numeric (ver definición completa
-- en la migración; solo cambian las declaraciones/casts de la cantidad).

-- decrement_inventory: p_qty integer -> numeric (requiere DROP porque cambia
-- el tipo de un parámetro).
DROP FUNCTION IF EXISTS public.decrement_inventory(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.decrement_inventory(p_product_id uuid, p_store_id uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Cantidad invalida';
  end if;

  update public.inventory
  set quantity = quantity - p_qty, updated_at = now()
  where product_id = p_product_id
    and store_id = p_store_id
    and quantity >= p_qty;

  if not found then
    raise exception 'Stock insuficiente o inventario no encontrado';
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.decrement_inventory(uuid, uuid, numeric) TO anon, authenticated;
