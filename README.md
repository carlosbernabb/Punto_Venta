# 🌿 Punto de Venta - Sistema Naturista

Sistema de Punto de Venta diseñado específicamente para tiendas naturistas con gestión multi-tienda, control de inventario y administración de empleados.

## 🚀 Características Principales

### Para Administradores
- ✅ **Gestión de Tiendas**: Agregar, editar y administrar múltiples tiendas y bodegas
- ✅ **Control de Empleados**: Crear usuarios, asignar roles (Admin, Empleado, Bodeguero)
- ✅ **Catálogo de Productos**: Gestión completa con códigos de barras, precios, marcas y categorías
- ✅ **Control de Inventario**: Monitoreo en tiempo real por tienda
- ✅ **Reportes y Estadísticas**: Ventas, productos más vendidos, cortes de caja
- ✅ **Transferencias**: Distribución de productos de bodega a tiendas

### Para Empleados
- ✅ **Punto de Venta**: Interfaz rápida para ventas
- ✅ **Búsqueda de Productos**: Por nombre o código de barras
- ✅ **Métodos de Pago**: Efectivo, tarjeta, transferencia
- ✅ **Corte de Caja**: Cierre diario de turno

## 📦 Instalación

### Requisitos Previos
- Node.js (v16 o superior)
- npm (incluido con Node.js)

### Pasos de Instalación

1. **Instalar dependencias**
```bash
npm install
```

2. **Ejecutar la aplicación**
```bash
npm start
```

Para modo desarrollo (con DevTools abierto):
```bash
npm run dev
```

## 🔐 Acceso Inicial

**Usuario por defecto:**
- Username: `admin`
- Password: `admin123`

> **Nota**: Todos los empleados usan la contraseña `admin123` en esta versión. Se recomienda implementar Supabase Auth completo para producción.

## 🗄️ Base de Datos

El sistema está conectado a **Supabase** en la nube, lo que permite:
- Acceso desde cualquier computadora
- Sincronización en tiempo real
- Respaldos automáticos
- Escalabilidad

### Estructura de Datos
- `organizations` - Organización principal
- `stores` - Tiendas y bodegas
- `employees` - Usuarios del sistema
- `products` - Catálogo de productos
- `categories` - Categorías de productos
- `brands` - Marcas
- `inventory` - Stock por tienda
- `sales` - Registro de ventas
- `sale_items` - Detalle de cada venta
- `transfers` - Transferencias entre tiendas
- `cash_registers` - Cortes de caja

## 📱 Uso del Sistema

### Dashboard Administrador

1. **Resumen General**: Muestra estadísticas clave y actividad reciente
2. **Tiendas**: Agregar/editar tiendas y bodegas
3. **Empleados**: Gestionar usuarios del sistema
4. **Productos**: Administrar catálogo con precios y categorías
5. **Inventario**: Ver stock por tienda y realizar transferencias
6. **Ventas**: Historial completo de transacciones
7. **Reportes**: Análisis y gráficas de ventas

### Punto de Venta (Empleados)

1. Búsqueda de productos por nombre o código de barras
2. Agregar productos al carrito
3. Seleccionar método de pago
4. Generar ticket de venta
5. Realizar corte de caja al final del turno

## 🔧 Personalización

### Agregar Categorías y Marcas

El sistema incluye categorías predefinidas para tiendas naturistas:
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

Puedes agregar más directamente en Supabase o mediante SQL.

### Configuración de Supabase

Las credenciales están en `src/config/supabase.js`:
- URL del proyecto
- API Key (anon/public)
- Organization ID

## 🛡️ Seguridad

El sistema implementa **Row Level Security (RLS)** en Supabase:
- Los empleados solo ven datos de su organización
- Los administradores tienen acceso completo
- Las políticas protegen datos sensibles

## 📝 Próximas Mejoras

- [ ] Implementar Supabase Auth completo
- [ ] Scanner de códigos de barras
- [ ] Impresión de tickets
- [ ] Notificaciones de stock bajo
- [ ] Historial de precios
- [ ] Módulo de compras a proveedores
- [ ] App móvil complementaria
- [ ] Reportes exportables (PDF, Excel)

## 🤝 Soporte

Para soporte técnico o preguntas:
- Consulta la documentación de Supabase: https://supabase.com/docs
- Revisa los logs en la consola del navegador (F12)

## 📄 Licencia

MIT License - Uso libre para proyectos comerciales y personales

---

**Desarrollado con ❤️ para tiendas naturistas**
