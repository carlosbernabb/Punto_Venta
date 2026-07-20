# 🔐 Credenciales y Primeros Pasos

## ✅ Configuración Completada

### **Tiendas Registradas:**

1. **La Casa del Ajo** 🏪
   - Dirección: Hidalgo 25, Zamora, Mich.
   - Tipo: Tienda

2. **La Canasta** 🏪
   - Dirección: Mercado Hidalgo, Calle Ávila Camacho, Zamora, Mich.
   - Tipo: Tienda

3. **Casa del Ajo Plaza** 🏪
   - Dirección: Los Portales, Zamora, Mich.
   - Tipo: Tienda

4. **Casa del Ajo Vista Hermosa** 🏪
   - Dirección: Vista Hermosa, Mich.
   - Tipo: Tienda

5. **Bodega Central** 📦
   - Dirección: Bodega Principal
   - Tipo: Bodega (solo movimientos, sin ventas)

---

## 🎯 Flujo de Login

### Paso 1: Seleccionar Tienda
Al abrir la aplicación, primero verás la lista de todas las tiendas. Haz clic en la tienda donde trabajarás hoy.

### Paso 2: Iniciar Sesión
Después de seleccionar la tienda, ingresa tus credenciales:

**Usuario Administrador:**
```
Usuario: admin
Contraseña: admin123
```

---

## 🚀 Cómo Ejecutar la Aplicación

1. **Abre una terminal** en la carpeta del proyecto:
   ```bash
   cd C:\Users\carbe\OneDrive\Escritorio\Punto_Venta
   ```

2. **Instala las dependencias** (solo la primera vez):
   ```bash
   npm install
   ```

3. **Ejecuta la aplicación**:
   ```bash
   npm start
   ```

---

## 📝 Próximos Pasos

### Agregar Más Usuarios
1. Inicia sesión como admin
2. Ve a la sección "Empleados"
3. Haz clic en "Agregar Empleado"
4. Completa el formulario
5. **Contraseña por defecto:** `admin123` para todos los empleados

### Agregar Productos
1. Ve a la sección "Productos"
2. Haz clic en "Agregar Producto"
3. Completa:
   - Nombre
   - Código de barras (opcional)
   - Marca (selecciona de la lista)
   - Categoría (selecciona de la lista)
   - Precio

### Categorías Disponibles
- Suplementos
- Hierbas y Tés
- Granos y Semillas
- Aceites
- Endulzantes Naturales
- Productos Orgánicos
- Cosméticos Naturales
- Superfoods
- Bebidas Naturales
- Snacks Saludables

---

## 🎨 Características del Sistema

### Dashboard Administrador (admin)
- ✅ Ver estadísticas generales
- ✅ Gestionar tiendas y bodegas
- ✅ Administrar empleados
- ✅ Catálogo de productos
- ✅ Control de inventario
- ✅ Historial de ventas
- ✅ Reportes

### Punto de Venta (empleados)
- 🚧 En desarrollo
- Ventas rápidas
- Búsqueda por código de barras
- Corte de caja

---

## 🔧 Solución de Problemas

### Error al cargar tiendas
- Verifica tu conexión a internet (el sistema usa Supabase en la nube)
- Revisa la consola del navegador (F12) para más detalles

### Error de login
- Asegúrate de haber seleccionado una tienda primero
- Verifica que el usuario y contraseña sean correctos
- Usuario: `admin`, Contraseña: `admin123`

### La aplicación no inicia
- Verifica que Node.js esté instalado: `node --version`
- Reinstala dependencias: `npm install`

---

## 📞 Contacto

Para soporte técnico o dudas, revisa:
- README.md en la raíz del proyecto
- Logs en consola del navegador (F12)

---

**¡Listo para empezar! 🌿**
