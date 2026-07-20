-- =====================================================================
-- Ajuste de precios por marca
-- (Ya aplicado en Supabase el 2026-07-12 como migración
--  "adjust_brand_prices_function". Este archivo queda como referencia.)
--
-- Ajusta por porcentaje TODOS los precios (compra, menudeo, mayoreo,
-- distribuidor y unit_price) de los productos ACTIVOS de una marca.
-- p_percent: 5 = subir 5%, -5 = bajar 5%. Devuelve cuántos productos cambió.
-- Se usa desde la sección "Ganancias por Marca" del panel (solo admins).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.adjust_brand_prices(p_brand_id uuid, p_percent numeric)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_count integer;
  v_factor numeric;
begin
  if p_brand_id is null then
    raise exception 'Marca no valida';
  end if;
  if p_percent is null or p_percent = 0 then
    raise exception 'Indica un porcentaje distinto de cero';
  end if;
  if p_percent <= -100 or p_percent > 500 then
    raise exception 'El porcentaje debe estar entre -99 y 500';
  end if;

  v_factor := 1 + (p_percent / 100.0);

  update public.products
  set
    cost_price        = case when cost_price        is not null then round(cost_price        * v_factor, 2) end,
    retail_price      = case when retail_price      is not null then round(retail_price      * v_factor, 2) end,
    wholesale_price   = case when wholesale_price   is not null then round(wholesale_price   * v_factor, 2) end,
    distributor_price = case when distributor_price is not null then round(distributor_price * v_factor, 2) end,
    unit_price        = case when unit_price        is not null then round(unit_price        * v_factor, 2) end,
    updated_at        = now()
  where brand_id = p_brand_id
    and is_active = true;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.adjust_brand_prices(uuid, numeric) TO anon, authenticated;
