# Publicar una actualizacion

Las tiendas solo pueden descargar actualizaciones. La clave privada de Supabase
debe usarse exclusivamente en la computadora del administrador y nunca debe
copiarse al codigo, al instalador ni a una computadora de tienda.

## Primera instalacion

Instalar manualmente `dist/Punto de Venta 0.1.9.exe` en cada tienda. Esta es la
ultima version que necesita distribuirse por USB.

## Versiones siguientes

1. Aumentar `version` en `package.json` y `package-lock.json` (por ejemplo,
   `0.1.10`).
2. Ejecutar `npm run check`.
3. Ejecutar `npm run dist`.
4. Definir temporalmente `SUPABASE_SECRET_KEY` en la terminal de publicacion.
5. Ejecutar `npm run publish:update`.
6. Cerrar la terminal para retirar la clave del entorno de esa sesion.

El publicador sube el instalador y su blockmap antes de reemplazar `latest.yml`.
Las tiendas revisan al iniciar y cada cuatro horas. Cuando la descarga termina,
la aplicacion ofrece reiniciar e instalar.
