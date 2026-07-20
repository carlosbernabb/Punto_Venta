# Estado de Supabase - Punto de Venta

Fecha de revision: 2026-05-18

Este reporte se genero con consultas de solo lectura usando la llave anon publica configurada en `src/config/supabase.js`. No se modificaron datos.

## Resumen operativo

- Tiendas: 5 activas.
- Empleados: 8 activos.
- Administradores: 2 (`admin`, `magui`).
- Productos: 3,586.
- Inventario: 6,813 filas, 10,188 unidades totales.
- Ventas: 1,080.
- Total historico de ventas: 260,396.
- Clientes: 11.
- Cortes de caja: 40.
- Proveedores: 1.
- Compras: 1.
- Recetas: 3, con 4 categorias y 28 productos asociados.

## Tiendas

- Bodega Central: bodega activa.
- Casa del Ajo Plaza: tienda activa.
- Casa del Ajo Vista Hermosa: tienda activa.
- La Canasta: tienda activa.
- La Casa del Ajo Hidalgo: tienda activa.

## Inventario

El inventario no tiene cantidades negativas, lo cual es buena senal. El problema es que hay demasiados productos en cero o bajo minimo:

- Bodega Central: 1,001 filas, 1 unidad total, 1,000 productos en cero.
- Casa del Ajo Plaza: 2,033 filas, 5,432 unidades, 863 productos en cero.
- Casa del Ajo Vista Hermosa: 1,771 filas, 4,740 unidades, 893 productos en cero.
- La Canasta: 1,002 filas, 0 unidades, 1,002 productos en cero.
- La Casa del Ajo Hidalgo: 1,006 filas, 15 unidades, 1,003 productos en cero.

Esto parece mas un tema de carga/inicializacion de inventario por sucursal que corrupcion.

## Ventas

Al 2026-05-18:

- Ventas del dia: 34.
- Total del dia: 6,476.
- Ventas del mes: 539.
- Total del mes: 122,787.75.

Por metodo de pago historico:

- Efectivo: 1,028 ventas, 230,788.
- Tarjeta: 50 ventas, 29,283.
- Mixto: 2 ventas, 325.

Por tipo:

- Menudeo: 1,073 ventas, 255,141.
- Mayoreo: 5 ventas, 5,085.
- Distribuidor: 2 ventas, 170.

## Hallazgos importantes

1. La tabla `organizations` aparece con 0 filas visibles.
   - Las demas tablas usan `organization_id = 5c433440-9a2b-47d9-9aab-dcdb0303c4ff`.
   - Puede faltar la fila de organizacion o puede estar oculta por politicas.

2. Casi todas las ventas no tienen empleado:
   - `sales.employee_id` nulo en 1,075 de 1,080 ventas.
   - La version actual del codigo fuente si intenta mandar `employee_id`, asi que esto probablemente viene de ventas hechas con un ejecutable viejo o con sesiones anteriores.

3. Muchos cortes no tienen empleado:
   - `cash_registers.employee_id` nulo en 34 de 40 cortes.

4. Catalogo con limpieza pendiente:
   - 638 productos sin categoria.
   - 3 codigos de barras duplicados.
   - 20 nombres de productos duplicados.
   - 3,458 productos con precio distribuidor en 0 o vacio.

5. Las tablas reales de compras y recetas si existen:
   - `suppliers`, `purchases`, `purchase_items`.
   - `recipe_categories`, `recipes`, `recipe_products`.
   - Las tablas visualmente llamadas "compras" y "recetas" no se llaman asi en la base.

6. Funciones RPC verificadas:
   - `login_employee` existe.
   - `increment_inventory` existe.
   - `process_sale_transaction` esta referenciada por el codigo; no se probo con una venta real para no modificar datos.

## Prioridad recomendada

1. Regenerar y usar el ejecutable nuevo, porque el `dist` actual esta viejo y no usa el login RPC moderno.
2. Validar por que las ventas nuevas salen sin empleado en produccion; si siguen saliendo nulas despues del ejecutable nuevo, revisar la funcion `process_sale_transaction` en Supabase.
3. Crear o corregir la fila de `organizations` si realmente no existe.
4. Hacer limpieza de catalogo con reporte previo: duplicados, categorias vacias y precios faltantes.
5. Revisar inventario por tienda antes de hacer ajustes masivos.

