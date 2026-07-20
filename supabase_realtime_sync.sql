-- Activa eventos en vivo para sincronizar caché entre computadoras abiertas.
-- Ejecutar una sola vez en Supabase SQL Editor.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory'
  ) then
    alter publication supabase_realtime add table public.inventory;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stores'
  ) then
    alter publication supabase_realtime add table public.stores;
  end if;
end $$;
