// Admin dashboard script
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.isAuthenticated()) {
    window.location.href = 'login.html';
    return;
  }

  const currentUser = Auth.getCurrentUser();
  if (!currentUser) {
    window.location.href = 'login.html';
    return;
  }
  const isAdmin = currentUser.role === 'admin';
  const productCatalogFields = isAdmin
    ? '*'
    : 'id, name, barcode, brand_id, category_id, retail_price, wholesale_price, distributor_price, unit_price, description, organization_id, is_active, created_at, updated_at';
  const productCatalogSelect = `${productCatalogFields}, brand:brands(name), category:categories(name)`;

  function hideProductCostForCurrentUser(product) {
    if (isAdmin || !product) return product;
    const { cost_price, ...productWithoutCost } = product;
    return productWithoutCost;
  }

  function shouldPreserveInputCase(input) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return true;
    if (input.type === 'password' || input.closest('#loginForm')) return true;
    if (input instanceof HTMLInputElement && !['text', 'search', 'email', 'tel', 'url'].includes(input.type)) return true;
    if (input.readOnly) return true;
    if (input.closest('.ticket-designer-layout') || input.matches('[data-preserve-case]')) return true;
    return false;
  }

  // Keep everyday capture consistent without changing credentials or ticket text.
  document.addEventListener('input', (event) => {
    const input = event.target;
    if (shouldPreserveInputCase(input) || typeof input.value !== 'string') return;

    const upperValue = input.value.toLocaleUpperCase('es-MX');
    if (upperValue === input.value) return;

    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    input.value = upperValue;
    if (selectionStart !== null && selectionEnd !== null) {
      input.setSelectionRange(selectionStart, selectionEnd);
    }
  }, true);

  function requireAdminAction(actionName = 'realizar esta accion') {
    if (isAdmin) return true;
    showToast(`No tienes permisos para ${actionName}`, 'error');
    return false;
  }

  const EMPLOYEE_MODULES = [
    { id: 'sales', label: 'Ventas' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'compras', label: 'Compras' },
    { id: 'overview', label: 'Resumen' },
    { id: 'stores', label: 'Tiendas' },
    { id: 'employees', label: 'Empleados' },
    { id: 'customers', label: 'Clientes' },
    { id: 'products', label: 'Productos' },
    { id: 'inventory', label: 'Inventario' },
    { id: 'stock-general', label: 'Stock General' },
    { id: 'transfers', label: 'Transferencias de Inventario' },
    { id: 'recetas', label: 'Recetas' },
    { id: 'tareas', label: 'Tareas' },
    { id: 'caja', label: 'Corte de Caja' },
    { id: 'reports', label: 'Reportes' },
    { id: 'brand-profit', label: 'Ganancias por Marca' },
    { id: 'config', label: 'Configuración' }
  ];

  const DEFAULT_EMPLOYEE_MODULE_PERMISSIONS = {
    sales: true,
    tickets: true,
    compras: true,
    overview: false,
    stores: false,
    employees: false,
    customers: true,
    products: true,
    inventory: true,
    'stock-general': true,
    transfers: true,
    recetas: true,
    tareas: true,
    caja: false,
    reports: false,
    'brand-profit': false,
    config: false
  };

  const ALL_MODULE_PERMISSIONS = EMPLOYEE_MODULES.reduce((acc, mod) => {
    acc[mod.id] = true;
    return acc;
  }, {});

  let currentUserPermissions = isAdmin
    ? { ...ALL_MODULE_PERMISSIONS }
    : normalizeModulePermissions(currentUser.module_permissions, currentUser.role);

  function parseModulePermissions(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (err) {
        return null;
      }
    }
    if (typeof value === 'object') return value;
    return null;
  }

  function normalizeModulePermissions(value, role = 'empleado') {
    if (role === 'admin') return { ...ALL_MODULE_PERMISSIONS };
    const parsed = parseModulePermissions(value);
    const base = { ...DEFAULT_EMPLOYEE_MODULE_PERMISSIONS };
    if (!parsed) return base;

    EMPLOYEE_MODULES.forEach(mod => {
      if (Object.prototype.hasOwnProperty.call(parsed, mod.id)) {
        base[mod.id] = parsed[mod.id] === true;
      }
    });

    return base;
  }

  function canAccessSection(sectionId) {
    if (isAdmin) return true;
    if (sectionId === 'inventory') return true;
    return currentUserPermissions[sectionId] === true;
  }

  function canEditInventoryStock() {
    return isAdmin || currentUserPermissions.inventory === true;
  }

  function getFirstAccessibleSection() {
    const preferred = ['sales', 'tickets', 'inventory', 'stock-general', 'transfers', 'compras', 'products', 'customers', 'recetas', 'tareas'];
    return preferred.find(canAccessSection) || EMPLOYEE_MODULES.find(mod => canAccessSection(mod.id))?.id || null;
  }

  function applyModuleAccessToSidebar() {
    document.querySelectorAll('.nav-item[data-section]').forEach(navItem => {
      const sectionId = navItem.dataset.section;
      navItem.style.display = canAccessSection(sectionId) ? '' : 'none';
    });
  }

  function employeeSelectFields(includePermissions = true) {
    const base = 'id, username, full_name, role, is_active, created_at, updated_at, avatar_url, organization_id, assigned_store_id, assigned_store:stores(id, name)';
    return includePermissions ? `${base}, module_permissions` : base;
  }

  async function refreshCurrentUserPermissions() {
    if (isAdmin || !currentUser?.id) return;

    try {
      const { data, error } = await supabaseClient
        .from('employees')
        .select('module_permissions')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (!error && data) {
        currentUser.module_permissions = data.module_permissions || null;
        currentUserPermissions = normalizeModulePermissions(currentUser.module_permissions, currentUser.role);
        localStorage.setItem('userData', JSON.stringify(currentUser));
      }
    } catch (err) {
      console.warn('No se pudieron actualizar permisos del usuario actual:', err);
    }

    if (!currentUser.module_permissions) {
      const localPermissions = getLocalEmployeePermissions(currentUser.id);
      if (localPermissions) {
        currentUser.module_permissions = localPermissions;
        currentUserPermissions = normalizeModulePermissions(localPermissions, currentUser.role);
        localStorage.setItem('userData', JSON.stringify(currentUser));
      }
    }
  }

  const sessionCache = {
    activeStores: null,
    activeStoresPromise: null,
    productsFull: null,
    productsFullPromise: null,
    productsInventory: null,
    productsInventoryPromise: null,
    inventoryByStore: new Map(),
    inventoryByStorePromise: new Map(),
    inventoryByProduct: new Map(),
    inventoryByProductPromise: new Map()
  };

  window.sessionDataCache = sessionCache;

  async function fetchPaged(queryFactory, pageSize = 1000) {
    let list = [];
    let page = 0;

    while (true) {
      const { data, error } = await queryFactory()
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      list = list.concat(data);
      if (data.length < pageSize) break;
      page++;
    }

    return list;
  }

  async function getCachedActiveStores(force = false) {
    if (!force && sessionCache.activeStores) return sessionCache.activeStores;
    if (!force && sessionCache.activeStoresPromise) return sessionCache.activeStoresPromise;

    sessionCache.activeStoresPromise = supabaseClient
      .from('stores')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }) => {
        if (error) throw error;
        sessionCache.activeStores = data || [];
        return sessionCache.activeStores;
      })
      .finally(() => {
        sessionCache.activeStoresPromise = null;
      });

    return sessionCache.activeStoresPromise;
  }

  async function getCachedFullProducts(force = false) {
    if (!force && sessionCache.productsFull) return sessionCache.productsFull;
    if (!force && sessionCache.productsFullPromise) return sessionCache.productsFullPromise;

    sessionCache.productsFullPromise = fetchPaged(() => supabaseClient
      .from('products')
      .select(productCatalogSelect)
      .eq('is_active', true)
      .order('created_at', { ascending: false }))
      .then(products => {
        const catalogProducts = products.map(hideProductCostForCurrentUser);
        sessionCache.productsFull = catalogProducts;
        window.posProductsCache = catalogProducts;
        return catalogProducts;
      })
      .finally(() => {
        sessionCache.productsFullPromise = null;
      });

    return sessionCache.productsFullPromise;
  }

  async function getCachedInventoryProducts(force = false) {
    if (!force && sessionCache.productsInventory) return sessionCache.productsInventory;
    if (!force && sessionCache.productsInventoryPromise) return sessionCache.productsInventoryPromise;

    sessionCache.productsInventoryPromise = fetchPaged(() => supabaseClient
      .from('products')
      .select('id, name, barcode, brand:brands(name), category:categories(name)')
      .eq('is_active', true)
      .order('name'))
      .then(products => {
        sessionCache.productsInventory = products;
        return products;
      })
      .finally(() => {
        sessionCache.productsInventoryPromise = null;
      });

    return sessionCache.productsInventoryPromise;
  }

  async function getCachedStoreInventory(storeId, force = false) {
    if (!storeId) return [];
    if (!force && sessionCache.inventoryByStore.has(storeId)) {
      return sessionCache.inventoryByStore.get(storeId);
    }
    if (!force && sessionCache.inventoryByStorePromise.has(storeId)) {
      return sessionCache.inventoryByStorePromise.get(storeId);
    }

    const promise = fetchPaged(() => supabaseClient
      .from('inventory')
      .select('id, product_id, store_id, quantity, min_stock')
      .eq('store_id', storeId))
      .then(rows => {
        sessionCache.inventoryByStore.set(storeId, rows);
        rows.forEach(row => cacheInventoryRow(row));
        return rows;
      })
      .finally(() => {
        sessionCache.inventoryByStorePromise.delete(storeId);
      });

    sessionCache.inventoryByStorePromise.set(storeId, promise);
    return promise;
  }

  async function getCachedProductInventory(productId, force = false) {
    if (!productId) return [];
    if (!force && sessionCache.inventoryByProduct.has(productId)) {
      return sessionCache.inventoryByProduct.get(productId);
    }
    if (!force && sessionCache.inventoryByProductPromise.has(productId)) {
      return sessionCache.inventoryByProductPromise.get(productId);
    }

    const promise = supabaseClient
      .from('inventory')
      .select('id, product_id, store_id, quantity, min_stock')
      .eq('product_id', productId)
      .then(({ data, error }) => {
        if (error) throw error;
        const rows = data || [];
        sessionCache.inventoryByProduct.set(productId, rows);
        rows.forEach(row => cacheInventoryRow(row));
        return rows;
      })
      .finally(() => {
        sessionCache.inventoryByProductPromise.delete(productId);
      });

    sessionCache.inventoryByProductPromise.set(productId, promise);
    return promise;
  }

  function cacheInventoryRow(row) {
    if (!row?.store_id || !row?.product_id) return;
    const normalized = {
      ...row,
      quantity: parseFloat(row.quantity || 0)
    };
    if (Object.prototype.hasOwnProperty.call(row, 'min_stock')) {
      normalized.min_stock = row.min_stock == null ? row.min_stock : parseInt(row.min_stock || 0);
    }

    const storeRows = sessionCache.inventoryByStore.get(normalized.store_id);
    if (storeRows) {
      const idx = storeRows.findIndex(item => item.product_id === normalized.product_id);
      if (idx >= 0) storeRows[idx] = { ...storeRows[idx], ...normalized };
      else storeRows.push(normalized);
    }

    const productRows = sessionCache.inventoryByProduct.get(normalized.product_id);
    if (productRows) {
      const idx = productRows.findIndex(item => item.store_id === normalized.store_id);
      if (idx >= 0) productRows[idx] = { ...productRows[idx], ...normalized };
      else productRows.push(normalized);
    }

    // Mantener el cache de Stock General en sync con cualquier cambio de inventario
    // (ventas, transferencias o cambios en vivo desde otra terminal).
    applyStockGeneralInventoryRow(normalized);
  }

  function adjustCachedInventory(storeId, productId, deltaQty) {
    const row = getCachedInventoryRowSync(storeId, productId);
    if (!row) return;
    // round a 3 decimales para evitar ruido de punto flotante (0.1+0.2 etc.)
    const nextQty = Math.max(0, Math.round((parseFloat(row.quantity || 0) + parseFloat(deltaQty || 0)) * 1000) / 1000);
    cacheInventoryRow({
      ...row,
      quantity: nextQty,
      updated_at: new Date().toISOString()
    });
  }

  function getCachedInventoryRowSync(storeId, productId) {
    const storeRows = sessionCache.inventoryByStore.get(storeId);
    return storeRows?.find(row => row.product_id === productId) || null;
  }

  async function getCachedInventoryRow(storeId, productId, force = false) {
    const rows = await getCachedStoreInventory(storeId, force);
    return rows.find(row => row.product_id === productId) || null;
  }

  function cacheProduct(product) {
    if (!product?.id) return;
    product = hideProductCostForCurrentUser(product);

    const put = (listName) => {
      const list = sessionCache[listName];
      if (!list) return;
      const idx = list.findIndex(item => item.id === product.id);
      if (product.is_active === false) {
        if (idx >= 0) list.splice(idx, 1);
        return;
      }
      if (idx >= 0) list[idx] = { ...list[idx], ...product };
      else list.unshift(product);
    };

    put('productsFull');
    put('productsInventory');
    if (window.posProductsCache) window.posProductsCache = sessionCache.productsFull || window.posProductsCache;
  }

  async function prewarmSessionCache() {
    try {
      const selectedStoreRaw = localStorage.getItem('selectedStore') || sessionStorage.getItem('pos_current_store');
      let selectedStoreId = currentUser.store_id || null;
      if (selectedStoreRaw) {
        try {
          selectedStoreId = JSON.parse(selectedStoreRaw).id || selectedStoreId;
        } catch (err) {
          console.warn('No se pudo leer la tienda para precargar caché', err);
        }
      }

      await Promise.all([
        getCachedActiveStores(),
        getCachedFullProducts(),
        getCachedInventoryProducts(),
        selectedStoreId ? getCachedStoreInventory(selectedStoreId) : Promise.resolve([])
      ]);
    } catch (err) {
      console.warn('Precarga de caché omitida:', err);
    }
  }

  async function syncProductFromRealtime(productId) {
    if (!productId) return;

    const { data, error } = await supabaseClient
      .from('products')
      .select(productCatalogSelect)
      .eq('id', productId)
      .maybeSingle();

    if (error) {
      console.warn('No se pudo sincronizar producto en vivo:', error);
      return;
    }

    cacheProduct(data || { id: productId, is_active: false });

    if (document.getElementById('section-products')?.classList.contains('active')) {
      globalProductsList = sessionCache.productsFull || globalProductsList;
      window.globalProductsList = globalProductsList;
      renderProductsTable();
    }
  }

  function syncInventoryFromRealtime(row) {
    if (!row?.store_id || !row?.product_id) return;
    cacheInventoryRow(row);

    if (row.store_id === globalCurrentStoreId && Array.isArray(globalInventoryProducts)) {
      const product = globalInventoryProducts.find(p => p.id === row.product_id);
      if (product) {
        product.current_qty = parseInt(row.quantity || 0);
        if (Object.prototype.hasOwnProperty.call(row, 'min_stock')) {
          product.current_min = row.min_stock !== null ? parseInt(row.min_stock || 0) : 10;
        }
      }

      if (document.getElementById('section-inventory')?.classList.contains('active')) {
        const currentSearch = document.getElementById('inventorySearchInput')?.value.toLowerCase().trim() || '';
        renderInventoryTable(currentSearch);
      }
    }
  }

  function setupRealtimeCacheSync() {
    if (!supabaseClient?.channel || window.sessionRealtimeCacheChannel) return;

    const channel = supabaseClient
      .channel('session-cache-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, payload => {
        const row = payload.new || payload.old;
        syncInventoryFromRealtime(row);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
        const productId = payload.new?.id || payload.old?.id;
        syncProductFromRealtime(productId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, () => {
        getCachedActiveStores(true).catch(err => {
          console.warn('No se pudieron sincronizar tiendas en vivo:', err);
        });
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          console.log('Sincronización en vivo activa');
        }
      });

    window.sessionRealtimeCacheChannel = channel;
    window.addEventListener('beforeunload', () => {
      supabaseClient.removeChannel(channel);
      window.sessionRealtimeCacheChannel = null;
    });
  }

  Object.assign(window, {
    getCachedActiveStores,
    getCachedFullProducts,
    getCachedInventoryProducts,
    getCachedStoreInventory,
    getCachedProductInventory,
    getCachedInventoryRow,
    cacheInventoryRow,
    adjustCachedInventory,
    cacheProduct
  });

  await refreshCurrentUserPermissions();
  applyModuleAccessToSidebar();
  document.getElementById('userName').textContent = currentUser.full_name;

  // Format role string before assigning (e.g. 'bodeguero' -> 'Bodeguero')
  const roleName = currentUser.role ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) : 'Usuario';
  document.getElementById('userRoleText').textContent = roleName;

  // Set avatar if exists
  const avatarImg = document.getElementById('userAvatarImage');
  const avatarText = document.getElementById('userAvatarText');
  if (currentUser.avatar_url) {
    // Generate public URL if it's just a file path from our bucket
    const { data: publicUrlData } = supabaseClient.storage.from('avatars').getPublicUrl(currentUser.avatar_url);
    avatarImg.src = publicUrlData.publicUrl;
    avatarImg.style.display = 'block';
    avatarText.style.display = 'none';
  }

  // Profile Picture Upload Logic
  const profileBtn = document.getElementById('userProfileBtn');
  const avatarInput = document.getElementById('avatarUploadInput');

  if (profileBtn && avatarInput) {
    profileBtn.addEventListener('click', () => {
      avatarInput.click();
    });

    avatarInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        // Show loading state on avatar
        avatarText.textContent = '⏳';
        avatarText.style.display = 'block';
        avatarImg.style.display = 'none';

        // 1. Upload to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${currentUser.id}_${Date.now()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabaseClient.storage
          .from('avatars')
          .upload(filePath, file, { cacheControl: '3600', upsert: true });

        if (uploadError) throw uploadError;

        // 2. Update employee record in DB
        const { error: dbError } = await supabaseClient
          .from('employees')
          .update({ avatar_url: filePath })
          .eq('id', currentUser.id);

        if (dbError) throw dbError;

        // 3. Update UI and LocalStorage
        const { data: publicUrlData } = supabaseClient.storage.from('avatars').getPublicUrl(filePath);
        avatarImg.src = publicUrlData.publicUrl;
        avatarImg.style.display = 'block';
        avatarText.style.display = 'none';

        // Update local storage so it persists on refresh
        currentUser.avatar_url = filePath;
        localStorage.setItem('userData', JSON.stringify(currentUser));

        showToast('¡Foto de perfil actualizada exitosamente!', 'success');

      } catch (err) {
        console.error('Error uploading avatar:', err);
        showToast('Hubo un error al subir la foto de perfil.', 'error');
        avatarText.textContent = '👤';
        avatarText.style.display = 'block';
      } finally {
        avatarInput.value = ''; // Reset input
      }
    });
  }

  // Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');
  let activeSectionId = 'overview';

  function activateSection(sectionId, options = {}) {
    const isProgrammatic = options.programmatic === true;
    if (sectionId === 'transfers' && isProgrammatic && options.allowTransfers !== true) {
      return;
    }
    if (!canAccessSection(sectionId)) {
      showToast('No tienes permisos para abrir esta seccion', 'error');
      return;
    }

    const targetSection = document.getElementById(`section-${sectionId}`);
    const targetNav = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (!targetSection || !targetNav) return;

    activeSectionId = sectionId;
    navItems.forEach(nav => nav.classList.remove('active'));
    sections.forEach(sec => sec.classList.remove('active'));

    targetNav.classList.add('active');
    targetSection.classList.add('active');
    targetNav.blur();

    updatePageTitle(sectionId);
    loadSectionData(sectionId);
  }

  window.navigateToAdminSection = function (sectionId) {
    activateSection(sectionId, { programmatic: true, allowTransfers: true });
  };

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = item.dataset.section;
      if (sectionId === 'transfers' && !e.isTrusted) {
        return;
      }
      activateSection(sectionId);
    });
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await Auth.logout();
    window.location.href = 'login.html';
  });

  // Default Load
  const initialSection = isAdmin ? 'overview' : getFirstAccessibleSection();
  if (initialSection) {
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    document.querySelector(`.nav-item[data-section="${initialSection}"]`)?.classList.add('active');

    document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
    document.getElementById(`section-${initialSection}`)?.classList.add('active');

    updatePageTitle(initialSection);
    loadSectionData(initialSection);
  } else {
    showToast('No tienes modulos habilitados. Contacta al administrador.', 'error');
  }

  setTimeout(() => {
    prewarmSessionCache();
    setupRealtimeCacheSync();
  }, 250);

  function updatePageTitle(section) {
    const titles = {
      overview: { title: 'Resumen General', subtitle: 'Vista general del sistema' },
      stores: { title: 'Gestión de Tiendas', subtitle: 'Administra tus tiendas y bodegas' },
      employees: { title: 'Gestión de Empleados', subtitle: 'Administra el equipo de trabajo' },
      customers: { title: 'Gestión de Clientes', subtitle: 'Directorio de clientes y descuentos especiales' },
      products: { title: 'Gestión de Productos', subtitle: 'Catálogo de productos' },
      inventory: { title: 'Control de Inventario', subtitle: 'Stock por tienda' },
      'stock-general': { title: 'Stock General', subtitle: 'Consulta total y distribucion por tienda' },
      transfers: { title: 'Transferencias de Inventario', subtitle: 'Movimientos internos entre tiendas y bodega' },
      sales: { title: 'Punto de Venta', subtitle: 'Caja Registradora' },
      tickets: { title: 'Tickets', subtitle: 'Reimpresion de los ultimos tickets de esta sesion' },
      caja: { title: 'Corte de Caja', subtitle: 'Cierre y retiro de efectivo por tienda' },
      reports: { title: 'Reportes y Análisis', subtitle: 'Estadísticas del negocio' },
      'brand-profit': { title: 'Ganancias por Marca', subtitle: 'Porcentaje de ganancia sobre precio de compra' },
      config: { title: 'Configuración', subtitle: 'Tema, impresora y diseño del ticket' },
      recetas: { title: 'Gestión de Recetas', subtitle: 'Padecimientos y tratamientos' },
      tareas: { title: 'Gestión de Tareas', subtitle: 'Actividades por sucursal' },
      compras: { title: 'Compras', subtitle: 'Registro de compras a proveedores' }
    };

    const info = titles[section];
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageSubtitle').textContent = info.subtitle;
  }

  async function loadSectionData(section) {
    if (!canAccessSection(section)) {
      showToast('No tienes permiso para ver esta sección', 'error');
      const fallbackSection = getFirstAccessibleSection();
      if (!fallbackSection) return;

      document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
      document.querySelector(`.nav-item[data-section="${fallbackSection}"]`)?.classList.add('active');
      document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
      document.getElementById(`section-${fallbackSection}`)?.classList.add('active');
      updatePageTitle(fallbackSection);
      section = fallbackSection;
    }

    switch (section) {
      case 'overview': await loadOverview(); break;
      case 'stores': await loadStores(); break;
      case 'employees': await loadEmployees(); break;
      case 'customers': await loadCustomers(); break;
      case 'products': await loadProducts(); break;
      case 'inventory': await loadInventory(); break;
      case 'stock-general': await loadStockGeneral(); break;
      case 'transfers': await loadInventoryTransfers(); break;
      case 'sales': await loadSales(); break;
      case 'tickets': await loadTickets(); break;
      case 'caja': await loadCorteCaja(); break;
      case 'reports': await loadReports(); break;
      case 'brand-profit': await loadBrandProfit(); break;
      case 'config': await loadConfigSection(); break;
      case 'recetas': await loadRecetas(); break;
      case 'tareas': await loadTareas(); break;
      case 'compras': if (window.loadCompras) await window.loadCompras(); break;
    }
  }

  // Load Overview
  async function loadOverview() {
    try {
      const todayStr = toLocalDateInputValue(new Date());
      const { startIso: todayStartIso, endIso: todayEndIso } = getLocalDateRange(todayStr);

      // --- Global stats ---
      const [storesRes, empRes, prodRes, salesTodayData] = await Promise.all([
        supabaseClient.from('stores').select('*', { count: 'exact' }),
        supabaseClient.from('employees').select('id', { count: 'exact' }).eq('is_active', true),
        supabaseClient.from('products').select('*', { count: 'exact' }),
        fetchSalesForDateRange('total', todayStartIso, todayEndIso)
      ]);

      if (storesRes.error) throw storesRes.error;
      if (empRes.error) throw empRes.error;
      if (prodRes.error) throw prodRes.error;

      document.getElementById('totalStores').textContent = storesRes.count || 0;
      document.getElementById('totalEmployees').textContent = empRes.count || 0;
      document.getElementById('totalProducts').textContent = prodRes.count || 0;
      const todayTotal = salesTodayData?.reduce((s, r) => s + parseFloat(r.total || 0), 0) || 0;
      document.getElementById('todaySales').textContent = `$${todayTotal.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // --- Stock alerts (all inventory where quantity <= min_stock) ---
      // Actually filter in JS because lte on same-row column isn't direct
      const { data: allInv, error: invError } = await supabaseClient
        .from('inventory')
        .select('quantity, min_stock, product:products(name), store:stores(name, type)');

      if (invError) throw invError;

      const alerts = (allInv || []).filter(r => r.quantity <= r.min_stock);
      const alertBanner = document.getElementById('stockAlertsBanner');
      if (alerts.length === 0) {
        alertBanner.innerHTML = '';
      } else {
        const criticals = alerts.filter(r => r.quantity === 0);
        const lows = alerts.filter(r => r.quantity > 0);

        // Group by store
        const alertsByStore = {};
        criticals.forEach(r => {
          const key = r.store?.name || 'Sin Tienda';
          if (!alertsByStore[key]) alertsByStore[key] = { sinStock: [], stockBajo: [], type: r.store?.type || 'tienda' };
          alertsByStore[key].sinStock.push(r);
        });
        lows.forEach(r => {
          const key = r.store?.name || 'Sin Tienda';
          if (!alertsByStore[key]) alertsByStore[key] = { sinStock: [], stockBajo: [], type: r.store?.type || 'tienda' };
          alertsByStore[key].stockBajo.push(r);
        });

        // Sort stores by total alerts descending
        const sortedStores = Object.entries(alertsByStore).sort(
          (a, b) => (b[1].sinStock.length + b[1].stockBajo.length) - (a[1].sinStock.length + a[1].stockBajo.length)
        );

        let html = `
        <div style="border:1.5px solid #fde68a; border-radius:12px; overflow:hidden; background:#fff; margin-bottom:2px;">
          <!-- Panel header -->
          <div onclick="const body=this.nextElementSibling; const arr=this.querySelector('.inv-main-arrow'); const open=body.style.display!=='none'; body.style.display=open?'none':'block'; arr.style.transform=open?'rotate(0deg)':'rotate(180deg)';"
               style="background:#fef3c7; padding:13px 18px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none;">
            <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
              <span style="font-weight:800; color:#92400e; font-size:0.88rem; letter-spacing:.03em;">⚠️ ALERTAS DE INVENTARIO</span>
              <span style="background:#fee2e2; color:#b91c1c; border-radius:20px; padding:2px 11px; font-size:0.75rem; font-weight:700;">🔴 ${criticals.length} sin stock</span>
              ${lows.length > 0 ? `<span style="background:#fef9c3; color:#78350f; border:1px solid #fde047; border-radius:20px; padding:2px 11px; font-size:0.75rem; font-weight:700;">🟡 ${lows.length} stock bajo</span>` : ''}
              <span style="color:#a16207; font-size:0.75rem; font-weight:600;">${sortedStores.length} tiendas afectadas</span>
            </div>
            <span class="inv-main-arrow" style="font-size:1rem; color:#b45309; transition:transform .25s; transform:rotate(0deg); flex-shrink:0;">▾</span>
          </div>
          <!-- Store list (collapsed by default) -->
          <div style="display:none;">`;

        sortedStores.forEach(([storeName, { sinStock, stockBajo, type }], idx) => {
          const panelId = `invAlertStore_${idx}`;
          const total = sinStock.length + stockBajo.length;
          const icon = type === 'bodega' ? '📦' : '🏪';
          html += `
            <div style="border-top:1px solid #fde68a;">
              <!-- Store row -->
              <div onclick="const p=document.getElementById('${panelId}'); const a=this.querySelector('.inv-store-arrow'); const open=p.style.display!=='none'; p.style.display=open?'none':'block'; a.textContent=open?'▾':'▴';"
                   style="padding:10px 18px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; background:#fffbeb; user-select:none;">
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                  <span style="font-size:0.9rem;">${icon}</span>
                  <span style="font-weight:700; color:#374151; font-size:0.84rem;">${escapeHtml(storeName)}</span>
                  ${sinStock.length > 0 ? `<span style="background:#fee2e2; color:#b91c1c; border-radius:20px; padding:1px 9px; font-size:0.71rem; font-weight:700;">🔴 ${sinStock.length} sin stock</span>` : ''}
                  ${stockBajo.length > 0 ? `<span style="background:#fef9c3; color:#78350f; border:1px solid #fde047; border-radius:20px; padding:1px 9px; font-size:0.71rem; font-weight:700;">🟡 ${stockBajo.length} bajo</span>` : ''}
                </div>
                <span class="inv-store-arrow" style="font-size:0.8rem; color:#9ca3af; flex-shrink:0;">▾</span>
              </div>
              <!-- Product list -->
              <div id="${panelId}" style="display:none; padding:10px 22px 14px; border-top:1px dashed #fde68a; background:#fff;">
                ${sinStock.length > 0 ? `
                  <div style="font-size:0.71rem; font-weight:800; color:#b91c1c; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px;">Sin Stock (${sinStock.length})</div>
                  <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:${stockBajo.length > 0 ? '12px' : '0'};">
                    ${sinStock.map(r => `<span style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:5px; padding:2px 9px; font-size:0.75rem; font-weight:600;">${escapeHtml(r.product?.name || '?')}</span>`).join('')}
                  </div>` : ''}
                ${stockBajo.length > 0 ? `
                  <div style="font-size:0.71rem; font-weight:800; color:#78350f; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px;">Stock Bajo (${stockBajo.length})</div>
                  <div style="display:flex; flex-wrap:wrap; gap:5px;">
                    ${stockBajo.map(r => `<span style="background:#fef9c3; color:#78350f; border:1px solid #fde047; border-radius:5px; padding:2px 9px; font-size:0.75rem; font-weight:600;">${escapeHtml(r.product?.name || '?')} <span style="opacity:0.6; font-weight:500;">(${r.quantity}/${r.min_stock})</span></span>`).join('')}
                  </div>` : ''}
              </div>
            </div>`;
        });

        html += `</div></div>`;
        alertBanner.innerHTML = html;
      }

      // --- Per-store accordion ---
      const stores = storesRes.data || [];
      if (stores.length === 0) {
        document.getElementById('storeAccordion').innerHTML = '<p class="text-muted">No hay tiendas registradas.</p>';
        return;
      }

      const salesSelect = 'id, store_id, total, payment_method, sale_date, sale_type, employee:employees(full_name), customer:customers(name), items:sale_items(quantity, unit_price, subtotal, product:products(name))';

      // Fetch today's sales separately so the per-store summary is complete even on busy days.
      const [todaySalesAll, recentSalesRes, invRes, logsRes] = await Promise.all([
        fetchSalesForDateRange(salesSelect, todayStartIso, todayEndIso),
        supabaseClient
          .from('sales')
          .select(salesSelect)
          .order('sale_date', { ascending: false })
          .limit(100),
        supabaseClient
          .from('inventory')
          .select('store_id, quantity, min_stock, product:products(name)'),
        supabaseClient
          .from('inventory_logs')
          .select('store_id, quantity, type, description, created_at, product:products(name), employee:employees(full_name)')
          .order('created_at', { ascending: false })
          .limit(100)
      ]);

      const salesById = new Map();
      [...(todaySalesAll || []), ...(recentSalesRes.data || [])].forEach(sale => {
        if (sale?.id) salesById.set(sale.id, sale);
      });
      const salesAll = Array.from(salesById.values())
        .sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime());
      const invAll = invRes.data || [];
      const logsAll = logsRes.data || [];
      renderOverviewTransferSummary(logsAll);

      const storeIcon = t => t === 'bodega' ? '🏭' : '🏪';
      const accordion = document.getElementById('storeAccordion');

      accordion.innerHTML = stores.map((store, idx) => {
        const storeSales = salesAll.filter(s => s.store_id === store.id);
        const todaySalesStore = (todaySalesAll || []).filter(s => s.store_id === store.id);
        const todayRevStore = todaySalesStore.reduce((sum, s) => sum + parseFloat(s.total || 0), 0);
        const storeInv = invAll.filter(i => i.store_id === store.id);
        const lowStoreInv = storeInv.filter(i => i.quantity <= i.min_stock);

        const alertBadge = lowStoreInv.length > 0
          ? `<span style="background:#fee2e2; color:#b91c1c; border-radius:20px; padding:2px 10px; font-size:0.72rem; font-weight:700; margin-left:8px;">⚠️ ${lowStoreInv.length} alertas</span>`
          : `<span style="background:#d1fae5; color:#065f46; border-radius:20px; padding:2px 10px; font-size:0.72rem; font-weight:700; margin-left:8px;">✅ Stock OK</span>`;

        const recentRows = storeSales.slice(0, 5).map(s => {
          const personName = s.customer?.name || s.employee?.full_name || 'Desconocido';
          const typeLabel = s.sale_type ? ` <span style="font-size:0.65rem; background:#f3f4f6; padding:1px 5px; border-radius:4px; color:#6b7280; font-weight:600; vertical-align:middle; text-transform:uppercase;">${s.sale_type}</span>` : '';
          const timeStr = formatAppDateTime(s.sale_date, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
          const methodIcon = {
            'tarjeta': '💳', 'Tarjeta': '💳',
            'efectivo': '💵',
            'transferencia': '🏦',
            'mixto': '🔀'
          }[s.payment_method] || '💵';
          // Para pagos mixtos mostrar el desglose en un tooltip
          const mixedDetail = s.payment_method === 'mixto' && s.mixed_method
            ? ` <span style="font-size:0.68rem; color:#6b7280;">(${s.mixed_method})</span>` : '';

          const itemsHtml = (s.items && s.items.length > 0) ? s.items.map(item => `
            <div style="display:flex; justify-content:space-between; padding:3px 0; font-size:0.75rem; color:#4b5563; border-bottom:1px dashed #e5e7eb; margin-bottom: 2px;">
              <span style="flex:1;">${item.quantity}x ${item.product?.name || 'Producto'}</span>
              <span style="color:#9ca3af; font-size:0.7rem; margin-right:12px;">$${Number(item.unit_price || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} c/u</span>
              <span style="font-weight:600; color:#374151;">$${Number(item.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          `).join('') : '<div style="font-size:0.75rem; color:#9ca3af;">Sin detalles</div>';

          return `
          <div style="border-bottom:1px solid #f3f4f6; padding:7px 0;">
            <div onclick="const b = this.nextElementSibling; const i = this.querySelector('.chevron-icon'); if(b.style.display==='none'){b.style.display='block';i.style.transform='rotate(180deg)';}else{b.style.display='none';i.style.transform='rotate(0deg)';}" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none; font-size:0.82rem;">
              <span>${methodIcon}${mixedDetail} <strong>$${parseFloat(s.total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> &nbsp;·&nbsp; ${personName}${typeLabel}</span>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="color:#9ca3af; font-size:0.75rem;">${timeStr}</span>
                <span class="chevron-icon" style="font-size:0.9rem; color:#9ca3af; transition:transform .2s; transform:rotate(0deg);">▾</span>
              </div>
            </div>
            <div style="display:none; padding:8px 10px 4px 28px; background:#f9fafb; border-radius:6px; margin-top:6px;">
              <div style="font-weight:600; font-size:0.7rem; color:#6b7280; text-transform:uppercase; margin-bottom:4px;">Detalle de Venta</div>
              ${itemsHtml}
            </div>
          </div>`;
        }).join('');

        const invRows = storeInv.slice(0, 8).map(i => {
          const pct = i.min_stock > 0 ? Math.min(100, (i.quantity / i.min_stock) * 100) : 100;
          const barColor = i.quantity === 0 ? '#ef4444' : i.quantity <= i.min_stock ? '#f59e0b' : '#22c55e';
          return `<div style="display:flex; align-items:center; gap:10px; font-size:0.8rem; padding:4px 0;">
            <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:160px;">${i.product?.name || '—'}</span>
            <div style="flex:2; background:#f3f4f6; border-radius:6px; height:8px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:6px; transition:width .4s;"></div>
            </div>
            <span style="min-width:36px; text-align:right; font-weight:700; color:${barColor};">${i.quantity}</span>
          </div>`;
        }).join('');

        const storeLogs = logsAll.filter(l => l.store_id === store.id);
        const logRows = storeLogs.slice(0, 5).map(l => {
          const qtyColor = l.quantity > 0 ? '#10b981' : '#ef4444'; // Green for +, Red for -
          const sign = l.quantity > 0 ? '+' : '';
          const timeStr = formatAppDateTime(l.created_at, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
          return `<div style="display:flex; justify-content:space-between; align-items:flex-start; padding:7px 0; border-bottom:1px solid #f3f4f6; font-size:0.82rem;">
            <div style="display:flex; flex-direction:column;">
              <span><strong style="color:${qtyColor};">${sign}${l.quantity}</strong> ${l.product?.name || '—'}</span>
              <span style="color:#6b7280; font-size:0.75rem;">${l.description} por ${l.employee?.full_name || 'Sistema'}</span>
            </div>
            <span style="color:#9ca3af; font-size:0.75rem;">${timeStr}</span>
          </div>`;
        }).join('');

        const isOpen = false; // closed by default
        return `
        <div style="background:white; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,0.08); margin-bottom:10px; overflow:hidden;">
          <!-- Header / Toggle -->
          <div onclick="toggleAccordion('acc-${store.id}')"
               style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px; cursor:pointer; user-select:none;
                      background:${isOpen ? '#f0faf0' : 'white'}; border-bottom:1px solid ${isOpen ? '#c8e6c8' : 'transparent'}; transition:background .15s;"
               id="acc-hdr-${store.id}">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.5rem;">${storeIcon(store.type)}</span>
              <div>
                <div style="font-weight:700; font-size:0.95rem; color:#1a1a1a;">${store.name}
                  <span style="font-size:0.72rem; background:#e8f5e9; color:#2d6a2d; border-radius:4px; padding:1px 6px; margin-left:4px; text-transform:uppercase;">${store.type}</span>
                  ${alertBadge}
                </div>
                <div style="font-size:0.75rem; color:#6b7280; margin-top:2px;">Hoy: <strong style="color:#2d6a2d;">$${todayRevStore.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> · ${todaySalesStore.length} venta(s)</div>
              </div>
            </div>
            <span id="acc-chevron-${store.id}" style="font-size:1.1rem; color:#6b7280; transition:transform .2s; transform:${isOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">▾</span>
          </div>
          <!-- Body -->
          <div id="acc-${store.id}" style="display:${isOpen ? 'grid' : 'none'}; grid-template-columns:1fr 1fr; gap:0;">
            <!-- Left: ventas recientes -->
            <div style="padding:14px 18px; border-right:1px solid #f3f4f6;">
              <div style="font-size:0.7rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Últimas ventas</div>
              ${recentRows || '<div style="color:#9ca3af; font-size:0.8rem;">Sin ventas aún</div>'}
            </div>
            <!-- Right: latest movements -->
            <div style="padding:14px 18px;">
              <div style="font-size:0.7rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Últimos Movimientos</div>
              ${logRows || '<div style="color:#9ca3af; font-size:0.8rem;">Sin movimientos recientes</div>'}
            </div>
          </div>
        </div>`;
      }).join('');

    } catch (err) {
      console.error('Error loading overview:', err);
    }
  }

  // Load Stores
  async function loadStores() {
    try {
      const { data: stores, error } = await supabaseClient
        .from('stores')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const tbody = document.getElementById('storesTableBody');
      if (!stores || stores.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No hay tiendas registradas</td></tr>';
        return;
      }

      tbody.innerHTML = stores.map(store => `
        <tr>
          <td><strong>${store.name}</strong></td>
          <td>${store.address || 'Sin dirección'}</td>
          <td><span class="badge ${store.type === 'bodega' ? 'badge-info' : 'badge-success'}">${store.type}</span></td>
          <td><span class="badge ${store.is_active ? 'badge-success' : 'badge-error'}">${store.is_active ? 'Activa' : 'Inactiva'}</span></td>
          <td>
            <div class="d-flex" style="gap: 8px;">
              <button class="btn btn-sm btn-light border d-flex align-items-center justify-content-center" onclick="editStore('${store.id}')" title="Editar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">✏️</button>
              <button class="btn btn-sm btn-danger d-flex align-items-center justify-content-center" onclick="deleteStore('${store.id}')" title="Eliminar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('Error loading stores:', error);
    }
  }

  // Add/Edit Store Handler
  const addStoreBtn = document.getElementById('addStoreBtn');
  if (addStoreBtn) {
    addStoreBtn.addEventListener('click', () => {
      openStoreModal();
    });
  }

  function openStoreModal(store = null) {
    const isEdit = !!store;
    const modalTitle = isEdit ? 'Editar Tienda' : 'Agregar Nueva Tienda';
    const btnText = isEdit ? 'Guardar Cambios' : 'Agregar Tienda';

    const modalHTML = `
      <div class="modal active">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${modalTitle}</h3>
            <button class="modal-close" onclick="closeModal()">&times;</button>
          </div>
          <form id="storeForm">
            <input type="hidden" name="id" value="${store?.id || ''}">
            <div class="form-group">
              <label class="form-label">Nombre de la Tienda</label>
              <input type="text" class="form-control" name="name" value="${store?.name || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Dirección</label>
              <textarea class="form-control" name="address" rows="3">${store?.address || ''}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo</label>
              <select class="form-control" name="type" required>
                <option value="tienda" ${store?.type === 'tienda' ? 'selected' : ''}>Tienda</option>
                <option value="bodega" ${store?.type === 'bodega' ? 'selected' : ''}>Bodega</option>
              </select>
            </div>
            ${isEdit ? `
            <div class="form-group">
                <label class="form-label">Estado</label>
                <select class="form-control" name="is_active">
                    <option value="true" ${store?.is_active !== false ? 'selected' : ''}>Activa</option>
                    <option value="false" ${store?.is_active === false ? 'selected' : ''}>Inactiva</option>
                </select>
            </div>
            ` : ''}
            <div class="d-flex gap-2 justify-between">
              <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
              <button type="submit" class="btn btn-primary">${btnText}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('modalContainer').innerHTML = modalHTML;

    document.getElementById('storeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const storeId = formData.get('id');

      const storeData = {
        name: formData.get('name'),
        address: formData.get('address'),
        type: formData.get('type'),
        organization_id: currentUser.organization_id
      };

      if (formData.has('is_active')) {
        storeData.is_active = formData.get('is_active') === 'true';
      }

      try {
        let error;
        if (storeId) {
          // Update existing
          const result = await supabaseClient
            .from('stores')
            .update(storeData)
            .eq('id', storeId);
          error = result.error;
        } else {
          // Create new
          const result = await supabaseClient
            .from('stores')
            .insert(storeData);
          error = result.error;
        }

        if (error) throw error;

        closeModal();
        showToast(storeId ? 'Tienda actualizada correctamente' : 'Tienda agregada exitosamente', 'success');
        loadStores();
      } catch (error) {
        console.error('Error saving store:', error);
        showToast('Error al guardar tienda: ' + error.message, 'error');
      }
    });
  }

  // Expose openStoreModal to global scope for editStore
  window.openStoreModal = openStoreModal;

  function isMissingModulePermissionsColumn(error) {
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return error?.code === '42501' || text.includes('module_permissions') || text.includes('schema cache');
  }

  function getEmployeePermissionsStorageKey(employeeId) {
    return `employeeModulePermissions:${employeeId}`;
  }

  function getLocalEmployeePermissions(employeeId) {
    try {
      return JSON.parse(localStorage.getItem(getEmployeePermissionsStorageKey(employeeId)) || 'null');
    } catch (err) {
      return null;
    }
  }

  function setLocalEmployeePermissions(employeeId, permissions) {
    localStorage.setItem(getEmployeePermissionsStorageKey(employeeId), JSON.stringify(permissions));
  }

  async function fetchEmployeesForManagement() {
    let result = await supabaseClient
      .from('employees')
      .select(employeeSelectFields(true))
      .order('created_at', { ascending: false });

    if (result.error && isMissingModulePermissionsColumn(result.error)) {
      result = await supabaseClient
        .from('employees')
        .select(employeeSelectFields(false))
        .order('created_at', { ascending: false });
    }

    return result;
  }

  function getEmployeeEffectivePermissions(emp) {
    return normalizeModulePermissions(emp.module_permissions || getLocalEmployeePermissions(emp.id), emp.role);
  }

  function renderEmployeePermissionToggles(emp) {
    if (emp.role === 'admin') {
      return `
        <div class="employee-permissions-note">
          Este usuario es administrador y tiene acceso completo a todos los modulos.
        </div>
      `;
    }

    const permissions = getEmployeeEffectivePermissions(emp);
    return `
      <div class="employee-permissions-grid">
        ${EMPLOYEE_MODULES.map(mod => `
          <label class="module-permission-toggle">
            <input type="checkbox" data-employee-permission="${emp.id}" data-module-id="${mod.id}" ${permissions[mod.id] ? 'checked' : ''}>
            <span>${mod.label}</span>
          </label>
        `).join('')}
      </div>
      <div class="employee-permissions-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick="saveEmployeeModulePermissions('${emp.id}')">
          Guardar permisos
        </button>
      </div>
    `;
  }

  // Load Employees
  async function loadEmployees() {
    try {
      const { data: employees, error } = await fetchEmployeesForManagement();

      if (error) throw error;

      const tbody = document.getElementById('employeesTableBody');
      if (!employees || employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay empleados registrados</td></tr>';
        return;
      }

      window.currentEmployeesList = employees;

      tbody.innerHTML = employees.map(emp => `
        <tr>
          <td><strong>${emp.username}</strong></td>
          <td>
            <div style="display: flex; align-items: center; gap: 12px;">
              ${emp.avatar_url ? `
                <img src="${supabaseClient.storage.from('avatars').getPublicUrl(emp.avatar_url).data.publicUrl}" 
                     alt="${emp.full_name}" 
                     onclick="openImagePreview('${supabaseClient.storage.from('avatars').getPublicUrl(emp.avatar_url).data.publicUrl}')"
                     style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); flex-shrink: 0; cursor: zoom-in; transition: transform 0.2s;"
                     onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
              ` : `
                <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  👤
                </div>
              `}
              <span style="font-weight: 500;">${emp.full_name}</span>
            </div>
          </td>
          <td><span class="badge ${emp.role === 'admin' ? 'badge-error' : emp.role === 'bodeguero' ? 'badge-warning' : 'badge-success'}">${emp.role}</span></td>
          <td>${emp.assigned_store?.name ? `<span class="badge badge-info" style="background:#e0f2fe; color:#0369a1;">🏪 ${escapeHtml(emp.assigned_store.name)}</span>` : '<span class="text-muted" style="font-size:0.85rem;">Elige al iniciar sesión</span>'}</td>
          <td><span class="badge ${emp.is_active ? 'badge-success' : 'badge-error'}">${emp.is_active ? 'Activo' : 'Inactivo'}</span></td>
          <td>
            <div class="d-flex" style="gap: 8px;">
              ${isAdmin ? `<button class="btn btn-sm btn-secondary d-flex align-items-center justify-content-center" onclick="toggleEmployeePermissionsRow('${emp.id}')" title="Permisos" style="padding: 0 10px; height: 36px; border-radius: 8px; font-weight: 700;">Permisos</button>
              <button class="btn btn-sm btn-light border d-flex align-items-center justify-content-center" onclick="editEmployee('${emp.id}')" title="Editar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">✏️</button>
              ${emp.id !== currentUser.id ? `<button class="btn btn-sm btn-danger d-flex align-items-center justify-content-center" onclick="deleteEmployee('${emp.id}')" title="Eliminar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🗑️</button>` : ''}` : '<span class="text-muted">Solo lectura</span>'}
            </div>
          </td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('Error loading employees:', error);
      const tbody = document.getElementById('employeesTableBody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No se pudieron cargar empleados. Revisa permisos de Supabase.</td></tr>';
      }
      showToast('Error al cargar empleados: ' + error.message, 'error');
    }
  }

  window.toggleEmployeePermissionsRow = function (employeeId) {
    let row = document.getElementById(`employeePermissionsRow-${employeeId}`);
    if (!row) {
      const emp = (window.currentEmployeesList || []).find(item => item.id === employeeId);
      const trigger = document.querySelector(`button[onclick="toggleEmployeePermissionsRow('${employeeId}')"]`);
      const hostRow = trigger?.closest('tr');
      if (!emp || !hostRow) return;

      hostRow.insertAdjacentHTML('afterend', `
        <tr class="employee-permissions-row" id="employeePermissionsRow-${employeeId}">
          <td colspan="6">
            <div class="employee-permissions-panel">
              <div class="employee-permissions-header">
                <div>
                  <strong>Modulos permitidos</strong>
                  <p>Selecciona los modulos que ${emp.full_name} puede usar en el panel.</p>
                </div>
              </div>
              ${renderEmployeePermissionToggles(emp)}
            </div>
          </td>
        </tr>
      `);
      row = document.getElementById(`employeePermissionsRow-${employeeId}`);
    }
    if (!row) return;
    row.classList.toggle('active');
  };

  window.saveEmployeeModulePermissions = async function (employeeId) {
    if (!requireAdminAction('administrar permisos de empleados')) return;

    const inputs = Array.from(document.querySelectorAll(`[data-employee-permission="${employeeId}"]`));
    if (inputs.length === 0) {
      showToast('Los administradores ya tienen acceso completo', 'info');
      return;
    }

    const permissions = {};
    EMPLOYEE_MODULES.forEach(mod => {
      const input = inputs.find(item => item.dataset.moduleId === mod.id);
      permissions[mod.id] = input ? input.checked : false;
    });

    try {
      const { error } = await supabaseClient
        .from('employees')
        .update({ module_permissions: permissions, updated_at: new Date().toISOString() })
        .eq('id', employeeId);

      if (error) throw error;

      setLocalEmployeePermissions(employeeId, permissions);
      if (permissions.inventory !== true) {
        await window.electronAPI?.revokeInventoryCountLinksForEmployee?.(employeeId);
      }
      showToast('Permisos guardados correctamente', 'success');
      if (employeeId === currentUser.id) {
        currentUser.module_permissions = permissions;
        currentUserPermissions = normalizeModulePermissions(permissions, currentUser.role);
        localStorage.setItem('userData', JSON.stringify(currentUser));
        applyModuleAccessToSidebar();
      }
    } catch (error) {
      console.error('Error saving employee permissions:', error);
      if (isMissingModulePermissionsColumn(error)) {
        setLocalEmployeePermissions(employeeId, permissions);
        if (permissions.inventory !== true) {
          await window.electronAPI?.revokeInventoryCountLinksForEmployee?.(employeeId);
        }
        showToast('Permisos guardados en este equipo. Falta aplicar la actualizacion SQL para guardarlos en Supabase.', 'warning');
        return;
      }
      showToast('Error al guardar permisos: ' + error.message, 'error');
    }
  };

  // Add/Edit Employee Handler
  const addEmployeeBtn = document.getElementById('addEmployeeBtn');
  if (addEmployeeBtn) {
    if (!isAdmin) {
      addEmployeeBtn.style.display = 'none';
    }
    addEmployeeBtn.addEventListener('click', () => {
      openEmployeeModal();
    });
  }

  async function openEmployeeModal(employee = null) {
    if (!isAdmin) {
      showToast('Solo el administrador puede editar empleados', 'error');
      return;
    }

    const isEdit = !!employee;
    const modalTitle = isEdit ? 'Editar Empleado' : 'Agregar Nuevo Empleado';
    const btnText = isEdit ? 'Guardar Cambios' : 'Agregar Empleado';

    // Tiendas activas para la asignación
    let assignableStores = [];
    try {
      const { data: storesData, error: storesError } = await supabaseClient
        .from('stores')
        .select('id, name, type')
        .eq('is_active', true)
        .order('name');
      if (storesError) throw storesError;
      assignableStores = storesData || [];
    } catch (err) {
      console.warn('No se pudieron cargar tiendas para asignación:', err);
    }

    const modalHTML = `
      <div class="modal active">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${modalTitle}</h3>
            <button class="modal-close" onclick="closeModal()">&times;</button>
          </div>
          <form id="employeeForm">
            <input type="hidden" name="id" value="${employee?.id || ''}">
            <div class="form-group">
              <label class="form-label">Nombre Completo</label>
              <input type="text" class="form-control" name="full_name" value="${employee?.full_name || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Usuario</label>
              <input type="text" class="form-control" name="username" value="${employee?.username || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">${isEdit ? 'Contraseña (dejar vacía para mantener actual)' : 'Contraseña'}</label>
              <div class="password-wrapper">
                <input type="password" class="form-control" name="password" id="employeePassword" ${isEdit ? '' : 'required'}>
                <button type="button" class="toggle-password" onclick="togglePasswordVisibility('employeePassword', this)" tabindex="-1">👁️</button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Rol</label>
              <select class="form-control" name="role" required>
                <option value="empleado" ${employee?.role === 'empleado' ? 'selected' : ''}>Empleado</option>
                <option value="bodeguero" ${employee?.role === 'bodeguero' ? 'selected' : ''}>Bodeguero</option>
                <option value="admin" ${employee?.role === 'admin' ? 'selected' : ''}>Administrador</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tienda Asignada</label>
              <select class="form-control" name="assigned_store_id">
                <option value="">Sin asignar (elige tienda al iniciar sesión)</option>
                ${assignableStores.map(store => `
                  <option value="${store.id}" ${employee?.assigned_store_id === store.id ? 'selected' : ''}>
                    ${store.type === 'bodega' ? '📦' : '🏪'} ${escapeHtml(store.name)}
                  </option>
                `).join('')}
              </select>
              <small class="text-muted" style="display:block; margin-top:4px;">
                Con tienda asignada, el empleado entra directo a esa tienda al iniciar sesión. Los administradores siempre eligen tienda.
              </small>
            </div>
            ${isEdit ? `
            <div class="form-group">
                <label class="form-label">Estado</label>
                <select class="form-control" name="is_active">
                    <option value="true" ${employee?.is_active !== false ? 'selected' : ''}>Activo</option>
                    <option value="false" ${employee?.is_active === false ? 'selected' : ''}>Inactivo</option>
                </select>
            </div>
            ` : ''}
            <div class="d-flex gap-2 justify-between">
              <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
              <button type="submit" class="btn btn-primary">${btnText}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('modalContainer').innerHTML = modalHTML;

    document.getElementById('employeeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const employeeId = formData.get('id');

      const employeeData = {
        username: formData.get('username'),
        full_name: formData.get('full_name'),
        role: formData.get('role'),
        organization_id: currentUser.organization_id,
        assigned_store_id: formData.get('assigned_store_id') || null
      };

      // Handle password update only if provided
      const password = formData.get('password');
      if (password && password.trim() !== '') {
        employeeData.password = password.trim();
      }

      if (formData.has('is_active')) {
        employeeData.is_active = formData.get('is_active') === 'true';
      }

      try {
        let error;
        if (employeeId) {
          // Update existing
          const { error: updateError } = await supabaseClient
            .from('employees')
            .update(employeeData)
            .eq('id', employeeId);
          error = updateError;
        } else {
          // Create new
          const { error: insertError } = await supabaseClient
            .from('employees')
            .insert(employeeData);
          error = insertError;
        }

        if (error) throw error;

        closeModal();
        showToast(employeeId ? 'Empleado actualizado correctamente' : 'Empleado agregado exitosamente', 'success');
        loadEmployees();
      } catch (error) {
        console.error('Error saving employee:', error);
        showToast('Error al guardar empleado: ' + error.message, 'error');
      }
    });
  }

  // Expose openEmployeeModal to global scope
  window.openEmployeeModal = openEmployeeModal;

  // --- BRAND PROFIT MODULE ---
  // Analisis de % de ganancia por marca, calculado sobre el precio de compra (cost_price).
  let brandProfitBrands = [];
  let brandProfitSelectedBrand = null;
  let brandProfitProducts = [];
  let brandProfitMode = 'retail'; // 'retail' | 'wholesale' | 'distributor'
  let brandProfitChartInstance = null;
  let brandProfitInitialized = false;
  let brandProfitProductFilter = '';

  const BRAND_PROFIT_MODE_INFO = {
    retail: { label: 'Menudeo', field: 'retail_price' },
    wholesale: { label: 'Mayoreo', field: 'wholesale_price' },
    distributor: { label: 'Distribuidor', field: 'distributor_price' }
  };

  async function loadBrandProfit() {
    if (!brandProfitInitialized) {
      setupBrandProfitListeners();
      brandProfitInitialized = true;
    }

    try {
      const { data: brands, error } = await supabaseClient
        .from('brands')
        .select('id, name')
        .order('name');

      if (error) throw error;

      // Deduplicar por nombre (pueden existir marcas repetidas con distinta capitalizacion)
      brandProfitBrands = Array.from(
        new Map((brands || []).map(b => [String(b.name || '').trim().toLowerCase(), b])).values()
      ).filter(b => (b.name || '').trim() !== '');
    } catch (error) {
      console.error('Error loading brands for profit analysis:', error);
      showToast('Error al cargar marcas: ' + error.message, 'error');
    }
  }

  function setupBrandProfitListeners() {
    const searchInput = document.getElementById('brandProfitSearch');
    const suggestions = document.getElementById('brandProfitSuggestions');
    if (!searchInput || !suggestions) return;

    searchInput.addEventListener('input', () => {
      renderBrandProfitSuggestions(searchInput.value.trim().toLowerCase());
    });
    searchInput.addEventListener('focus', () => {
      renderBrandProfitSuggestions(searchInput.value.trim().toLowerCase());
    });
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !suggestions.contains(e.target)) {
        suggestions.style.display = 'none';
      }
    });

    document.querySelectorAll('.brand-profit-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        brandProfitMode = btn.dataset.profitMode;
        renderBrandProfitResults();
      });
    });

    // Buscador de productos dentro de la marca
    const productSearch = document.getElementById('brandProfitProductSearch');
    if (productSearch) {
      productSearch.addEventListener('input', () => {
        brandProfitProductFilter = productSearch.value.trim().toLowerCase();
        renderBrandProfitResults();
      });
    }

    // Ajuste de precios de toda la marca (solo admin)
    const adjustBtn = document.getElementById('brandPriceAdjustBtn');
    if (adjustBtn) {
      adjustBtn.addEventListener('click', applyBrandPriceAdjustment);
    }
  }

  function renderBrandProfitSuggestions(term) {
    const suggestions = document.getElementById('brandProfitSuggestions');
    const matches = (term
      ? brandProfitBrands.filter(b => b.name.toLowerCase().includes(term))
      : brandProfitBrands
    ).slice(0, 30);

    if (matches.length === 0) {
      suggestions.innerHTML = '<div style="padding:12px 16px; color:#6b7280; font-size:0.85rem;">No se encontraron marcas</div>';
      suggestions.style.display = 'block';
      return;
    }

    suggestions.innerHTML = matches.map(b => `
      <div class="brand-profit-suggestion" data-brand-id="${b.id}"
        style="padding:10px 16px; cursor:pointer; font-size:0.9rem; border-bottom:1px solid #f1f5f9;"
        onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='white'">
        🏷️ ${escapeHtml(b.name)}
      </div>
    `).join('');
    suggestions.style.display = 'block';

    suggestions.querySelectorAll('.brand-profit-suggestion').forEach(item => {
      item.addEventListener('click', () => {
        const brand = brandProfitBrands.find(b => b.id === item.dataset.brandId);
        if (brand) selectBrandForProfit(brand);
      });
    });
  }

  async function selectBrandForProfit(brand, { resetFilter = true } = {}) {
    brandProfitSelectedBrand = brand;
    document.getElementById('brandProfitSearch').value = brand.name;
    document.getElementById('brandProfitSuggestions').style.display = 'none';

    if (resetFilter) {
      brandProfitProductFilter = '';
      const productSearch = document.getElementById('brandProfitProductSearch');
      if (productSearch) productSearch.value = '';
    }

    try {
      const { data: products, error } = await supabaseClient
        .from('products')
        .select('id, name, barcode, cost_price, retail_price, wholesale_price, distributor_price')
        .eq('brand_id', brand.id)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      brandProfitProducts = products || [];
      document.getElementById('brandProfitResults').style.display = 'block';
      document.getElementById('brandPriceAdjustCard').style.display = isAdmin ? 'block' : 'none';
      renderBrandProfitResults();
    } catch (error) {
      console.error('Error loading brand products:', error);
      showToast('Error al cargar productos de la marca: ' + error.message, 'error');
    }
  }

  async function applyBrandPriceAdjustment() {
    if (!requireAdminAction('ajustar precios de una marca')) return;
    if (!brandProfitSelectedBrand) return;

    const input = document.getElementById('brandPriceAdjustInput');
    const pct = parseFloat(input.value);

    if (isNaN(pct) || pct === 0) {
      showToast('Indica un porcentaje distinto de cero (ej. 5 o -5)', 'error');
      return;
    }
    if (pct <= -100 || pct > 500) {
      showToast('El porcentaje debe estar entre -99 y 500', 'error');
      return;
    }

    const direction = pct > 0 ? 'SUBIRÁN' : 'BAJARÁN';
    const confirmed = confirm(
      `Todos los precios (compra, menudeo, mayoreo y distribuidor) de los ${brandProfitProducts.length} producto(s) activos de "${brandProfitSelectedBrand.name}" ${direction} un ${Math.abs(pct)}%.\n\nEste cambio se guarda de inmediato. ¿Continuar?`
    );
    if (!confirmed) return;

    const btn = document.getElementById('brandPriceAdjustBtn');
    btn.disabled = true;
    btn.textContent = 'Aplicando...';

    try {
      const { data: updatedCount, error } = await supabaseClient
        .rpc('adjust_brand_prices', {
          p_brand_id: brandProfitSelectedBrand.id,
          p_percent: pct
        });

      if (error) throw error;

      input.value = '';
      showToast(`Precios de ${updatedCount} producto(s) ${pct > 0 ? 'aumentados' : 'reducidos'} un ${Math.abs(pct)}%`, 'success');
      // Recargar productos para reflejar los nuevos precios (mantiene el filtro de búsqueda)
      await selectBrandForProfit(brandProfitSelectedBrand, { resetFilter: false });
    } catch (error) {
      console.error('Error adjusting brand prices:', error);
      showToast('Error al ajustar precios: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Aplicar a toda la marca';
    }
  }

  // % de ganancia sobre precio de compra: (venta - compra) / compra * 100
  function computeBrandProfitPct(product, mode) {
    const cost = parseFloat(product.cost_price || 0);
    const price = parseFloat(product[BRAND_PROFIT_MODE_INFO[mode].field] || 0);
    if (!(cost > 0) || !(price > 0)) return null;
    return ((price - cost) / cost) * 100;
  }

  function renderBrandProfitResults() {
    if (!brandProfitSelectedBrand) return;
    const modeInfo = BRAND_PROFIT_MODE_INFO[brandProfitMode];

    // Toggle activo
    document.querySelectorAll('.brand-profit-mode-btn').forEach(btn => {
      const active = btn.dataset.profitMode === brandProfitMode;
      btn.style.background = active ? 'white' : 'transparent';
      btn.style.color = active ? '#16a34a' : 'white';
    });

    document.getElementById('brandProfitTitle').textContent = `${brandProfitSelectedBrand.name} — Ganancia ${modeInfo.label}`;
    const subtitleEl = document.getElementById('brandProfitSubtitle');
    if (subtitleEl) {
      subtitleEl.textContent = `${brandProfitProducts.length} producto(s) activos · ganancia calculada sobre el precio de compra`;
    }
    document.getElementById('brandProfitPriceHeader').textContent = `Precio ${modeInfo.label}`;

    // Calcular margen por producto y ordenar de mayor a menor % (sin datos al final)
    const rows = brandProfitProducts.map(p => {
      const cost = parseFloat(p.cost_price || 0);
      const price = parseFloat(p[modeInfo.field] || 0);
      const pct = computeBrandProfitPct(p, brandProfitMode);
      return { product: p, cost, price, pct, profit: pct !== null ? price - cost : null };
    }).sort((a, b) => {
      if (a.pct === null && b.pct === null) return 0;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return b.pct - a.pct;
    });

    const withData = rows.filter(r => r.pct !== null);
    const avgPct = withData.length > 0
      ? withData.reduce((sum, r) => sum + r.pct, 0) / withData.length
      : 0;

    renderBrandProfitChart(avgPct);

    // Stats laterales
    const fmtMoney = v => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const best = withData[0];
    const worst = withData[withData.length - 1];
    document.getElementById('brandProfitStats').innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:10px 14px;">
        <div style="font-size:0.72rem; font-weight:700; color:#166534; text-transform:uppercase;">Productos analizados</div>
        <div style="font-size:1.15rem; font-weight:800; color:#16a34a;">${withData.length} de ${brandProfitProducts.length}</div>
      </div>
      ${best ? `
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px;">
        <div style="font-size:0.72rem; font-weight:700; color:#475569; text-transform:uppercase;">Mayor ganancia</div>
        <div style="font-size:0.88rem; font-weight:600;">${escapeHtml(best.product.name)}</div>
        <div style="font-size:0.95rem; font-weight:800; color:#16a34a;">${best.pct.toFixed(1)}%</div>
      </div>` : ''}
      ${worst && worst !== best ? `
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px;">
        <div style="font-size:0.72rem; font-weight:700; color:#475569; text-transform:uppercase;">Menor ganancia</div>
        <div style="font-size:0.88rem; font-weight:600;">${escapeHtml(worst.product.name)}</div>
        <div style="font-size:0.95rem; font-weight:800; color:${worst.pct < 0 ? '#dc2626' : '#d97706'};">${worst.pct.toFixed(1)}%</div>
      </div>` : ''}
      ${brandProfitProducts.length > withData.length ? `
      <div style="font-size:0.76rem; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:8px 12px;">
        ⚠️ ${brandProfitProducts.length - withData.length} producto(s) sin precio de compra o de venta registrado.
      </div>` : ''}
    `;

    // Lista de productos (con filtro de búsqueda; la gráfica y stats siguen siendo de toda la marca)
    const filteredRows = brandProfitProductFilter
      ? rows.filter(r =>
        r.product.name.toLowerCase().includes(brandProfitProductFilter) ||
        (r.product.barcode || '').toLowerCase().includes(brandProfitProductFilter))
      : rows;

    const tbody = document.getElementById('brandProfitTableBody');
    if (filteredRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">${brandProfitProductFilter
        ? 'Ningún producto coincide con la búsqueda'
        : 'Esta marca no tiene productos activos'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filteredRows.map((r, idx) => {
      const pctBadge = r.pct === null
        ? '<span class="text-muted" style="font-size:0.82rem;">Sin datos</span>'
        : `<span style="font-weight:800; padding:3px 10px; border-radius:8px; font-size:0.85rem; ${r.pct >= 50 ? 'background:#dcfce7; color:#166534;'
          : r.pct >= 20 ? 'background:#fef9c3; color:#854d0e;'
            : r.pct >= 0 ? 'background:#ffedd5; color:#9a3412;'
              : 'background:#fee2e2; color:#991b1b;'}">${r.pct.toFixed(1)}%</span>`;
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>
            <div style="font-weight:600;">${escapeHtml(r.product.name)}</div>
            ${r.product.barcode ? `<small class="text-muted">${escapeHtml(r.product.barcode)}</small>` : ''}
          </td>
          <td>${r.cost > 0 ? fmtMoney(r.cost) : '<span class="text-muted">—</span>'}</td>
          <td>${r.price > 0 ? fmtMoney(r.price) : '<span class="text-muted">—</span>'}</td>
          <td>${r.profit !== null ? `<span style="font-weight:600; color:${r.profit >= 0 ? '#16a34a' : '#dc2626'};">${fmtMoney(r.profit)}</span>` : '<span class="text-muted">—</span>'}</td>
          <td>${pctBadge}</td>
        </tr>
      `;
    }).join('');
  }

  function renderBrandProfitChart(avgPct) {
    const canvas = document.getElementById('brandProfitChart');
    if (!canvas) return;

    const avgText = document.getElementById('brandProfitAvgText');
    avgText.textContent = `${avgPct.toFixed(1)}%`;
    avgText.style.color = avgPct >= 0 ? '#16a34a' : '#dc2626';

    // Medidor: la porcion llena representa el % promedio (tope visual en 100%)
    const fill = Math.max(0, Math.min(avgPct, 100));
    const fillColor = avgPct < 0 ? '#dc2626' : avgPct < 20 ? '#f59e0b' : '#16a34a';

    if (brandProfitChartInstance) {
      brandProfitChartInstance.destroy();
    }

    brandProfitChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Ganancia promedio', ''],
        datasets: [{
          data: [fill, 100 - fill],
          backgroundColor: [fillColor, '#e5e7eb'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '74%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          datalabels: { display: false }
        }
      }
    });
  }

  // --- CONFIG MODULE ---
  // Tema (por equipo, localStorage), impresora (por equipo, main process) y
  // diseño de ticket (por tienda, stores.settings.ticket en Supabase).

  window.setAppTheme = function (theme) {
    const dark = theme === 'dark';
    document.documentElement.classList.toggle('dark-mode', dark);
    localStorage.setItem('appTheme', dark ? 'dark' : 'light');
    updateThemeButtons();
  };

  function updateThemeButtons() {
    const dark = document.documentElement.classList.contains('dark-mode');
    const lightBtn = document.getElementById('themeLightBtn');
    const darkBtn = document.getElementById('themeDarkBtn');
    if (!lightBtn || !darkBtn) return;
    lightBtn.style.borderColor = dark ? 'var(--border)' : 'var(--primary)';
    lightBtn.style.boxShadow = dark ? 'none' : '0 0 0 3px rgba(90,158,47,0.25)';
    darkBtn.style.borderColor = dark ? 'var(--primary)' : 'var(--border)';
    darkBtn.style.boxShadow = dark ? '0 0 0 3px rgba(90,158,47,0.25)' : 'none';
  }

  async function loadConfigSection() {
    updateThemeButtons();
    setupTicketConfigPreview();

    // Impresoras de este equipo
    const printerSelect = document.getElementById('configPrinterSelect');
    if (printerSelect && window.electronAPI?.listPrinters) {
      printerSelect.innerHTML = '<option value="">Cargando impresoras...</option>';
      try {
        const { printers, selected } = await window.electronAPI.listPrinters();
        if (!printers.length) {
          printerSelect.innerHTML = '<option value="">No se detectaron impresoras</option>';
        } else {
          printerSelect.innerHTML = printers.map(p =>
            `<option value="${escapeHtml(p.name)}" ${p.name === selected ? 'selected' : ''}>${escapeHtml(p.name)}${p.isDefault ? ' (predeterminada de Windows)' : ''}</option>`
          ).join('');
        }
      } catch (err) {
        console.error('Error listando impresoras:', err);
        printerSelect.innerHTML = '<option value="">Error al listar impresoras</option>';
      }
    } else if (printerSelect) {
      printerSelect.innerHTML = '<option value="">Disponible solo en la app de escritorio</option>';
    }

    // Tiendas para el diseño de ticket
    const storeSelect = document.getElementById('configTicketStore');
    if (storeSelect) {
      try {
        const { data: stores, error } = await supabaseClient
          .from('stores')
          .select('id, name, settings')
          .eq('is_active', true)
          .order('name');
        if (error) throw error;

        window.__configStoresCache = stores || [];
        const currentStoreId = getSelectedLoginStoreIdSafe();
        storeSelect.innerHTML = (stores || []).map(s =>
          `<option value="${s.id}" ${s.id === currentStoreId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
        ).join('');
        onConfigTicketStoreChange();
      } catch (err) {
        console.error('Error cargando tiendas para config:', err);
        storeSelect.innerHTML = '<option value="">Error al cargar tiendas</option>';
      }
    }
  }

  function getSelectedLoginStoreIdSafe() {
    try {
      const raw = localStorage.getItem('selectedStore');
      return raw ? JSON.parse(raw).id : null;
    } catch (err) {
      return null;
    }
  }

  window.onConfigTicketStoreChange = function () {
    const storeSelect = document.getElementById('configTicketStore');
    const store = (window.__configStoresCache || []).find(s => s.id === storeSelect?.value);
    const cfg = { ...DEFAULT_TICKET_CONFIG, ...(store?.settings?.ticket || {}) };
    document.getElementById('configTicketPaper').value = String(cfg.paperWidth);
    document.getElementById('configTicketWidth').value = cfg.printWidthMm;
    document.getElementById('configTicketFont').value = cfg.fontSize;
    document.getElementById('configTicketHeaderTitle').value = cfg.headerTitle;
    document.getElementById('configTicketHeader1').value = cfg.headerLine1;
    document.getElementById('configTicketHeader2').value = cfg.headerLine2;
    document.getElementById('configTicketMarginHorizontal').value = cfg.marginHorizontalMm;
    document.getElementById('configTicketMarginVertical').value = cfg.marginVerticalMm;
    document.getElementById('configTicketShowFolio').checked = cfg.showFolio;
    document.getElementById('configTicketShowDateTime').checked = cfg.showDateTime;
    document.getElementById('configTicketShowCustomer').checked = cfg.showCustomer;
    document.getElementById('configTicketShowCashier').checked = cfg.showCashier;
    document.getElementById('configTicketFooter1').value = cfg.footerLine1;
    document.getElementById('configTicketFooter2').value = cfg.footerLine2;
    document.getElementById('configTicketFooter3').value = cfg.footerLine3;
    document.getElementById('configTicketCashierLabel').value = cfg.cashierLabel;
    renderTicketConfigPreview();
    const status = document.getElementById('configTicketStatus');
    if (status) status.textContent = store?.settings?.ticket ? 'Esta tienda ya tiene un diseño guardado.' : 'Esta tienda usa el diseño por defecto.';
  };

  window.onConfigPaperChange = function () {
    // Presets de ancho útil típico por tamaño de papel
    const paper = document.getElementById('configTicketPaper').value;
    document.getElementById('configTicketWidth').value = paper === '58' ? 48 : 72;
    renderTicketConfigPreview();
  };

  function readTicketConfigForm() {
    const paperWidth = parseInt(document.getElementById('configTicketPaper').value) || 80;
    let printWidthMm = parseInt(document.getElementById('configTicketWidth').value);
    let fontSize = parseInt(document.getElementById('configTicketFont').value);
    let marginHorizontalMm = parseFloat(document.getElementById('configTicketMarginHorizontal').value);
    let marginVerticalMm = parseFloat(document.getElementById('configTicketMarginVertical').value);
    if (isNaN(printWidthMm)) printWidthMm = paperWidth === 58 ? 48 : 72;
    if (isNaN(fontSize)) fontSize = 14;
    if (isNaN(marginHorizontalMm)) marginHorizontalMm = 2;
    if (isNaN(marginVerticalMm)) marginVerticalMm = 3;
    printWidthMm = Math.min(80, Math.max(35, printWidthMm));
    fontSize = Math.min(20, Math.max(9, fontSize));
    marginHorizontalMm = Math.min(10, Math.max(0, marginHorizontalMm));
    marginVerticalMm = Math.min(10, Math.max(0, marginVerticalMm));
    return {
      paperWidth,
      printWidthMm,
      fontSize,
      headerTitle: (document.getElementById('configTicketHeaderTitle').value || '').trim(),
      headerLine1: (document.getElementById('configTicketHeader1').value || '').trim(),
      headerLine2: (document.getElementById('configTicketHeader2').value || '').trim(),
      marginHorizontalMm,
      marginVerticalMm,
      showFolio: document.getElementById('configTicketShowFolio').checked,
      showDateTime: document.getElementById('configTicketShowDateTime').checked,
      showCustomer: document.getElementById('configTicketShowCustomer').checked,
      showCashier: document.getElementById('configTicketShowCashier').checked,
      footerLine1: (document.getElementById('configTicketFooter1').value || '').trim(),
      footerLine2: (document.getElementById('configTicketFooter2').value || '').trim(),
      footerLine3: (document.getElementById('configTicketFooter3').value || '').trim(),
      cashierLabel: (document.getElementById('configTicketCashierLabel').value || '').trim()
    };
  }

  function renderTicketConfigPreview() {
    const preview = document.getElementById('configTicketPreview');
    if (!preview) return;

    const cfg = readTicketConfigForm();
    const storeSelect = document.getElementById('configTicketStore');
    const storeName = storeSelect?.selectedOptions?.[0]?.textContent || 'Tienda';
    const now = new Date();
    const date = formatAppDateTime(now, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const time = formatAppDateTime(now, { hour: '2-digit', minute: '2-digit' });
    const rows = [
      { name: 'PRODUCTO DE PRUEBA 500 MG', quantity: 2, price: 89.50 },
      { name: 'SUPLEMENTO NATURAL 60 CAPS', quantity: 1, price: 215.00 }
    ].map(item => `<tr><td style="padding:4px 2px;">${item.name}</td><td style="text-align:center;padding:4px 2px;">${item.quantity}</td><td style="text-align:right;padding:4px 2px;">$${item.price.toFixed(2)}</td><td style="text-align:right;padding:4px 2px;">$${(item.quantity * item.price).toFixed(2)}</td></tr>`).join('');
    const subtotal = 394;
    const body = `
      ${buildTicketHeader({
        storeName,
        folio: 'VISTA PREVIA',
        date,
        time,
        customer: { name: 'CLIENTE DE PRUEBA', code: 'PRUEBA' }
      }, cfg)}
      <hr>
      <table>
        <thead><tr><th style="text-align:left;width:44%;">Descripcion</th><th style="text-align:center;width:10%;">Cant</th><th style="text-align:right;width:20%;">P.U.</th><th style="text-align:right;width:22%;">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <hr>
      <table>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Subtotal</td><td style="text-align:right;padding:3px 2px;">$${subtotal.toFixed(2)}</td></tr>
        <tr class="total-row"><td colspan="3" style="text-align:right;padding:4px 2px;">TOTAL</td><td style="text-align:right;padding:4px 2px;">$${subtotal.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Efectivo recibido</td><td style="text-align:right;padding:3px 2px;">$400.00</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Cambio</td><td style="text-align:right;padding:3px 2px;">$6.00</td></tr>
      </table>
      ${buildTicketFooter('Cajero de prueba', cfg)}`;

    preview.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getThermalTicketStyles('', cfg)}</style></head><body>${body}</body></html>`;
  }

  function setupTicketConfigPreview() {
    const fields = [
      'configTicketPaper', 'configTicketWidth', 'configTicketFont',
      'configTicketHeaderTitle', 'configTicketHeader1', 'configTicketHeader2',
      'configTicketMarginHorizontal', 'configTicketMarginVertical',
      'configTicketShowFolio', 'configTicketShowDateTime', 'configTicketShowCustomer',
      'configTicketShowCashier', 'configTicketFooter1', 'configTicketFooter2',
      'configTicketFooter3', 'configTicketCashierLabel'
    ];

    fields.forEach(id => {
      const field = document.getElementById(id);
      if (!field || field.dataset.ticketPreviewBound === 'true') return;
      field.addEventListener('input', renderTicketConfigPreview);
      field.addEventListener('change', renderTicketConfigPreview);
      field.dataset.ticketPreviewBound = 'true';
    });
  }

  window.saveDevicePrinter = async function () {
    if (!requireAdminAction('cambiar la impresora')) return;
    const printerSelect = document.getElementById('configPrinterSelect');
    if (!printerSelect?.value) { showToast('Selecciona una impresora', 'error'); return; }
    if (!window.electronAPI?.setPrinter) { showToast('Disponible solo en la app de escritorio', 'error'); return; }
    try {
      await window.electronAPI.setPrinter(printerSelect.value);
      showToast('Impresora guardada para este equipo', 'success');
    } catch (err) {
      showToast('Error al guardar impresora: ' + err.message, 'error');
    }
  };

  window.printTestTicket = async function () {
    const cfg = readTicketConfigForm();
    const storeSelect = document.getElementById('configTicketStore');
    const storeName = storeSelect?.selectedOptions?.[0]?.textContent || 'Tienda';
    const testDate = formatAppDateTime(new Date(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const testTime = formatAppDateTime(new Date(), { hour: '2-digit', minute: '2-digit' });
    const testItems = [
      { name: 'PRODUCTO X - PRUEBA', quantity: 2, unitPrice: 89.50 },
      { name: 'PRODUCTO Y - PRUEBA', quantity: 3, unitPrice: 42.75 },
      { name: 'PRODUCTO Z - PRUEBA', quantity: 1, unitPrice: 215.00 }
    ];
    const testSubtotal = testItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
    const testDiscount = 22.25;
    const testTotal = testSubtotal - testDiscount;
    const testReceived = 600;
    const testChange = testReceived - testTotal;
    const testRows = testItems.map(item => `
      <tr>
        <td style="padding:4px 2px;">${item.name}</td>
        <td style="text-align:center;padding:4px 2px;">${item.quantity}</td>
        <td style="text-align:right;padding:4px 2px;">$${item.unitPrice.toFixed(2)}</td>
        <td style="text-align:right;padding:4px 2px;">$${(item.quantity * item.unitPrice).toFixed(2)}</td>
      </tr>`).join('');
    const body = `
      ${buildTicketHeader({
        storeName,
        folio: 'TICKET DE PRUEBA',
        date: testDate,
        time: testTime,
        customer: { name: 'CLIENTE DE PRUEBA', code: 'PRUEBA' }
      }, cfg)}
      <hr>
      <table>
        <thead><tr>
          <th style="text-align:left;width:44%;">Descripción</th>
          <th style="text-align:center;width:10%;">Cant</th>
          <th style="text-align:right;width:20%;">P.U.</th>
          <th style="text-align:right;width:22%;">Total</th>
        </tr></thead>
        <tbody>${testRows}</tbody>
      </table>
      <hr>
      <table>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Subtotal</td><td style="text-align:right;padding:3px 2px;">$${testSubtotal.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Descuento</td><td style="text-align:right;padding:3px 2px;">-$${testDiscount.toFixed(2)}</td></tr>
        <tr class="total-row"><td colspan="3" style="text-align:right;padding:4px 2px;">TOTAL</td><td style="text-align:right;padding:4px 2px;">$${testTotal.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Efectivo recibido</td><td style="text-align:right;padding:3px 2px;">$${testReceived.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Cambio</td><td style="text-align:right;padding:3px 2px;">$${testChange.toFixed(2)}</td></tr>
      </table>
      ${buildTicketFooter('Ticket de prueba', cfg)}`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getThermalTicketStyles('', cfg)}</style></head><body>${body}</body></html>`;
    try {
      await printHtmlSilently(html);
      showToast('Ticket de prueba enviado a imprimir', 'success');
    } catch (err) {
      showToast('No se pudo imprimir: ' + err.message, 'error');
    }
  };

  window.saveTicketConfig = async function () {
    if (!requireAdminAction('configurar el ticket')) return;
    const storeSelect = document.getElementById('configTicketStore');
    const storeId = storeSelect?.value;
    if (!storeId) { showToast('Selecciona una tienda', 'error'); return; }

    const cfg = readTicketConfigForm();
    const store = (window.__configStoresCache || []).find(s => s.id === storeId);
    const newSettings = { ...(store?.settings || {}), ticket: cfg };

    try {
      const { error } = await supabaseClient
        .from('stores')
        .update({ settings: newSettings, updated_at: new Date().toISOString() })
        .eq('id', storeId);
      if (error) throw error;

      if (store) store.settings = newSettings;
      // Si es la tienda activa de este equipo, aplicar de inmediato a los tickets
      if (storeId === getSelectedLoginStoreIdSafe()) {
        window.__activeTicketConfig = cfg;
      }
      showToast('Diseño de ticket guardado para la tienda', 'success');
      const status = document.getElementById('configTicketStatus');
      if (status) status.textContent = 'Diseño guardado. Los tickets de esta tienda ya salen con esta configuración.';
    } catch (err) {
      console.error('Error guardando config de ticket:', err);
      showToast('Error al guardar: ' + err.message, 'error');
    }
  };

  // Carga la config de ticket de la tienda activa al iniciar el dashboard
  (async function loadActiveTicketConfig() {
    const storeId = getSelectedLoginStoreIdSafe();
    if (!storeId) return;
    try {
      const { data, error } = await supabaseClient
        .from('stores')
        .select('settings')
        .eq('id', storeId)
        .maybeSingle();
      if (!error && data?.settings?.ticket) {
        window.__activeTicketConfig = { ...DEFAULT_TICKET_CONFIG, ...data.settings.ticket };
      }
    } catch (err) {
      console.warn('No se pudo cargar la config de ticket de la tienda:', err);
    }
  })();

  // --- CUSTOMERS MODULE ---
  let globalCustomersList = [];

  async function loadCustomers() {
    try {
      const { data: customers, error } = await supabaseClient
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        // If table does not exist yet, we catch it and show empty state gracefully
        if (error.code === '42P01') {
          console.warn('Tabla customers no existe. Esperando creación SQL.');
          renderCustomersTable([]);
          return;
        }
        throw error;
      }
      globalCustomersList = customers || [];
      renderCustomersTable(globalCustomersList);

      const searchInput = document.getElementById('customerSearch');
      if (searchInput) {
        const newSearch = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearch, searchInput);
        newSearch.addEventListener('input', (e) => {
          const term = e.target.value.toLowerCase();
          const filtered = globalCustomersList.filter(c =>
            c.name.toLowerCase().includes(term) ||
            (c.customer_code && c.customer_code.toLowerCase().includes(term)) ||
            (c.identifier && c.identifier.toLowerCase().includes(term))
          );
          renderCustomersTable(filtered);
        });
      }

    } catch (error) {
      console.error('Error loading customers:', error);
      document.getElementById('customersTableBody').innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error cargando clientes. ¿Creaste la tabla en Supabase?</td></tr>';
    }
  }

  function renderCustomersTable(customers) {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;

    if (!customers || customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-4">No hay clientes registrados o falta crear la tabla de supabase.</td></tr>';
      return;
    }

    tbody.innerHTML = customers.map(c => `
      <tr>
        <td class="align-middle"><code style="background:#eef7ee; color:#2d6a2d; padding:4px 8px; border-radius:4px; font-weight:900;">${c.customer_code}</code></td>
        <td class="align-middle">
          <div style="display: flex; align-items: center; gap: 12px;">
            ${c.avatar_url ? `
              <img src="${supabaseClient.storage.from('avatars').getPublicUrl(c.avatar_url).data.publicUrl}" 
                   alt="${c.name}" 
                   onclick="openImagePreview('${supabaseClient.storage.from('avatars').getPublicUrl(c.avatar_url).data.publicUrl}')"
                   style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); flex-shrink: 0; cursor: zoom-in; transition: transform 0.2s;"
                   onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
            ` : `
              <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                👤
              </div>
            `}
            <div style="display: flex; flex-direction: column;">
                <strong>${c.name}</strong>
            </div>
          </div>
        </td>
        <td class="align-middle"><small class="text-muted">${c.identifier || 'N/A'}</small></td>
        <td class="align-middle">
           <span class="badge ${c.customer_type === 'especial' ? 'badge-warning' : c.customer_type === 'distribuidor' ? 'badge-error' : 'badge-info'}">${c.customer_type.toUpperCase()}</span>
           ${c.customer_type === 'especial' ? `<div style="font-size: 0.75rem; color: #b45309; margin-top:2px;"><strong>-${c.discount_percentage}% dto</strong></div>` : ''}
        </td>
        <td class="align-middle">
          <div class="d-flex" style="gap: 8px;">
            <button class="btn btn-sm btn-light border d-flex align-items-center justify-content-center" onclick="openCustomerModal('${c.id}')" title="Editar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">✏️</button>
            <button class="btn btn-sm btn-danger d-flex align-items-center justify-content-center" onclick="deleteCustomer('${c.id}')" title="Eliminar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // Generic Function to preview any image URL in the modal overlay
  window.openImagePreview = function (url) {
    const modal = document.getElementById('imagePreviewModal');
    const imgEl = document.getElementById('imagePreviewImg');
    if (modal && imgEl) {
      imgEl.style.transform = 'scale(0.9)'; // Reset scale for animation
      imgEl.src = url;
      modal.style.display = 'flex';
      // Minor delay to let the display:flex apply before triggering the scale transition
      setTimeout(() => {
        imgEl.style.transform = 'scale(1)';
      }, 10);
    }
  };

  const addCustomerBtn = document.getElementById('addCustomerBtn');
  if (addCustomerBtn) {
    addCustomerBtn.addEventListener('click', () => openCustomerModal());
  }

  const customerPhotoQrBtn = document.getElementById('btnCustomerPhotoQr');
  if (customerPhotoQrBtn && !customerPhotoQrBtn.hasAttribute('data-listener-attached')) {
    customerPhotoQrBtn.addEventListener('click', () => openCustomerPhotoQr());
    customerPhotoQrBtn.setAttribute('data-listener-attached', 'true');
  }

  if (window.electronAPI?.onCustomerPhotoUploaded && !window.__customerPhotoUploadListenerAttached) {
    window.electronAPI.onCustomerPhotoUploaded(({ customerId, avatarUrl }) => {
      const customer = globalCustomersList.find(c => c.id === customerId);
      if (customer) customer.avatar_url = avatarUrl;

      const openCustomerId = document.getElementById('customerId')?.value;
      if (openCustomerId === customerId) {
        setCustomerAvatarPreviewFromStorage(avatarUrl);
        hideCustomerPhotoQr();
      }

      showToast('Foto de cliente subida desde el celular', 'success');
      loadCustomers();
    });
    window.__customerPhotoUploadListenerAttached = true;
  }

  window.openCustomerModal = function (id = null) {
    const isEdit = !!id;
    const modal = document.getElementById('customerModal');
    document.getElementById('customerModalTitle').textContent = isEdit ? 'Editar Cliente' : 'Nuevo Cliente';
    document.getElementById('customerForm').reset();
    document.getElementById('customerId').value = id || '';
    resetCustomerAvatarSelection();
    hideCustomerPhotoQr();

    const qrButton = document.getElementById('btnCustomerPhotoQr');
    if (qrButton) {
      qrButton.style.display = isEdit ? 'inline-block' : 'none';
    }

    if (isEdit) {
      const customer = globalCustomersList.find(c => c.id === id);
      if (customer) {
        document.getElementById('customerCode').value = customer.customer_code;
        document.getElementById('customerName').value = customer.name;
        document.getElementById('customerIdentifier').value = customer.identifier || '';
        document.getElementById('customerAddress').value = customer.address || '';
        document.getElementById('customerType').value = customer.customer_type;
        document.getElementById('customerDiscount').value = customer.discount_percentage || 0;

        if (customer.avatar_url) {
          setCustomerAvatarPreviewFromStorage(customer.avatar_url);
        }
      }
    } else {
      document.getElementById('customerCode').value = '';
    }

    // Avatar preview logic setup (single event listener attachment)
    const avatarInput = document.getElementById('customerAvatarInput');
    if (!avatarInput.hasAttribute('data-listener-attached')) {
      avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const preview = document.getElementById('customerAvatarPreview');
            preview.src = e.target.result;
            preview.dataset.source = 'file';
            preview.style.display = 'block';
            document.getElementById('customerAvatarText').style.display = 'none';
          };
          reader.readAsDataURL(file);
        }
      });
      avatarInput.setAttribute('data-listener-attached', 'true');
    }

    window.handleCustomerTypeChange();
    modal.style.display = 'flex';
  };

  window.closeCustomerModal = function () {
    document.getElementById('customerModal').style.display = 'none';
    resetCustomerAvatarSelection();
    hideCustomerPhotoQr();
  };

  function resetCustomerAvatarSelection() {
    const preview = document.getElementById('customerAvatarPreview');
    const text = document.getElementById('customerAvatarText');
    const input = document.getElementById('customerAvatarInput');

    if (preview) {
      preview.removeAttribute('src');
      delete preview.dataset.source;
      preview.style.display = 'none';
    }
    if (text) text.style.display = 'block';
    if (input) input.value = '';
  }

  function setCustomerAvatarPreviewFromStorage(avatarUrl) {
    const { data } = supabaseClient.storage.from('avatars').getPublicUrl(avatarUrl);
    const preview = document.getElementById('customerAvatarPreview');
    const text = document.getElementById('customerAvatarText');
    if (!preview || !text) return;

    preview.src = `${data.publicUrl}${data.publicUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    preview.dataset.source = 'storage';
    preview.style.display = 'block';
    text.style.display = 'none';
  }

  function hideCustomerPhotoQr() {
    const container = document.getElementById('customerPhotoQrContainer');
    const image = document.getElementById('customerPhotoQrImage');
    const urlInput = document.getElementById('customerPhotoQrUrl');
    if (container) container.style.display = 'none';
    if (image) image.src = '';
    if (urlInput) urlInput.value = '';
  }

  window.openCustomerPhotoQr = async function () {
    const id = document.getElementById('customerId')?.value;
    const customer = globalCustomersList.find(c => c.id === id);
    if (!id || !customer) {
      showToast('Primero guarda el cliente para generar el QR', 'warning');
      return;
    }

    if (!window.electronAPI?.createCustomerPhotoUploadLink) {
      showToast('No se pudo crear el QR en esta version de la app', 'error');
      return;
    }

    const qrButton = document.getElementById('btnCustomerPhotoQr');
    const container = document.getElementById('customerPhotoQrContainer');
    const image = document.getElementById('customerPhotoQrImage');
    const urlInput = document.getElementById('customerPhotoQrUrl');

    try {
      if (qrButton) {
        qrButton.disabled = true;
        qrButton.textContent = 'Generando...';
      }

      const result = await window.electronAPI.createCustomerPhotoUploadLink({
        id: customer.id,
        name: customer.name
      });

      image.src = result.qrDataUrl;
      urlInput.value = result.url;
      container.style.display = 'block';
      showToast('QR listo para escanear', 'success');
    } catch (error) {
      console.error('Error creating customer photo QR:', error);
      showToast('Error al crear el QR de foto', 'error');
    } finally {
      if (qrButton) {
        qrButton.disabled = false;
        qrButton.textContent = 'QR Foto';
      }
    }
  };

  window.handleCustomerTypeChange = function () {
    const type = document.getElementById('customerType').value;
    const group = document.getElementById('customerDiscountGroup');
    group.style.display = type === 'especial' ? 'block' : 'none';
  };

  function generateAutoCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  window.saveCustomer = async function (e) {
    e.preventDefault();
    const form = document.getElementById('customerForm');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const id = document.getElementById('customerId').value;
    const isNew = !id;

    const customerData = {
      name: document.getElementById('customerName').value,
      identifier: document.getElementById('customerIdentifier').value,
      address: document.getElementById('customerAddress').value,
      customer_type: document.getElementById('customerType').value,
      discount_percentage: document.getElementById('customerType').value === 'especial' ? parseFloat(document.getElementById('customerDiscount').value || 0) : 0,
      organization_id: currentUser.organization_id
    };

    if (isNew) {
      customerData.customer_code = generateAutoCode();
    }

    try {
      // Handle Avatar Upload
      let finalAvatarFile = null;
      let finalFileName = null;

      const avatarInput = document.getElementById('customerAvatarInput');
      const avatarPreview = document.getElementById('customerAvatarPreview');
      // Only use a base64 preview captured in the current form session.
      const previewSrc = avatarPreview.getAttribute('src') || '';

      if (avatarInput.files.length > 0) {
        finalAvatarFile = avatarInput.files[0];
        const fileExt = finalAvatarFile.name.split('.').pop();
        finalFileName = `customer_${Date.now()}.${fileExt}`;
      } else if (avatarPreview.dataset.source === 'camera' && previewSrc.startsWith('data:image')) {
        // Convert base64 from canvas to Blob
        const fetchRes = await fetch(previewSrc);
        finalAvatarFile = await fetchRes.blob();
        finalFileName = `customer_${Date.now()}.png`; // Canvas default is png
      }

      if (finalAvatarFile && finalFileName) {
        const { error: uploadError } = await supabaseClient.storage
          .from('avatars')
          .upload(finalFileName, finalAvatarFile, { cacheControl: '3600', upsert: true });

        if (uploadError) throw uploadError;
        customerData.avatar_url = finalFileName;
      }

      let error;
      if (id) {
        // Find existing customer to ensure we don't accidentally blank out avatar_url
        // if a new one wasn't selected (though SQL UPDATE only updates provided fields)
        const { error: uErr } = await supabaseClient.from('customers').update(customerData).eq('id', id);
        error = uErr;
      } else {
        const { error: iErr, data } = await supabaseClient.from('customers').insert(customerData).select();
        error = iErr;
        if (!error && data && data.length > 0) {
          customerData.customer_code = data[0].customer_code;
        }
      }

      if (error) {
        if (error.code === '42P01') {
          showToast('Error: ¡Falta crear la tabla en Supabase! Ejecuta el comando SQL.', 'error');
        } else {
          throw error;
        }
        return;
      }

      closeCustomerModal();
      showToast(isNew ? 'Cliente creado. Código: ' + customerData.customer_code : 'Cliente actualizado', 'success');
      loadCustomers();
    } catch (err) {
      console.error('Save customer error:', err);
      showToast('Error al guardar cliente', 'error');
    }
  };

  window.deleteCustomer = async function (id) {
    if (!confirm('¿Estás seguro de eliminar este cliente? Esta acción no se puede deshacer.')) return;
    try {
      const { error } = await supabaseClient.from('customers').delete().eq('id', id);
      if (error) throw error;
      showToast('Cliente eliminado', 'success');
      loadCustomers();
    } catch (error) {
      console.error('Delete customer error:', error);
      showToast('Error al eliminar cliente', 'error');
    }
  };
  // --- END CUSTOMERS MODULE ---

  // Load Products
  // Load Products
  let globalProductsList = [];
  let currentProductPriceView = 'retail';
  const PRODUCT_INITIAL_RENDER_LIMIT = 150;
  const PRODUCT_SEARCH_RENDER_LIMIT = 350;
  const INVENTORY_INITIAL_RENDER_LIMIT = 180;
  const INVENTORY_SEARCH_RENDER_LIMIT = 350;

  function debounce(fn, delay = 120) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  window.loadProducts = async function loadProducts() {
    try {
      const allProducts = await getCachedFullProducts();

      globalProductsList = allProducts;
      window.globalProductsList = allProducts;

      // Setup price filter listener
      const filter = document.getElementById('productPriceFilter');
      if (filter) {
        const newFilter = filter.cloneNode(true);
        filter.parentNode.replaceChild(newFilter, filter);

        if (!isAdmin) {
          newFilter.querySelector('option[value="buy"]')?.remove();
          if (currentProductPriceView === 'buy') currentProductPriceView = 'retail';
        }

        newFilter.addEventListener('change', (e) => {
          currentProductPriceView = e.target.value;
          renderProductsTable();
        });
        newFilter.value = currentProductPriceView;
      }

      // Setup search listener
      const searchInput = document.getElementById('productSearch');
      if (searchInput) {
        const newSearch = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearch, searchInput);
        newSearch.addEventListener('input', debounce(() => renderProductsTable(), 120));
      }

      renderProductsTable();

    } catch (error) {
      console.error('Error loading products:', error);
      // showToast('Error cargando productos', 'error');
    }
  }

  function renderProductsTable() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (!globalProductsList || globalProductsList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-4">No hay productos registrados</td></tr>';
      return;
    }

    const searchTerm = document.getElementById('productSearch')?.value.toLowerCase() || '';

    let filtered = globalProductsList;
    if (searchTerm) {
      filtered = globalProductsList.filter(p =>
        p.name.toLowerCase().includes(searchTerm) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchTerm)) ||
        (p.brand?.name && p.brand.name.toLowerCase().includes(searchTerm))
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-4">No se encontraron productos</td></tr>';
      return;
    }

    const renderLimit = searchTerm ? PRODUCT_SEARCH_RENDER_LIMIT : PRODUCT_INITIAL_RENDER_LIMIT;
    const visibleRows = filtered.slice(0, renderLimit);
    const limitNotice = filtered.length > visibleRows.length
      ? `<tr><td colspan="6" class="text-center text-muted p-3" style="background:#f8fafc;">
          Mostrando ${visibleRows.length} de ${filtered.length} productos. Usa la búsqueda para filtrar más rápido.
        </td></tr>`
      : '';

    tbody.innerHTML = limitNotice + visibleRows.map(product => {
      let priceValue = 0;
      let priceLabel = '';

      switch (currentProductPriceView) {
        case 'wholesale':
          priceValue = product.wholesale_price;
          priceLabel = 'Mayoreo';
          break;
        case 'distributor':
          priceValue = product.distributor_price;
          priceLabel = 'Distrib.';
          break;
        case 'buy':
          priceValue = product.cost_price;
          priceLabel = 'Costo';
          break;
        case 'retail':
        default:
          priceValue = product.retail_price;
          priceLabel = 'Menudeo';
          break;
      }

      const formattedPrice = parseFloat(priceValue || 0).toFixed(2);
      const costPrice = parseFloat(product.cost_price || 0).toFixed(2);
      const productId = escapeHtml(product.id);
      const productName = escapeHtml(product.name);
      const barcode = escapeHtml(product.barcode || 'N/A');
      const brandName = escapeHtml(product.brand?.name || 'Sin marca');
      const categoryName = escapeHtml(product.category?.name || 'Sin categoría');

      return `
        <tr>
          <td class="align-middle"><code>${barcode}</code></td>
          <td class="align-middle"><strong>${productName}</strong></td>
          <td class="align-middle">${brandName}</td>
          <td class="align-middle"><span class="badge badge-info">${categoryName}</span></td>
          <td class="align-middle">
            <div class="d-flex flex-column" style="gap: 2px;">
                <span class="text-success" style="font-weight: bold; font-size: 1.05rem;">
                    $${formattedPrice} <small class="text-muted">(${priceLabel})</small>
                </span>
                ${isAdmin && currentProductPriceView !== 'buy' ? `<small class="text-muted" style="font-size: 0.8rem;">C: $${costPrice}</small>` : ''}
            </div>
          </td>
          <td class="align-middle">
             <div class="d-flex" style="gap: 8px;">
              <button class="btn btn-sm btn-light border d-flex align-items-center justify-content-center" onclick="openStockDistributionModal('${productId}', '${productName}')" title="Distribuir Stock" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">📦</button>
              <button class="btn btn-sm btn-white border d-flex align-items-center justify-content-center" onclick="editProduct('${productId}')" title="Editar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">✏️</button>
              <button class="btn btn-sm btn-danger d-flex align-items-center justify-content-center" onclick="deleteProduct('${productId}')" title="Eliminar" style="padding: 0; width: 36px; height: 36px; border-radius: 8px; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🗑️</button>
            </div>
          </td>
        </tr>
      `}).join('');
  }

  // Gestionar Stock por Tienda (Modal de Distribución)
  // Gestionar Stock por Tienda (Modal de Distribución)
  window.openStockDistributionModal = async (productId, productName) => {
    try {
      showToast('Cargando inventario...', 'info');

      const stores = await getCachedActiveStores();

      if (!stores || stores.length === 0) {
        showToast('No hay tiendas activas para asignar stock', 'warning');
        return;
      }

      const inventory = await getCachedProductInventory(productId);

      const stockMap = {};
      if (inventory) {
        inventory.forEach(i => stockMap[i.store_id] = i.quantity);
      }

      const modalHTML = `
        <div class="modal active" id="stockModal" style="display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);">
          <div class="modal-content" style="max-width: 600px; width: 95%; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header bg-info text-white p-3" style="display: flex; justify-content: space-between; align-items: center;">
              <h3 class="m-0" style="color: white;">📦 Distribuir: ${productName}</h3>
              <button class="modal-close text-white" onclick="document.getElementById('stockModal').remove()" style="background: none; border: none; font-size: 1.5rem;">&times;</button>
            </div>
            <div class="modal-body p-4">
              <p class="text-muted mb-4">Ingresa la cantidad física disponible en cada sucursal:</p>
              
              <form id="stockDistributionForm">
                <input type="hidden" name="product_id" value="${productId}">
                <div class="list-group">
                  ${stores.map(store => `
                    <div class="d-flex justify-content-between align-items-center p-3 border-bottom" style="background: #ffffff; margin-bottom: 5px; border-radius: 5px; border: 1px solid #f1f1f1;">
                      <div style="flex-grow: 1;">
                        <div class="font-weight-bold" style="font-size: 1.1rem; color: var(--primary);">${store.name}</div>
                        <small class="text-muted">${store.address || 'Ubicación General'}</small>
                      </div>
                      
                      <div class="d-flex align-items-center bg-white p-2 rounded border shadow-sm" style="min-width: 150px; justify-content: flex-end;">
                        <span class="mr-2 font-weight-bold text-muted small text-uppercase">Cant:</span>
                        <input type="number" name="qty_${store.id}" 
                               class="form-control font-weight-bold text-dark" 
                               value="${stockMap[store.id] || 0}" 
                               min="0" step="1" 
                               onfocus="this.select()"
                               style="width: 80px; text-align: right; font-size: 1.4rem; border: none; background: transparent; padding: 0;">
                      </div>
                    </div>
                  `).join('')}
                </div>
                
                <div class="d-grid gap-2 mt-4" style="display: grid; gap: 10px;">
                  <button type="submit" class="btn btn-info btn-lg btn-block shadow-sm">
                    💾 Guardar Distribución
                  </button>
                  <button type="button" class="btn btn-outline-secondary" onclick="document.getElementById('stockModal').remove()">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = modalHTML;
      document.body.appendChild(container.firstElementChild);

      // Handle Submit
      document.getElementById('stockDistributionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'Guardando...';

        const formData = new FormData(e.target);

        try {
          for (const store of stores) {
            const qty = parseInt(formData.get(`qty_${store.id}`)) || 0;

            // Updated: Removed organization_id
            const { error } = await supabaseClient
              .from('inventory')
              .upsert({
                store_id: store.id,
                product_id: productId,
                quantity: qty,
                updated_at: new Date()
              }, { onConflict: 'store_id, product_id' });

            if (error) throw error;
            cacheInventoryRow({
              store_id: store.id,
              product_id: productId,
              quantity: qty,
              updated_at: new Date().toISOString()
            });
          }

          showToast('Inventario distribuido correctamente', 'success');
          document.getElementById('stockModal').remove();

        } catch (err) {
          console.error(err);
          showToast('Error al guardar inventario: ' + err.message, 'error');
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      });

    } catch (error) {
      console.error('Error opening stock modal:', error);
      showToast('Error al cargar datos', 'error');
    }
  };

  // --------------------------------------------------------------------------
  // Lógica de la Sección Inventario (Tabla Principal)
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Lógica de la Sección Inventario (Tabla Principal)
  // --------------------------------------------------------------------------

  let globalInventoryProducts = [];
  let globalCurrentStoreId = null;

  async function loadInventory() {
    console.log('Cargando módulo de inventario...');
    await loadInventoryStores();
    setupInventorySearch(); // Configurar búsqueda
    setupInventoryQrButton();
  }

  function setupInventoryQrButton() {
    const qrBtn = document.getElementById('inventoryQrBtn');
    if (!qrBtn) return;

    qrBtn.style.display = canEditInventoryStock() ? 'inline-flex' : 'none';
    if (!qrBtn.hasAttribute('data-listener-attached')) {
      qrBtn.addEventListener('click', openInventoryQrModal);
      qrBtn.setAttribute('data-listener-attached', 'true');
    }

    if (window.electronAPI?.onInventoryCountUpdated && !window.__inventoryCountListenerAttached) {
      window.electronAPI.onInventoryCountUpdated(({ storeId, productName, quantity }) => {
        if (storeId === globalCurrentStoreId) {
          loadInventoryTable(storeId, true);
          const detail = productName ? `: ${productName} (${quantity})` : '';
          showToast(`Inventario guardado desde iPad${detail}`, 'success');
        }
      });
      window.__inventoryCountListenerAttached = true;
    }

    if (window.electronAPI?.onInventoryCountLinkTest && !window.__inventoryCountLinkTestListenerAttached) {
      window.electronAPI.onInventoryCountLinkTest(({ storeId, storeName }) => {
        if (storeId === globalCurrentStoreId) {
          showToast(`iPad enlazado correctamente con ${storeName || 'esta tienda'}`, 'success');
        }
      });
      window.__inventoryCountLinkTestListenerAttached = true;
    }
  }

  window.closeInventoryQrModal = function () {
    const modal = document.getElementById('inventoryQrModal');
    if (modal) modal.style.display = 'none';
  };

  async function verifyInventoryQrLink(url, expectedServerInstanceId) {
    try {
      const pingUrl = new URL(url);
      pingUrl.pathname = `${pingUrl.pathname.replace(/\/$/, '')}/ping`;
      pingUrl.searchParams.set('_', Date.now().toString());

      const response = await fetch(pingUrl.toString(), {
        method: 'POST',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      if (expectedServerInstanceId && result.serverInstanceId && result.serverInstanceId !== expectedServerInstanceId) {
        showToast('El QR responde desde una instancia vieja del sistema. Cierra otras ventanas del Punto de Venta y genera otro QR.', 'warning');
        return;
      }

      if (expectedServerInstanceId && !result.serverInstanceId) {
        showToast('El QR responde desde una version vieja del servidor local. Cierra el sistema por completo y abrelo de nuevo.', 'warning');
      }
    } catch (error) {
      console.warn('Inventory QR self-test failed:', error);
      showToast('El QR se genero, pero no se pudo validar la conexion local. Si el iPad dice expirado, cierra otras instancias del sistema y genera otro QR.', 'warning');
    }
  }

  window.openInventoryQrModal = async function () {
    if (!canEditInventoryStock()) {
      showToast('Solo puedes consultar el inventario. No tienes permiso para usar el QR.', 'warning');
      return;
    }

    const storeSelect = document.getElementById('inventoryStoreSelect');
    const storeId = storeSelect?.value || globalCurrentStoreId;
    const selectedOption = storeSelect?.options[storeSelect.selectedIndex];
    const storeName = selectedOption?.text || 'Tienda';

    if (!storeId) {
      showToast('Selecciona una tienda para generar el QR', 'warning');
      return;
    }

    if (!window.electronAPI?.createInventoryCountLink) {
      showToast('No se pudo crear el QR en esta version de la app', 'error');
      return;
    }

    const qrBtn = document.getElementById('inventoryQrBtn');
    try {
      if (qrBtn) {
        qrBtn.disabled = true;
        qrBtn.textContent = '...';
      }

      const result = await window.electronAPI.createInventoryCountLink({
        storeId,
        storeName,
        employeeId: currentUser.id,
        userRole: currentUser.role,
        canEditInventory: canEditInventoryStock()
      });

      document.getElementById('inventoryQrStoreName').textContent = storeName;
      document.getElementById('inventoryQrImage').src = result.qrDataUrl;
      document.getElementById('inventoryQrUrl').value = result.url;
      document.getElementById('inventoryQrModal').style.display = 'flex';
      verifyInventoryQrLink(result.url, result.serverInstanceId);
    } catch (error) {
      console.error('Error creating inventory QR:', error);
      showToast(error.message || 'Error al crear el QR de inventario', 'error');
    } finally {
      if (qrBtn) {
        qrBtn.disabled = false;
        qrBtn.textContent = 'QR';
      }
    }
  };

  function setupInventorySearch() {
    const searchInput = document.getElementById('inventorySearchInput');
    if (searchInput) {
      // Clonar para limpiar listeners previos
      const newDetail = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newDetail, searchInput);

      newDetail.addEventListener('input', debounce((e) => {
        const term = e.target.value.toLowerCase().trim();
        renderInventoryTable(term);
      }, 120));
      // Focus
      // newDetail.focus(); // Opcional, puede molestar si carga despues
    }
  }

  async function loadInventoryStores() {
    const select = document.getElementById('inventoryStoreSelect');
    if (!select) return;

    try {
      const stores = await getCachedActiveStores();

      select.innerHTML = '<option value="">-- Selecciona una sucursal --</option>';

      if (stores && stores.length > 0) {
        stores.forEach(store => {
          select.innerHTML += `<option value="${store.id}">${store.name}</option>`;
        });
      } else {
        select.innerHTML = '<option value="">No hay tiendas activas</option>';
      }

      select.removeEventListener('change', handleStoreChange);
      select.addEventListener('change', handleStoreChange);

      // Auto-select store from storage and load its inventory
      let myStoreId = null;
      const loginStoreStr = localStorage.getItem('selectedStore') || sessionStorage.getItem('pos_current_store');
      if (loginStoreStr) {
        try {
          myStoreId = JSON.parse(loginStoreStr).id;
        } catch (err) {
          console.warn('Error parsing store for inventory auto-load', err);
        }
      } else {
        // Fallback for employees who might only have user.store_id
        const currentUser = Auth.getCurrentUser();
        if (currentUser && currentUser.store_id) {
          myStoreId = currentUser.store_id;
        }
      }

      if (myStoreId) {
        // Check if the storeId exists in the options
        const ops = Array.from(select.options).map(o => o.value);
        if (ops.includes(myStoreId)) {
          select.value = myStoreId;
          loadInventoryTable(myStoreId);
        }
      }

    } catch (e) {
      console.error('Error loading inventory stores:', e);
      select.innerHTML = '<option value="">Error al cargar tiendas</option>';
    }
  }

  function handleStoreChange(e) {
    loadInventoryTable(e.target.value);
  }

  async function loadInventoryTable(storeId, force = false) {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    if (!storeId) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-5">Por favor selecciona una tienda para ver su inventario</td></tr>';
      globalInventoryProducts = [];
      globalCurrentStoreId = null;
      return;
    }

    globalCurrentStoreId = storeId;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-5"><span class="spinner-border spinner-border-sm"></span> Cargando inventario...</td></tr>';

    try {
      const [products, inventory] = await Promise.all([
        getCachedInventoryProducts(),
        getCachedStoreInventory(storeId, force)
      ]);

      // 3. Map stock
      const stockMap = {};
      if (inventory) {
        inventory.forEach(item => {
          stockMap[item.product_id] = {
            qty: item.quantity,
            min: item.min_stock
          };
        });
      }

      if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center p-4">No hay productos registrados en el sistema.</td></tr>';
        globalInventoryProducts = [];
        return;
      }

      // Cachear datos
      globalInventoryProducts = products.map(p => {
        const stockData = stockMap[p.id] || { qty: 0, min: 10 };
        return {
          ...p,
          current_qty: stockData.qty,
          current_min: stockData.min !== null ? stockData.min : 10
        };
      });

      // Renderizar inicial
      renderInventoryTable('');

    } catch (error) {
      console.error('Error loading inventory table:', error);
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger p-4">Error al cargar datos del inventario.</td></tr>';
    }
  }

  function renderInventoryTable(searchTerm = '') {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    let filtered = globalInventoryProducts;

    if (searchTerm) {
      filtered = globalInventoryProducts.filter(p => {
        const nameMatch = p.name.toLowerCase().includes(searchTerm);
        const brandMatch = p.brand?.name?.toLowerCase().includes(searchTerm);
        const codeMatch = p.barcode?.toLowerCase().includes(searchTerm);
        return nameMatch || brandMatch || codeMatch;
      });
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center p-4">No se encontraron productos con esa búsqueda.</td></tr>';
      return;
    }

    const renderLimit = searchTerm ? INVENTORY_SEARCH_RENDER_LIMIT : INVENTORY_INITIAL_RENDER_LIMIT;
    const visibleRows = filtered.slice(0, renderLimit);
    const limitNotice = filtered.length > visibleRows.length
      ? `<tr><td colspan="5" class="text-center text-muted p-3" style="background:#f8fafc;">
          Mostrando ${visibleRows.length} de ${filtered.length} productos. Usa la búsqueda para ubicar uno específico.
        </td></tr>`
      : '';

    tbody.innerHTML = limitNotice + visibleRows.map(p => {
      const stock = p.current_qty;
      const minStock = p.current_min;
      const productName = escapeHtml(p.name);
      const barcode = escapeHtml(p.barcode || '');
      const brandName = escapeHtml(p.brand?.name || '');
      const canEditInventory = canEditInventoryStock();
      const stockInputAttrs = canEditInventory
        ? `onkeydown="if(event.key === 'Enter'){ event.preventDefault(); updateSingleInventory('${globalCurrentStoreId}', '${p.id}', this.value, document.getElementById('min-stock-input-${p.id}').value); }"`
        : 'readonly aria-readonly="true" title="Solo lectura: no tienes permiso para modificar inventario"';
      const minStockInputAttrs = canEditInventory
        ? `onkeydown="if(event.key === 'Enter'){ event.preventDefault(); updateSingleInventory('${globalCurrentStoreId}', '${p.id}', document.getElementById('stock-input-${p.id}').value, this.value); }"`
        : 'readonly aria-readonly="true" title="Solo lectura: no tienes permiso para modificar inventario"';
      const actionCell = canEditInventory
        ? `<button class="btn btn-sm btn-outline-primary shadow-sm" 
                   onclick="updateSingleInventory('${globalCurrentStoreId}', '${p.id}', document.getElementById('stock-input-${p.id}').value, document.getElementById('min-stock-input-${p.id}').value)">
               <small>💾 Guardar</small>
           </button>`
        : '<span class="badge badge-light text-muted" title="Solo lectura: no tienes permiso para modificar inventario">Solo lectura</span>';

      const isLowStock = stock <= minStock && stock > 0;
      const isOut = stock === 0;

      let statusBadge = '<span class="badge badge-success" style="background:#28a745; color:white;">En Stock</span>';
      if (isLowStock) statusBadge = '<span class="badge badge-warning" style="background:#ffc107; color:black;">Bajo Stock</span>';
      if (isOut) statusBadge = '<span class="badge badge-danger" style="background:#dc3545; color:white;">Agotado</span>';

      return `
                <tr style="vertical-align: middle;">
                    <td>
                        <div class="font-weight-bold" style="font-size: 1rem;">${productName}</div>
                        <small class="text-muted d-block">
                            ${barcode ? `Ref: ${barcode}` : ''} 
                            ${brandName ? ` | ${brandName}` : ''}
                        </small>
                    </td>
                    <td class="text-center">
                        <div class="input-group input-group-sm mx-auto" style="width: 140px;">
                            <input type="number" 
                                   class="form-control text-center font-weight-bold ${isOut ? 'text-danger' : 'text-primary'}" 
                                   value="${stock}" 
                                   id="stock-input-${p.id}"
                                   min="0"
                                   step="0.001"
                                   placeholder="Cant"
                                   ${stockInputAttrs}
                                   style="font-size: 1.1rem;">
                        </div>
                    </td>
                    <td class="text-center">
                        <div class="input-group input-group-sm mx-auto" style="width: 100px;">
                             <input type="number" 
                                    class="form-control text-center text-muted" 
                                    value="${minStock}" 
                                    id="min-stock-input-${p.id}"
                                    min="0"
                                    placeholder="Min"
                                    ${minStockInputAttrs}
                                    style="font-size: 1rem; border-color: #eee;">
                        </div>
                    </td>
                    <td class="text-center">${statusBadge}</td>
                    <td class="text-center">${actionCell}</td>
                </tr>
            `;
    }).join('');
  }

  let stockGeneralRows = [];
  let stockGeneralStores = [];
  let stockGeneralProducts = [];
  let stockGeneralSelectedId = null;
  let stockGeneralBrandList = [];        // marcas del catalogo para el buscador
  let stockGeneralBrandSelected = '';    // marca elegida en el dropdown ('' = todas)
  let stockGeneralLoaded = false;            // ¿hay datos en cache válidos?
  const stockGeneralInvIndex = new Map();    // `${storeId}::${productId}` -> { quantity, minStock }
  let stockGeneralRefreshTimer = null;

  function stockGeneralInvKey(storeId, productId) {
    return `${storeId}::${productId}`;
  }

  // Reconstruye stockGeneralRows desde el cache en memoria (rápido, sin tocar la BD).
  function buildStockGeneralRows() {
    stockGeneralRows = (stockGeneralProducts || []).map(product => {
      const distribution = stockGeneralStores.map(store => {
        const inv = stockGeneralInvIndex.get(stockGeneralInvKey(store.id, product.id));
        return {
          storeId: store.id,
          storeName: store.name,
          storeType: store.type || 'tienda',
          quantity: inv ? inv.quantity : 0,
          minStock: inv ? inv.minStock : 0
        };
      });
      const totalQty = Math.round(distribution.reduce((sum, row) => sum + row.quantity, 0) * 1000) / 1000;
      const totalMin = distribution.reduce((sum, row) => sum + row.minStock, 0);

      return {
        ...product,
        totalQty,
        totalMin,
        distribution
      };
    }).sort((a, b) => {
      const aPriority = a.totalQty === 0 ? 0 : (a.totalMin > 0 && a.totalQty <= a.totalMin ? 1 : 2);
      const bPriority = b.totalQty === 0 ? 0 : (b.totalMin > 0 && b.totalQty <= b.totalMin ? 1 : 2);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  // Pinta resultados + detalle a partir del cache ya construido.
  function renderStockGeneralFromCache() {
    const detailEl = document.getElementById('stockGeneralDetail');
    buildStockGeneralRows();
    populateStockGeneralBrandFilter();
    renderStockGeneralResults(document.getElementById('stockGeneralSearch')?.value || '');
    if (stockGeneralSelectedId && stockGeneralRows.some(row => row.id === stockGeneralSelectedId)) {
      selectStockGeneralProduct(stockGeneralSelectedId);
    } else if (detailEl) {
      stockGeneralSelectedId = null;
      detailEl.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:42px 10px; font-size:0.9rem;">Haz clic en un producto para ver su stock por ubicacion.</div>';
    }
  }

  async function loadStockGeneral(force = false) {
    const resultsEl = document.getElementById('stockGeneralResults');
    const countEl = document.getElementById('stockGeneralCount');
    if (!resultsEl) return;

    // Camino rápido: ya tenemos datos en cache y no se pidió forzar → mostrar al instante.
    if (!force && stockGeneralLoaded) {
      renderStockGeneralFromCache();
      return;
    }

    resultsEl.innerHTML = '<div class="text-center text-muted" style="padding:40px;">Cargando stock general...</div>';
    if (countEl) countEl.textContent = 'Cargando...';

    try {
      const [products, stores, inventoryRows] = await Promise.all([
        getCachedInventoryProducts(force),
        getCachedActiveStores(force),
        fetchPaged(() => supabaseClient
          .from('inventory')
          .select('id, product_id, store_id, quantity, min_stock'))
      ]);

      stockGeneralStores = stores || [];
      stockGeneralProducts = products || [];
      stockGeneralInvIndex.clear();
      (inventoryRows || []).forEach(row => {
        stockGeneralInvIndex.set(stockGeneralInvKey(row.store_id, row.product_id), {
          quantity: parseFloat(row.quantity || 0),
          minStock: row.min_stock == null ? 0 : parseInt(row.min_stock || 0)
        });
      });
      stockGeneralLoaded = true;

      renderStockGeneralFromCache();
    } catch (error) {
      console.error('Error loading stock general:', error);
      stockGeneralLoaded = false;
      resultsEl.innerHTML = '<div class="text-center text-danger" style="padding:40px;">Error al cargar stock general.</div>';
      if (countEl) countEl.textContent = 'Error';
    }
  }

  // Aplica un cambio puntual de inventario al cache de Stock General. Se invoca desde
  // cacheInventoryRow, por lo que cubre ventas, transferencias y cambios en vivo de otras
  // terminales. Si el panel está abierto, lo refresca (con debounce para coalescer ráfagas).
  function applyStockGeneralInventoryRow(row) {
    if (!stockGeneralLoaded) return;
    if (!row || !row.store_id || !row.product_id) return;

    const key = stockGeneralInvKey(row.store_id, row.product_id);
    const existing = stockGeneralInvIndex.get(key) || { quantity: 0, minStock: 0 };
    const next = { quantity: existing.quantity, minStock: existing.minStock };
    if (Object.prototype.hasOwnProperty.call(row, 'quantity') && row.quantity != null) {
      next.quantity = Math.max(0, parseFloat(row.quantity || 0));
    }
    if (Object.prototype.hasOwnProperty.call(row, 'min_stock')) {
      next.minStock = row.min_stock == null ? 0 : parseInt(row.min_stock || 0);
    }
    stockGeneralInvIndex.set(key, next);

    if (!document.getElementById('section-stock-general')?.classList.contains('active')) return;
    if (stockGeneralRefreshTimer) clearTimeout(stockGeneralRefreshTimer);
    stockGeneralRefreshTimer = setTimeout(() => {
      stockGeneralRefreshTimer = null;
      renderStockGeneralFromCache();
    }, 180);
  }

  // Estado de producto para el filtro: 'out' agotado, 'low' bajo minimo, 'ok' con stock
  function stockGeneralProductStatus(product) {
    if (product.totalQty === 0) return 'out';
    if (product.totalMin > 0 && product.totalQty <= product.totalMin) return 'low';
    return 'ok';
  }

  // Recolecta las marcas presentes en el catalogo cargado para el buscador de marca.
  function populateStockGeneralBrandFilter() {
    stockGeneralBrandList = Array.from(
      new Set((stockGeneralProducts || []).map(p => (p.brand?.name || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    // Si la marca seleccionada ya no existe, limpiar el filtro
    if (stockGeneralBrandSelected && !stockGeneralBrandList.includes(stockGeneralBrandSelected)) {
      stockGeneralBrandSelected = '';
      const input = document.getElementById('stockGeneralBrandFilter');
      if (input) input.value = '';
    }
  }

  // Dropdown de sugerencias de marca (buscable). "Todas las marcas" limpia el filtro.
  window.renderStockGeneralBrandSuggestions = function (rawTerm) {
    const box = document.getElementById('stockGeneralBrandSuggestions');
    if (!box) return;

    const term = String(rawTerm || '').trim().toLowerCase();
    const matches = (term
      ? stockGeneralBrandList.filter(name => name.toLowerCase().includes(term))
      : stockGeneralBrandList
    ).slice(0, 40);

    const allOption = `
      <div class="stock-brand-suggestion" data-brand=""
        style="padding:9px 14px; cursor:pointer; font-size:0.86rem; font-weight:700; color:#1d4ed8; border-bottom:1px solid #f1f5f9;"
        onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='white'">
        Todas las marcas
      </div>`;

    box.innerHTML = allOption + (matches.length === 0
      ? '<div style="padding:10px 14px; color:#94a3b8; font-size:0.84rem;">Sin coincidencias</div>'
      : matches.map(name => `
        <div class="stock-brand-suggestion" data-brand="${escapeHtml(name)}"
          style="padding:9px 14px; cursor:pointer; font-size:0.86rem; border-bottom:1px solid #f1f5f9;"
          onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='white'">
          🏷️ ${escapeHtml(name)}
        </div>`).join(''));

    box.style.display = 'block';

    box.querySelectorAll('.stock-brand-suggestion').forEach(item => {
      item.addEventListener('click', () => {
        stockGeneralBrandSelected = item.dataset.brand || '';
        const input = document.getElementById('stockGeneralBrandFilter');
        if (input) input.value = stockGeneralBrandSelected;
        box.style.display = 'none';
        renderStockGeneralResults(document.getElementById('stockGeneralSearch')?.value || '');
      });
    });
  };

  // Cerrar el dropdown de marca al hacer clic fuera
  document.addEventListener('click', (e) => {
    const input = document.getElementById('stockGeneralBrandFilter');
    const box = document.getElementById('stockGeneralBrandSuggestions');
    if (!input || !box) return;
    if (!input.contains(e.target) && !box.contains(e.target)) {
      box.style.display = 'none';
      // Si el texto no coincide con una marca válida, revertir al filtro activo
      if (input.value !== stockGeneralBrandSelected) {
        input.value = stockGeneralBrandSelected;
      }
    }
  });

  window.onStockGeneralFilterChange = function () {
    renderStockGeneralResults(document.getElementById('stockGeneralSearch')?.value || '');
  };

  window.clearStockGeneralFilters = function () {
    const searchEl = document.getElementById('stockGeneralSearch');
    const brandEl = document.getElementById('stockGeneralBrandFilter');
    const statusEl = document.getElementById('stockGeneralStatusFilter');
    const sortEl = document.getElementById('stockGeneralSortFilter');
    if (searchEl) searchEl.value = '';
    if (brandEl) brandEl.value = '';
    if (statusEl) statusEl.value = 'all';
    if (sortEl) sortEl.value = 'priority';
    stockGeneralBrandSelected = '';
    const box = document.getElementById('stockGeneralBrandSuggestions');
    if (box) box.style.display = 'none';
    renderStockGeneralResults('');
  };

  function renderStockGeneralResults(rawTerm = '') {
    const resultsEl = document.getElementById('stockGeneralResults');
    const countEl = document.getElementById('stockGeneralCount');
    if (!resultsEl) return;

    const term = String(rawTerm || '').trim().toLowerCase();
    const brandFilter = stockGeneralBrandSelected || '';
    const statusFilter = document.getElementById('stockGeneralStatusFilter')?.value || 'all';
    const sortMode = document.getElementById('stockGeneralSortFilter')?.value || 'priority';

    let filtered = stockGeneralRows;
    if (term) {
      filtered = filtered.filter(product => {
        const productName = product.name?.toLowerCase() || '';
        const brandName = product.brand?.name?.toLowerCase() || '';
        const barcode = product.barcode?.toLowerCase() || '';
        return productName.includes(term) || brandName.includes(term) || barcode.includes(term);
      });
    }
    if (brandFilter) {
      filtered = filtered.filter(product => (product.brand?.name || '').trim() === brandFilter);
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter(product => stockGeneralProductStatus(product) === statusFilter);
    }

    // stockGeneralRows ya viene en orden "prioridad" (agotados, bajos, resto);
    // los demas modos reordenan una copia sin tocar el cache.
    if (sortMode === 'qty-asc') {
      filtered = filtered.slice().sort((a, b) => a.totalQty - b.totalQty || (a.name || '').localeCompare(b.name || ''));
    } else if (sortMode === 'qty-desc') {
      filtered = filtered.slice().sort((a, b) => b.totalQty - a.totalQty || (a.name || '').localeCompare(b.name || ''));
    } else if (sortMode === 'name-asc') {
      filtered = filtered.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortMode === 'brand-asc') {
      filtered = filtered.slice().sort((a, b) =>
        (a.brand?.name || 'zzz').localeCompare(b.brand?.name || 'zzz') || (a.name || '').localeCompare(b.name || ''));
    }

    if (countEl) {
      countEl.textContent = `${filtered.length} producto${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      resultsEl.innerHTML = '<div class="text-center text-muted" style="padding:40px;">No se encontraron productos.</div>';
      return;
    }

    const limit = (term || brandFilter || statusFilter !== 'all') ? 220 : 160;
    const visible = filtered.slice(0, limit);
    const notice = filtered.length > visible.length
      ? `<div style="padding:10px 14px; background:#f8fafc; border-bottom:1px solid #eef2f7; color:#64748b; font-size:0.82rem;">Mostrando ${visible.length} de ${filtered.length}. Usa la busqueda para filtrar mas.</div>`
      : '';

    resultsEl.innerHTML = notice + visible.map(product => {
      const brandName = product.brand?.name || 'Sin marca';
      const barcode = product.barcode || '';
      const isSelected = product.id === stockGeneralSelectedId;
      let badge = '<span style="background:#dcfce7; color:#166534; border-radius:999px; padding:4px 8px; font-size:0.72rem; font-weight:800;">OK</span>';
      if (product.totalQty === 0) badge = '<span style="background:#fee2e2; color:#991b1b; border-radius:999px; padding:4px 8px; font-size:0.72rem; font-weight:800;">AGOTADO</span>';
      else if (product.totalMin > 0 && product.totalQty <= product.totalMin) badge = '<span style="background:#fef3c7; color:#92400e; border-radius:999px; padding:4px 8px; font-size:0.72rem; font-weight:800;">BAJO</span>';

      return `
        <button type="button" onclick="selectStockGeneralProduct('${product.id}')"
                style="width:100%; border:none; border-bottom:1px solid #eef2f7; background:${isSelected ? '#eff6ff' : '#fff'}; padding:13px 16px; text-align:left; cursor:pointer;">
          <div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center;">
            <div style="min-width:0;">
              <div style="font-weight:800; color:#111827; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(product.name || 'Producto')}</div>
              <div style="margin-top:3px; color:#64748b; font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${escapeHtml(brandName)}${barcode ? ` · ${escapeHtml(barcode)}` : ''}
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1.25rem; font-weight:900; color:#1d4ed8; line-height:1;">${product.totalQty}</div>
              <div style="font-size:0.68rem; color:#94a3b8; text-transform:uppercase; margin-top:2px;">total</div>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:8px;">
            ${badge}
            <span style="color:#64748b; font-size:0.75rem;">${product.distribution.filter(row => row.quantity > 0).length} ubicacion(es) con stock</span>
          </div>
        </button>`;
    }).join('');
  }

  function selectStockGeneralProduct(productId) {
    const product = stockGeneralRows.find(row => row.id === productId);
    if (!product) return;

    stockGeneralSelectedId = productId;
    const titleEl = document.getElementById('stockGeneralDetailTitle');
    const subtitleEl = document.getElementById('stockGeneralDetailSubtitle');
    const detailEl = document.getElementById('stockGeneralDetail');
    if (!detailEl) return;

    if (titleEl) titleEl.textContent = product.name || 'Producto';
    if (subtitleEl) {
      const brandName = product.brand?.name || 'Sin marca';
      subtitleEl.textContent = `${brandName} · Total general: ${product.totalQty}`;
    }

    const rows = product.distribution
      .slice()
      .sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return (a.storeName || '').localeCompare(b.storeName || '');
      });

    detailEl.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
        <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px;">
          <div style="font-size:0.68rem; color:#1d4ed8; font-weight:800; text-transform:uppercase;">Total general</div>
          <div style="font-size:1.6rem; font-weight:900; color:#1e40af;">${product.totalQty}</div>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px;">
          <div style="font-size:0.68rem; color:#64748b; font-weight:800; text-transform:uppercase;">Minimo global</div>
          <div style="font-size:1.6rem; font-weight:900; color:#334155;">${product.totalMin}</div>
        </div>
      </div>
      <div style="border:1px solid #eef2f7; border-radius:8px; overflow:hidden;">
        ${rows.map(row => {
          const typeLabel = String(row.storeType || 'tienda').toLowerCase().includes('bodega') ? 'Bodega' : 'Tienda';
          const isLow = row.minStock > 0 && row.quantity <= row.minStock;
          const qtyColor = row.quantity === 0 ? '#dc2626' : (isLow ? '#b45309' : '#166534');
          return `
            <div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; padding:11px 12px; border-bottom:1px solid #eef2f7;">
              <div style="min-width:0;">
                <div style="font-weight:800; color:#111827; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(row.storeName || 'Ubicacion')}</div>
                <div style="font-size:0.74rem; color:#64748b;">${typeLabel}${row.minStock > 0 ? ` · Min ${row.minStock}` : ''}</div>
              </div>
              <div style="font-size:1.15rem; font-weight:900; color:${qtyColor};">${row.quantity}</div>
            </div>`;
        }).join('')}
      </div>`;

    renderStockGeneralResults(document.getElementById('stockGeneralSearch')?.value || '');
  }

  window.loadStockGeneral = loadStockGeneral;
  window.renderStockGeneralResults = renderStockGeneralResults;
  window.selectStockGeneralProduct = selectStockGeneralProduct;

  // Hacer disponible globalmente
  window.updateSingleInventory = async (storeId, productId, newQtyRaw, newMinRaw) => {
    try {
      if (!canEditInventoryStock()) {
        showToast('Solo puedes consultar el inventario. No tienes permiso para modificarlo.', 'warning');
        return;
      }

      const qty = parseFloat(newQtyRaw);
      const minStock = parseInt(newMinRaw);

      if (isNaN(qty) || qty < 0) {
        showToast('Cantidad inválida', 'warning');
        return;
      }
      if (isNaN(minStock) || minStock < 0) {
        showToast('Stock mínimo inválido', 'warning');
        return;
      }

      // Find old qty to calculate the difference
      const prod = globalInventoryProducts.find(p => p.id === productId);
      const oldQty = prod ? prod.current_qty : 0;
      const deltaQty = qty - oldQty;

      const { error } = await supabaseClient
        .from('inventory')
        .upsert({
          store_id: storeId,
          product_id: productId,
          quantity: qty,
          min_stock: minStock,
          updated_at: new Date()
        }, { onConflict: 'store_id, product_id' });

      if (error) throw error;
      cacheInventoryRow({
        store_id: storeId,
        product_id: productId,
        quantity: qty,
        min_stock: minStock,
        updated_at: new Date().toISOString()
      });

      // Insert log if there's a change in stock
      if (deltaQty !== 0) {
        await supabaseClient.from('inventory_logs').insert({
          store_id: storeId,
          product_id: productId,
          employee_id: currentUser.id,
          type: 'ajuste',
          quantity: deltaQty,
          description: deltaQty > 0 ? 'Ajuste manual (incremento)' : 'Ajuste manual (decremento)'
        });
      }

      showToast('Stock actualizado', 'success');

      // Actualizar cache local para que no revierta al filtrar
      const cachedProd = globalInventoryProducts.find(p => p.id === productId);
      if (cachedProd) {
        cachedProd.current_qty = qty;
        cachedProd.current_min = minStock;
      }

      // Re-renderizar para actualizar badges si cambiaron
      const currentSearch = document.getElementById('inventorySearchInput')?.value.toLowerCase().trim() || '';
      renderInventoryTable(currentSearch);

    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, 'error');
    }
  };

  // --- INVENTORY TRANSFER LOGIC ---
  const transferBtn = document.getElementById('transferBtn');
  if (transferBtn) {
    transferBtn.addEventListener('click', openTransferModal);
  }

  async function openTransferModal() {
    if (!globalCurrentStoreId) {
      showToast('Por favor selecciona una tienda de origen primero', 'warning');
      return;
    }

    const sourceStoreSelect = document.getElementById('inventoryStoreSelect');
    const sourceStoreName = sourceStoreSelect.options[sourceStoreSelect.selectedIndex].text;

    document.getElementById('transferSourceStoreName').value = sourceStoreName;
    document.getElementById('transferSourceStoreId').value = globalCurrentStoreId;

    // Clear form
    document.getElementById('transferDestStoreId').innerHTML = '<option value="">Cargando...</option>';
    document.getElementById('transferProductSearch').value = '';
    document.getElementById('transferProductId').value = '';
    document.getElementById('transferSelectedProductDisplay').style.display = 'none';
    document.getElementById('transferQuantity').value = '';
    document.getElementById('transferStockWarning').style.display = 'none';
    document.getElementById('btnExecuteTransfer').disabled = true;

    // Load destination stores
    try {
      const stores = await getCachedActiveStores();

      let options = '<option value="">Selecciona tienda destino...</option>';
      stores.forEach(s => {
        if (s.id !== globalCurrentStoreId) {
          options += `<option value="${s.id}">${s.name}</option>`;
        }
      });
      document.getElementById('transferDestStoreId').innerHTML = options;
    } catch (err) {
      console.error(err);
      showToast('Error cargando tiendas destino', 'error');
    }

    document.getElementById('transferModal').style.display = 'block';
  }

  window.closeTransferModal = function () {
    document.getElementById('transferModal').style.display = 'none';
  };

  // Setup Product Search for Transfer
  const transferProductSearch = document.getElementById('transferProductSearch');
  const transferProductResults = document.getElementById('transferProductResults');

  if (transferProductSearch) {
    const showProductResults = (term) => {
      transferProductResults.innerHTML = '';

      const lowerTerm = term.toLowerCase().trim();

      // Filter from globalInventoryProducts where current_qty > 0
      const matches = globalInventoryProducts.filter(p => {
        if (p.current_qty <= 0) return false;
        if (!lowerTerm) return true;
        return (
          p.name.toLowerCase().includes(lowerTerm) ||
          (p.barcode && p.barcode.toLowerCase().includes(lowerTerm)) ||
          (p.sku && p.sku.toLowerCase().includes(lowerTerm))
        );
      }).slice(0, 50); // Muestra hasta 50 resultados para dar panorama

      if (matches.length > 0) {
        matches.forEach(p => {
          const a = document.createElement('a');
          a.href = '#';
          a.className = 'list-group-item list-group-item-action';
          a.style.cssText = 'padding: 10px 14px; border-bottom: 1px solid #f3f4f6; text-decoration: none; display: flex; flex-direction: column; gap: 4px; transition: background-color 0.2s; border-radius: 0; border-left: none; border-right: none; cursor: pointer;';

          a.onmouseover = () => a.style.backgroundColor = '#f9fafb';
          a.onmouseout = () => a.style.backgroundColor = 'transparent';

          const codeInfo = p.sku ? `SKU: ${p.sku}` : (p.barcode ? `Cód: ${p.barcode}` : '');
          const codeBadge = codeInfo ? `<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.5px;">${codeInfo}</span>` : '';

          a.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <strong style="color: #1f2937; font-size: 0.9rem; line-height: 1.2;">${p.name}</strong>
              ${codeBadge}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <small style="color: #6b7280; font-size: 0.75rem;">${p.brand ? p.brand.name : 'Sin marca'}</small>
              <div style="background: #ecfdf5; color: #059669; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; border: 1px solid #a7f3d0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                <span style="font-size: 0.65rem; color: #10b981; margin-right: 3px;">STOCK:</span>${p.current_qty}
              </div>
            </div>
          `;
          a.onclick = (ev) => {
            ev.preventDefault();
            selectProductForTransfer(p);
          };
          transferProductResults.appendChild(a);
        });
        transferProductResults.style.display = 'block';
      } else {
        transferProductResults.style.display = 'none';
      }
    };

    transferProductSearch.addEventListener('input', (e) => showProductResults(e.target.value));
    transferProductSearch.addEventListener('focus', (e) => showProductResults(e.target.value));

    // Hide results when clicking outside
    document.addEventListener('click', (e) => {
      if (e.target !== transferProductSearch && e.target !== transferProductResults) {
        if (transferProductResults) transferProductResults.style.display = 'none';
      }
    });
  }

  function selectProductForTransfer(product) {
    document.getElementById('transferProductId').value = product.id;
    document.getElementById('transferProductSearch').value = '';
    const display = document.getElementById('transferSelectedProductDisplay');
    display.innerHTML = `Producto Seleccionado: ${product.name} <br>Stock en Origen: <strong>${product.current_qty}</strong>`;
    display.style.display = 'block';

    const qtyInput = document.getElementById('transferQuantity');
    qtyInput.max = product.current_qty;
    qtyInput.dataset.maxQty = product.current_qty;

    document.getElementById('transferProductResults').style.display = 'none';
    validateTransferForm();
  }

  const transferDestStoreId = document.getElementById('transferDestStoreId');
  const transferQuantity = document.getElementById('transferQuantity');

  if (transferDestStoreId) transferDestStoreId.addEventListener('change', validateTransferForm);
  if (transferQuantity) {
    transferQuantity.addEventListener('input', () => {
      const max = parseInt(transferQuantity.dataset.maxQty || 0);
      const val = parseInt(transferQuantity.value || 0);
      const warning = document.getElementById('transferStockWarning');

      if (val > max) {
        warning.style.display = 'block';
      } else {
        warning.style.display = 'none';
      }
      validateTransferForm();
    });
  }

  function validateTransferForm() {
    const destId = document.getElementById('transferDestStoreId').value;
    const prodId = document.getElementById('transferProductId').value;
    const qtyInput = document.getElementById('transferQuantity');
    const qty = parseInt(qtyInput.value || 0);
    const max = parseInt(qtyInput.dataset.maxQty || 0);

    const btn = document.getElementById('btnExecuteTransfer');
    if (destId && prodId && qty > 0 && qty <= max) {
      btn.disabled = false;
      btn.style.opacity = '1';
    } else {
      btn.disabled = true;
      btn.style.opacity = '0.6';
    }
  }

  window.executeTransfer = async function (e) {
    e.preventDefault();
    const btn = document.getElementById('btnExecuteTransfer');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Procesando...';

    const sourceStoreId = document.getElementById('transferSourceStoreId').value;
    const destStoreId = document.getElementById('transferDestStoreId').value;
    const productId = document.getElementById('transferProductId').value;
    const qty = parseInt(document.getElementById('transferQuantity').value);

    let sourceData = null;
    let sourceUpdated = false;

    try {
      const { error: transferRpcError } = await supabaseClient.rpc('transfer_inventory', {
        p_product_id: productId,
        p_source_store_id: sourceStoreId,
        p_dest_store_id: destStoreId,
        p_qty: qty,
        p_employee_id: currentUser.id
      });

      if (!transferRpcError) {
        adjustCachedInventory(sourceStoreId, productId, -qty);
        adjustCachedInventory(destStoreId, productId, qty);
        await getCachedProductInventory(productId, true);
        showToast('Transferencia completada con exito', 'success');
        closeTransferModal();
        loadInventoryTable(sourceStoreId);
        return;
      }

      if (!isMissingRpcError(transferRpcError)) {
        throw transferRpcError;
      }

      // 1. Get current stock for SOURCE
      const { data: loadedSourceData, error: e1 } = await supabaseClient
        .from('inventory')
        .select('quantity, id')
        .eq('store_id', sourceStoreId)
        .eq('product_id', productId)
        .single();


      sourceData = loadedSourceData;
      if (e1 || !sourceData) throw new Error("No se encontro stock origen");

      if (sourceData.quantity < qty) throw new Error("Stock insuficiente en origen");

      const newSourceQty = sourceData.quantity - qty;

      // 2. Update SOURCE
      const { error: e2 } = await supabaseClient
        .from('inventory')
        .update({ quantity: newSourceQty })
        .eq('id', sourceData.id);

      if (e2) throw e2;
      sourceUpdated = true;

      // 3. Check DESTINATION
      const { data: destData, error: e3 } = await supabaseClient
        .from('inventory')
        .select('quantity, id')
        .eq('store_id', destStoreId)
        .eq('product_id', productId)
        .maybeSingle(); // might not exist

      if (destData) {
        // Update existing DESTINATION record
        const { error: e4 } = await supabaseClient
          .from('inventory')
          .update({ quantity: destData.quantity + qty })
          .eq('id', destData.id);
        if (e4) throw e4;
        cacheInventoryRow({
          ...destData,
          store_id: destStoreId,
          product_id: productId,
          quantity: parseInt(destData.quantity || 0) + qty
        });
      } else {
        // Insert new DESTINATION record
        const { error: e5 } = await supabaseClient
          .from('inventory')
          .insert({
            store_id: destStoreId,
            product_id: productId,
            quantity: qty,
            min_stock: 10
          });
        if (e5) throw e5;
        cacheInventoryRow({
          store_id: destStoreId,
          product_id: productId,
          quantity: qty,
          min_stock: 10
        });
      }
      cacheInventoryRow({
        ...sourceData,
        store_id: sourceStoreId,
        product_id: productId,
        quantity: newSourceQty
      });

      // 4. Register Logs for both stores
      await supabaseClient.from('inventory_logs').insert([
        {
          store_id: sourceStoreId,
          product_id: productId,
          employee_id: currentUser.id,
          type: 'transferencia',
          quantity: -qty,
          description: 'Traspaso enviado'
        },
        {
          store_id: destStoreId,
          product_id: productId,
          employee_id: currentUser.id,
          type: 'transferencia',
          quantity: qty,
          description: 'Traspaso recibido'
        }
      ]);

      showToast('Transferencia completada con éxito 📦➡️', 'success');
      closeTransferModal();

      // Reload inventory table to reflect new quantities for current store
      loadInventoryTable(sourceStoreId);

    } catch (err) {
      console.error("Transfer error", err);
      if (sourceUpdated && sourceData?.id) {
        await supabaseClient
          .from('inventory')
          .update({ quantity: sourceData.quantity })
          .eq('id', sourceData.id);
      }
      showToast(err.message || 'Error al ejecutar transferencia', 'error');
      btn.innerHTML = 'Confirmar Transferencia';
      btn.disabled = false;
    }
  };

  // --- INVENTORY TRANSFERS MODULE (multi-product) ---
  let transferStores = [];
  let transferSourceProducts = [];
  let transferSelectedProduct = null;
  let transferDraftItems = [];
  let transferHistoryRows = [];

  async function loadInventoryTransfers() {
    setupInventoryTransferEvents();
    await loadInventoryTransferStores();
    await loadInventoryTransferHistory();
  }

  function setupInventoryTransferEvents() {
    const sourceSelect = document.getElementById('inventoryTransferSourceStore');
    const destSelect = document.getElementById('inventoryTransferDestStore');
    const searchInput = document.getElementById('inventoryTransferProductSearch');
    const qtyInput = document.getElementById('inventoryTransferQty');
    const addBtn = document.getElementById('addTransferItemBtn');
    const confirmBtn = document.getElementById('confirmInventoryTransferBtn');
    const refreshBtn = document.getElementById('refreshTransfersBtn');
    const historySearch = document.getElementById('transferHistorySearch');

    if (sourceSelect && !sourceSelect.dataset.bound) {
      sourceSelect.dataset.bound = 'true';
      sourceSelect.addEventListener('change', async () => {
        resetInventoryTransferDraft();
        syncTransferDestinationOptions();
        await loadTransferSourceProducts();
      });
    }

    if (destSelect && !destSelect.dataset.bound) {
      destSelect.dataset.bound = 'true';
      destSelect.addEventListener('change', () => {
        renderTransferDraft();
        renderTransferProductResults(searchInput?.value || '');
      });
    }

    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('input', debounce(() => renderTransferProductResults(searchInput.value), 120));
      searchInput.addEventListener('focus', () => renderTransferProductResults(searchInput.value));
    }

    if (qtyInput && !qtyInput.dataset.bound) {
      qtyInput.dataset.bound = 'true';
      qtyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addSelectedProductToTransfer();
        }
      });
    }

    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = 'true';
      addBtn.addEventListener('click', addSelectedProductToTransfer);
    }

    if (confirmBtn && !confirmBtn.dataset.bound) {
      confirmBtn.dataset.bound = 'true';
      confirmBtn.addEventListener('click', confirmInventoryTransfer);
    }

    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = 'true';
      refreshBtn.addEventListener('click', async () => {
        await loadTransferSourceProducts(true);
        await loadInventoryTransferHistory();
        showToast('Transferencias actualizadas', 'success');
      });
    }

    if (historySearch && !historySearch.dataset.bound) {
      historySearch.dataset.bound = 'true';
      historySearch.addEventListener('input', debounce(() => renderInventoryTransferHistory(), 120));
    }

    if (!document.body.dataset.transferSearchClickBound) {
      document.body.dataset.transferSearchClickBound = 'true';
      document.addEventListener('click', (event) => {
        const results = document.getElementById('inventoryTransferProductResults');
        const activeSearch = document.getElementById('inventoryTransferProductSearch');
        if (!results || !activeSearch) return;
        if (!results.contains(event.target) && event.target !== activeSearch) {
          results.style.display = 'none';
        }
      });
    }
  }

  async function loadInventoryTransferStores() {
    const sourceSelect = document.getElementById('inventoryTransferSourceStore');
    const destSelect = document.getElementById('inventoryTransferDestStore');
    if (!sourceSelect || !destSelect) return;

    try {
      transferStores = await getCachedActiveStores();
      const options = ['<option value="">Selecciona tienda...</option>']
        .concat(transferStores.map(store => `<option value="${store.id}">${escapeHtml(store.name)}</option>`))
        .join('');

      const oldSource = sourceSelect.value;
      const oldDest = destSelect.value;
      sourceSelect.innerHTML = options;
      destSelect.innerHTML = options;

      const selectedStore = getSelectedLoginStoreId();
      sourceSelect.value = oldSource || selectedStore || '';
      syncTransferDestinationOptions(oldDest);
      await loadTransferSourceProducts();
    } catch (error) {
      console.error('Error loading transfer stores:', error);
      sourceSelect.innerHTML = '<option value="">Error al cargar tiendas</option>';
      destSelect.innerHTML = '<option value="">Error al cargar tiendas</option>';
    }
  }

  function getSelectedLoginStoreId() {
    const raw = localStorage.getItem('selectedStore') || sessionStorage.getItem('pos_current_store');
    if (raw) {
      try {
        return JSON.parse(raw).id || '';
      } catch (error) {
        return '';
      }
    }
    return currentUser.store_id || '';
  }

  function syncTransferDestinationOptions(preferredDest = '') {
    const sourceId = document.getElementById('inventoryTransferSourceStore')?.value || '';
    const destSelect = document.getElementById('inventoryTransferDestStore');
    if (!destSelect) return;

    const currentDest = preferredDest || destSelect.value;
    const options = ['<option value="">Selecciona destino...</option>']
      .concat(transferStores
        .filter(store => store.id !== sourceId)
        .map(store => `<option value="${store.id}">${escapeHtml(store.name)}</option>`))
      .join('');
    destSelect.innerHTML = options;
    destSelect.value = currentDest && currentDest !== sourceId ? currentDest : '';
  }

  async function loadTransferSourceProducts(force = false) {
    const sourceId = document.getElementById('inventoryTransferSourceStore')?.value;
    const results = document.getElementById('inventoryTransferProductResults');
    if (results) results.style.display = 'none';

    if (!sourceId) {
      transferSourceProducts = [];
      updateSelectedTransferProduct(null);
      renderTransferDraft();
      return;
    }

    try {
      const [products, inventory] = await Promise.all([
        getCachedInventoryProducts(force),
        getCachedStoreInventory(sourceId, force)
      ]);

      const stockMap = {};
      (inventory || []).forEach(row => {
        stockMap[row.product_id] = {
          quantity: parseInt(row.quantity || 0),
          min_stock: row.min_stock
        };
      });

      transferSourceProducts = (products || []).map(product => ({
        ...product,
        current_qty: stockMap[product.id]?.quantity || 0,
        current_min: stockMap[product.id]?.min_stock ?? 10
      }));
      updateSelectedTransferProduct(null);
      renderTransferDraft();
    } catch (error) {
      console.error('Error loading source inventory for transfer:', error);
      showToast('Error al cargar inventario de origen', 'error');
    }
  }

  function renderTransferProductResults(term = '') {
    const results = document.getElementById('inventoryTransferProductResults');
    const sourceId = document.getElementById('inventoryTransferSourceStore')?.value;
    const destId = document.getElementById('inventoryTransferDestStore')?.value;
    if (!results) return;

    results.innerHTML = '';
    if (!sourceId || !destId || sourceId === destId) {
      results.style.display = 'none';
      return;
    }

    const lowerTerm = term.toLowerCase().trim();
    const matches = transferSourceProducts
      .filter(product => {
        if (product.current_qty <= 0) return false;
        if (!lowerTerm) return true;
        return (
          product.name.toLowerCase().includes(lowerTerm) ||
          (product.barcode || '').toLowerCase().includes(lowerTerm) ||
          (product.brand?.name || '').toLowerCase().includes(lowerTerm)
        );
      })
      .slice(0, 60);

    if (matches.length === 0) {
      results.style.display = 'none';
      return;
    }

    results.innerHTML = matches.map(product => `
      <button type="button" class="transfer-search-item" onclick="selectInventoryTransferProduct('${product.id}')">
        <span>
          <strong>${escapeHtml(product.name)}</strong><br>
          <small>${escapeHtml(product.barcode || 'Sin codigo')} ${product.brand?.name ? ' | ' + escapeHtml(product.brand.name) : ''}</small>
        </span>
        <span class="transfer-status">Stock ${product.current_qty}</span>
      </button>
    `).join('');
    results.style.display = 'block';
  }

  window.selectInventoryTransferProduct = function (productId) {
    const product = transferSourceProducts.find(item => item.id === productId);
    updateSelectedTransferProduct(product || null);
  };

  function updateSelectedTransferProduct(product) {
    transferSelectedProduct = product;
    const display = document.getElementById('selectedTransferProduct');
    const qtyInput = document.getElementById('inventoryTransferQty');
    const searchInput = document.getElementById('inventoryTransferProductSearch');
    const results = document.getElementById('inventoryTransferProductResults');

    if (!display || !qtyInput) return;

    if (!product) {
      display.textContent = 'Selecciona un producto para agregarlo.';
      qtyInput.value = '';
      qtyInput.removeAttribute('max');
      if (searchInput) searchInput.value = '';
      return;
    }

    const alreadyQty = transferDraftItems.find(item => item.product_id === product.id)?.quantity || 0;
    const available = Math.max(0, product.current_qty - alreadyQty);
    display.innerHTML = `<strong>${escapeHtml(product.name)}</strong><br><span>Stock origen: ${product.current_qty} | Disponible para agregar: ${available}</span>`;
    qtyInput.max = available;
    qtyInput.value = available > 0 ? 1 : '';
    if (searchInput) searchInput.value = product.name;
    if (results) results.style.display = 'none';
  }

  function addSelectedProductToTransfer() {
    const sourceId = document.getElementById('inventoryTransferSourceStore')?.value;
    const destId = document.getElementById('inventoryTransferDestStore')?.value;
    const qtyInput = document.getElementById('inventoryTransferQty');
    const qty = parseInt(qtyInput?.value || 0);

    if (!sourceId || !destId) return showToast('Selecciona origen y destino', 'warning');
    if (sourceId === destId) return showToast('Origen y destino no pueden ser iguales', 'warning');
    if (!transferSelectedProduct) return showToast('Selecciona un producto', 'warning');
    if (!qty || qty < 1) return showToast('Ingresa una cantidad valida', 'warning');

    const existing = transferDraftItems.find(item => item.product_id === transferSelectedProduct.id);
    const existingQty = existing?.quantity || 0;
    const totalQty = existingQty + qty;

    if (totalQty > transferSelectedProduct.current_qty) {
      return showToast(`Stock insuficiente. Disponible: ${transferSelectedProduct.current_qty - existingQty}`, 'warning');
    }

    if (existing) {
      existing.quantity = totalQty;
    } else {
      transferDraftItems.push({
        product_id: transferSelectedProduct.id,
        name: transferSelectedProduct.name,
        barcode: transferSelectedProduct.barcode || '',
        brand: transferSelectedProduct.brand?.name || '',
        source_stock: transferSelectedProduct.current_qty,
        min_stock: transferSelectedProduct.current_min,
        quantity: qty
      });
    }

    updateSelectedTransferProduct(null);
    renderTransferDraft();
  }

  function renderTransferDraft() {
    const tbody = document.getElementById('inventoryTransferCartBody');
    const confirmBtn = document.getElementById('confirmInventoryTransferBtn');
    const sourceId = document.getElementById('inventoryTransferSourceStore')?.value;
    const destId = document.getElementById('inventoryTransferDestStore')?.value;
    if (!tbody) return;

    if (transferDraftItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Aun no hay productos agregados.</td></tr>';
    } else {
      tbody.innerHTML = transferDraftItems.map(item => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong><br>
            <small class="text-muted">${escapeHtml(item.barcode || 'Sin codigo')}${item.brand ? ' | ' + escapeHtml(item.brand) : ''}</small>
          </td>
          <td>${item.source_stock}</td>
          <td>
            <input type="number" class="form-control" min="1" max="${item.source_stock}" value="${item.quantity}"
              onchange="updateTransferDraftQty('${item.product_id}', this.value)" style="width:90px;">
          </td>
          <td class="text-right">
            <button class="btn btn-sm btn-danger" type="button" onclick="removeTransferDraftItem('${item.product_id}')">Quitar</button>
          </td>
        </tr>
      `).join('');
    }

    if (confirmBtn) {
      confirmBtn.disabled = !(sourceId && destId && sourceId !== destId && transferDraftItems.length > 0);
    }
  }

  window.updateTransferDraftQty = function (productId, rawQty) {
    const item = transferDraftItems.find(row => row.product_id === productId);
    if (!item) return;
    const qty = parseInt(rawQty || 0);
    if (!qty || qty < 1 || qty > item.source_stock) {
      showToast('Cantidad invalida para el stock disponible', 'warning');
      renderTransferDraft();
      return;
    }
    item.quantity = qty;
    renderTransferDraft();
  };

  window.removeTransferDraftItem = function (productId) {
    transferDraftItems = transferDraftItems.filter(item => item.product_id !== productId);
    renderTransferDraft();
  };

  function resetInventoryTransferDraft() {
    transferDraftItems = [];
    updateSelectedTransferProduct(null);
    renderTransferDraft();
  }

  async function confirmInventoryTransfer() {
    const sourceId = document.getElementById('inventoryTransferSourceStore')?.value;
    const destId = document.getElementById('inventoryTransferDestStore')?.value;
    const printTicket = document.getElementById('printTransferTicket')?.checked;
    const btn = document.getElementById('confirmInventoryTransferBtn');

    if (!sourceId || !destId || sourceId === destId) return showToast('Selecciona tiendas validas', 'warning');
    if (transferDraftItems.length === 0) return showToast('Agrega al menos un producto', 'warning');

    const sourceStore = transferStores.find(store => store.id === sourceId);
    const destStore = transferStores.find(store => store.id === destId);
    if (!sourceStore || !destStore) return showToast('No se encontraron las tiendas seleccionadas', 'error');

    if (!confirm(`Confirmar transferencia de ${transferDraftItems.length} producto(s) de ${sourceStore.name} a ${destStore.name}?`)) return;

    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Procesando...';

    try {
      const transfer = await executeMultiInventoryTransfer({
        sourceStore,
        destStore,
        items: transferDraftItems.map(item => ({ ...item }))
      });

      showToast(`Transferencia ${transfer.id} completada`, 'success');
      resetInventoryTransferDraft();
      await loadTransferSourceProducts(true);
      await loadInventoryTransferHistory();
      if (document.getElementById('section-inventory')?.classList.contains('active') && globalCurrentStoreId) {
        await loadInventoryTable(globalCurrentStoreId);
      }
      if (printTicket) printInventoryTransferTicket(transfer);
    } catch (error) {
      console.error('Multi transfer error:', error);
      showToast(error.message || 'Error al confirmar transferencia', 'error');
    } finally {
      btn.innerHTML = originalText;
      renderTransferDraft();
    }
  }

  async function executeMultiInventoryTransfer({ sourceStore, destStore, items }) {
    const transferId = `TR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase()}`;
    const rollback = [];

    for (const item of items) {
      const qty = parseInt(item.quantity || 0);
      if (!qty || qty < 1) throw new Error(`Cantidad invalida para ${item.name}`);

      const { data: sourceRow, error: sourceError } = await supabaseClient
        .from('inventory')
        .select('id, product_id, store_id, quantity, min_stock')
        .eq('store_id', sourceStore.id)
        .eq('product_id', item.product_id)
        .single();

      if (sourceError || !sourceRow) throw new Error(`No hay stock origen para ${item.name}`);
      if (parseInt(sourceRow.quantity || 0) < qty) throw new Error(`Stock insuficiente para ${item.name}`);

      const { data: destRow, error: destError } = await supabaseClient
        .from('inventory')
        .select('id, product_id, store_id, quantity, min_stock')
        .eq('store_id', destStore.id)
        .eq('product_id', item.product_id)
        .maybeSingle();

      if (destError) throw destError;

      const newSourceQty = parseInt(sourceRow.quantity || 0) - qty;
      const { error: updateSourceError } = await supabaseClient
        .from('inventory')
        .update({ quantity: newSourceQty, updated_at: new Date().toISOString() })
        .eq('id', sourceRow.id);

      if (updateSourceError) throw updateSourceError;
      rollback.push({ type: 'update', row: sourceRow });

      if (destRow) {
        const newDestQty = parseInt(destRow.quantity || 0) + qty;
        const { error: updateDestError } = await supabaseClient
          .from('inventory')
          .update({ quantity: newDestQty, updated_at: new Date().toISOString() })
          .eq('id', destRow.id);
        if (updateDestError) throw updateDestError;
        rollback.push({ type: 'update', row: destRow });
        cacheInventoryRow({ ...destRow, quantity: newDestQty });
      } else {
        const { data: insertedDest, error: insertDestError } = await supabaseClient
          .from('inventory')
          .insert({
            store_id: destStore.id,
            product_id: item.product_id,
            quantity: qty,
            min_stock: sourceRow.min_stock ?? item.min_stock ?? 10,
            updated_at: new Date().toISOString()
          })
          .select('id, product_id, store_id, quantity, min_stock')
          .single();
        if (insertDestError) throw insertDestError;
        rollback.push({ type: 'delete', row: insertedDest });
        cacheInventoryRow(insertedDest);
      }

      cacheInventoryRow({ ...sourceRow, quantity: newSourceQty });
      item.source_stock_after = newSourceQty;
    }

    const logRows = items.flatMap(item => [
      {
        store_id: sourceStore.id,
        product_id: item.product_id,
        employee_id: currentUser.id,
        type: 'transferencia',
        quantity: -Math.abs(parseInt(item.quantity || 0)),
        description: `Transferencia ${transferId} | Enviado a ${destStore.name} | Estado: completada`
      },
      {
        store_id: destStore.id,
        product_id: item.product_id,
        employee_id: currentUser.id,
        type: 'transferencia',
        quantity: Math.abs(parseInt(item.quantity || 0)),
        description: `Transferencia ${transferId} | Recibido de ${sourceStore.name} | Estado: completada`
      }
    ]);

    const { error: logError } = await supabaseClient.from('inventory_logs').insert(logRows);
    if (logError) {
      await rollbackInventoryTransfer(rollback);
      throw logError;
    }

    for (const item of items) {
      adjustCachedInventory(sourceStore.id, item.product_id, -Math.abs(parseInt(item.quantity || 0)));
      adjustCachedInventory(destStore.id, item.product_id, Math.abs(parseInt(item.quantity || 0)));
      await getCachedProductInventory(item.product_id, true);
    }

    return {
      id: transferId,
      created_at: new Date().toISOString(),
      sourceStore,
      destStore,
      employeeName: currentUser.full_name || currentUser.username || 'Usuario',
      status: 'completada',
      items
    };
  }

  async function rollbackInventoryTransfer(rollback) {
    for (const action of rollback.reverse()) {
      try {
        if (action.type === 'update') {
          await supabaseClient
            .from('inventory')
            .update({
              quantity: action.row.quantity,
              min_stock: action.row.min_stock,
              updated_at: new Date().toISOString()
            })
            .eq('id', action.row.id);
        } else if (action.type === 'delete') {
          await supabaseClient.from('inventory').delete().eq('id', action.row.id);
        }
      } catch (rollbackError) {
        console.error('Transfer rollback error:', rollbackError);
      }
    }
  }

  async function loadInventoryTransferHistory() {
    const tbody = document.getElementById('inventoryTransferHistoryBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Cargando historial...</td></tr>';
    }

    try {
      const { data, error } = await supabaseClient
        .from('inventory_logs')
        .select('id, store_id, product_id, quantity, type, description, created_at, product:products(name, barcode), employee:employees(full_name), store:stores(name)')
        .eq('type', 'transferencia')
        .order('created_at', { ascending: false })
        .limit(400);

      if (error) throw error;
      transferHistoryRows = groupInventoryTransferLogs(data || []);
      renderInventoryTransferHistory();
    } catch (error) {
      console.error('Error loading transfer history:', error);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error al cargar historial.</td></tr>';
    }
  }

  function groupInventoryTransferLogs(logs) {
    const groups = new Map();

    logs.forEach(log => {
      const transferId = parseTransferId(log.description) || `SIN-FOLIO-${log.created_at}`;
      if (!groups.has(transferId)) {
        groups.set(transferId, {
          id: transferId,
          created_at: log.created_at,
          sourceName: '',
          destName: '',
          employeeName: log.employee?.full_name || 'Sistema',
          status: parseTransferStatus(log.description),
          itemsMap: new Map(),
          rawLogs: []
        });
      }

      const group = groups.get(transferId);
      group.rawLogs.push(log);
      if (new Date(log.created_at) < new Date(group.created_at)) group.created_at = log.created_at;
      if (!group.employeeName || group.employeeName === 'Sistema') group.employeeName = log.employee?.full_name || group.employeeName;

      if (log.quantity < 0) {
        group.sourceName = group.sourceName || log.store?.name || parseStoreName(log.description, 'origen') || '';
      } else {
        group.destName = group.destName || log.store?.name || parseStoreName(log.description, 'destino') || '';
      }

      const inferredDest = parseStoreName(log.description, 'destino');
      const inferredSource = parseStoreName(log.description, 'origen');
      if (inferredDest) group.destName = inferredDest;
      if (inferredSource) group.sourceName = inferredSource;

      if (log.quantity < 0) {
        const key = log.product_id || log.product?.name || log.id;
        group.itemsMap.set(key, {
          product_id: log.product_id,
          name: log.product?.name || 'Producto',
          barcode: log.product?.barcode || '',
          quantity: Math.abs(parseInt(log.quantity || 0))
        });
      }
    });

    return Array.from(groups.values()).map(group => ({
      ...group,
      items: Array.from(group.itemsMap.values()),
      productsCount: Array.from(group.itemsMap.values()).length
    })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function parseTransferId(description = '') {
    return description.match(/Transferencia\s+([A-Z0-9-]+)/i)?.[1] || null;
  }

  function parseTransferStatus(description = '') {
    return description.match(/Estado:\s*([^|]+)/i)?.[1]?.trim() || 'completada';
  }

  function parseStoreName(description = '', type) {
    if (type === 'destino') return description.match(/Enviado a\s+([^|]+)/i)?.[1]?.trim() || null;
    if (type === 'origen') return description.match(/Recibido de\s+([^|]+)/i)?.[1]?.trim() || null;
    return null;
  }

  function renderInventoryTransferHistory() {
    const tbody = document.getElementById('inventoryTransferHistoryBody');
    if (!tbody) return;

    const term = document.getElementById('transferHistorySearch')?.value.toLowerCase().trim() || '';
    let rows = transferHistoryRows;
    if (term) {
      rows = rows.filter(row => [
        row.id,
        row.sourceName,
        row.destName,
        row.employeeName,
        row.status,
        ...row.items.map(item => `${item.name} ${item.barcode}`)
      ].join(' ').toLowerCase().includes(term));
    }

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay transferencias registradas.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.slice(0, 120).map(row => {
      const date = new Date(row.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const productLabel = row.items.length <= 1
        ? escapeHtml(row.items[0]?.name || 'Sin detalle')
        : `${row.items.length} productos`;
      return `
        <tr>
          <td>${date}</td>
          <td><code>${escapeHtml(row.id)}</code></td>
          <td>${escapeHtml(row.sourceName || 'Origen')}</td>
          <td>${escapeHtml(row.destName || 'Destino')}</td>
          <td>${productLabel}</td>
          <td>${escapeHtml(row.employeeName || 'Sistema')}</td>
          <td><span class="transfer-status">${escapeHtml(row.status)}</span></td>
          <td>
            <button class="btn btn-sm btn-secondary" type="button" onclick="viewInventoryTransfer('${row.id}')">Ver</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderOverviewTransferSummary(logs) {
    const container = document.getElementById('overviewTransfersPanel');
    if (!container) return;

    const rows = groupInventoryTransferLogs((logs || []).filter(log => log.type === 'transferencia')).slice(0, 5);
    if (rows.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div style="background:white; border:1px solid var(--border-light); border-radius:10px; padding:12px 16px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:8px;">
          <strong style="font-size:0.9rem;">Ultimas transferencias de inventario</strong>
          <button class="btn btn-sm btn-secondary" onclick="window.navigateToAdminSection('transfers')">Abrir modulo</button>
        </div>
        <div style="display:grid; gap:6px;">
          ${rows.map(row => `
            <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.82rem; border-top:1px solid #f3f4f6; padding-top:6px;">
              <span><code>${escapeHtml(row.id)}</code> ${escapeHtml(row.sourceName || 'Origen')} -> ${escapeHtml(row.destName || 'Destino')} (${row.items.length} producto(s))</span>
              <span style="color:#6b7280;">${new Date(row.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  window.viewInventoryTransfer = function (transferId) {
    const row = transferHistoryRows.find(item => item.id === transferId);
    if (!row) return showToast('No se encontro la transferencia', 'error');

    document.getElementById('modalContainer').innerHTML = `
      <div class="modal active">
        <div class="modal-content" style="max-width:760px;">
          <div class="modal-header">
            <h3>Transferencia ${escapeHtml(row.id)}</h3>
            <button class="modal-close" onclick="closeModal()">&times;</button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin-bottom:16px; font-size:0.9rem;">
            <div><strong>Fecha:</strong><br>${new Date(row.created_at).toLocaleString('es-MX')}</div>
            <div><strong>Estado:</strong><br><span class="transfer-status">${escapeHtml(row.status)}</span></div>
            <div><strong>Origen:</strong><br>${escapeHtml(row.sourceName || 'Origen')}</div>
            <div><strong>Destino:</strong><br>${escapeHtml(row.destName || 'Destino')}</div>
            <div><strong>Usuario:</strong><br>${escapeHtml(row.employeeName || 'Sistema')}</div>
          </div>
          <table class="table">
            <thead><tr><th>Producto</th><th>Codigo</th><th>Cantidad</th></tr></thead>
            <tbody>
              ${row.items.map(item => `
                <tr>
                  <td>${escapeHtml(item.name)}</td>
                  <td>${escapeHtml(item.barcode || '')}</td>
                  <td>${item.quantity}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="d-flex justify-between gap-2" style="margin-top:16px;">
            <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
            <button class="btn btn-primary" onclick="printInventoryTransferFromHistory('${row.id}')">Imprimir ticket</button>
          </div>
        </div>
      </div>
    `;
  };

  window.printInventoryTransferFromHistory = function (transferId) {
    const row = transferHistoryRows.find(item => item.id === transferId);
    if (!row) return;
    printInventoryTransferTicket({
      id: row.id,
      created_at: row.created_at,
      sourceStore: { name: row.sourceName },
      destStore: { name: row.destName },
      employeeName: row.employeeName,
      status: row.status,
      items: row.items
    });
  };

  function getThermalTicketStyles(extraStyles = '', cfgOverride = null) {
    const cfg = resolveTicketConfig(cfgOverride);
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      html, body {
        background: #fff;
        color: #000;
      }
      body {
        font-family: "Courier New", "Lucida Console", monospace;
        font-size: ${cfg.fontSize}px;
        font-weight: 700;
        line-height: 1.28;
        color: #000;
        width: ${cfg.printWidthMm}mm;
        max-width: ${cfg.printWidthMm}mm;
        margin: 0 auto;
        padding: ${cfg.marginVerticalMm}mm ${cfg.marginHorizontalMm}mm;
        text-rendering: geometricPrecision;
      }
      h2 {
        font-size: ${cfg.fontSize + 3}px;
        line-height: 1.15;
        text-align: center;
        margin-bottom: 4px;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .sub,
      .price-label,
      .cashier-line,
      .footer,
      .muted {
        color: #000;
        font-weight: 700;
      }
      .sub {
        text-align: center;
        font-size: 12px;
        margin-bottom: 3px;
      }
      .folio {
        text-align: center;
        font-size: 12px;
        font-weight: 900;
        color: #000;
        background: #fff;
        padding: 4px 0;
        margin: 7px 0;
        letter-spacing: 1px;
        border-top: 2px dashed #000;
        border-bottom: 2px dashed #000;
      }
      .price-label,
      .price-especial {
        text-align: center;
        font-size: 12px;
        margin-bottom: 4px;
      }
      .price-especial {
        font-weight: 900;
        color: #000;
      }
      hr,
      .line {
        border: none;
        border-top: 2px dashed #000;
        margin: 8px 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        font-size: 11px;
        color: #000;
        font-weight: 900;
        padding: 3px 2px;
        text-transform: uppercase;
        border-bottom: 2px solid #000;
      }
      td {
        font-size: 12px;
        font-weight: 700;
        color: #000;
        vertical-align: top;
      }
      strong,
      b {
        font-weight: 900;
        color: #000;
      }
      .total-row td {
        font-weight: 900;
        font-size: 15px;
        padding-top: 6px;
        border-top: 2px solid #000;
      }
      .footer {
        text-align: center;
        margin-top: 12px;
        font-size: 12px;
        line-height: 1.45;
      }
      .cashier-line {
        text-align: center;
        margin-top: 7px;
        font-size: 12px;
        border-top: 2px dashed #000;
        padding-top: 7px;
      }
      @media print {
        @page {
          size: ${cfg.paperWidth}mm auto;
          margin: 0;
        }
        body {
          width: ${cfg.printWidthMm}mm;
          max-width: ${cfg.printWidthMm}mm;
          padding: ${cfg.marginVerticalMm}mm ${cfg.marginHorizontalMm}mm;
        }
      }
      ${extraStyles}
    `;
  }

function getThermalTicketPreviewStyle() {
  const cfg = resolveTicketConfig();
  return `font-family:'Courier New','Lucida Console',monospace;font-size:${cfg.fontSize}px;font-weight:700;line-height:1.28;color:#000;width:${cfg.printWidthMm}mm;background:white;border:1px solid #d1d5db;border-radius:4px;padding:${cfg.marginVerticalMm}mm ${cfg.marginHorizontalMm}mm;box-shadow:0 2px 8px rgba(0,0,0,0.08);`;
}

  function printInventoryTransferTicket(transfer) {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);

    const rows = transfer.items.map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td style="text-align:center;">${item.quantity}</td>
      </tr>
    `).join('');

    frame.contentDocument.write(`
      <html>
        <head>
          <title>Transferencia ${escapeHtml(transfer.id)}</title>
          <style>${getThermalTicketStyles('th, td { padding: 4px 0; border-bottom: 1px dashed #000; } th { text-align: left; }')}</style>
        </head>
        <body>
          <h2>Transferencia de Inventario</h2>
          <div class="muted">Folio: ${escapeHtml(transfer.id)}</div>
          <div class="muted">Fecha: ${new Date(transfer.created_at).toLocaleString('es-MX')}</div>
          <div class="line"></div>
          <div><strong>Origen:</strong> ${escapeHtml(transfer.sourceStore?.name || '')}</div>
          <div><strong>Destino:</strong> ${escapeHtml(transfer.destStore?.name || '')}</div>
          <div><strong>Usuario:</strong> ${escapeHtml(transfer.employeeName || '')}</div>
          <div><strong>Estado:</strong> ${escapeHtml(transfer.status || 'completada')}</div>
          <div class="line"></div>
          <table>
            <thead><tr><th>Producto</th><th style="text-align:center;">Cant.</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="line"></div>
          <div style="text-align:center;">Comprobante interno</div>
        </body>
      </html>
    `);
    frame.contentDocument.close();
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (error) {
        console.error('Print transfer ticket error:', error);
      }
      setTimeout(() => frame.remove(), 1000);
    };
  }

  // Add/Edit Product Handler
  if (addProductBtn) {
    addProductBtn.addEventListener('click', () => {
      openProductModal();
    });
  }

  async function openProductModal(product = null) {
    // Load categories and brands first
    const [categoriesRes, brandsRes] = await Promise.all([
      supabaseClient.from('categories').select('*').order('name'),
      supabaseClient.from('brands').select('*').order('name')
    ]);

    const isEdit = !!product;
    const modalTitle = isEdit ? 'Editar Producto' : 'Agregar Nuevo Producto';
    const btnText = isEdit ? 'Guardar Cambios' : 'Agregar Producto';
    const canEnterCostPrice = isAdmin || !isEdit;

    // Current brand name (if editing)
    const currentBrandName = product?.brand?.name || '';
    const uniqueBrands = Array.from(
      new Map((brandsRes.data || []).map(b => [String(b.name || '').trim().toLowerCase(), b])).values()
    ).filter(b => b.name);

    const modalHTML = `
        <div class="modal active">
          <div class="modal-content">
            <div class="modal-header">
              <h3>${modalTitle}</h3>
              <button class="modal-close" onclick="closeModal()">&times;</button>
            </div>
            <form id="productForm">
              <input type="hidden" name="id" value="${product?.id || ''}">
                <div class="form-group">
                  <label class="form-label">Nombre del Producto</label>
                  <input type="text" class="form-control" name="name" value="${product?.name || ''}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Código de Barras</label>
                  <input type="text" class="form-control" name="barcode" value="${product?.barcode || ''}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Marca</label>
                  <input type="text" class="form-control" name="brandName" list="brandList"
                    value="${currentBrandName}" placeholder="Escribe o selecciona una marca" required>
                    <datalist id="brandList">
                      ${uniqueBrands.map(b => `<option value="${escapeHtml(b.name)}">`).join('')}
                    </datalist>
                </div>
                <div class="form-group">
                  <label class="form-label">Categoría</label>
                  <select class="form-control" name="category_id" required>
                    <option value="">Seleccionar categoría</option>
                    ${categoriesRes.data?.map(c => `<option value="${c.id}" ${product?.category_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                  </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; background: var(--bg-tertiary); padding: 1rem; border-radius: var(--radius-md);">
                  ${canEnterCostPrice ? `
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label text-sm">Precio de Compra</label>
                    <input type="number" step="0.01" class="form-control" name="cost_price" value="${product?.cost_price || ''}" placeholder="$0.00" required>
                  </div>
                  ` : ''}
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label text-sm" style="color: var(--primary); font-weight: bold;">Precio Menudeo (Público)</label>
                    <input type="number" step="0.01" class="form-control" name="retail_price" value="${product?.retail_price || ''}" placeholder="$0.00" required style="border-color: var(--primary);">
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label text-sm">Precio Mayoreo</label>
                    <input type="number" step="0.01" class="form-control" name="wholesale_price" value="${product?.wholesale_price || ''}" placeholder="$0.00" required>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label text-sm">Precio Distribuidor</label>
                    <input type="number" step="0.01" class="form-control" name="distributor_price" value="${product?.distributor_price || ''}" placeholder="$0.00" required>
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label">Descripción <small class="text-muted">(Opcional)</small></label>
                  <textarea class="form-control" name="description" rows="3">${product?.description || ''}</textarea>
                </div>
                <div class="d-flex gap-2 justify-between">
                  <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                  <button type="submit" class="btn btn-primary">${btnText}</button>
                </div>
            </form>
          </div>
        </div>
        `;

    document.getElementById('modalContainer').innerHTML = modalHTML;

    document.getElementById('productForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const productId = formData.get('id');
      const brandName = formData.get('brandName').trim(); // Get the text from input

      try {
        // 1. Handle Brand Logic (Find or Create)
        let brandId = null;
        if (brandName) {
          // Check if exists
          const { data: existingBrand } = await supabaseClient
            .from('brands')
            .select('id')
            .ilike('name', brandName) // Case insensitive check
            .maybeSingle(); // Returns null if not found instead of error

          if (existingBrand) {
            brandId = existingBrand.id;
          } else {
            // Create new brand
            const { data: newBrand, error: brandError } = await supabaseClient
              .from('brands')
              .insert({ name: brandName }) // Removed organization_id as column doesn't exist
              .select()
              .single();

            if (brandError) throw brandError;
            brandId = newBrand.id;
            showToast(`Nueva marca "${brandName}" creada`, 'success');
          }
        }

        // 2. Prepare Product Data
        const productData = {
          name: formData.get('name').trim(),
          barcode: formData.get('barcode')?.trim() || null,
          brand_id: brandId,
          category_id: formData.get('category_id') || null,
          retail_price: parseFloat(formData.get('retail_price') || 0),
          wholesale_price: parseFloat(formData.get('wholesale_price') || 0),
          distributor_price: parseFloat(formData.get('distributor_price') || 0),

          // Map unit_price to retail_price to satisfy DB constraint
          unit_price: parseFloat(formData.get('retail_price') || 0),

          description: formData.get('description') || null,
          organization_id: currentUser.organization_id
        };

        // An employee may set the purchase price only while creating a product.
        // Omit it on edits so the stored cost remains intact and undisclosed.
        if (isAdmin || !productId) {
          productData.cost_price = parseFloat(formData.get('cost_price') || 0);
        }

        let error;
        if (productId) {
          // Update
          const result = await supabaseClient
            .from('products')
            .update(productData)
            .eq('id', productId)
            .select('*, brand:brands(name), category:categories(name)')
            .single();
          error = result.error;
          if (!error) cacheProduct(result.data);
        } else {
          let existingInactive = null;
          if (productData.barcode) {
            const { data: inactiveProduct, error: inactiveError } = await supabaseClient
              .from('products')
              .select('id, is_active')
              .eq('barcode', productData.barcode)
              .eq('is_active', false)
              .maybeSingle();

            if (inactiveError) throw inactiveError;
            existingInactive = inactiveProduct;
          }

          const result = existingInactive
            ? await supabaseClient
              .from('products')
              .update({
                ...productData,
                is_active: true,
                updated_at: new Date().toISOString()
              })
              .eq('id', existingInactive.id)
              .select('*, brand:brands(name), category:categories(name)')
              .single()
            : await supabaseClient
              .from('products')
              .insert(productData)
              .select('*, brand:brands(name), category:categories(name)')
              .single();
          error = result.error;
          if (!error) cacheProduct(result.data);
        }

        if (error) throw error;

        closeModal();
        showToast(productId ? 'Producto actualizado' : 'Producto creado exitosamente', 'success');
        loadProducts();

      } catch (error) {
        console.error('Error saving product:', error);
        showToast('Error al guardar producto: ' + error.message, 'error');
      }
    });
  }

  // Expose to window
  window.openProductModal = openProductModal;

  // Ctrl+Alt+D — Descuento rápido en Corte de Caja (sin registro en DB)
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.altKey || e.key.toLowerCase() !== 'd') return;
    if (!document.getElementById('section-caja')?.classList.contains('active')) return;
    e.preventDefault();

    const existing = document.getElementById('_cajaDescuentoModal');
    if (existing) { existing.remove(); return; }

    const modal = document.createElement('div');
    modal.id = '_cajaDescuentoModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:14px;width:100%;max-width:380px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25);">
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:0.7rem;letter-spacing:2px;opacity:.8;text-transform:uppercase;">Corte de Caja</div>
            <h3 style="margin:4px 0 0;font-size:1.1rem;">Descontar de Efectivo</h3>
          </div>
          <button id="_cajaDescuentoClose" style="background:none;border:none;color:#fff;font-size:1.6rem;cursor:pointer;line-height:1;padding:0;">×</button>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;font-size:0.88rem;color:#6b7280;">El monto se descontará del efectivo esperado en pantalla. <strong>No se guarda en la base de datos.</strong></p>
          <label style="font-size:0.8rem;font-weight:700;color:#374151;display:block;margin-bottom:6px;letter-spacing:.5px;">MONTO A DESCONTAR ($)</label>
          <input id="_cajaDescuentoInput" type="number" min="0" step="0.01" placeholder="0.00"
            style="width:100%;padding:12px 14px;font-size:1.4rem;font-weight:700;border:2px solid #a5b4fc;border-radius:8px;text-align:right;outline:none;box-sizing:border-box;">
          <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">
            <button id="_cajaDescuentoCancelBtn" class="btn btn-secondary" style="border-radius:8px;">Cancelar</button>
            <button id="_cajaDescuentoConfirmBtn" class="btn btn-primary" style="border-radius:8px;background:#1d4ed8;border:none;">Aplicar Descuento</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const input = document.getElementById('_cajaDescuentoInput');
    input.focus();

    const close = () => modal.remove();
    document.getElementById('_cajaDescuentoClose').addEventListener('click', close);
    document.getElementById('_cajaDescuentoCancelBtn').addEventListener('click', close);
    modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') document.getElementById('_cajaDescuentoConfirmBtn').click();
      if (ev.key === 'Escape') close();
    });

    document.getElementById('_cajaDescuentoConfirmBtn').addEventListener('click', async () => {
      const amount = parseFloat(input.value || 0);
      if (!amount || amount <= 0) { showToast('Ingresa un monto mayor a 0', 'warning'); input.focus(); return; }

      const storeId = typeof _cajaCurrentStoreId !== 'undefined' ? _cajaCurrentStoreId : null;
      if (!storeId) { showToast('No hay tienda seleccionada en Corte de Caja', 'error'); close(); return; }

      const btn = document.getElementById('_cajaDescuentoConfirmBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

      // Buscar el último corte real (excluir cortes de tarjeta)
      const { data: cuts } = await supabaseClient
        .from('cash_registers')
        .select('id, opening_amount, opened_at, closed_at, difference')
        .eq('store_id', storeId)
        .eq('is_closed', true)
        .order('closed_at', { ascending: false })
        .limit(10);

      const isCardCut = (c) => {
        if (!c.opened_at || !c.closed_at) return false;
        return (new Date(c.closed_at) - new Date(c.opened_at)) < 1000
          && parseFloat(c.opening_amount) === 0
          && parseFloat(c.difference) === 0;
      };
      const lastReal = (cuts || []).find(c => !isCardCut(c));

      if (!lastReal) {
        showToast('No hay corte previo para ajustar. Haz un corte de caja primero.', 'warning');
        if (btn) { btn.disabled = false; btn.textContent = 'Aplicar Descuento'; }
        return;
      }

      // Usar el efectivo actual como base (no el opening del corte),
      // y actualizar closed_at a ahora para que las ventas del turno
      // queden "antes del corte" y no se sumen al nuevo efectivo.
      const currentEffective = parseMoneyValue(document.getElementById('cajaEfectivoTotal')?.value || 0);
      const newOpening = Math.max(0, currentEffective - amount);

      const { error } = await supabaseClient
        .from('cash_registers')
        .update({ opening_amount: newOpening, closed_at: new Date().toISOString() })
        .eq('id', lastReal.id);

      if (error) {
        showToast('Error al guardar ajuste: ' + error.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Aplicar Descuento'; }
        return;
      }

      showToast(`Ajuste de ${formatCurrencyMX(amount)} aplicado`, 'success');
      close();
      // Recargar todo desde la DB para que banner, historial y monto esperado queden consistentes
      if (typeof window.loadCajaData === 'function') await window.loadCajaData();
    });
  });

  // Load initial data is now handled in Default Load logic above
});

// Global helper functions
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Diseño de ticket por defecto. Cada tienda puede guardar el suyo en
// stores.settings.ticket (módulo Configuración); al iniciar sesión se carga
// en window.__activeTicketConfig y ambas copias de getThermalTicketStyles lo usan.
const DEFAULT_TICKET_CONFIG = {
  paperWidth: 80,
  printWidthMm: 72,
  fontSize: 14,
  headerTitle: '',
  headerLine1: '',
  headerLine2: '',
  marginHorizontalMm: 2,
  marginVerticalMm: 3,
  showFolio: true,
  showDateTime: true,
  showCustomer: true,
  showCashier: true,
  footerLine1: '¡Gracias por su compra!',
  footerLine2: 'La Casa del Ajo',
  footerLine3: '',
  cashierLabel: 'Atendió'
};

function resolveTicketConfig(cfgOverride = null) {
  return { ...DEFAULT_TICKET_CONFIG, ...(window.__activeTicketConfig || {}), ...(cfgOverride || {}) };
}

function buildTicketHeader({ storeName, folio, date, time, customer } = {}, cfgOverride = null) {
  const cfg = resolveTicketConfig(cfgOverride);
  const title = cfg.headerTitle || storeName || 'Tienda';
  const customLines = [cfg.headerLine1, cfg.headerLine2]
    .filter(Boolean)
    .map(line => `<div class="sub">${escapeHtml(line)}</div>`)
    .join('');
  const folioLine = cfg.showFolio && folio
    ? `<div class="folio">★ FOLIO: ${escapeHtml(folio)} ★</div>`
    : '';
  const dateTime = cfg.showDateTime
    ? `${date ? `<div class="sub">${escapeHtml(date)}</div>` : ''}${time ? `<div class="sub">${escapeHtml(time)}</div>` : ''}`
    : '';
  const customerLine = cfg.showCustomer && customer
    ? `<div class="sub" style="font-weight:900;margin-top:2px;">Cliente: ${escapeHtml(customer.name || '')}${customer.code ? ` (${escapeHtml(customer.code)})` : ''}</div>`
    : '';

  return `<h2>${escapeHtml(title)}</h2>${customLines}${folioLine}${dateTime}${customerLine}`;
}

function buildTicketFooter(cashierName = '', cfgOverride = null) {
  const cfg = resolveTicketConfig(cfgOverride);
  const footerLines = [cfg.footerLine1, cfg.footerLine2, cfg.footerLine3].filter(Boolean);
  const footer = footerLines.length
    ? `<div class="footer">${footerLines.map((line, index) => index === 1 ? `<strong>${escapeHtml(line)}</strong>` : escapeHtml(line)).join('<br>')}</div>`
    : '';
  const cashier = cfg.showCashier && cashierName
    ? `<div class="cashier-line">${escapeHtml(cfg.cashierLabel || 'Atendió')}: <strong>${escapeHtml(cashierName)}</strong></div>`
    : '';

  return footer || cashier ? `<hr>${footer}${cashier}` : '';
}

function getThermalTicketStyles(extraStyles = '', cfgOverride = null) {
  const cfg = resolveTicketConfig(cfgOverride);
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      background: #fff;
      color: #000;
    }
    body {
      font-family: "Courier New", "Lucida Console", monospace;
      font-size: ${cfg.fontSize}px;
      font-weight: 700;
      line-height: 1.28;
      color: #000;
      width: ${cfg.printWidthMm}mm;
      max-width: ${cfg.printWidthMm}mm;
      margin: 0 auto;
      padding: ${cfg.marginVerticalMm}mm ${cfg.marginHorizontalMm}mm;
      text-rendering: geometricPrecision;
    }
    h2 {
      font-size: ${cfg.fontSize + 3}px;
      line-height: 1.15;
      text-align: center;
      margin-bottom: 4px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .sub,
    .price-label,
    .cashier-line,
    .footer,
    .muted {
      color: #000;
      font-weight: 700;
    }
    .sub {
      text-align: center;
      font-size: 12px;
      margin-bottom: 3px;
    }
    .folio {
      text-align: center;
      font-size: 12px;
      font-weight: 900;
      color: #000;
      background: #fff;
      padding: 4px 0;
      margin: 7px 0;
      letter-spacing: 1px;
      border-top: 2px dashed #000;
      border-bottom: 2px dashed #000;
    }
    .price-label,
    .price-especial {
      text-align: center;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .price-especial {
      font-weight: 900;
      color: #000;
    }
    hr,
    .line {
      border: none;
      border-top: 2px dashed #000;
      margin: 8px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      font-size: 11px;
      color: #000;
      font-weight: 900;
      padding: 3px 2px;
      text-transform: uppercase;
      border-bottom: 2px solid #000;
    }
    td {
      font-size: 12px;
      font-weight: 700;
      color: #000;
      vertical-align: top;
    }
    strong,
    b {
      font-weight: 900;
      color: #000;
    }
    .total-row td {
      font-weight: 900;
      font-size: 15px;
      padding-top: 6px;
      border-top: 2px solid #000;
    }
    .footer {
      text-align: center;
      margin-top: 12px;
      font-size: 12px;
      line-height: 1.45;
    }
    .cashier-line {
      text-align: center;
      margin-top: 7px;
      font-size: 12px;
      border-top: 2px dashed #000;
      padding-top: 7px;
    }
    @media print {
        @page {
          size: ${cfg.paperWidth}mm auto;
          margin: 0;
        }
        body {
          width: ${cfg.printWidthMm}mm;
          max-width: ${cfg.printWidthMm}mm;
          padding: ${cfg.marginVerticalMm}mm ${cfg.marginHorizontalMm}mm;
        }
    }
    ${extraStyles}
  `;
}

function getThermalTicketPreviewStyle() {
  const cfg = resolveTicketConfig();
  return `font-family:'Courier New','Lucida Console',monospace;font-size:${cfg.fontSize}px;font-weight:700;line-height:1.28;color:#000;width:${cfg.printWidthMm}mm;background:white;border:1px solid #d1d5db;border-radius:4px;padding:${cfg.marginVerticalMm}mm ${cfg.marginHorizontalMm}mm;box-shadow:0 2px 8px rgba(0,0,0,0.08);`;
}

function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
  // Al cerrar el modal, devolver el foco a la ventana para que los inputs
  // respondan de inmediato (evita el bloqueo que se quitaba con Alt+Alt)
  window.electronAPI?.refocusWindow?.();
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `alert alert-${type}`;
  // Add styles dynamically or use existing css
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.padding = '1rem';
  toast.style.borderRadius = 'var(--radius-md)';
  toast.style.background = 'white';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  toast.style.zIndex = '10000';
  toast.textContent = message;

  // Add color bar based on type
  if (type === 'success') toast.style.borderLeft = '4px solid var(--success)';
  if (type === 'error') toast.style.borderLeft = '4px solid var(--error)';

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    button.textContent = '🔒';
  } else {
    input.type = 'password';
    button.textContent = '👁️';
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

// Placeholder functions for edit/delete (will be implemented)
// Implementations for edit/delete
async function editStore(id) {
  try {
      const { data, error } = await supabaseClient
      .from('stores')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    // Call the modal function exposed on window
    if (window.openStoreModal) {
      window.openStoreModal(data);
    } else {
      console.error('openStoreModal not found');
    }
  } catch (error) {
    console.error('Error fetching store:', error);
    showToast('Error al cargar datos de la tienda', 'error');
  }
}

async function deleteStore(id) {
  if (!requireAdminAction('eliminar tiendas')) return;
  if (!confirm('¿Estás seguro de que deseas eliminar esta tienda? Esta acción no se puede deshacer.')) return;

  try {
    const { error } = await supabaseClient
      .from('stores')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    showToast('Tienda eliminada correctamente', 'success');
    // We need to reload stores. finding the function might be tricky since it's inside scope.
    // But clicking the nav item refreshes it. or we can trigger a click.
    const navItem = document.querySelector('.nav-item[data-section="stores"]');
    if (navItem) navItem.click();

  } catch (error) {
    console.error('Error deleting store:', error);
    showToast('Error al eliminar tienda: ' + error.message, 'error');
  }
}

// Global exposure
window.editStore = editStore;
window.deleteStore = deleteStore;
async function editEmployee(id) {
  if (!Auth.isAdmin()) {
    showToast('Solo el administrador puede editar empleados', 'error');
    return;
  }

  try {
    let result = await supabaseClient
      .from('employees')
      .select('id, username, full_name, role, is_active, created_at, updated_at, avatar_url, organization_id, assigned_store_id, module_permissions')
      .eq('id', id)
      .single();

    const missingPermissionsColumn = `${result.error?.message || ''} ${result.error?.details || ''}`.toLowerCase();
    if (result.error && (missingPermissionsColumn.includes('module_permissions') || missingPermissionsColumn.includes('schema cache'))) {
      result = await supabaseClient
        .from('employees')
        .select('id, username, full_name, role, is_active, created_at, updated_at, avatar_url, organization_id, assigned_store_id')
        .eq('id', id)
        .single();
    }

    const { data, error } = result;
    if (error) throw error;
    if (window.openEmployeeModal) {
      window.openEmployeeModal(data);
    } else {
      console.error('openEmployeeModal not found');
    }
  } catch (error) {
    console.error('Error fetching employee:', error);
    showToast('Error al cargar datos del empleado', 'error');
  }
}

async function deleteEmployee(id) {
  if (!Auth.isAdmin()) {
    showToast('Solo el administrador puede eliminar empleados', 'error');
    return;
  }
  if (!confirm('¿Estás seguro de que deseas eliminar este empleado?')) return;

  try {
    const { error } = await supabaseClient
      .from('employees')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    showToast('Empleado eliminado correctamente', 'success');
    const navItem = document.querySelector('.nav-item[data-section="employees"]');
    if (navItem) navItem.click();
  } catch (error) {
    console.error('Error deleting employee:', error);
    showToast('Error al eliminar empleado: ' + error.message, 'error');
  }
}

// Global exposure
window.editEmployee = editEmployee;
window.deleteEmployee = deleteEmployee;
async function editProduct(id) {
  try {
    const cachedProductLists = [window.globalProductsList, window.posProductsCache].filter(Array.isArray);
    let data = cachedProductLists.flat().find(product => product.id === id) || null;
    let error = null;

    if (!data) {
      const result = await supabaseClient
        .from('products')
        .select(productCatalogSelect)
        .eq('id', id)
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) throw error;
    if (window.openProductModal) {
      await window.openProductModal(data);
    }
  } catch (error) {
    console.error('Error fetching product:', error);
    showToast('Error al cargar datos del producto', 'error');
  }
}

async function deleteProduct(id) {
  const user = Auth.getCurrentUser();
  if (!user || user.role !== 'admin') {
    showToast('No tienes permisos para eliminar productos', 'error');
    return;
  }
  if (!confirm('¿Estás seguro de que deseas eliminar este producto?')) return;

  try {
    const { data, error } = await supabaseClient
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, is_active')
      .single();

    if (error) throw error;

    cacheProduct(data || { id, is_active: false });
    showToast('Producto eliminado del catalogo correctamente', 'success');
    const navItem = document.querySelector('.nav-item[data-section="products"]');
    if (navItem) navItem.click();
  } catch (error) {
    console.error('Error deleting product:', error);
    showToast('Error al eliminar producto: ' + error.message, 'error');
  }
}

window.editProduct = editProduct;
window.deleteProduct = deleteProduct;

// NOTE: loadInventory is defined inside the DOMContentLoaded scope above
// ==========================================
// PUNTO DE VENTA (POS) LOGIC
// ==========================================

// --- Accordion toggle for Resumen section ---
window.toggleAccordion = function (bodyId) {
  const body = document.getElementById(bodyId);
  const storeId = bodyId.replace('acc-', '');
  const chevron = document.getElementById('acc-chevron-' + storeId);
  const header = document.getElementById('acc-hdr-' + storeId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'grid';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  if (header) header.style.background = isOpen ? 'white' : '#f0faf0';
};

// ==========================================
// CORTE DE CAJA LOGIC
// ==========================================

// State for corte de caja
let _cajaCurrentStoreId = null;
let _cajaEfectivoTotal = 0;
let _cajaTarjetaTotal = 0;
let _cajaSinceDate = null; // sales since last cut

async function loadCorteCaja() {
  const sel = document.getElementById('cajaStoreSelect');
  if (!sel) return;

  // Populate store dropdown
  let stores = [];
  try {
    stores = await getCachedActiveStores();
  } catch (storesErr) {
    showToast('Error al cargar tiendas: ' + storesErr.message, 'error');
    return;
  }
  sel.innerHTML = '<option value="">-- Elige una tienda --</option>';
  (stores || []).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.type === 'bodega' ? '🏭' : '🏪'} ${s.name}`;
    sel.appendChild(opt);
  });

  // If there was a previously selected store, keep it
  if (_cajaCurrentStoreId) {
    sel.value = _cajaCurrentStoreId;
    await loadCajaData();
  }
}

window.onCajaStoreChange = async function () {
  const sel = document.getElementById('cajaStoreSelect');
  _cajaCurrentStoreId = sel.value || null;
  if (_cajaCurrentStoreId) await loadCajaData();
  else document.getElementById('cajaPanel').style.display = 'none';
};

window.loadCajaData = async function () {
  if (!_cajaCurrentStoreId) return;

  // 1. Find last CASH cut (Normal cuts: opening_amount likely > 0 or expected_amount represents cash)
  // We'll identify bank/card cuts as records created by the quick bank-clearing action.
  // To get the real last CASH cut, we look for ones that ARE NOT card cuts
  const { data: allCuts } = await supabaseClient
    .from('cash_registers')
    .select('*')
    .eq('store_id', _cajaCurrentStoreId)
    .eq('is_closed', true)
    .order('closed_at', { ascending: false })
    .limit(20);

  const closedCuts = allCuts || [];

  // A bank cut is opened and closed immediately, has no cash left in drawer, and has no employee_id.
  // CRITICAL FIX: To prevent misidentifying a cash cut where the user withdrew 100% of cash as a card cut,
  // we check if the cut was opened AND closed in the exact same moment (time difference < 1 second).
  const isCardCut = (cut) => {
    if (!cut.opened_at || !cut.closed_at) return false;
    const oTime = new Date(cut.opened_at).getTime();
    const cTime = new Date(cut.closed_at).getTime();
    return (cTime - oTime) < 1000 && parseFloat(cut.opening_amount) === 0 && !cut.employee_id;
  };

  const lastCashCut = closedCuts.find(c => !isCardCut(c)) || null;
  const lastCardCut = closedCuts.find(c => isCardCut(c)) || null;

  _cajaSinceDate = lastCashCut?.closed_at || null;
  const cardSinceDate = lastCardCut?.closed_at || null;

  // Show last CASH cut info in the banner
  const lastCutEl = document.getElementById('cajaLastCut');
  if (lastCashCut) {
    const closedAt = formatAppDateTime(lastCashCut.closed_at);
    lastCutEl.innerHTML = `✅ Último corte general: <strong>${closedAt}</strong> — Dejado en caja: <strong>${formatCurrencyMX(lastCashCut.opening_amount)}</strong>`;
    lastCutEl.style.display = 'block';
  } else {
    lastCutEl.innerHTML = 'ℹ️ No hay cortes generales previos registrados para esta tienda.';
    lastCutEl.style.display = 'block';
  }

  // 2. Consulta de ventas en EFECTIVO puro y porción efectivo de pagos mixtos
  //    (desde el último corte de efectivo)
  let cashSalesQuery = supabaseClient
    .from('sales')
    .select('total, payment_method, cash_amount')
    .eq('store_id', _cajaCurrentStoreId)
    .in('payment_method', ['efectivo', 'mixto']);

  if (_cajaSinceDate) cashSalesQuery = cashSalesQuery.gt('sale_date', _cajaSinceDate);
  const { data: cashSalesData } = await cashSalesQuery;

  // Para efectivo puro: sumar el total. Para mixto: sumar solo cash_amount.
  _cajaEfectivoTotal = (cashSalesData || []).reduce((sum, s) => {
    if (s.payment_method === 'efectivo') return sum + parseFloat(s.total || 0);
    if (s.payment_method === 'mixto') return sum + parseFloat(s.cash_amount || 0);
    return sum;
  }, 0);
  if (lastCashCut) {
    _cajaEfectivoTotal += parseFloat(lastCashCut.opening_amount || 0);
  }

  // 3. Consulta de ventas en TARJETA pura y porción tarjeta de pagos mixtos
  let cardSalesQuery = supabaseClient
    .from('sales')
    .select('total, payment_method, card_amount, mixed_method')
    .eq('store_id', _cajaCurrentStoreId)
    .in('payment_method', ['tarjeta', 'Tarjeta', 'mixto']);

  if (cardSinceDate) cardSalesQuery = cardSalesQuery.gt('sale_date', cardSinceDate);
  const { data: cardSalesData } = await cardSalesQuery;

  // Para tarjeta pura: total. Para mixto con tarjeta: card_amount.
  _cajaTarjetaTotal = (cardSalesData || []).reduce((sum, s) => {
    if (s.payment_method === 'tarjeta' || s.payment_method === 'Tarjeta') return sum + parseFloat(s.total || 0);
    if (s.payment_method === 'mixto' && s.mixed_method?.includes('tarjeta')) return sum + parseFloat(s.card_amount || 0);
    return sum;
  }, 0);

  // 4. Consulta de TRANSFERENCIA pura y porción transferencia de pagos mixtos
  let transferSalesQuery = supabaseClient
    .from('sales')
    .select('total, payment_method, transfer_amount, mixed_method')
    .eq('store_id', _cajaCurrentStoreId)
    .in('payment_method', ['transferencia', 'mixto']);

  if (cardSinceDate) transferSalesQuery = transferSalesQuery.gt('sale_date', cardSinceDate);
  const { data: transferSalesData } = await transferSalesQuery;

  const _cajaTransferenciaTotal = (transferSalesData || []).reduce((sum, s) => {
    if (s.payment_method === 'transferencia') return sum + parseFloat(s.total || 0);
    if (s.payment_method === 'mixto' && s.mixed_method?.includes('transferencia')) return sum + parseFloat(s.transfer_amount || 0);
    return sum;
  }, 0);

  // Las transferencias se suman al total de tarjeta porque van al mismo banco.
  // Se detalla en la etiqueta del bloque de tarjeta para que el cajero lo sepa.
  _cajaTarjetaTotal += _cajaTransferenciaTotal;

  // Actualizar UI de totales
  document.getElementById('cajaEfectivoTotal').value = formatCurrencyMX(_cajaEfectivoTotal);
  // Label dinámico: indica si hay transferencias incluidas
  const cajaTarjetaLabelEl = document.getElementById('cajaTarjetaLabel');
  if (cajaTarjetaLabelEl) {
    cajaTarjetaLabelEl.textContent = _cajaTransferenciaTotal > 0
      ? `💳 Total Tarjeta + 🏦 Transf. ($${_cajaTransferenciaTotal.toFixed(2)})`
      : '💳 Total Tarjeta';
  }
  if (cajaTarjetaLabelEl) {
    cajaTarjetaLabelEl.textContent = _cajaTransferenciaTotal > 0
      ? `Total Tarjeta + Transf. (${formatCurrencyMX(_cajaTransferenciaTotal)})`
      : 'Total Tarjeta';
  }
  document.getElementById('cajaTarjetaTotal').textContent = formatCurrencyMX(_cajaTarjetaTotal);
  const cardWithdrawInput = document.getElementById('cajaTarjetaRetiroAmount');
  if (cardWithdrawInput) cardWithdrawInput.value = formatCurrencyMX(_cajaTarjetaTotal);
  // El botón "Marcar como Cobrada" aplica ahora a tarjeta+transferencia juntas

  // Pre-fill defaults: Withdraw = 0, Leave = Expected
  document.getElementById('cajaClosingAmount').value = ''; // Empty or 0 initially (Withdraw)
  document.getElementById('cajaLeaveAmount').value = formatCurrencyMX(_cajaEfectivoTotal); // Default: Leave everything

  // Initial calculation
  updateCajaDiff();

  // Load cut history
  const { data: history } = await supabaseClient
    .from('cash_registers')
    .select('*')
    .eq('store_id', _cajaCurrentStoreId)
    .order('opened_at', { ascending: false })
    .limit(8);

  const histEl = document.getElementById('cajaHistory');
  if (!history || history.length === 0) {
    histEl.innerHTML = '<p style="font-size:0.82rem; color:#9ca3af;">Sin cortes registrados.</p>';
  } else {
    histEl.innerHTML = history.map(h => {
      const dateStr = formatAppDateTime(h.closed_at || h.opened_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const closing = parseFloat(h.closing_amount || 0);
      const leaving = parseFloat(h.opening_amount || 0);
      const isBankCut = isCardCut(h);
      const retiroEfectivo = isBankCut ? 0 : Math.max(0, closing - leaving);
      const amountLabel = isBankCut ? 'Tarj/Transf.:' : 'Retiro efectivo:';
      const amount = isBankCut ? closing : retiroEfectivo;
      const diff = parseFloat(h.difference || 0);
      const diffText = isBankCut && Math.abs(diff) >= 0.01
        ? ` <span style="color:${diff < 0 ? '#dc2626' : '#16a34a'}; font-size:0.72rem;">Dif. ${diff >= 0 ? '+' : ''}${formatCurrencyMX(diff)}</span>`
        : '';
      const status = h.is_closed ? '🔒 Cerrado' : '🔓 Abierto';
      return `<div style="display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid #f3f4f6; font-size:0.82rem;">
        <span style="color:#374151;">${dateStr} &nbsp; <span style="font-size:0.72rem; color:#9ca3af;">${status}</span></span>
        <span>${amountLabel} <strong>${formatCurrencyMX(amount)}</strong>${diffText}
        </span>
      </div>`;
    }).join('');
  }

  document.getElementById('cajaPanel').style.display = 'block';
};

window.updateCajaDiff = function (source) {
  // Logic: 
  // Left Input (cajaClosingAmount) = Money to Withdraw
  // Right Input (cajaLeaveAmount) = Money to Leave
  // Expected (cajaEfectivoTotal input) = System Total

  const withdrawInput = document.getElementById('cajaClosingAmount');
  const leaveInput = document.getElementById('cajaLeaveAmount');
  const expectedInput = document.getElementById('cajaEfectivoTotal');

  const expected = parseMoneyValue(expectedInput.value);
  let withdraw = parseMoneyValue(withdrawInput.value);

  // If user is typing in Withdraw (Left), update Leave (Right)
  if (source === 'withdraw') {
    const calculatedLeave = expected - withdraw;
    leaveInput.value = formatCurrencyMX(calculatedLeave);
  }
  // If user is typing in Leave (Right), update Withdraw (Left)
  else if (source === 'leave') {
    // Standard asymmetric behavior: Do NOT update Withdraw automatically to allow diffs
    // But if we wanted to enforce equality, we'd do it here. 
    // User requested: "Manual modification" allowed, so we do nothing here for auto-calc
    // EXCEPT if we want to confirm the diff calculation is running.
  }
  // If user clicks Refresh Button (source = 'leave_refresh')
  else if (source === 'leave_refresh') {
    // "Update everything": This means the user is asserting that their physical count (Leave + Withdraw) 
    // IS the correct reality, and they want the system to accept it.
    // So we update Expected to match (Leave + Withdraw). Diff becomes 0.
    const currentLeave = parseMoneyValue(leaveInput.value);
    const newExpected = withdraw + currentLeave;
    expectedInput.value = formatCurrencyMX(newExpected);
    // Also likely want to ensure Withdraw is correct? 
    // If they typed 150 in Leave, and Withdraw is 0. Expected becomes 150.
  }

  // Reread leave because it might have been updated above or manually edited
  let leave = parseMoneyValue(leaveInput.value);

  // Implied Counted = Withdraw + Leave
  // Difference = Counted - Expected
  // (Withdraw + Leave) - Expected
  const counted = withdraw + leave;
  const diff = counted - expected;

  // Update Summary UI
  document.getElementById('cajaExpected').textContent = formatCurrencyMX(expected);

  // "Diferencia"
  document.getElementById('cajaDiff').textContent = `${diff >= 0 ? '+' : ''}${formatCurrencyMX(Math.abs(diff))}`;
  document.getElementById('cajaDiff').style.color = Math.abs(diff) < 0.01 ? '#6b7280' : (diff < 0 ? '#ef4444' : '#16a34a');

  // "A Retirar" (Visualization only, redundancy with input but good for summary)
  // In this logic, A Retirar IS the withdraw input.
  // The summary box "A Retirar" was calculated as Closing - Leave.
  // Now Closing IS Withdraw + Leave. So (Withdraw + Leave) - Leave = Withdraw.
  document.getElementById('cajaToRetire').textContent = formatCurrencyMX(withdraw);
};

window.vaciarTarjeta = async function () {
  if (!_cajaCurrentStoreId) return;
  if (!confirm(`¿Marcar $${_cajaTarjetaTotal.toFixed(2)} en tarjeta como cobrados/retirados? Esto registrará un corte parcial de tarjeta.`)) return;

  // Insert a partial register record for card clearing
  const { error } = await supabaseClient.from('cash_registers').insert({
    store_id: _cajaCurrentStoreId,
    opening_amount: 0,
    closing_amount: _cajaTarjetaTotal,
    expected_amount: _cajaTarjetaTotal,
    difference: 0,
    is_closed: true,
    opened_at: new Date().toISOString(),
    closed_at: new Date().toISOString()
  });

  if (error) { showToast('Error al registrar: ' + error.message, 'error'); return; }

  showToast(`✅ Tarjeta vaciada — $${_cajaTarjetaTotal.toFixed(2)} marcados como cobrados`, 'success');
  document.getElementById('cajaTarjetaTotal').textContent = '$0.00';
  _cajaTarjetaTotal = 0;
};

window.vaciarTarjeta = async function () {
  if (!_cajaCurrentStoreId) return;
  const amountInput = document.getElementById('cajaTarjetaRetiroAmount');
  const amountToClear = parseMoneyValue(amountInput?.value || _cajaTarjetaTotal);
  const expectedTotal = _cajaTarjetaTotal;

  if (expectedTotal <= 0) {
    showToast('No hay tarjeta o transferencias pendientes', 'info');
    return;
  }
  if (amountToClear <= 0) {
    showToast('Escribe el monto que quieres marcar como cobrado', 'warning');
    amountInput?.focus();
    return;
  }
  if (amountToClear > expectedTotal) {
    showToast('El monto cobrado no puede ser mayor al total pendiente', 'warning');
    amountInput?.focus();
    return;
  }

  const difference = amountToClear - expectedTotal;
  const diffLine = Math.abs(difference) >= 0.01
    ? `\nDiferencia registrada: ${difference >= 0 ? '+' : ''}${formatCurrencyMX(difference)}`
    : '';

  if (!confirm(`Marcar ${formatCurrencyMX(amountToClear)} como cobrado/retirado de tarjeta/transferencia?\n\nPendiente en sistema: ${formatCurrencyMX(expectedTotal)}${diffLine}\n\nEsto registrara un corte parcial bancario.`)) return;

  const { error } = await supabaseClient.from('cash_registers').insert({
    store_id: _cajaCurrentStoreId,
    opening_amount: 0,
    closing_amount: amountToClear,
    expected_amount: expectedTotal,
    difference,
    is_closed: true,
    opened_at: new Date().toISOString(),
    closed_at: new Date().toISOString()
  });

  if (error) { showToast('Error al registrar: ' + error.message, 'error'); return; }

  showToast(`Tarjeta/transferencia marcada - ${formatCurrencyMX(amountToClear)} cobrados`, 'success');
  document.getElementById('cajaTarjetaTotal').textContent = formatCurrencyMX(0);
  if (amountInput) amountInput.value = formatCurrencyMX(0);
  _cajaTarjetaTotal = 0;
  await loadCajaData();
};

/**
 * vaciarTransferencia()
 * Marca el total de transferencias como cobrado/retirado,
 * registrando un corte parcial en cash_registers y reseteando
 * el contador visual a $0.00.
 */
window.vaciarTransferencia = async function () {
  if (!_cajaCurrentStoreId) return;
  const transEl = document.getElementById('cajaTransferenciaTotal');
  const currentTotal = parseFloat(transEl?.textContent?.replace('$', '').replace(',', '') || 0);
  if (currentTotal <= 0) { showToast('No hay transferencias pendientes', 'info'); return; }
  if (!confirm(`¿Marcar $${currentTotal.toFixed(2)} en transferencias como cobrados? Esto registrará un corte parcial de transferencia.`)) return;

  // Registrar como corte parcial de transferencia
  const { error } = await supabaseClient.from('cash_registers').insert({
    store_id: _cajaCurrentStoreId,
    opening_amount: 0,
    closing_amount: currentTotal,
    expected_amount: currentTotal,
    difference: 0,
    is_closed: true,
    opened_at: new Date().toISOString(),
    closed_at: new Date().toISOString()
  });

  if (error) { showToast('Error al registrar: ' + error.message, 'error'); return; }

  showToast(`✅ Transferencia vaciada — $${currentTotal.toFixed(2)} marcados como cobrados`, 'success');
  if (transEl) transEl.textContent = '$0.00';
  const btnVaciarTransf = document.getElementById('btnVaciarTransferencia');
  if (btnVaciarTransf) btnVaciarTransf.style.display = 'none';
};

window.registrarCorte = async function () {
  if (!_cajaCurrentStoreId) { showToast('Selecciona una tienda primero', 'warning'); return; }

  const withdraw = parseMoneyValue(document.getElementById('cajaClosingAmount').value);
  const leave = parseMoneyValue(document.getElementById('cajaLeaveAmount').value);
  const expected = parseMoneyValue(document.getElementById('cajaEfectivoTotal').value);

  if (withdraw < 0) { showToast('El retiro no puede ser negativo', 'warning'); return; }
  // Leave can theoretically be whatever, but usually >= 0

  // Calculated actual money counted
  const closing = withdraw + leave;
  const difference = closing - expected;
  const formattedConfirmMsg = `Confirmar corte:\n\nEn caja contado: ${formatCurrencyMX(closing)}\nEsperado: ${formatCurrencyMX(expected)}\nDiferencia: ${difference >= 0 ? '+' : ''}${formatCurrencyMX(difference)}\n\nSe retira: ${formatCurrencyMX(withdraw)}\nSe deja: ${formatCurrencyMX(leave)}\n\nRegistrar corte?`;
  if (!confirm(formattedConfirmMsg)) return;

  const confirmMsg = `Confirmar corte:\n\n💵 En Caja (Calc): $${closing.toFixed(2)}\n📊 Esperado:    $${expected.toFixed(2)}\n❕ Diferencia:  $${difference.toFixed(2)}\n\n- Se retira:   $${withdraw.toFixed(2)}\n- Se deja:     $${leave.toFixed(2)}\n\n¿Registrar corte?`;
  if (false && !confirm(confirmMsg)) return;

  const currentUser = Auth.getCurrentUser();
  if (!currentUser?.id) {
    showToast('Sesion invalida. Cierra sesion y vuelve a entrar antes de registrar el corte.', 'error');
    return;
  }
  const employeeId = currentUser?.id || null;

  const { error } = await supabaseClient.from('cash_registers').insert({
    store_id: _cajaCurrentStoreId,
    employee_id: employeeId,
    opening_amount: leave,         // money left in register = next shift's opening
    closing_amount: closing,       // actual counted
    expected_amount: expected,      // what should be there from efectivo sales
    difference: difference,
    is_closed: true,
    opened_at: _cajaSinceDate || new Date().toISOString(),
    closed_at: new Date().toISOString()
  });

  if (error) { showToast('Error al registrar corte: ' + error.message, 'error'); return; }

  showToast(`Corte registrado - Retiro: ${formatCurrencyMX(closing - leave)} | Queda en caja: ${formatCurrencyMX(leave)}`, 'success');

  // Reset inputs and refresh
  document.getElementById('cajaClosingAmount').value = '';
  document.getElementById('cajaLeaveAmount').value = '';
  await loadCajaData();
};

let currentCart = [];
let posCurrentStoreId = null;
let currentPriceMode = 'retail'; // 'retail' | 'wholesale' | 'distributor'
let currentDiscount = { type: 'percent', value: 0 }; // active discount
let printTicketOnSale = false; // toggle: print ticket on Cobrar
let posCurrentCustomer = null; // Currently associated customer for the sale
let lastSaleData = null; // snapshot of last completed sale for ticket reprinting
const recentTicketCache = [];
let ticketHistoryLoadedForStore = null;
let ticketHistoryLoading = false;
let ticketHistoryRefreshTimer = null;

function cloneTicketData(ticket) {
  return JSON.parse(JSON.stringify(ticket));
}

function getTicketHistoryStore() {
  if (posCurrentStoreId) {
    return { id: posCurrentStoreId, name: document.getElementById('posStoreTitle')?.textContent || '' };
  }
  try {
    const rawStore = localStorage.getItem('selectedStore') || sessionStorage.getItem('pos_current_store');
    const store = rawStore ? JSON.parse(rawStore) : null;
    return store?.id ? { id: store.id, name: store.name || '' } : null;
  } catch (error) {
    return null;
  }
}

function getTicketHistoryStartIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function getSharedTicketSnapshot(sale, fallbackStoreName = '') {
  const items = (sale.items || []).map(item => ({
    id: item.product_id,
    name: item.product?.name || 'Producto no disponible',
    quantity: Number(item.quantity || 0),
    price: Number(item.unit_price || 0)
  }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = Number(sale.total || 0);
  const discountAmount = Math.max(0, subtotal - total);
  const paymentMethod = (sale.payment_method || 'efectivo').toLowerCase();

  return {
    id: sale.id,
    folio: sale.id.replace(/-/g, '').slice(-8).toUpperCase(),
    items,
    total,
    subtotal,
    discount: { type: 'fixed', value: discountAmount },
    paymentMethod,
    paid: total,
    mixedCashAmount: Number(sale.cash_amount || 0),
    mixedOtherAmount: Number(sale.card_amount || sale.transfer_amount || 0),
    mixedOtherMethod: sale.mixed_method?.includes('transferencia') ? 'transferencia' : 'tarjeta',
    customer: sale.customer ? { name: sale.customer.name, customer_code: sale.customer.customer_code } : null,
    priceMode: ({ Menudeo: 'retail', Mayoreo: 'wholesale', Distribuidor: 'distributor' })[sale.sale_type] || 'retail',
    employeeName: sale.employee?.full_name || sale.employee?.username || 'Usuario',
    storeName: sale.store?.name || fallbackStoreName || 'Tienda',
    storeId: sale.store_id,
    date: new Date(sale.sale_date || Date.now())
  };
}

async function loadSharedTickets(force = false) {
  const store = getTicketHistoryStore();
  if (!store?.id || ticketHistoryLoading) return;
  if (!force && ticketHistoryLoadedForStore === store.id) return;

  ticketHistoryLoading = true;
  try {
    const { data: sales, error } = await supabaseClient
      .from('sales')
      .select('id, store_id, total, payment_method, cash_amount, card_amount, transfer_amount, mixed_method, sale_date, sale_type, store:stores(name), employee:employees(full_name, username), customer:customers(name, customer_code), items:sale_items(product_id, quantity, unit_price, subtotal, product:products(name))')
      .eq('store_id', store.id)
      .gte('sale_date', getTicketHistoryStartIso())
      .order('sale_date', { ascending: false })
      .limit(300);

    if (error) throw error;
    recentTicketCache.splice(0, recentTicketCache.length, ...(sales || []).map(sale => getSharedTicketSnapshot(sale, store.name)));
    ticketHistoryLoadedForStore = store.id;
  } catch (error) {
    console.error('Error cargando tickets compartidos:', error);
    showToast('No se pudo cargar el historial de tickets: ' + error.message, 'error');
  } finally {
    ticketHistoryLoading = false;
  }
}

function startSharedTicketRefresh() {
  if (ticketHistoryRefreshTimer) return;
  ticketHistoryRefreshTimer = setInterval(() => {
    if (document.getElementById('section-tickets')?.classList.contains('active')) {
      loadTickets(true);
    }
  }, 15000);
}

function rememberRecentTicket(ticket) {
  if (!ticket || !ticket.id) return;
  const snapshot = cloneTicketData(ticket);
  const existingIndex = recentTicketCache.findIndex(item => item.id === snapshot.id);
  if (existingIndex >= 0) recentTicketCache.splice(existingIndex, 1);
  recentTicketCache.unshift(snapshot);
  if (document.getElementById('section-tickets')?.classList.contains('active')) {
    renderTicketsList();
  }
}

function getTicketTotal(ticket) {
  const subtotal = (ticket.items || []).reduce((sum, item) => sum + (parseFloat(item.price || 0) * parseInt(item.quantity || 0)), 0);
  const discount = ticket.discount || { type: 'percent', value: 0 };
  const discountValue = parseFloat(discount.value || 0);
  const discountAmount = discountValue > 0
    ? (discount.type === 'percent' ? subtotal * (discountValue / 100) : Math.min(discountValue, subtotal))
    : 0;
  return Math.max(0, subtotal - discountAmount);
}

function renderTicketsList() {
  const list = document.getElementById('ticketsList');
  if (!list) return;

  if (recentTicketCache.length === 0) {
    list.innerHTML = `
      <div style="text-align:center; padding:2rem; color:#64748b;">
        No hay tickets registrados hoy en esta tienda.
      </div>`;
    return;
  }

  list.innerHTML = recentTicketCache.map((ticket, index) => {
    const customerName = ticket.customer?.name || 'Sin cliente';
    const itemCount = (ticket.items || []).reduce((sum, item) => sum + parseInt(item.quantity || 0), 0);
    const total = getTicketTotal(ticket);
    const timeText = formatAppDateTime(ticket.date || Date.now(), {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <div onclick="previewRecentTicket('${ticket.id}')" title="Ver vista previa del ticket"
           style="display:grid; grid-template-columns:52px 1fr auto; gap:14px; align-items:center; padding:14px 12px; border-bottom:1px solid #e5e7eb; cursor:pointer;">
        <div style="width:42px; height:42px; display:grid; place-items:center; border-radius:8px; background:#edf7ed; color:#1e4d0f; font-weight:800;">
          #${index + 1}
        </div>
        <div style="min-width:0;">
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <strong style="font-size:1rem; color:#111;">${escapeHtml(ticket.folio || 'SIN FOLIO')}</strong>
            <span class="badge badge-success" style="background:#e6f4ea; color:#1e7e34;">${escapeHtml(ticket.storeName || 'Tienda')}</span>
          </div>
          <div style="margin-top:4px; color:#64748b; font-size:0.86rem;">
            ${escapeHtml(timeText)} · ${escapeHtml(customerName)} · ${itemCount} pieza(s) · ${formatCurrencyMX(total)}
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-sm btn-primary" title="Imprimir ticket en la impresora configurada" onclick="event.stopPropagation(); reprintRecentTicket('${ticket.id}')">Ticket</button>
          <button class="btn btn-sm btn-secondary" title="Ver version formal para hoja carta" onclick="event.stopPropagation(); previewLetterTicket('${ticket.id}')">Carta</button>
        </div>
      </div>`;
  }).join('');
}

async function loadTickets(force = true) {
  await loadSharedTickets(force);
  renderTicketsList();
  startSharedTicketRefresh();
}

async function printHtmlSilently(ticketHTML) {
  if (window.electronAPI?.printHtml) {
    const result = await window.electronAPI.printHtml(ticketHTML);
    restorePOSInteractionFocus(document.getElementById('posSearchProduct'), { forceSearch: true, delayMs: 100 });
    return result;
  }

  return new Promise((resolve) => {
    let printFrame = document.getElementById('_fallbackPrintFrame');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = '_fallbackPrintFrame';
      printFrame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(printFrame);
    }
    printFrame.srcdoc = ticketHTML;
    printFrame.onload = () => {
      try { printFrame.contentWindow.focus(); printFrame.contentWindow.print(); } catch (e) { console.error(e); }
      setTimeout(() => restorePOSInteractionFocus(document.getElementById('posSearchProduct'), { forceSearch: true }), 150);
      resolve({ ok: true });
    };
  });
}

window.loadTickets = loadTickets;
window.previewRecentTicket = async function (ticketId) {
  await loadSharedTickets();
  const ticket = recentTicketCache.find(item => item.id === ticketId);
  if (!ticket) {
    showToast('Ese ticket ya no está disponible en el historial de esta tienda', 'warning');
    renderTicketsList();
    return;
  }
  printTicket(cloneTicketData(ticket), false, true);
};

window.reprintRecentTicket = async function (ticketId) {
  await loadSharedTickets();
  const ticket = recentTicketCache.find(item => item.id === ticketId);
  if (!ticket) {
    showToast('Ese ticket ya no está disponible en el historial de esta tienda', 'warning');
    renderTicketsList();
    return;
  }
  printTicket(cloneTicketData(ticket), true);
};

function buildLetterTicketDocument(saleData) {
  const cfg = resolveTicketConfig();
  const cart = saleData?.items || [];
  if (!cart.length) return null;

  const storeName = saleData.storeName || 'Tienda';
  const now = new Date(saleData.date || Date.now());
  const dateText = formatAppDateTime(now, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const discount = saleData.discount || { type: 'percent', value: 0 };
  const discountValue = Number(discount.value || 0);
  const discountAmount = discountValue > 0
    ? (discount.type === 'percent' ? subtotal * (discountValue / 100) : Math.min(discountValue, subtotal))
    : 0;
  const total = Math.max(0, subtotal - discountAmount);
  const customer = saleData.customer?.name || 'Publico general';
  const customerCode = saleData.customer?.customer_code ? ` (${saleData.customer.customer_code})` : '';
  const cashier = saleData.employeeName || 'Usuario';
  const paymentMethod = String(saleData.paymentMethod || 'efectivo').toLowerCase();
  const paymentLabel = ({ tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Pago mixto', efectivo: 'Efectivo' })[paymentMethod] || 'Efectivo';
  const headerLines = [cfg.headerLine1, cfg.headerLine2].filter(Boolean);
  const totalItems = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const itemRows = cart.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.price || 0);
    return `<tr><td>${index + 1}</td><td>${escapeHtml(item.name || 'Producto')}</td><td class="numeric">${quantity}</td><td class="numeric">$${unitPrice.toFixed(2)}</td><td class="numeric">$${(quantity * unitPrice).toFixed(2)}</td></tr>`;
  }).join('');

  const body = `
    <main class="letter-ticket">
      <header class="letter-header"><h1>${escapeHtml(cfg.headerTitle || storeName)}</h1>${headerLines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</header>
      <section class="letter-meta">
        <div><span>Folio</span><strong>${escapeHtml(saleData.folio || 'SIN FOLIO')}</strong></div>
        <div><span>Fecha</span><strong>${escapeHtml(dateText)}</strong></div>
        <div><span>Cliente</span><strong>${escapeHtml(customer + customerCode)}</strong></div>
        <div><span>Atendio</span><strong>${escapeHtml(cashier)}</strong></div>
      </section>
      <section><h2>Detalle de productos</h2><table class="letter-table"><thead><tr><th>#</th><th>Producto</th><th class="numeric">Cantidad</th><th class="numeric">P. unitario</th><th class="numeric">Importe</th></tr></thead><tbody>${itemRows}</tbody></table></section>
      <section class="letter-summary">
        <div class="letter-payment"><span>Metodo de pago</span><strong>${escapeHtml(paymentLabel)}</strong><small>${totalItems} pieza(s)</small></div>
        <table><tbody><tr><td>Subtotal</td><td>$${subtotal.toFixed(2)}</td></tr>${discountAmount > 0 ? `<tr class="discount"><td>Descuento</td><td>-$${discountAmount.toFixed(2)}</td></tr>` : ''}<tr class="grand-total"><td>Total</td><td>$${total.toFixed(2)}</td></tr></tbody></table>
      </section>
      <footer>${escapeHtml(cfg.footerLine1 || 'Gracias por su compra.')}${cfg.footerLine2 ? `<br><strong>${escapeHtml(cfg.footerLine2)}</strong>` : ''}${cfg.footerLine3 ? `<br>${escapeHtml(cfg.footerLine3)}` : ''}</footer>
    </main>`;

  const styles = `
    @page { size: letter; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17251a; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
    .letter-ticket { width: 100%; max-width: 816px; margin: 0 auto; padding: 42px 48px 56px; color: #17251a; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
    .letter-header { border-bottom: 3px solid #1e5b24; padding: 0 0 18px; margin-bottom: 22px; text-align: center; }
    .letter-header h1 { margin: 0 0 7px; color: #17451c; font-size: 25px; line-height: 1.15; letter-spacing: 0; }
    .letter-header p { margin: 3px 0; color: #52665a; }
    .letter-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 28px; padding: 14px; background: #f2f8f1; border: 1px solid #d8e8d7; margin-bottom: 22px; }
    .letter-meta div { min-width: 0; display: grid; gap: 3px; }
    .letter-meta span, .letter-payment span { color: #64736a; font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
    .letter-meta strong { overflow-wrap: anywhere; font-size: 12px; }
    .letter-ticket h2 { margin: 0 0 10px; font-size: 14px; color: #17451c; }
    .letter-table { width: 100%; border-collapse: collapse; }
    .letter-table th { padding: 10px 8px; background: #1e5b24; color: #fff; font-size: 10px; letter-spacing: .4px; text-align: left; text-transform: uppercase; }
    .letter-table td { padding: 10px 8px; border-bottom: 1px solid #dce6dd; vertical-align: top; }
    .letter-table tbody tr:nth-child(even) { background: #f8fbf8; }
    .numeric { text-align: right !important; white-space: nowrap; }
    .letter-summary { display: flex; justify-content: space-between; gap: 30px; align-items: flex-end; max-width: 620px; margin: 28px auto 0; }
    .letter-payment { display: grid; gap: 5px; color: #263b2a; }
    .letter-payment small { color: #64736a; }
    .letter-summary table { min-width: 245px; border-collapse: collapse; }
    .letter-summary td { padding: 6px 0 6px 20px; text-align: right; }
    .letter-summary td:first-child { color: #52665a; }
    .letter-summary .discount td { color: #b42318; }
    .grand-total td { padding-top: 11px; border-top: 2px solid #1e5b24; color: #17451c !important; font-size: 18px; font-weight: 800; }
    .letter-ticket footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #dce6dd; color: #52665a; text-align: center; line-height: 1.65; }
    @media print { body { font-size: 11px; } .letter-ticket { max-width: none; padding: 28px 34px 38px; } }
  `;

  return { body, styles, html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Venta ${escapeHtml(saleData.folio || '')}</title><style>${styles}</style></head><body>${body}</body></html>` };
}

function showLetterTicketPreview(saleData) {
  const documentData = buildLetterTicketDocument(saleData);
  if (!documentData) {
    showToast('El ticket no tiene productos para imprimir', 'warning');
    return;
  }

  let modal = document.getElementById('_letterTicketPreviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_letterTicketPreviewModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(10,20,12,.62);z-index:10000;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(3px);';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:8px;width:min(1040px,96vw);max-height:94vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.36);overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid #dfe7df;flex-shrink:0;">
          <div><strong style="font-size:1rem;color:#17251a;">Vista previa en hoja carta</strong><div style="font-size:.78rem;color:#64736a;margin-top:3px;">Elige la impresora y papel en el cuadro de impresion.</div></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;"><button id="_letterTicketPrintBtn" class="btn btn-primary">Imprimir en hoja carta</button><button id="_letterTicketPdfBtn" class="btn btn-secondary">Guardar PDF</button><button id="_letterTicketCloseBtn" class="btn btn-secondary" aria-label="Cerrar vista previa">X</button></div>
        </div>
        <div style="overflow:auto;padding:24px;background:#edf1ed;"><iframe id="_letterTicketPreviewContent" title="Vista previa del ticket en hoja carta" style="display:block;background:#fff;width:min(816px,100%);height:1056px;margin:0 auto;border:none;box-shadow:0 3px 14px rgba(0,0,0,.18);"></iframe></div>
      </div>`;
    document.body.appendChild(modal);
  }

  const closeModal = () => {
    modal.style.display = 'none';
    window.electronAPI?.refocusWindow?.();
  };
  document.getElementById('_letterTicketPreviewContent').srcdoc = documentData.html;
  modal.style.display = 'flex';
  document.getElementById('_letterTicketCloseBtn').onclick = closeModal;
  document.getElementById('_letterTicketPrintBtn').onclick = async () => {
    try {
      if (window.electronAPI?.printHtmlWithDialog) {
        await window.electronAPI.printHtmlWithDialog(documentData.html);
      } else {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(documentData.html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
      showToast('Se abrio el cuadro de impresion para hoja carta', 'success');
    } catch (error) {
      console.error('Error imprimiendo en hoja carta:', error);
      showToast('No se pudo imprimir en hoja carta: ' + error.message, 'error');
    }
  };
  document.getElementById('_letterTicketPdfBtn').onclick = async () => {
    if (!window.electronAPI?.saveHtmlAsPdf) {
      showToast('Guardar PDF esta disponible solo en la app de escritorio', 'warning');
      return;
    }

    try {
      const result = await window.electronAPI.saveHtmlAsPdf(
        documentData.html,
        `Ticket ${saleData.folio || 'venta'}.pdf`
      );
      if (!result?.canceled) showToast('Ticket guardado como PDF', 'success');
    } catch (error) {
      console.error('Error guardando ticket como PDF:', error);
      showToast('No se pudo guardar el PDF: ' + error.message, 'error');
    }
  };
}

window.previewLetterTicket = async function (ticketId) {
  await loadSharedTickets();
  const ticket = recentTicketCache.find(item => item.id === ticketId);
  if (!ticket) {
    showToast('Ese ticket ya no esta disponible en el historial de esta tienda', 'warning');
    renderTicketsList();
    return;
  }
  showLetterTicketPreview(cloneTicketData(ticket));
};

// --- Estado de Pago Mixto ---
// Se resetean en clearCart() después de cada venta o cancelación.
let mixedCashAmount = 0;      // Porción en efectivo del pago mixto
let mixedOtherAmount = 0;     // Porción en tarjeta/transferencia del pago mixto
let mixedOtherMethod = 'tarjeta'; // 'tarjeta' | 'transferencia'
let mixedPaymentConfirmed = false; // true sólo cuando el cajero hizo clic en "Confirmar Pago Mixto"

let posSaleTabs = [];
let activePosSaleTabId = null;
let posSaleTabCounter = 0;
let posSaleProcessing = false;

function getActiveSaleTab() {
  return posSaleTabs.find(tab => tab.id === activePosSaleTabId) || null;
}

function createBlankSaleTab() {
  posSaleTabCounter += 1;
  return {
    // El contador solo da un id único; la etiqueta visible se calcula por posición.
    id: `sale-tab-${Date.now()}-${posSaleTabCounter}`,
    cart: [],
    priceMode: 'retail',
    discount: { type: 'percent', value: 0 },
    customer: null,
    paymentMethod: 'efectivo',
    amountPaid: '',
    mixedCashInput: '',
    mixedRestMethod: 'tarjeta',
    mixedCashAmount: 0,
    mixedOtherAmount: 0,
    mixedOtherMethod: 'tarjeta',
    mixedPaymentConfirmed: false,
    printTicketOnSale: false
  };
}

function getCartFinancials(cart = currentCart, discount = currentDiscount) {
  const subtotal = (cart || []).reduce((sum, item) => sum + (parseFloat(item.price || 0) * parseFloat(item.quantity || 0)), 0);
  const discountValue = parseFloat(discount?.value || 0);
  const discountAmount = discountValue > 0
    ? (discount?.type === 'percent' ? subtotal * (discountValue / 100) : Math.min(discountValue, subtotal))
    : 0;
  return { subtotal, discountAmount, total: Math.max(0, subtotal - discountAmount) };
}

function captureActiveSaleTabFromUI() {
  const tab = getActiveSaleTab();
  if (!tab) return;

  tab.cart = cloneTicketData(currentCart || []);
  tab.priceMode = currentPriceMode || 'retail';
  tab.discount = { ...(currentDiscount || { type: 'percent', value: 0 }) };
  tab.customer = posCurrentCustomer ? { ...posCurrentCustomer } : null;
  tab.paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'efectivo';
  tab.amountPaid = document.getElementById('posAmountPaid')?.value || '';
  tab.mixedCashInput = document.getElementById('posMixedCash')?.value || '';
  tab.mixedRestMethod = document.getElementById('posMixedRestMethod')?.value || mixedOtherMethod || 'tarjeta';
  tab.mixedCashAmount = mixedCashAmount || 0;
  tab.mixedOtherAmount = mixedOtherAmount || 0;
  tab.mixedOtherMethod = mixedOtherMethod || 'tarjeta';
  tab.mixedPaymentConfirmed = mixedPaymentConfirmed === true;
  tab.printTicketOnSale = printTicketOnSale === true;
}

function syncPriceModeButtons(mode = currentPriceMode) {
  ['retail', 'wholesale', 'distributor'].forEach(m => {
    const btn = document.getElementById(`priceMode_${m}`);
    if (btn) {
      btn.style.background = m === mode ? 'var(--primary, #2d6a2d)' : 'white';
      btn.style.color = m === mode ? 'white' : '#555';
      btn.style.borderColor = 'var(--primary, #2d6a2d)';
    }
  });
}

function syncTicketToggleButton() {
  const btn = document.getElementById('btnTicketToggle');
  if (!btn) return;
  if (printTicketOnSale) {
    btn.style.background = '#2d6a2d';
    btn.style.color = 'white';
    btn.style.borderColor = '#2d6a2d';
    btn.textContent = '✅ Imprimir Ticket';
  } else {
    btn.style.background = '#f8f9fa';
    btn.style.color = '#666';
    btn.style.borderColor = '#ddd';
    btn.textContent = '🖨️ Ticket';
  }
}

function applySaleTabToUI(tab) {
  currentCart = cloneTicketData(tab?.cart || []);
  currentPriceMode = tab?.priceMode || 'retail';
  currentDiscount = { ...(tab?.discount || { type: 'percent', value: 0 }) };
  posCurrentCustomer = tab?.customer ? { ...tab.customer } : null;
  printTicketOnSale = tab?.printTicketOnSale === true;
  mixedCashAmount = parseFloat(tab?.mixedCashAmount || 0);
  mixedOtherAmount = parseFloat(tab?.mixedOtherAmount || 0);
  mixedOtherMethod = tab?.mixedOtherMethod || tab?.mixedRestMethod || 'tarjeta';
  mixedPaymentConfirmed = tab?.mixedPaymentConfirmed === true;

  const discountInput = document.getElementById('posDiscountInput');
  if (discountInput) discountInput.value = currentDiscount.value || '';
  const discountType = document.getElementById('posDiscountType');
  if (discountType) discountType.value = currentDiscount.type || 'percent';
  const amountPaid = document.getElementById('posAmountPaid');
  if (amountPaid) setPosAmountPaidValue(amountPaid, tab?.amountPaid || '');
  const mixedCashInput = document.getElementById('posMixedCash');
  if (mixedCashInput) mixedCashInput.value = tab?.mixedCashInput || '';
  const mixedRestMethod = document.getElementById('posMixedRestMethod');
  if (mixedRestMethod) mixedRestMethod.value = tab?.mixedRestMethod || mixedOtherMethod || 'tarjeta';
  const mixedOtherInput = document.getElementById('posMixedOther');
  if (mixedOtherInput) mixedOtherInput.value = mixedOtherAmount ? mixedOtherAmount.toFixed(2) : '';
  const mixedStatus = document.getElementById('mixedPaymentStatus');
  if (mixedStatus) {
    if (mixedPaymentConfirmed) {
      const methodLabel = mixedOtherMethod === 'tarjeta' ? 'Tarjeta' : 'Transferencia';
      mixedStatus.textContent = `Confirmado: ${formatCurrencyMX(mixedCashAmount)} + ${methodLabel} ${formatCurrencyMX(mixedOtherAmount)}`;
      mixedStatus.style.display = 'block';
    } else {
      mixedStatus.textContent = '';
      mixedStatus.style.display = 'none';
    }
  }

  syncPriceModeButtons(currentPriceMode);
  syncTicketToggleButton();
  selectPayment(tab?.paymentMethod || 'efectivo');
  if (tab?.paymentMethod === 'mixto') {
    mixedCashAmount = parseFloat(tab?.mixedCashAmount || 0);
    mixedOtherAmount = parseFloat(tab?.mixedOtherAmount || 0);
    mixedOtherMethod = tab?.mixedOtherMethod || tab?.mixedRestMethod || 'tarjeta';
    mixedPaymentConfirmed = tab?.mixedPaymentConfirmed === true;
    const restoredOtherInput = document.getElementById('posMixedOther');
    if (restoredOtherInput) restoredOtherInput.value = mixedOtherAmount ? mixedOtherAmount.toFixed(2) : '';
    const restoredStatus = document.getElementById('mixedPaymentStatus');
    if (restoredStatus) {
      if (mixedPaymentConfirmed) {
        const methodLabel = mixedOtherMethod === 'tarjeta' ? 'Tarjeta' : 'Transferencia';
        restoredStatus.textContent = `Confirmado: ${formatCurrencyMX(mixedCashAmount)} + ${methodLabel} ${formatCurrencyMX(mixedOtherAmount)}`;
        restoredStatus.style.display = 'block';
      } else {
        restoredStatus.textContent = '';
        restoredStatus.style.display = 'none';
      }
    }
  }

  syncPosCustomerUIFromState();
  renderCart();
  renderSaleTabs();
}

function getSaleTabLabel(tab, index) {
  const customerName = tab.customer?.name || tab.customer?.full_name;
  if (customerName) return customerName.split(' ')[0].slice(0, 12);
  // Numeración por posición: siempre contigua (1, 2, 3...) y se reordena al cerrar pestañas.
  return `Venta ${index + 1}`;
}

function renderSaleTabs() {
  const tabsEl = document.getElementById('posSaleTabs');
  if (!tabsEl) return;

  tabsEl.innerHTML = posSaleTabs.map((tab, index) => {
    const active = tab.id === activePosSaleTabId;
    const count = Math.round((tab.cart || []).reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0) * 1000) / 1000;
    const total = getCartFinancials(tab.cart, tab.discount).total;
    const label = escapeHtml(getSaleTabLabel(tab, index));
    const idleClose = active ? '#94a3b8' : '#cbd5e1';
    // Monto en línea solo si la pestaña ya tiene artículos (mantiene el chip de una sola línea).
    const meta = count > 0
      ? `<span style="color:#94a3b8; font-weight:500; font-size:0.72rem; margin-left:6px;">${formatCurrencyMX(total)}</span>`
      : '';
    // Pestaña inactiva: casi transparente con leve hover (estilo navegador). Activa: tarjeta blanca.
    const hover = active
      ? ''
      : `onmouseover="this.style.background='#f1f5f9';" onmouseout="this.style.background='transparent';"`;
    return `
      <div ${hover}
           style="display:flex; align-items:center; border:1px solid ${active ? '#bcd9bc' : 'transparent'}; border-radius:8px; background:${active ? '#fff' : 'transparent'}; flex-shrink:0; box-shadow:${active ? '0 1px 2px rgba(45,106,45,.10)' : 'none'}; transition:background .12s;">
        <button type="button" onclick="switchSaleTab('${tab.id}')"
                style="border:none; background:transparent; padding:6px 4px 6px 11px; cursor:pointer; text-align:left; display:flex; align-items:center; white-space:nowrap;">
          <span style="font-size:0.8rem; font-weight:${active ? '700' : '500'}; color:${active ? '#2d6a2d' : '#64748b'};">${label}</span>
          ${meta}
        </button>
        <button type="button" onclick="deleteSaleTab('${tab.id}')"
                title="Cerrar venta"
                onmouseover="this.style.background='#fee2e2'; this.style.color='#dc2626';"
                onmouseout="this.style.background='transparent'; this.style.color='${idleClose}';"
                style="border:none; background:transparent; color:${idleClose}; width:20px; height:20px; border-radius:5px; cursor:pointer; font-size:0.95rem; line-height:1; display:flex; align-items:center; justify-content:center; margin-right:5px; transition:all .12s;">&times;</button>
      </div>`;
  }).join('');
}

window.createSaleTab = function () {
  if (posSaleProcessing) {
    showToast('Espera a que termine el cobro actual', 'warning');
    return;
  }
  captureActiveSaleTabFromUI();
  const tab = createBlankSaleTab();
  posSaleTabs.push(tab);
  activePosSaleTabId = tab.id;
  applySaleTabToUI(tab);
  setTimeout(() => document.getElementById('posSearchProduct')?.focus(), 50);
};

window.switchSaleTab = function (tabId) {
  if (posSaleProcessing) {
    showToast('Espera a que termine el cobro actual', 'warning');
    return;
  }
  if (tabId === activePosSaleTabId) return;
  captureActiveSaleTabFromUI();
  const tab = posSaleTabs.find(item => item.id === tabId);
  if (!tab) return;
  activePosSaleTabId = tab.id;
  applySaleTabToUI(tab);
  setTimeout(() => document.getElementById('posSearchProduct')?.focus(), 50);
};

window.deleteSaleTab = function (tabId, skipConfirm = false) {
  if (posSaleProcessing && !skipConfirm) {
    showToast('Espera a que termine el cobro actual', 'warning');
    return;
  }
  const tab = posSaleTabs.find(item => item.id === tabId);
  if (!tab) return;
  const hasWork = (tab.cart || []).length > 0 || !!tab.customer;
  if (!skipConfirm && hasWork && !confirm('Eliminar esta pestaña de venta y borrar su carrito?')) return;

  const index = posSaleTabs.findIndex(item => item.id === tabId);
  posSaleTabs.splice(index, 1);

  if (posSaleTabs.length === 0) {
    const fresh = createBlankSaleTab();
    posSaleTabs.push(fresh);
    activePosSaleTabId = fresh.id;
    applySaleTabToUI(fresh);
    return;
  }

  if (activePosSaleTabId === tabId) {
    const next = posSaleTabs[Math.max(0, index - 1)] || posSaleTabs[0];
    activePosSaleTabId = next.id;
    applySaleTabToUI(next);
  } else {
    renderSaleTabs();
  }
};

function ensureSaleTabsInitialized() {
  if (posSaleTabs.length > 0) return;
  const tab = createBlankSaleTab();
  posSaleTabs.push(tab);
  activePosSaleTabId = tab.id;
  applySaleTabToUI(tab);
}

function closeCompletedSaleTab() {
  const completedTabId = activePosSaleTabId;
  if (!completedTabId) return;
  window.deleteSaleTab(completedTabId, true);
  restorePOSInteractionFocus(document.getElementById('posSearchProduct'), { forceSearch: true, delayMs: 80 });
}

let isPOSInitialized = false;
window.posProductsCache = null;
let posBrandFilterList = [];
let posBrandFilterSelected = '';

async function loadSales() {
  // This is now the POS initialization
  if (!isPOSInitialized) {
    setupPOSListeners();
    isPOSInitialized = true;
  }

  await loadPOSStores();
  getCachedFullProducts()
    .then(() => populatePOSBrandFilter())
    .catch(error => console.warn('No se pudieron precargar marcas para ventas:', error));
  updatePOSDate();
  ensureSaleTabsInitialized();
  renderSaleTabs();

  // Focus search input
  setTimeout(() => {
    restorePOSInteractionFocus(document.getElementById('posSearchProduct'), { forceSearch: true });
  }, 500);
}

function updatePOSDate() {
  const dateEl = document.getElementById('posDateDisplay');
  if (dateEl) {
    dateEl.textContent = formatAppDateTime(new Date(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
}

function isSalesSectionActive() {
  return document.getElementById('section-sales')?.classList.contains('active');
}

function isEditableTarget(el) {
  if (!el) return false;
  return el.matches?.('input, textarea, select, [contenteditable="true"]');
}

function restorePOSInteractionFocus(target = null, options = {}) {
  if (!isSalesSectionActive()) return;

  const visibleBlockingModal = document.querySelector('.modal.active, #modalContainer .modal');
  const ticketModal = document.getElementById('_ticketPreviewModal');
  const compraTicketModal = document.getElementById('_compraTicketPreviewModal');
  const ticketOpen = ticketModal?.style.display && ticketModal.style.display !== 'none';
  const compraTicketOpen = compraTicketModal?.style.display && compraTicketModal.style.display !== 'none';
  if (visibleBlockingModal || ticketOpen || compraTicketOpen) return;

  try { window.focus(); } catch (_) {}

  const activeEl = document.activeElement;
  if (activeEl?.tagName === 'IFRAME' || activeEl === document.body) {
    try { activeEl.blur?.(); } catch (_) {}
  }

  const focusTarget = isEditableTarget(target)
    ? target
    : (options.forceSearch ? document.getElementById('posSearchProduct') : null);

  if (focusTarget && !focusTarget.disabled) {
    setTimeout(() => {
      try { focusTarget.focus({ preventScroll: true }); } catch (_) { focusTarget.focus?.(); }
    }, options.delayMs ?? 0);
  }
}

async function loadPOSStores() {
  const titleEl = document.getElementById('posStoreTitle');
  if (!titleEl) return;

  // 1. Check localStorage for store selected at login (set by login.js)
  const loginStore = localStorage.getItem('selectedStore');
  if (loginStore) {
    try {
      const store = JSON.parse(loginStore);
      posCurrentStoreId = store.id;
      titleEl.textContent = store.name;
      titleEl.classList.add('text-primary');
      titleEl.style.cursor = 'pointer';
      titleEl.title = 'Clic para cambiar de sucursal';
      titleEl.onclick = () => requestStoreSelection(true);
      // Sync to sessionStorage for consistency
      sessionStorage.setItem('pos_current_store', loginStore);
      return;
    } catch (e) {
      console.warn('Error parsing selectedStore from localStorage:', e);
    }
  }

  // 2. Fallback: check sessionStorage (if store was changed inside admin)
  const storedStore = sessionStorage.getItem('pos_current_store');
  if (storedStore) {
    try {
      const store = JSON.parse(storedStore);
      posCurrentStoreId = store.id;
      titleEl.textContent = store.name;
      titleEl.classList.add('text-primary');
      titleEl.style.cursor = 'pointer';
      titleEl.title = 'Clic para cambiar de sucursal';
      titleEl.onclick = () => requestStoreSelection(true);
      return;
    } catch (e) {
      console.warn('Error parsing pos_current_store from sessionStorage:', e);
    }
  }

  // 3. Nothing saved — open store selection modal
  await requestStoreSelection();
}

async function requestStoreSelection(force = false) {
  try {
    const { data: stores } = await supabaseClient
      .from('stores')
      .select('id, name')
      .eq('is_active', true)
      .order('name');

    if (!stores || stores.length === 0) {
      showToast('No hay tiendas activas', 'error');
      return;
    }

    // If only 1 store, select automatically (unless forced to change)
    if (stores.length === 1 && !force) {
      selectPOSStore(stores[0]);
      return;
    }

    // Show Custom Modal
    const modalHTML = `
        < div class="modal" tabindex = "-1" role = "dialog" style = "display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999;" >
          <div class="modal-dialog" role="document" style="background: white; border-radius: 8px; width: 400px; max-width: 90%;">
            <div class="modal-content">
              <div class="modal-header bg-primary text-white p-3" style="border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;">
                <h5 class="modal-title m-0">Seleccionar Sucursal</h5>
                ${force ? '<button type="button" class="close text-white" onclick="document.getElementById(\'modalContainer\').innerHTML = \'\'" style="background:none; border:none; font-size:1.5rem;">&times;</button>' : ''}
              </div>
              <div class="modal-body p-4">
                <p class="text-muted mb-3">Elige dónde estás trabajando hoy:</p>
                <div class="d-grid gap-2" style="display: flex; flex-direction: column; gap: 10px;">
                  ${stores.map(store => `
                                    <button class="btn btn-outline-primary btn-lg btn-block text-left p-3" 
                                            onclick='window.selectPOSStore(${JSON.stringify(store).replace(/'/g, "&#39;")})'
                                            style="text-align: left; border: 1px solid var(--primary); background: white; color: var(--primary); border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                                        🏢 <strong>${store.name}</strong>
                                    </button>
                                `).join('')}
                </div>
              </div>
            </div>
          </div>
            </div >
        `;
    document.getElementById('modalContainer').innerHTML = modalHTML;

  } catch (e) {
    console.error(e);
    showToast('Error cargando tiendas', 'error');
  }
}

window.selectPOSStore = function (store) {
  posCurrentStoreId = store.id;
  const storeJson = JSON.stringify(store);
  sessionStorage.setItem('pos_current_store', storeJson);
  localStorage.setItem('selectedStore', storeJson); // Keep in sync with login.js

  // Update UI
  const titleEl = document.getElementById('posStoreTitle');
  if (titleEl) {
    titleEl.textContent = store.name;
    titleEl.onclick = () => requestStoreSelection(true);
    titleEl.style.cursor = 'pointer';
    titleEl.classList.remove('text-danger');
    titleEl.classList.add('text-primary');
  }

  // Close modal
  document.getElementById('modalContainer').innerHTML = '';
  showToast(`Sucursal seleccionada: ${store.name}`, 'success');
};

function getPOSProductBrandName(product) {
  return (product?.brand?.name || '').trim();
}

function populatePOSBrandFilter() {
  posBrandFilterList = Array.from(
    new Set((window.posProductsCache || []).map(getPOSProductBrandName).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  if (posBrandFilterSelected && !posBrandFilterList.includes(posBrandFilterSelected)) {
    posBrandFilterSelected = '';
  }
  syncPOSBrandFilterDisplay();
}

function syncPOSBrandFilterDisplay(forceText = false) {
  const input = document.getElementById('posBrandFilter');
  const clearBtn = document.getElementById('posBrandFilterClear');
  const toggleBtn = document.getElementById('posBrandDropdownToggle');
  const box = document.getElementById('posBrandSuggestions');
  if (input && (forceText || document.activeElement !== input || posBrandFilterSelected)) {
    input.value = posBrandFilterSelected;
  }
  if (input) {
    input.style.borderColor = posBrandFilterSelected ? '#2d6a2d' : '#b8d2b8';
    input.style.background = posBrandFilterSelected ? '#f0fdf4' : 'white';
  }
  if (clearBtn) {
    clearBtn.style.display = posBrandFilterSelected ? 'flex' : 'none';
  }
  if (toggleBtn) {
    const isOpen = box && box.style.display !== 'none';
    toggleBtn.innerHTML = isOpen ? '&#9652;' : '&#9662;';
    toggleBtn.style.background = isOpen ? '#dff0d8' : '#eef4ea';
  }
}

function refreshPOSSearchWithCurrentFilters() {
  const searchInput = document.getElementById('posSearchProduct');
  const results = document.getElementById('posSearchResults');
  const query = searchInput?.value.trim() || '';
  if (query.length >= 2) {
    searchProduct(query);
  } else if (results) {
    results.style.display = 'none';
  }
}

window.renderPOSBrandSuggestions = async function (rawTerm) {
  const box = document.getElementById('posBrandSuggestions');
  if (!box) return;

  if (!window.posProductsCache) {
    box.innerHTML = '<div style="padding:10px 14px; color:#64748b; font-size:0.84rem;">Cargando marcas...</div>';
    box.style.display = 'block';
    try {
      window.posProductsCache = await getCachedFullProducts();
      populatePOSBrandFilter();
    } catch (error) {
      console.error('Error loading POS brands:', error);
      box.innerHTML = '<div style="padding:10px 14px; color:#dc2626; font-size:0.84rem;">Error al cargar marcas</div>';
      return;
    }
  } else if (posBrandFilterList.length === 0) {
    populatePOSBrandFilter();
  }

  const term = String(rawTerm || '').trim().toLowerCase();
  const matches = (term
    ? posBrandFilterList.filter(name => name.toLowerCase().includes(term))
    : posBrandFilterList
  ).slice(0, 45);

  const allOption = `
    <div class="pos-brand-suggestion" data-brand=""
      style="padding:9px 14px; cursor:pointer; font-size:0.86rem; font-weight:700; color:#1d4ed8; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='white'">
      Todas las marcas
    </div>`;

  box.innerHTML = allOption + (matches.length === 0
    ? '<div style="padding:10px 14px; color:#94a3b8; font-size:0.84rem;">Sin coincidencias</div>'
    : matches.map(name => `
      <div class="pos-brand-suggestion" data-brand="${escapeHtml(name)}"
        style="padding:9px 14px; cursor:pointer; font-size:0.86rem; border-bottom:1px solid #f1f5f9; white-space:nowrap;"
        onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='white'">
        &#127991; ${escapeHtml(name)}
      </div>`).join(''));

  box.style.display = 'block';
  syncPOSBrandFilterDisplay();
  box.querySelectorAll('.pos-brand-suggestion').forEach(item => {
    item.addEventListener('click', () => {
      posBrandFilterSelected = item.dataset.brand || '';
      const input = document.getElementById('posBrandFilter');
      if (input) input.value = posBrandFilterSelected;
      box.style.display = 'none';
      syncPOSBrandFilterDisplay(true);
      refreshPOSSearchWithCurrentFilters();
      document.getElementById('posSearchProduct')?.focus();
    });
  });
};

window.togglePOSBrandSuggestions = function (event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const box = document.getElementById('posBrandSuggestions');
  const input = document.getElementById('posBrandFilter');
  if (!box) return;

  const isOpen = box.style.display !== 'none';
  if (isOpen) {
    box.style.display = 'none';
    syncPOSBrandFilterDisplay(true);
    document.getElementById('posSearchProduct')?.focus();
    return;
  }

  renderPOSBrandSuggestions(input?.value || posBrandFilterSelected || '');
  setTimeout(() => {
    input?.focus({ preventScroll: true });
    syncPOSBrandFilterDisplay();
  }, 0);
};

window.clearPOSBrandFilter = function () {
  posBrandFilterSelected = '';
  const input = document.getElementById('posBrandFilter');
  const box = document.getElementById('posBrandSuggestions');
  if (input) input.value = '';
  if (box) box.style.display = 'none';
  syncPOSBrandFilterDisplay(true);
  refreshPOSSearchWithCurrentFilters();
  document.getElementById('posSearchProduct')?.focus();
};

function setupPOSListeners() {
  const searchInput = document.getElementById('posSearchProduct');
  const brandInput = document.getElementById('posBrandFilter');
  const payInput = document.getElementById('posAmountPaid');
  const processBtn = document.getElementById('btnProcessSale');
  const cancelBtn = document.getElementById('btnCancelSale');

  // Search Product — debounce timer declared here so Enter can cancel it
  let searchDebounce;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      const query = e.target.value.trim();
      if (query.length < 2) {
        document.getElementById('posSearchResults').style.display = 'none';
        return;
      }
      searchDebounce = setTimeout(() => searchProduct(query), 300);
    });

    // Use keydown (not keypress) so we can cancel the pending debounce before it fires
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchDebounce); // cancel pending debounce — prevents duplicate search
        const query = e.target.value.trim();
        if (query) await searchProduct(query, true);
      }
    });
  }

  if (brandInput && !brandInput.dataset.bound) {
    brandInput.dataset.bound = 'true';
    brandInput.addEventListener('keydown', (e) => {
      const box = document.getElementById('posBrandSuggestions');
      if (e.key === 'Escape') {
        e.preventDefault();
        if (box) box.style.display = 'none';
        syncPOSBrandFilterDisplay(true);
        searchInput?.focus();
        return;
      }
      if (e.key === 'Enter') {
        const options = Array.from(box?.querySelectorAll('.pos-brand-suggestion') || []);
        const first = options.find(item => item.dataset.brand) || options[0];
        if (!first || box.style.display === 'none') return;
        e.preventDefault();
        first.click();
      }
    });
  }

  // Calculate Change
  if (payInput) {
    payInput.addEventListener('input', () => {
      const cursorAtEnd = payInput.selectionStart === payInput.value.length;
      payInput.value = formatPosAmountPaidWhileTyping(payInput.value);
      if (cursorAtEnd) payInput.setSelectionRange(payInput.value.length, payInput.value.length);
      updateChange();
    });
    payInput.addEventListener('blur', () => {
      if (payInput.value) setPosAmountPaidValue(payInput, payInput.value);
      updateChange();
    });
    payInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (!document.getElementById('section-sales').classList.contains('active')) return;
      const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'efectivo';
      if (paymentMethod !== 'efectivo') return;
      e.preventDefault();
      if (!document.getElementById('btnProcessSale').disabled) processSale();
    });
  }

  // Process Sale
  if (processBtn) {
    processBtn.addEventListener('click', processSale);
  }

  // Cancel Sale
  if (cancelBtn) {
    cancelBtn.addEventListener('click', clearCart);
  }

  // Hotkeys
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('section-sales').classList.contains('active')) return;

    if (e.key === 'F1') {
      e.preventDefault();
      document.getElementById('posSearchProduct').focus();
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      if (!document.getElementById('btnProcessSale').disabled) processSale();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      const brandResults = document.getElementById('posBrandSuggestions');
      if (brandResults && brandResults.style.display !== 'none') {
        brandResults.style.display = 'none';
        syncPOSBrandFilterDisplay(true);
        document.getElementById('posSearchProduct').focus();
        return;
      }
      const results = document.getElementById('posSearchResults');
      if (results && results.style.display !== 'none') {
        results.style.display = 'none';
        document.getElementById('posSearchProduct').focus();
        return;
      }
      // Esc closes search results first; otherwise it starts the fast payment flow.
      handlePOSQuickChargeShortcut();
      return;
    }

    // +/- adjust qty of last item — only when not typing in a field
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if ((e.key === '+' || e.key === '=') && currentCart.length > 0) {
      e.preventDefault();
      const idx = currentCart.length - 1;
      updateQuantity(idx, currentCart[idx].quantity + 1);
    }
    if (e.key === '-' && currentCart.length > 0) {
      e.preventDefault();
      const idx = currentCart.length - 1;
      if (currentCart[idx].quantity > 1) updateQuantity(idx, currentCart[idx].quantity - 1);
    }
  });

  // Close search results on click outside
  document.addEventListener('click', (e) => {
    if (!isSalesSectionActive()) return;
    if (!e.target.closest('.pos-search-bar')) {
      document.getElementById('posSearchResults').style.display = 'none';
      const brandInputEl = document.getElementById('posBrandFilter');
      const brandBox = document.getElementById('posBrandSuggestions');
      if (brandBox) brandBox.style.display = 'none';
      if (brandInputEl && brandInputEl.value !== posBrandFilterSelected) {
        brandInputEl.value = posBrandFilterSelected;
      }
      syncPOSBrandFilterDisplay(true);
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!isSalesSectionActive()) return;
    const editable = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (!editable) return;
    restorePOSInteractionFocus(editable);
  }, true);
}

function handlePOSQuickChargeShortcut() {
  if (currentCart.length === 0) {
    document.getElementById('posSearchProduct')?.focus();
    return;
  }

  const processBtn = document.getElementById('btnProcessSale');
  if (!processBtn || processBtn.disabled) return;

  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'efectivo';
  const amountInput = document.getElementById('posAmountPaid');

  if (paymentMethod === 'efectivo') {
    if (!amountInput) return;
    amountInput.disabled = false;
    amountInput.focus();
    amountInput.select();
    return;
  }

  if (paymentMethod === 'tarjeta') {
    processSale();
    return;
  }

  showToast('Atajo Esc disponible solo para efectivo o tarjeta', 'info');
}

async function searchProduct(query, isEnter = false) {
  if (!posCurrentStoreId) {
    showToast('Selecciona una tienda primero', 'error');
    return;
  }

  try {
    const resultsContainer = document.getElementById('posSearchResults');

    if (!window.posProductsCache) {
      // Show loading indicator
      resultsContainer.innerHTML = '<div style="padding: 10px; text-align: center; color: #888;">Cargando catálogo...</div>';
      resultsContainer.style.display = 'block';

      window.posProductsCache = await getCachedFullProducts();
      populatePOSBrandFilter();
    } else if (posBrandFilterList.length === 0) {
      populatePOSBrandFilter();
    }

    const searchTerms = query.toLowerCase().trim().split(/\s+/);
    const q = query.toLowerCase().trim();
    const activeBrandFilter = posBrandFilterSelected || '';
    const candidateProducts = activeBrandFilter
      ? window.posProductsCache.filter(p => getPOSProductBrandName(p) === activeBrandFilter)
      : window.posProductsCache;

    // Check for exact barcode match first
    const exactMatch = candidateProducts.find(p => p.barcode && p.barcode.toLowerCase() === q);

    // Direct match logic for scanners (Enter key)
    if (isEnter && exactMatch) {
      addToCart(exactMatch);
      document.getElementById('posSearchProduct').value = '';
      resultsContainer.style.display = 'none';
      return;
    }

    // Filter local cache instead of making network request
    const results = candidateProducts.filter(p => {
      const pCode = p.barcode ? p.barcode.toLowerCase() : '';
      const pName = p.name ? p.name.toLowerCase() : '';
      const pBrand = p.brand && p.brand.name ? p.brand.name.toLowerCase() : '';

      const searchString = `${pCode} ${pName} ${pBrand}`;
      // Search matches if EVERY typed word exists somewhere in the Code, Name, or Brand
      return searchTerms.every(term => searchString.includes(term));
    });

    // Priorizar la marca de la casa (Naturalezam): si hay coincidencias de esa marca,
    // van siempre hasta arriba. Es un orden estable, así que si no hay productos
    // Naturalezam en la búsqueda el orden no cambia. Se ordena ANTES de cortar a 50
    // para que un Naturalezam que esté más abajo no se quede fuera.
    const isHouseBrand = (p) => (p.brand && p.brand.name ? p.brand.name : '')
      .toLowerCase().includes('naturalezam');
    results.sort((a, b) => (isHouseBrand(b) ? 1 : 0) - (isHouseBrand(a) ? 1 : 0));

    // Increased from 20 to 50 to allow better scrolling
    const products = results.slice(0, 50);
    resultsContainer.innerHTML = '';

    if (products.length === 0) {
      if (!isEnter) {
        resultsContainer.style.display = 'none'; // Don't show empty box
      } else {
        showToast('Producto no encontrado', 'error');
      }
      return;
    }

    if (isEnter && products.length === 1) {
      addToCart(products[0]);
      document.getElementById('posSearchProduct').value = '';
      resultsContainer.style.display = 'none';
      return;
    }

    // Show dropdown results
    products.forEach(product => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex; align-items: center; padding: 10px 14px; cursor: pointer;
        border-bottom: 1px solid #f0f0f0; background: white; gap: 12px;
        transition: background 0.15s;
      `;
      item.onmouseenter = () => item.style.background = '#f8f9fb';
      item.onmouseleave = () => item.style.background = 'white';

      item.innerHTML = `
        <span style="font-family: monospace; font-size: 0.78rem; color: #aaa; white-space: nowrap; min-width: 55px;">${product.barcode || '—'}</span>
        <span style="flex: 1; font-weight: 600; font-size: 0.95rem; color: #222; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${product.name}
          ${product.brand?.name ? `<span style="font-weight: 400; font-size: 0.82rem; color: #999; margin-left: 6px;">${product.brand.name}</span>` : ''}
        </span>
        <span style="font-weight: 700; font-size: 1rem; color: #2d7a2d; white-space: nowrap;">$${parseFloat(product.retail_price).toFixed(2)}</span>
      `;

      item.onclick = () => {
        addToCart(product);
        document.getElementById('posSearchProduct').value = '';
        resultsContainer.style.display = 'none';
        document.getElementById('posSearchProduct').focus();
      };
      resultsContainer.appendChild(item);
    });

    resultsContainer.style.display = 'block';
    resultsContainer.style.cssText += `
      border: 1px solid #e8e8e8; border-radius: 0 0 8px 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.1); overflow-y: auto; max-height: 60vh; background: white;
    `;

  } catch (error) {
    console.error('Search error:', error);
  }
}

async function addToCart(product) {
  try {
    const inv = await getInventoryRow(posCurrentStoreId, product.id);
    const currentStock = inv ? parseFloat(inv.quantity || 0) : 0;
    const existingItem = currentCart.find(item => item.id === product.id);
    const requestedQty = existingItem ? existingItem.quantity + 1 : 1;

    if (currentStock < requestedQty) {
      showToast('⚠️ No está disponible este producto (Sin stock en tienda)', 'warning');
      return;
    }
  } catch (err) {
    console.error('Error verificando stock:', err);
    showToast('⚠️ No está disponible este producto (Error consultando stock)', 'warning');
    return;
  }

  const existingItem = currentCart.find(item => item.id === product.id);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    const prices = {
      retail: parseFloat(product.retail_price || 0),
      wholesale: parseFloat(product.wholesale_price || 0),
      distributor: parseFloat(product.distributor_price || 0)
    };
    currentCart.push({
      id: product.id,
      name: product.name,
      prices,
      price: prices[currentPriceMode], // Active price based on current mode
      cost: parseFloat(product.cost_price || 0),
      quantity: 1,
      barcode: product.barcode
    });
  }

  renderCart();
}

function removeFromCart(index) {
  currentCart.splice(index, 1);
  renderCart();
}

// Switch price mode for all cart items
window.setPriceMode = function (mode) {
  // Translate mode keys for the error message
  const modeNames = { retail: 'Menudeo', wholesale: 'Mayoreo', distributor: 'Distribuidor' };

  // Validar si algún producto NO tiene el precio configurado
  const missingPrices = currentCart.filter(item => {
    return !item.prices || parseFloat(item.prices[mode] || 0) <= 0;
  });

  if (missingPrices.length > 0) {
    const nombres = missingPrices.map(p => p.name).join(', ');
    showToast(`⚠️ No se puede aplicar: Falta configurar el precio de ${modeNames[mode] || mode} en: ${nombres}`, 'warning');
    return; // Bloquear cambio
  }

  currentPriceMode = mode;

  // Update price of every item in cart
  currentCart.forEach(item => {
    if (item.prices) {
      item.price = item.prices[mode] || item.prices.retail;
    }
  });

  // Update button styles
  syncPriceModeButtons(mode);

  renderCart();
};

async function updateQuantity(index, newQty) {
  // Acepta decimales (venta por kilo/gramos). Redondea a 3 decimales (1 g dentro de 1 kg).
  let parsedQty = parseFloat(String(newQty).replace(',', '.'));
  if (isNaN(parsedQty)) {
    renderCart(); // valor invalido: revertir
    return;
  }
  parsedQty = Math.round(parsedQty * 1000) / 1000;

  if (parsedQty <= 0) {
    if (confirm('¿Eliminar producto del carrito?')) {
      removeFromCart(index);
    } else {
      renderCart(); // Reset input
    }
    return;
  }

  const item = currentCart[index];
  try {
    const inv = await getInventoryRow(posCurrentStoreId, item.id);
    const currentStock = inv ? parseFloat(inv.quantity || 0) : 0;

    if (parsedQty > currentStock) {
      showToast('⚠️ Sobrepasas el stock disponible (' + currentStock + ')', 'warning');
      renderCart(); // revert to old qty in UI
      return;
    }
  } catch (err) {
    console.error('Error verificando stock:', err);
  }

  currentCart[index].quantity = parsedQty;
  renderCart();
}

function renderCart() {
  const tbody = document.getElementById('posCartBody');
  const emptyState = document.getElementById('posEmptyState');
  const table = document.getElementById('posCartTable');

  if (currentCart.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'flex';
    table.style.display = 'none'; // Hide header
    updateTotals();
    return;
  }

  emptyState.style.display = 'none';
  table.style.display = 'table';

  tbody.innerHTML = currentCart.map((item, index) => `
        <tr>
            <td style="font-family: monospace; color: #666; font-size: 0.85rem;">${item.barcode || 'S/C'}</td>
            <td class="text-center" style="padding: 0;">
                <input type="number" class="pos-qty-input"
                       value="${item.quantity}" min="0" step="any" inputmode="decimal"
                       onchange="window.updatePOSQuantity(${index}, this.value)"
                       onclick="this.select()">
            </td>
            <td>
                <div style="font-weight: 500; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px;">${item.name}</div>
            </td>
            <td class="text-right" style="cursor: pointer;" title="Clic para editar precio"
                onclick="window.editPOSPrice(this, ${index})">
                <span style="color: #555; border-bottom: 1px dashed #bbb;">${formatCurrencyMX(item.price)}</span>
            </td>
            <td class="text-right pos-total-cell">${formatCurrencyMX(item.price * item.quantity)}</td>
            <td class="text-center">
                <button class="btn btn-sm text-danger" onclick="window.removePOSItem(${index})" title="Eliminar (Supr)" style="padding: 0 5px;">✕</button>
            </td>
        </tr>
        `).join('');

  // Scroll to bottom
  const container = document.querySelector('.pos-table-wrapper');
  if (container) container.scrollTop = container.scrollHeight;

  updateTotals();
}

// Global wrappers for inline onclick
window.updatePOSQuantity = updateQuantity;
window.removePOSItem = removeFromCart;

// Inline price editing: click P.UNIT cell to edit
window.editPOSPrice = function (td, index) {
  // Avoid creating duplicate inputs
  if (td.querySelector('input')) return;

  const currentPrice = currentCart[index].price;
  td.innerHTML = `
    <input type="number" value="${currentPrice.toFixed(2)}" min="0" step="0.01"
      id="priceEditInput_${index}"
      style="width: 80px; text-align: right; border: 1.5px solid var(--primary,#2d6a2d);
             border-radius: 4px; padding: 2px 4px; font-size: 0.9rem; font-weight: 600; color: #222;">
  `;
  const input = td.querySelector('input');
  input.focus();
  input.select();

  function savePrice() {
    const newPrice = parseFloat(input.value);
    if (!isNaN(newPrice) && newPrice >= 0) {
      currentCart[index].price = newPrice;
    }
    renderCart();
  }

  input.addEventListener('blur', savePrice);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); savePrice(); }
    if (e.key === 'Escape') { renderCart(); } // Cancel
  });
};

function updateTotals() {
  const subtotal = currentCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // Apply discount
  let discountAmount = 0;
  if (currentDiscount.value > 0) {
    if (currentDiscount.type === 'percent') {
      discountAmount = subtotal * (currentDiscount.value / 100);
    } else {
      discountAmount = Math.min(currentDiscount.value, subtotal);
    }
  }
  const total = Math.max(0, subtotal - discountAmount);

  document.getElementById('posSubtotal').textContent = formatCurrencyMX(subtotal);
  document.getElementById('posTotal').textContent = formatCurrencyMX(total);

  // Show/hide discount row in header
  const discRow = document.getElementById('posDiscountRow');
  const discEl = document.getElementById('posDiscount');
  if (discountAmount > 0 && discRow && discEl) {
    discEl.textContent = `-${formatCurrencyMX(discountAmount)}`;
    discRow.style.display = 'inline';
  } else if (discRow) {
    discRow.style.display = 'none';
  }

  // Enable cobrar if cart has items
  const processBtn = document.getElementById('btnProcessSale');
  if (processBtn) {
    processBtn.disabled = currentCart.length === 0;
    processBtn.style.opacity = currentCart.length === 0 ? '0.45' : '1';
  }

  updateChange();
  captureActiveSaleTabFromUI();
  renderSaleTabs();
}

// --- Payment method toggle ---
// Gestiona la selección visual de los 4 botones de método de pago
// y la visibilidad del panel de pago mixto.
function selectPayment(method) {
  // Sincronizar los radio buttons ocultos
  document.getElementById('payCash').checked = method === 'efectivo';
  document.getElementById('payCard').checked = method === 'tarjeta';
  document.getElementById('payTransfer').checked = method === 'transferencia';
  document.getElementById('payMixed').checked = method === 'mixto';

  // Estilos activo/inactivo para los 4 botones
  const buttons = [
    { id: 'lblCash', key: 'efectivo' },
    { id: 'lblCard', key: 'tarjeta' },
    { id: 'lblTransfer', key: 'transferencia' },
    { id: 'lblMixed', key: 'mixto' }
  ];
  buttons.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const active = method === key;
    el.style.borderColor = active ? '#2d6a2d' : '#ccc';
    el.style.color = active ? '#2d6a2d' : '#666';
    el.style.background = active ? '#f0faf0' : 'white';
  });

  // Panel de pago mixto: mostrar u ocultar
  const mixedPanel = document.getElementById('mixedPaymentPanel');
  if (mixedPanel) {
    mixedPanel.style.display = method === 'mixto' ? 'block' : 'none';
  }

  // Si se cancela el mixto, resetear confirmación
  if (method !== 'mixto') {
    mixedPaymentConfirmed = false;
    mixedCashAmount = 0;
    mixedOtherAmount = 0;
    const status = document.getElementById('mixedPaymentStatus');
    if (status) status.style.display = 'none';
  } else {
    // Al seleccionar mixto, pre-calcular el panel
    updateMixedPanel();
  }

  updateChange();
}

// --- Discount ---
function applyDiscount() {
  const input = document.getElementById('posDiscountInput');
  const typeEl = document.getElementById('posDiscountType');
  const val = parseFloat(input?.value || 0);
  const type = typeEl?.value || 'percent';

  if (isNaN(val) || val < 0) { showToast('Descuento inválido', 'warning'); return; }
  if (type === 'percent' && val > 100) { showToast('El porcentaje no puede ser mayor a 100', 'warning'); return; }

  currentDiscount = { type, value: val };
  updateTotals();
  showToast(`Descuento de ${type === 'percent' ? val + '%' : '$' + val.toFixed(2)} aplicado`, 'success');
}

function clearDiscount() {
  currentDiscount = { type: 'percent', value: 0 };
  const inp = document.getElementById('posDiscountInput');
  if (inp) inp.value = '';
  updateTotals();
  showToast('Descuento eliminado', 'info');
}

// ---------------------------------------------------------------------------
// PAGO MIXTO: funciones de soporte
// ---------------------------------------------------------------------------

/**
 * updateMixedPanel()
 * Recalcula el campo "Resto ($)" en tiempo real a medida que el cajero
 * escribe la porción en efectivo. Se llama desde el oninput del campo
 * #posMixedCash y al cambiar el método del resto.
 */
window.updateMixedPanel = function () {
  const total = parseMoneyValue(document.getElementById('posTotal').textContent);
  const cashInput = document.getElementById('posMixedCash');
  const otherInput = document.getElementById('posMixedOther');
  const statusEl = document.getElementById('mixedPaymentStatus');

  const cash = parseFloat(cashInput?.value || 0);
  const other = Math.max(0, total - cash);

  if (otherInput) otherInput.value = other.toFixed(2);

  // Ocultar confirmación previa si el cajero modifica los montos
  if (statusEl) statusEl.style.display = 'none';
  mixedPaymentConfirmed = false;
  mixedCashAmount = 0;
  mixedOtherAmount = 0;
};

/**
 * applyMixedPayment()
 * Valida que efectivo + resto = total y guarda los montos en las
 * variables de estado globales. Muestra un mensaje de confirmación.
 */
window.applyMixedPayment = function () {
  const total = parseMoneyValue(document.getElementById('posTotal').textContent);
  const cash = parseFloat(document.getElementById('posMixedCash')?.value || 0);
  const other = parseFloat(document.getElementById('posMixedOther')?.value || 0);
  const restMethod = document.getElementById('posMixedRestMethod')?.value || 'tarjeta';
  const statusEl = document.getElementById('mixedPaymentStatus');

  if (total <= 0) {
    showToast('El carrito está vacío', 'warning');
    return;
  }
  if (cash < 0) {
    showToast('El efectivo no puede ser negativo', 'warning');
    return;
  }
  if (cash >= total) {
    showToast(`Si el efectivo cubre el total, usa directamente "Efectivo"`, 'warning');
    return;
  }
  if (Math.abs(cash + other - total) > 0.01) {
    showToast(`Error en el desglose: ${formatCurrencyMX(cash)} + ${formatCurrencyMX(other)} ≠ ${formatCurrencyMX(total)}`, 'error');
    return;
  }

  // Guardar en variables globales
  mixedCashAmount = cash;
  mixedOtherAmount = other;
  mixedOtherMethod = restMethod;
  mixedPaymentConfirmed = true;

  // Mostrar confirmación visual
  const methodLabel = restMethod === 'tarjeta' ? '💳 Tarjeta' : '🏦 Transferencia';
  if (statusEl) {
    statusEl.textContent = `Confirmado: ${formatCurrencyMX(cash)} + ${methodLabel} ${formatCurrencyMX(other)}`;
    statusEl.style.display = 'block';
  }

  // Actualizar campo de dinero recibido (muestra la parte en efectivo)
  const paidInput = document.getElementById('posAmountPaid');
  if (paidInput) {
    setPosAmountPaidValue(paidInput, cash);
  }

  updateChange();
  showToast(`Pago mixto configurado: ${formatCurrencyMX(cash)} + ${methodLabel} ${formatCurrencyMX(other)}`, 'success');
};

// --- Customers POS ---
let posCustomerSearchTimer = null;
let posCustomerSearchToken = 0;

function ensurePosCustomerResultsBox() {
  const input = document.getElementById('posCustomerInput');
  if (!input) return null;

  let results = document.getElementById('posCustomerResults');
  if (results) return results;

  const customerBlock = input.closest('div')?.parentElement?.parentElement;
  if (!customerBlock) return null;

  results = document.createElement('div');
  results.id = 'posCustomerResults';
  results.style.cssText = `
    display:none;
    margin-top:5px;
    background:white;
    border:1px solid #d9e4d2;
    border-radius:8px;
    box-shadow:0 8px 22px rgba(0,0,0,0.12);
    max-height:210px;
    overflow-y:auto;
    z-index:50;
  `;
  customerBlock.appendChild(results);
  return results;
}

function hidePosCustomerResults() {
  const results = document.getElementById('posCustomerResults');
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
}

function renderPosCustomerSuggestions(customers) {
  const results = ensurePosCustomerResultsBox();
  if (!results) return;

  if (!customers || customers.length === 0) {
    results.innerHTML = '<div style="padding:9px 11px; color:#8a9585; font-size:0.82rem;">Sin clientes encontrados</div>';
    results.style.display = 'block';
    return;
  }

  results.innerHTML = customers.map(customer => {
    const code = escapeHtml(customer.customer_code || '');
    const name = escapeHtml(customer.name || '');
    const identifier = escapeHtml(customer.identifier || '');
    const type = escapeHtml(customer.customer_type || '');
    return `
      <button type="button"
        class="pos-customer-suggestion"
        data-customer='${escapeHtml(JSON.stringify(customer))}'
        style="width:100%; border:none; background:white; padding:9px 11px; display:flex; justify-content:space-between; gap:10px; cursor:pointer; text-align:left; border-bottom:1px solid #eef3ea;">
        <span style="min-width:0;">
          <strong style="display:block; color:#1f2a1b; font-size:0.86rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</strong>
          <small style="color:#7f8b79;">${code}${identifier ? ` · ${identifier}` : ''}</small>
        </span>
        <span style="align-self:center; color:#1e4d0f; font-weight:800; font-size:0.72rem; text-transform:uppercase;">${type}</span>
      </button>
    `;
  }).join('');

  results.querySelectorAll('.pos-customer-suggestion').forEach(button => {
    button.addEventListener('mousedown', event => {
      event.preventDefault();
      try {
        const customer = JSON.parse(button.dataset.customer || '{}');
        selectCustomerForSale(customer);
      } catch (err) {
        console.error('Error seleccionando cliente:', err);
      }
    });
  });

  results.style.display = 'block';
}

async function searchPosCustomers(term) {
  const cleanTerm = term.trim();
  if (cleanTerm.length < 2) {
    hidePosCustomerResults();
    return;
  }

  const token = ++posCustomerSearchToken;
  const escapedTerm = cleanTerm.replace(/[%_]/g, '\\$&');

  try {
    const { data, error } = await supabaseClient
      .from('customers')
      .select('*')
      .or(`customer_code.ilike.%${escapedTerm}%,name.ilike.%${escapedTerm}%,identifier.ilike.%${escapedTerm}%`)
      .order('name')
      .limit(8);

    if (token !== posCustomerSearchToken) return;
    if (error) throw error;
    renderPosCustomerSuggestions(data || []);
  } catch (err) {
    console.error('Error buscando clientes:', err);
    hidePosCustomerResults();
  }
}

function setupPosCustomerAutocomplete() {
  const input = document.getElementById('posCustomerInput');
  if (!input || input.dataset.autocompleteReady === 'true') return;
  input.dataset.autocompleteReady = 'true';

  input.addEventListener('input', () => {
    clearTimeout(posCustomerSearchTimer);
    posCustomerSearchTimer = setTimeout(() => searchPosCustomers(input.value), 140);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) searchPosCustomers(input.value);
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') hidePosCustomerResults();
  });

  document.addEventListener('click', event => {
    const results = document.getElementById('posCustomerResults');
    if (!results || event.target === input || results.contains(event.target)) return;
    hidePosCustomerResults();
  });
}

async function selectCustomerForSale(customer) {
  if (!customer?.id) return;
  const input = document.getElementById('posCustomerInput');
  if (input) input.value = customer.customer_code || customer.name || '';
  hidePosCustomerResults();
  await linkCustomerToSale(customer);
}

window.linkCustomerToSale = async function () {
  setupPosCustomerAutocomplete();
  const preselectedCustomer = arguments[0]?.id ? arguments[0] : null;
  const input = document.getElementById('posCustomerInput');
  const code = input?.value.trim().toUpperCase();

  if (!code && !preselectedCustomer) {
    showToast('Ingresa un código de cliente', 'warning');
    return;
  }

  const btn = document.getElementById('btnLinkCustomer');
  const originalText = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;

  try {
    let customer = preselectedCustomer;

    if (!customer) {
      const { data: customersFound, error } = await supabaseClient
        .from('customers')
        .select('*')
        .or(`customer_code.ilike.%${code}%,name.ilike.%${code}%,identifier.ilike.%${code}%`)
        .limit(1);

      if (error) throw error;
      customer = customersFound?.[0];
    }

    if (!customer) {
      showToast('Cliente no encontrado', 'error');
      btn.textContent = originalText;
      btn.disabled = false;
      return;
    }

    // 2. Set global state
    posCurrentCustomer = customer;

    // 3. Update UI (Customer Section)
    input.style.display = 'none';
    btn.style.display = 'none';

    const nameEl = document.getElementById('posActiveCustomerName');
    nameEl.textContent = customer.name;
    nameEl.style.display = 'block';
    document.getElementById('btnClearCustomer').style.display = 'block';

    // 4. Map and Apply Price Type
    const typeMap = {
      'menudeo': 'retail',
      'mayoreo': 'wholesale',
      'distribuidor': 'distributor',
      'especial': 'retail' // Especial has custom discount, defaults to retail base
    };

    const mappedMode = typeMap[customer.customer_type] || 'retail';

    if (typeof setPriceMode === 'function') {
      setPriceMode(mappedMode);
    }

    // 5. Apply special discount if applicable
    if (customer.customer_type === 'especial' && customer.discount_percentage > 0) {
      document.getElementById('posDiscountType').value = 'percent';
      document.getElementById('posDiscountInput').value = customer.discount_percentage;
      applyDiscount();
      showToast(`Cliente Especial: ${customer.discount_percentage}% desc. aplicado`, 'info');
    } else {
      showToast(`Cliente asociado: Precio ${mappedMode} activado`, 'success');
    }

    // 6. Fetch Recent Purchases
    const { data: recentSales } = await supabaseClient
      .from('sales')
      .select('id, sale_date, total')
      .eq('customer_id', customer.id)
      .order('sale_date', { ascending: false })
      .limit(4);

    const banner = document.getElementById('posCustomerBanner');
    const bName = document.getElementById('bannerCustomerName');
    const bType = document.getElementById('bannerCustomerType');
    const bDiscount = document.getElementById('bannerCustomerDiscount');
    const bHistory = document.getElementById('bannerCustomerHistory');

    bName.textContent = customer.name;

    if (bType) {
      const typeLabels = { menudeo: 'Menudeo', mayoreo: 'Mayoreo', distribuidor: 'Distribuidor', especial: 'Especial' };
      bType.textContent = typeLabels[customer.customer_type] || customer.customer_type || '';
      bType.style.display = customer.customer_type ? 'inline-block' : 'none';
    }

    if (bDiscount && customer.customer_type === 'especial' && customer.discount_percentage > 0) {
      bDiscount.textContent = `${customer.discount_percentage}% desc.`;
      bDiscount.style.display = 'inline-block';
    } else if (bDiscount) {
      bDiscount.style.display = 'none';
    }

    if (bHistory) {
      if (recentSales && recentSales.length > 0) {
        const groupedByDate = recentSales.reduce((acc, sale) => {
          const key = formatAppDateTime(sale.sale_date, {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          });
          if (!acc[key]) acc[key] = { count: 0, total: 0 };
          acc[key].count += 1;
          acc[key].total += parseFloat(sale.total || 0);
          return acc;
        }, {});
        const rows = Object.entries(groupedByDate).map(([date, info]) => {
          const comprasText = info.count === 1 ? '1 compra' : `${info.count} compras`;
          return `<span style="margin-right:12px;">📅 ${date} — ${comprasText}, total $${info.total.toFixed(2)}</span>`;
        }).join('');
        bHistory.innerHTML = `<span style="font-weight:600; margin-right:6px;">Últimas compras:</span>${rows}`;
      } else {
        bHistory.textContent = 'Cliente nuevo sin historial previo';
      }
    }

    banner.style.display = 'block';
    captureActiveSaleTabFromUI();
    renderSaleTabs();

  } catch (err) {
    console.error('Error linking customer:', err);
    showToast('Error al buscar cliente', 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
};

window.clearCustomerFromSale = function () {
  posCurrentCustomer = null;
  hidePosCustomerResults();

  document.getElementById('posCustomerInput').style.display = 'block';
  document.getElementById('posCustomerInput').value = '';
  document.getElementById('btnLinkCustomer').style.display = 'block';

  document.getElementById('posActiveCustomerName').style.display = 'none';
  document.getElementById('btnClearCustomer').style.display = 'none';
  document.getElementById('posCustomerBanner').style.display = 'none';

  // Reset price mode
  if (typeof setPriceMode === 'function') {
    setPriceMode('retail');
  }
  clearDiscount();
};

function syncPosCustomerUIFromState() {
  const input = document.getElementById('posCustomerInput');
  const linkBtn = document.getElementById('btnLinkCustomer');
  const nameEl = document.getElementById('posActiveCustomerName');
  const clearBtn = document.getElementById('btnClearCustomer');
  const banner = document.getElementById('posCustomerBanner');
  const bannerName = document.getElementById('bannerCustomerName');
  const bannerType = document.getElementById('bannerCustomerType');
  const bannerDiscount = document.getElementById('bannerCustomerDiscount');
  const bannerHistory = document.getElementById('bannerCustomerHistory');

  hidePosCustomerResults();

  if (!posCurrentCustomer) {
    if (input) { input.style.display = 'block'; input.value = ''; }
    if (linkBtn) linkBtn.style.display = 'block';
    if (nameEl) nameEl.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    if (banner) banner.style.display = 'none';
    return;
  }

  if (input) {
    input.value = posCurrentCustomer.customer_code || posCurrentCustomer.name || '';
    input.style.display = 'none';
  }
  if (linkBtn) linkBtn.style.display = 'none';
  if (nameEl) {
    nameEl.textContent = posCurrentCustomer.name || 'Cliente';
    nameEl.style.display = 'block';
  }
  if (clearBtn) clearBtn.style.display = 'block';
  if (bannerName) bannerName.textContent = posCurrentCustomer.name || 'Cliente';
  if (bannerType) {
    const typeLabels = { menudeo: 'Menudeo', mayoreo: 'Mayoreo', distribuidor: 'Distribuidor', especial: 'Especial' };
    bannerType.textContent = typeLabels[posCurrentCustomer.customer_type] || posCurrentCustomer.customer_type || '';
    bannerType.style.display = posCurrentCustomer.customer_type ? 'inline-block' : 'none';
  }
  if (bannerDiscount) {
    const hasDiscount = posCurrentCustomer.customer_type === 'especial' && parseFloat(posCurrentCustomer.discount_percentage || 0) > 0;
    bannerDiscount.textContent = hasDiscount ? `${posCurrentCustomer.discount_percentage}% desc.` : '';
    bannerDiscount.style.display = hasDiscount ? 'inline-block' : 'none';
  }
  if (bannerHistory) bannerHistory.textContent = 'Cliente asociado en esta pestaña.';
  if (banner) banner.style.display = 'block';
}

setupPosCustomerAutocomplete();

// Toggle: print ticket on sale
function toggleTicket() {
  printTicketOnSale = !printTicketOnSale;
  const btn = document.getElementById('btnTicketToggle');
  if (!btn) return;
  if (printTicketOnSale) {
    btn.style.background = '#2d6a2d';
    btn.style.color = 'white';
    btn.style.borderColor = '#2d6a2d';
    btn.textContent = '✅ Imprimir Ticket';
  } else {
    btn.style.background = '#f8f9fa';
    btn.style.color = '#666';
    btn.style.borderColor = '#ddd';
    btn.textContent = '🖨️ Imprimir Ticket';
  }
  captureActiveSaleTabFromUI();
  renderSaleTabs();
}

// --- Print Ticket ---
function clearTicketPreviewAutoClose(modal) {
  if (!modal) return;
  if (modal._autoCloseTimer) clearTimeout(modal._autoCloseTimer);
  if (modal._enterCloseHandler) document.removeEventListener('keydown', modal._enterCloseHandler, true);
  modal._autoCloseTimer = null;
  modal._enterCloseHandler = null;
}

function printTicket(saleData = null, autoPrint = false, allowManualPrint = !autoPrint, autoClosePreview = false) {
  // Resolve all data from saleData (post-sale reprint) or from current POS state
  const _tcfg     = resolveTicketConfig();
  const _cart     = saleData ? saleData.items : currentCart;
  const _discount = saleData ? saleData.discount : currentDiscount;
  const _customer = saleData ? saleData.customer : posCurrentCustomer;
  const _mode     = saleData ? saleData.priceMode : currentPriceMode;

  if (_cart.length === 0) { showToast('El carrito está vacío', 'warning'); return; }

  const storeName  = saleData ? saleData.storeName : (document.getElementById('posStoreTitle')?.textContent || 'Tienda');
  const folio      = saleData ? saleData.folio : null;
  const now        = saleData ? new Date(saleData.date) : new Date();
  const fecha      = formatAppDateTime(now, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const hora       = formatAppDateTime(now, { hour: '2-digit', minute: '2-digit' });
  const subtotal = _cart.reduce((s, i) => s + i.price * i.quantity, 0);
  let discountAmount = 0;
  if (_discount.value > 0) {
    discountAmount = _discount.type === 'percent'
      ? subtotal * (_discount.value / 100)
      : Math.min(_discount.value, subtotal);
  }
  const total = Math.max(0, subtotal - discountAmount);

  const discRow = discountAmount > 0
    ? `<tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#d32f2f;">Descuento</td><td style="text-align:right;padding:3px 2px;color:#d32f2f;">-$${discountAmount.toFixed(2)}</td></tr>`
    : '';

  const rows = _cart.map(item => `
    <tr>
      <td style="padding:4px 2px;">${item.name}</td>
      <td style="text-align:center;padding:4px 2px;">${item.quantity}</td>
      <td style="text-align:right;padding:4px 2px;">$${item.price.toFixed(2)}</td>
      <td style="text-align:right;padding:4px 2px;">$${(item.price * item.quantity).toFixed(2)}</td>
    </tr>`).join('');

  const headerName = document.getElementById('userName')?.textContent;
  const cashierName = saleData?.employeeName || (headerName && headerName !== 'Admin' && headerName !== 'Usuario' ? headerName : 'Administrador');

  // Resolve payment details
  let paymentRows = '';
  if (saleData) {
    const pm = saleData.paymentMethod;
    const mc = saleData.mixedCashAmount;
    const mo = saleData.mixedOtherAmount;
    const mm = saleData.mixedOtherMethod;
    const pd = saleData.paid;
    if (pm === 'tarjeta' || pm === 'Tarjeta') {
      paymentRows = `<tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">💳 Tarjeta</td><td style="text-align:right;padding:3px 2px;">Exacto</td></tr>`;
    } else if (pm === 'transferencia') {
      paymentRows = `<tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">🏦 Transferencia</td><td style="text-align:right;padding:3px 2px;">Exacto</td></tr>`;
    } else if (pm === 'mixto' && mc > 0) {
      const ml = mm === 'tarjeta' ? '💳 Tarjeta' : '🏦 Transferencia';
      paymentRows = `
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">💵 Efectivo</td><td style="text-align:right;padding:3px 2px;">$${mc.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">${ml}</td><td style="text-align:right;padding:3px 2px;">$${mo.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">Cambio</td><td style="text-align:right;padding:3px 2px;color:#2d6a2d;font-weight:900;">$0.00</td></tr>`;
    } else {
      const change = Math.max(0, pd - total);
      paymentRows = `
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">💵 Efectivo recibido</td><td style="text-align:right;padding:3px 2px;">$${pd.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">Cambio</td><td style="text-align:right;padding:3px 2px;color:#2d6a2d;font-weight:900;">$${change.toFixed(2)}</td></tr>`;
    }
  } else {
    // Read from current DOM state (called before cart is cleared)
    const pm = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'efectivo';
    if (pm === 'tarjeta' || pm === 'Tarjeta') {
      paymentRows = `<tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">💳 Tarjeta</td><td style="text-align:right;padding:3px 2px;">Exacto</td></tr>`;
    } else if (pm === 'transferencia') {
      paymentRows = `<tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">🏦 Transferencia</td><td style="text-align:right;padding:3px 2px;">Exacto</td></tr>`;
    } else if (pm === 'mixto' && mixedPaymentConfirmed) {
      const ml = mixedOtherMethod === 'tarjeta' ? '💳 Tarjeta' : '🏦 Transferencia';
      paymentRows = `
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">💵 Efectivo</td><td style="text-align:right;padding:3px 2px;">$${mixedCashAmount.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">${ml}</td><td style="text-align:right;padding:3px 2px;">$${mixedOtherAmount.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">Cambio</td><td style="text-align:right;padding:3px 2px;color:#2d6a2d;font-weight:900;">$0.00</td></tr>`;
    } else {
      const paidInput = parseMoneyValue(document.getElementById('posAmountPaid')?.value || 0);
      const change    = Math.max(0, paidInput - total);
      paymentRows = `
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">💵 Efectivo recibido</td><td style="text-align:right;padding:3px 2px;">$${paidInput.toFixed(2)}</td></tr>
        <tr><td colspan="3" style="text-align:right;padding:3px 2px;color:#000;">Cambio</td><td style="text-align:right;padding:3px 2px;color:#2d6a2d;font-weight:900;">$${change.toFixed(2)}</td></tr>`;
    }
  }

  const customerLine = _customer
    ? `<div class="sub" style="font-weight:900;margin-top:2px;">Cliente: ${_customer.name} (${_customer.customer_code || 'N/A'})</div>`
    : '';

  const ticketHTML = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Ticket${folio ? ' #' + folio : ''} — ${storeName}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:'Courier New',monospace; font-size:13px; color:#111; padding:18px 14px; max-width:302px; margin:0 auto; }
      h2 { font-size:1.05rem; text-align:center; margin-bottom:2px; letter-spacing:-0.01em; }
      .sub { text-align:center; color:#000; font-size:0.83rem; margin-bottom:3px; }
      .folio { text-align:center; font-size:0.78rem; font-weight:700; color:#222; background:#f0f0f0; padding:4px 0; margin:6px 0; border-radius:3px; letter-spacing:2px; border:1px dashed #ccc; }
      hr { border:none; border-top:1px dashed #aaa; margin:8px 0; }
      table { width:100%; border-collapse:collapse; }
      th { font-size:0.7rem; color:#000; padding:2px; text-transform:uppercase; border-bottom:1px solid #ddd; }
      td { font-size:0.86rem; vertical-align:top; }
      .total-row td { font-weight:900; font-size:1.05rem; padding-top:5px; border-top:1px solid #aaa; }
      .footer { text-align:center; margin-top:14px; color:#000; font-size:0.77rem; line-height:1.9; }
      .cashier-line { text-align:center; margin-top:6px; font-size:0.8rem; color:#000; border-top:1px dashed #ccc; padding-top:6px; }
      @media print { body { padding:6px 2px; } }
    </style>
  </head><body>
    <h2>${storeName}</h2>
    ${folio ? `<div class="folio">★ FOLIO: ${folio} ★</div>` : ''}
    <div class="sub">${fecha}</div>
    <div class="sub">${hora}</div>
    ${customerLine}
    <hr>
    <table>
      <thead><tr>
        <th style="text-align:left;width:44%;">Descripción</th>
        <th style="text-align:center;width:10%;">Cant</th>
        <th style="text-align:right;width:20%;">P.U.</th>
        <th style="text-align:right;width:22%;">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr>
    <table>
      <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Subtotal</td><td style="text-align:right;padding:3px 2px;">$${subtotal.toFixed(2)}</td></tr>
      ${discRow}
      <tr class="total-row"><td colspan="3" style="text-align:right;padding:4px 2px;">TOTAL</td><td style="text-align:right;padding:4px 2px;">$${total.toFixed(2)}</td></tr>
      ${paymentRows}
    </table>
    <hr>
    <div class="footer">${escapeHtml(_tcfg.footerLine1)}<br><strong>${escapeHtml(_tcfg.footerLine2)}</strong></div>
    <div class="cashier-line">Atendió: <strong>${cashierName}</strong></div>
    <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
  </body></html>`;

  // Build ticket body HTML (reused for both preview and print)
  const ticketBody = `
    ${buildTicketHeader({
      storeName,
      folio,
      date: fecha,
      time: hora,
      customer: _customer ? { name: _customer.name, code: _customer.customer_code } : null
    }, _tcfg)}
    <hr>
    <table>
      <thead><tr>
        <th style="text-align:left;width:44%;">Descripción</th>
        <th style="text-align:center;width:10%;">Cant</th>
        <th style="text-align:right;width:20%;">P.U.</th>
        <th style="text-align:right;width:22%;">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr>
    <table>
      <tr><td colspan="3" style="text-align:right;padding:3px 2px;">Subtotal</td><td style="text-align:right;padding:3px 2px;">$${subtotal.toFixed(2)}</td></tr>
      ${discRow}
      <tr class="total-row"><td colspan="3" style="text-align:right;padding:4px 2px;">TOTAL</td><td style="text-align:right;padding:4px 2px;">$${total.toFixed(2)}</td></tr>
      ${paymentRows}
    </table>
    ${buildTicketFooter(cashierName, _tcfg)}`;

  const ticketStyles = `
    ${getThermalTicketStyles()}`;

  // Helper to trigger iframe print
  async function triggerPrint() {
    const ticketHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${ticketStyles}</style></head><body>${ticketBody}</body></html>`;
    try {
      await printHtmlSilently(ticketHTML);
      showToast('Ticket enviado a imprimir', 'success');
    } catch (error) {
      console.error('Error imprimiendo ticket:', error);
      showToast('No se pudo imprimir el ticket: ' + error.message, 'error');
    }
  }

  // Show preview modal
  let previewModal = document.getElementById('_ticketPreviewModal');
  if (!previewModal) {
    previewModal = document.createElement('div');
    previewModal.id = '_ticketPreviewModal';
    previewModal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
    previewModal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:0;max-width:420px;width:94%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.35);">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid #e5e7eb;flex-shrink:0;">
          <span style="font-weight:700;font-size:1rem;color:#111;">Vista previa del ticket</span>
          <div style="display:flex;gap:8px;">
            <button id="_ticketPrintBtn" style="background:#1e4d0f;color:white;border:none;border-radius:6px;padding:7px 16px;font-size:0.875rem;font-weight:600;cursor:pointer;">🖨️ Imprimir</button>
            <button id="_ticketCloseBtn" style="background:#f3f4f6;color:#374151;border:none;border-radius:6px;padding:7px 12px;font-size:0.875rem;cursor:pointer;">✕ Cerrar</button>
          </div>
        </div>
        <div style="overflow:auto;padding:12px 18px 18px;display:flex;justify-content:center;background:#fff;">
          <iframe id="_ticketPreviewContent" title="Vista previa del ticket" style="display:block;width:min(100%, ${_tcfg.paperWidth}mm);height:1px;border:0;background:#fff;"></iframe>
        </div>
      </div>`;
    document.body.appendChild(previewModal);
  }

  // Render the exact thermal document, without an extra styled card around it.
  const previewFrame = document.getElementById('_ticketPreviewContent');
  previewFrame.onload = () => {
    const contentHeight = previewFrame.contentDocument?.body?.scrollHeight || 0;
    previewFrame.style.height = `${Math.max(1, contentHeight)}px`;
  };
  previewFrame.style.height = '1px';
  previewFrame.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${ticketStyles}</style></head><body>${ticketBody}</body></html>`;
  clearTicketPreviewAutoClose(previewModal);
  previewModal.style.display = 'flex';
  previewModal.style.pointerEvents = 'auto';

  function closeModal() {
    clearTicketPreviewAutoClose(previewModal);
    previewModal.style.display = 'none';
    previewModal.style.pointerEvents = 'none';
    window.electronAPI?.refocusWindow?.();
    restorePOSInteractionFocus(document.getElementById('posSearchProduct'), { forceSearch: true, delayMs: 30 });
  }

  document.getElementById('_ticketCloseBtn').onclick = closeModal;
  const ticketPrintBtn = document.getElementById('_ticketPrintBtn');
  if (ticketPrintBtn) ticketPrintBtn.style.display = allowManualPrint ? '' : 'none';
  document.getElementById('_ticketPrintBtn').onclick = () => {
    triggerPrint();
  };

  if (autoClosePreview) {
    const closeWithEnter = (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      closeModal();
    };
    previewModal._enterCloseHandler = closeWithEnter;
    document.addEventListener('keydown', closeWithEnter, true);
    previewModal._autoCloseTimer = setTimeout(closeModal, 5000);
  }

  // Auto-print if toggle was ON
  if (autoPrint) triggerPrint();
}

function updateChange() {
  const total = parseMoneyValue(document.getElementById('posTotal').textContent);
  const paidInput = document.getElementById('posAmountPaid');
  const changeEl = document.getElementById('posChange');
  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'efectivo';

  // Tarjeta y Transferencia: monto exacto, sin cambio
  if (paymentMethod === 'tarjeta' || paymentMethod === 'transferencia') {
    if (paidInput) {
      paidInput.disabled = true;
      paidInput.value = '';
      paidInput.placeholder = 'Exacto';
    }
    if (changeEl) {
      changeEl.textContent = '$0.00';
      changeEl.style.color = '#888';
    }
    // Pago Mixto: el campo de dinero recibido muestra solo la parte en efectivo
  } else if (paymentMethod === 'mixto') {
    if (paidInput) {
      paidInput.disabled = true;
      setPosAmountPaidValue(paidInput, mixedPaymentConfirmed ? mixedCashAmount : '');
      paidInput.placeholder = 'Ver panel mixto';
    }
    if (changeEl) {
      changeEl.textContent = '$0.00'; // Sin cambio en pago mixto (se paga exacto)
      changeEl.style.color = '#888';
    }
    // Efectivo: calcular cambio
  } else {
    if (paidInput) {
      paidInput.disabled = false;
      paidInput.placeholder = '0.00';
    }
    const paid = parseMoneyValue(paidInput?.value || 0);
    if (paid >= total && total > 0) {
      if (changeEl) {
      changeEl.textContent = formatCurrencyMX(paid - total);
        changeEl.style.color = '#2d6a2d';
      }
    } else {
      if (changeEl) {
        changeEl.textContent = '$0.00';
        changeEl.style.color = '#888';
      }
    }
  }
}

function clearCart() {
  if (currentCart.length > 0) {
    if (!confirm('¿Cancelar venta actual y borrar carrito?')) return;
  }
  currentCart = [];
  currentDiscount = { type: 'percent', value: 0 };
  const discInp = document.getElementById('posDiscountInput');
  if (discInp) discInp.value = '';
  document.getElementById('posAmountPaid').value = '';

  // Resetear estado de pago mixto
  mixedCashAmount = 0;
  mixedOtherAmount = 0;
  mixedOtherMethod = 'tarjeta';
  mixedPaymentConfirmed = false;
  const mixedCashInput = document.getElementById('posMixedCash');
  if (mixedCashInput) mixedCashInput.value = '';
  const mixedOtherInput = document.getElementById('posMixedOther');
  if (mixedOtherInput) mixedOtherInput.value = '';
  const mixedStatus = document.getElementById('mixedPaymentStatus');
  if (mixedStatus) { mixedStatus.style.display = 'none'; mixedStatus.textContent = ''; }
  const mixedPanel = document.getElementById('mixedPaymentPanel');
  if (mixedPanel) mixedPanel.style.display = 'none';

  selectPayment('efectivo');
  if (typeof setPriceMode === 'function') setPriceMode('retail');
  else currentPriceMode = 'retail';

  if (typeof clearCustomerFromSale === 'function') {
    clearCustomerFromSale();
  }

  renderCart();
  restorePOSInteractionFocus(document.getElementById('posSearchProduct'), { forceSearch: true, delayMs: 30 });
}

function isMissingRpcError(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return msg.includes('function') && (msg.includes('does not exist') || msg.includes('not found'));
}

async function getInventoryRow(storeId, productId) {
  return await getCachedInventoryRow(storeId, productId);
}

async function restoreInventory(storeId, productId, qty) {
  const numericQty = parseInt(qty || 0);
  if (!storeId || !productId || numericQty <= 0) {
    throw new Error('Datos invalidos para restaurar inventario');
  }

  const { error: rpcError } = await supabaseClient.rpc('increment_inventory', {
    p_store_id: storeId,
    p_product_id: productId,
    p_qty: numericQty
  });

  if (!rpcError) {
    const { data: updatedRow, error: fetchError } = await supabaseClient
      .from('inventory')
      .select('id, product_id, store_id, quantity, min_stock')
      .eq('store_id', storeId)
      .eq('product_id', productId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (updatedRow) cacheInventoryRow(updatedRow);
    return;
  }

  if (!isMissingRpcError(rpcError)) {
    throw rpcError;
  }

  const invRow = await getInventoryRow(storeId, productId);
  if (!invRow) {
    const { data: insertedRow, error: insertError } = await supabaseClient
      .from('inventory')
      .insert({
        store_id: storeId,
        product_id: productId,
        quantity: numericQty,
        min_stock: 10,
        updated_at: new Date().toISOString()
      })
      .select('id, product_id, store_id, quantity, min_stock')
      .single();

    if (insertError) throw insertError;
    cacheInventoryRow(insertedRow);
    return;
  }

  const newQty = parseInt(invRow.quantity || 0) + numericQty;
  const { data: updatedRow, error: updateError } = await supabaseClient
    .from('inventory')
    .update({
      quantity: newQty,
      updated_at: new Date().toISOString()
    })
    .eq('id', invRow.id)
    .select('id, product_id, store_id, quantity, min_stock')
    .single();

  if (updateError) throw updateError;
  cacheInventoryRow(updatedRow);
}

async function decrementInventoryForSale(storeId, productId, qty) {
  const numericQty = Math.round(parseFloat(qty || 0) * 1000) / 1000;
  if (!storeId || !productId || numericQty <= 0) {
    throw new Error('Datos invalidos para descontar inventario');
  }

  const { error: rpcError } = await supabaseClient.rpc('decrement_inventory', {
    p_store_id: storeId,
    p_product_id: productId,
    p_qty: numericQty
  });

  if (!rpcError) {
    const { data: updatedRow, error: fetchError } = await supabaseClient
      .from('inventory')
      .select('id, product_id, store_id, quantity, min_stock')
      .eq('store_id', storeId)
      .eq('product_id', productId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (updatedRow) cacheInventoryRow(updatedRow);
    return updatedRow;
  }

  if (!isMissingRpcError(rpcError)) {
    throw rpcError;
  }

  const { data: invRow, error: loadError } = await supabaseClient
    .from('inventory')
    .select('id, product_id, store_id, quantity, min_stock')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .maybeSingle();

  if (loadError) throw loadError;
  const available = parseFloat(invRow?.quantity || 0);
  if (!invRow || available < numericQty) {
    throw new Error(`Stock insuficiente (disponible: ${available})`);
  }

  const { data: updatedRow, error: updateError } = await supabaseClient
    .from('inventory')
    .update({
      quantity: available - numericQty,
      updated_at: new Date().toISOString()
    })
    .eq('id', invRow.id)
    .eq('quantity', available)
    .select('id, product_id, store_id, quantity, min_stock')
    .maybeSingle();

  if (updateError) throw updateError;
  if (!updatedRow) throw new Error('El inventario cambio durante la venta. Intenta cobrar de nuevo.');
  cacheInventoryRow(updatedRow);
  return updatedRow;
}

async function adjustInventoryQuantity(storeId, productId, deltaQty) {
  const numericDelta = parseInt(deltaQty || 0);
  if (!storeId || !productId || numericDelta === 0) return;

  const invRow = await getInventoryRow(storeId, productId, true);
  if (!invRow) throw new Error('Inventario no encontrado para ajustar devolución');

  const newQty = parseInt(invRow.quantity || 0) + numericDelta;
  if (newQty < 0) throw new Error('El ajuste dejaría inventario negativo');

  const { data: updatedRow, error } = await supabaseClient
    .from('inventory')
    .update({
      quantity: newQty,
      updated_at: new Date().toISOString()
    })
    .eq('id', invRow.id)
    .select('id, product_id, store_id, quantity, min_stock')
    .single();

  if (error) throw error;
  cacheInventoryRow(updatedRow);
}

async function incrementInventoryForPurchase(storeId, productId, qty) {
  const numericQty = parseInt(qty || 0);
  if (!storeId || !productId || numericQty <= 0) {
    throw new Error('Datos invalidos para incrementar inventario');
  }

  const { error: rpcError } = await supabaseClient.rpc('increment_inventory', {
    p_store_id: storeId,
    p_product_id: productId,
    p_qty: numericQty
  });

  if (!rpcError) {
    const { data: updatedRow, error: fetchError } = await supabaseClient
      .from('inventory')
      .select('id, product_id, store_id, quantity, min_stock')
      .eq('store_id', storeId)
      .eq('product_id', productId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (updatedRow) cacheInventoryRow(updatedRow);
    return;
  }

  if (!isMissingRpcError(rpcError)) {
    throw rpcError;
  }

  const { data: existingRow, error: loadError } = await supabaseClient
    .from('inventory')
    .select('id, product_id, store_id, quantity, min_stock')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .maybeSingle();

  if (loadError) throw loadError;

  if (existingRow) {
    const nextQty = parseInt(existingRow.quantity || 0) + numericQty;
    const { data: savedRow, error: updateError } = await supabaseClient
      .from('inventory')
      .update({ quantity: nextQty, updated_at: new Date().toISOString() })
      .eq('id', existingRow.id)
      .select('id, product_id, store_id, quantity, min_stock')
      .single();

    if (updateError) throw updateError;
    cacheInventoryRow(savedRow);
    return;
  }

  const { data: insertedRow, error: insertError } = await supabaseClient
    .from('inventory')
    .insert({
      store_id: storeId,
      product_id: productId,
      quantity: numericQty,
      min_stock: 10,
      updated_at: new Date().toISOString()
    })
    .select('id, product_id, store_id, quantity, min_stock')
    .single();

  if (insertError) throw insertError;
  cacheInventoryRow(insertedRow);
}

async function processSale() {
  if (currentCart.length === 0) return;
  if (!posCurrentStoreId) {
    showToast('Error: Tienda no seleccionada', 'error');
    return;
  }

  // Read the already-calculated (discounted) total from the DOM
  const total = parseMoneyValue(document.getElementById('posTotal').textContent);
  const paid = parseMoneyValue(document.getElementById('posAmountPaid').value || 0);
  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'efectivo';

  if (isNaN(total) || total <= 0) {
    showToast('El carrito está vacío', 'warning');
    return;
  }

  if (paymentMethod === 'efectivo' && paid < total) {
    showToast(`Monto insuficiente. Faltan ${formatCurrencyMX(total - paid)}`, 'error');
    document.getElementById('posAmountPaid').focus();
    return;
  }

  // Validar que el pago mixto esté correctamente confirmado
  if (paymentMethod === 'mixto' && !mixedPaymentConfirmed) {
    showToast('Primero confirma el pago mixto en el panel de desglose', 'warning');
    document.getElementById('posMixedCash')?.focus();
    return;
  }

  const currentUser = Auth.getCurrentUser();
  if (!currentUser?.id) {
    showToast('Sesion invalida. Cierra sesion y vuelve a entrar antes de cobrar.', 'error');
    return;
  }

  const processBtn = document.getElementById('btnProcessSale');
  processBtn.disabled = true;
  posSaleProcessing = true;
  let createdSale = null;
  const decrementedItems = [];
  processBtn.textContent = '⏳ Procesando...';

  try {
    const employeeId = currentUser?.id || null;
    const saleItemsPayload = currentCart.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      unit_price: item.price
    }));

    const { data: rpcSale, error: rpcSaleError } = await supabaseClient
      .rpc('process_sale_transaction', {
        p_store_id: posCurrentStoreId,
        p_employee_id: employeeId,
        p_customer_id: posCurrentCustomer?.id || null,
        p_total: total,
        p_payment_method: paymentMethod,
        p_sale_type: { retail: 'Menudeo', wholesale: 'Mayoreo', distributor: 'Distribuidor' }[currentPriceMode] || 'Menudeo',
        p_cash_amount: paymentMethod === 'mixto' ? mixedCashAmount : null,
        p_card_amount: (paymentMethod === 'mixto' && mixedOtherMethod === 'tarjeta') ? mixedOtherAmount : null,
        p_transfer_amount: paymentMethod === 'transferencia'
          ? total
          : (paymentMethod === 'mixto' && mixedOtherMethod === 'transferencia' ? mixedOtherAmount : null),
        p_mixed_method: paymentMethod === 'mixto' ? `efectivo+${mixedOtherMethod}` : null,
        p_items: saleItemsPayload
      })
      .single();

    if (!rpcSaleError && rpcSale) {
      currentCart.forEach(item => adjustCachedInventory(posCurrentStoreId, item.id, -item.quantity));
      lastSaleData = {
        id: rpcSale.id,
        folio: rpcSale.id.replace(/-/g, '').slice(-8).toUpperCase(),
        items: currentCart.map(i => ({ ...i })),
        total,
        subtotal: currentCart.reduce((s, i) => s + i.price * i.quantity, 0),
        discount: { ...currentDiscount },
        paymentMethod,
        paid,
        mixedCashAmount,
        mixedOtherAmount,
        mixedOtherMethod,
        customer: posCurrentCustomer ? { ...posCurrentCustomer } : null,
        priceMode: currentPriceMode,
        employeeName: document.getElementById('userName')?.textContent || 'Administrador',
        storeName: document.getElementById('posStoreTitle')?.textContent || '',
        storeId: posCurrentStoreId,
        date: new Date(rpcSale.sale_date || Date.now())
      };

      showToast(`Venta registrada - Total: ${formatCurrencyMX(total)} | Cambio: ${formatCurrencyMX(paid - total)}`, 'success');

      const shouldAutoPrint = printTicketOnSale;
      printTicketOnSale = false;
      const tBtn = document.getElementById('btnTicketToggle');
      if (tBtn) {
        tBtn.style.background = '#f8f9fa';
        tBtn.style.color = '#666';
        tBtn.style.borderColor = '#ddd';
        tBtn.textContent = '🖨️ Imprimir Ticket';
      }
      rememberRecentTicket(lastSaleData);
      printTicket(lastSaleData, shouldAutoPrint, !shouldAutoPrint, true);

      currentCart = [];
      currentDiscount = { type: 'percent', value: 0 };
      const dInp = document.getElementById('posDiscountInput');
      if (dInp) dInp.value = '';
      document.getElementById('posAmountPaid').value = '';
      if (typeof clearCustomerFromSale === 'function') clearCustomerFromSale();
      if (typeof setPriceMode === 'function') setPriceMode('retail');
      renderCart();
      processBtn.textContent = '✅ COBRAR (F2)';
      processBtn.style.opacity = '0.45';
      posSaleProcessing = false;
      closeCompletedSaleTab();
      return;
    }

    if (!isMissingRpcError(rpcSaleError)) {
      throw rpcSaleError;
    }

    // 1. Validate stock before creating sale rows.
    for (const item of currentCart) {
      const invRow = await getInventoryRow(posCurrentStoreId, item.id);
      const available = parseFloat(invRow?.quantity || 0);
      if (!invRow || available < item.quantity) {
        throw new Error(`Stock insuficiente para ${item.name || 'producto'} (disponible: ${available})`);
      }
    }

    // 3. Insert sale con soporte para el desglose de pago mixto y transferencia
    // Segun el método de pago se guardan los montos en las columnas correspondientes:
    //   - efectivo puro    -> ningun campo extra
    //   - tarjeta pura     -> ningun campo extra  
    //   - transferencia    -> transfer_amount = total
    //   - mixto            -> cash_amount + (card_amount | transfer_amount) + mixed_method
    const { data: sale, error: saleError } = await supabaseClient
      .from('sales')
      .insert({
        store_id: posCurrentStoreId,
        employee_id: employeeId,
        customer_id: posCurrentCustomer?.id || null,
        total: total,
        payment_method: paymentMethod,
        sale_date: new Date().toISOString(),
        sale_type: { retail: 'Menudeo', wholesale: 'Mayoreo', distributor: 'Distribuidor' }[currentPriceMode] || 'Menudeo',
        // --- Desglose por método de pago ---
        cash_amount: paymentMethod === 'mixto' ? mixedCashAmount : null,
        card_amount: (paymentMethod === 'mixto' && mixedOtherMethod === 'tarjeta')
          ? mixedOtherAmount : null,
        transfer_amount: paymentMethod === 'transferencia'
          ? total
          : (paymentMethod === 'mixto' && mixedOtherMethod === 'transferencia'
            ? mixedOtherAmount : null),
        mixed_method: paymentMethod === 'mixto' ? `efectivo+${mixedOtherMethod}` : null
      })
      .select()
      .single();

    if (saleError) throw saleError;
    createdSale = sale;

    // 4. Insert sale items
    const saleItems = currentCart.map(item => ({
      sale_id: sale.id,
      product_id: item.id,
      quantity: item.quantity,
      unit_price: item.price,
      subtotal: item.price * item.quantity
    }));

    const { error: itemsError } = await supabaseClient
      .from('sale_items')
      .insert(saleItems);

    if (itemsError) throw itemsError;

    // Save snapshot for ticket reprinting after cart is cleared
    lastSaleData = {
      id: sale.id,
      folio: sale.id.replace(/-/g, '').slice(-8).toUpperCase(),
      items: currentCart.map(i => ({ ...i })),
      total,
      subtotal: currentCart.reduce((s, i) => s + i.price * i.quantity, 0),
      discount: { ...currentDiscount },
      paymentMethod,
      paid,
      mixedCashAmount,
      mixedOtherAmount,
      mixedOtherMethod,
      customer: posCurrentCustomer ? { ...posCurrentCustomer } : null,
      priceMode: currentPriceMode,
      employeeName: document.getElementById('userName')?.textContent || 'Administrador',
      storeName: document.getElementById('posStoreTitle')?.textContent || '',
      storeId: posCurrentStoreId,
      date: new Date()
    };

    // 5. Deduct inventory for each item in this store
    for (const item of currentCart) {
      const invRow = await getInventoryRow(posCurrentStoreId, item.id);
      const available = parseFloat(invRow?.quantity || 0);

      if (!invRow || available < item.quantity) {
        throw new Error(`Stock insuficiente para ${item.name || 'producto'} (disponible: ${available})`);
      }

      await decrementInventoryForSale(posCurrentStoreId, item.id, item.quantity);
      decrementedItems.push(item);

      await supabaseClient.from('inventory_logs').insert({
        store_id: posCurrentStoreId,
        product_id: item.id,
        employee_id: employeeId,
        type: 'venta',
        quantity: -item.quantity,
        description: 'Venta ' + sale.id.replace(/-/g, '').slice(-8).toUpperCase()
      });
    }

    // 6. Success!
    showToast(`Venta registrada - Total: ${formatCurrencyMX(total)} | Cambio: ${formatCurrencyMX(paid - total)}`, 'success');

    // Always show ticket preview; auto-print only if toggle was ON
    const shouldAutoPrint = printTicketOnSale;
    printTicketOnSale = false;
    const tBtn = document.getElementById('btnTicketToggle');
    if (tBtn) {
      tBtn.style.background = '#f8f9fa';
      tBtn.style.color = '#666';
      tBtn.style.borderColor = '#ddd';
      tBtn.textContent = '🖨️ Imprimir Ticket';
    }
    rememberRecentTicket(lastSaleData);
    printTicket(lastSaleData, shouldAutoPrint, !shouldAutoPrint, true);

    // 7. Reset POS state
    currentCart = [];
    currentDiscount = { type: 'percent', value: 0 };
    const dInp = document.getElementById('posDiscountInput');
    if (dInp) dInp.value = '';
    document.getElementById('posAmountPaid').value = '';
    if (typeof clearCustomerFromSale === 'function') clearCustomerFromSale();
    if (typeof setPriceMode === 'function') setPriceMode('retail');
    renderCart();
    processBtn.textContent = '✅ COBRAR (F2)';
    processBtn.style.opacity = '0.45';
    posSaleProcessing = false;
    closeCompletedSaleTab();

  } catch (error) {
    console.error('Sale error:', error);
    try {
      if (createdSale?.id) {
        await supabaseClient.from('sale_items').delete().eq('sale_id', createdSale.id);
        await supabaseClient.from('sales').delete().eq('id', createdSale.id);
      }
      for (const item of decrementedItems) {
        await restoreInventory(posCurrentStoreId, item.id, item.quantity);
      }
    } catch (rollbackError) {
      console.error('Sale rollback error:', rollbackError);
    }
    showToast('Error al procesar venta: ' + error.message, 'error');
    posSaleProcessing = false;
    processBtn.disabled = false;
    processBtn.textContent = '⚠️ Reintentar';
  }
}

// NOTE: loadInventory is defined inside the DOMContentLoaded scope above
// Global variables to keep track of chart instances so we can destroy them on reload
window.posCharts = window.posCharts || {};

const APP_LOCALE = 'es-MX';
const APP_TIME_ZONE = 'America/Mexico_City';

function getTimeZoneOffsetMs(date, timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = Number(part.value);
    return acc;
  }, {});

  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function getUtcDateForAppTimeZone(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const wallTimeMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let utcMs = wallTimeMs - getTimeZoneOffsetMs(new Date(wallTimeMs));
  utcMs = wallTimeMs - getTimeZoneOffsetMs(new Date(utcMs));
  return new Date(utcMs);
}

function getAppDateFromInputValue(dateStr, hour = 12) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return getUtcDateForAppTimeZone(year, month, day, hour, 0, 0, 0);
}

function toLocalDateInputValue(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftLocalDateInputValue(dateStr, days) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return toLocalDateInputValue(new Date());
  return toLocalDateInputValue(getUtcDateForAppTimeZone(year, month, day + days, 12));
}

function formatAppDateTime(dateValue, options = {}) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, ...options }).format(date);
}

function isDateValueInIsoRange(dateValue, startIso, endIso) {
  const valueTime = new Date(dateValue).getTime();
  if (Number.isNaN(valueTime)) return false;
  return valueTime >= new Date(startIso).getTime() && valueTime < new Date(endIso).getTime();
}

function formatMoneyMX(value) {
  return Number(value || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function formatCurrencyMX(value) {
  return Number(value || 0).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseMoneyValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '').replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPosAmountPaidWhileTyping(value) {
  const raw = String(value || '');
  const normalized = raw.replace(/[^\d.]/g, '');
  if (!normalized || !/\d/.test(normalized)) return '';

  const [wholePart = '', ...decimalParts] = normalized.split('.');
  const whole = Number(wholePart || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
  const decimal = decimalParts.join('').slice(0, 2);
  return `$${whole}${normalized.includes('.') ? `.${decimal}` : ''}`;
}

function setPosAmountPaidValue(input, value) {
  if (!input) return;
  const raw = String(value || '');
  input.value = raw && /\d/.test(raw) ? formatCurrencyMX(parseMoneyValue(raw)) : '';
}

function formatMoneyInputValue(input) {
  if (!input) return;
  input.value = formatCurrencyMX(parseMoneyValue(input.value));
}

function unformatMoneyInputValue(input) {
  if (!input) return;
  const value = parseMoneyValue(input.value);
  input.value = value > 0 ? value.toFixed(2) : '';
  setTimeout(() => input.select?.(), 0);
}

function getLocalDateRange(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const start = getUtcDateForAppTimeZone(year, month, day, 0, 0, 0, 0);
  const end = getUtcDateForAppTimeZone(year, month, day + 1, 0, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function fetchSalesForDateRange(selectFields, startIso, endIso, options = {}) {
  const pageSize = options.pageSize || 1000;
  const maxRows = options.maxRows || 10000;
  const rows = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, error } = await supabaseClient
      .from('sales')
      .select(selectFields)
      .gte('sale_date', startIso)
      .lt('sale_date', endIso)
      .order('sale_date', { ascending: !!options.ascending })
      .range(from, to);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function setupHistoricalSalesByStoreReport(defaultDateStr) {
  const input = document.getElementById('historicalSalesDate');
  if (!input) return;

  const todayStr = toLocalDateInputValue(new Date());

  input.max = todayStr;
  input.min = shiftLocalDateInputValue(todayStr, -14);
  if (!input.value) input.value = defaultDateStr || input.max;

  input.onchange = () => loadReports(input.value);
}

function clampReportDate(dateStr) {
  const maxStr = toLocalDateInputValue(new Date());
  const minStr = shiftLocalDateInputValue(maxStr, -14);

  if (!dateStr || dateStr > maxStr) return maxStr;
  if (dateStr < minStr) return minStr;
  return dateStr;
}

function getReportPaymentBreakdown(sale) {
  const method = (sale.payment_method || 'efectivo').toLowerCase();
  const total = parseFloat(sale.total || 0);
  const breakdown = { efectivo: 0, tarjeta: 0, transferencia: 0 };

  if (method === 'mixto') {
    breakdown.efectivo += parseFloat(sale.cash_amount || 0);
    breakdown.tarjeta += parseFloat(sale.card_amount || 0);
    breakdown.transferencia += parseFloat(sale.transfer_amount || 0);
    if ((breakdown.efectivo + breakdown.tarjeta + breakdown.transferencia) <= 0) {
      breakdown.efectivo = total;
    }
    return breakdown;
  }

  if (method === 'tarjeta') breakdown.tarjeta = total;
  else if (method === 'transferencia') breakdown.transferencia = total;
  else breakdown.efectivo = total;

  return breakdown;
}

function getReportPaymentLabel(sale) {
  const method = (sale.payment_method || 'efectivo').toLowerCase();
  if (method !== 'mixto') {
    return { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }[method] || 'Efectivo';
  }

  const breakdown = getReportPaymentBreakdown(sale);
  const parts = [];
  if (breakdown.efectivo > 0) parts.push(`Efectivo $${formatMoneyMX(breakdown.efectivo)}`);
  if (breakdown.tarjeta > 0) parts.push(`Tarjeta $${formatMoneyMX(breakdown.tarjeta)}`);
  if (breakdown.transferencia > 0) parts.push(`Transferencia $${formatMoneyMX(breakdown.transferencia)}`);
  return parts.length ? `Mixto: ${parts.join(' + ')}` : 'Mixto';
}

function openReportStoreDetail(storeId) {
  const state = window.reportSalesByStore?.[storeId];
  if (!state) return;

  const sales = state.sales || [];
  const total = sales.reduce((sum, sale) => sum + parseFloat(sale.total || 0), 0);
  const payments = sales.reduce((acc, sale) => {
    const breakdown = getReportPaymentBreakdown(sale);
    acc.efectivo += breakdown.efectivo;
    acc.tarjeta += breakdown.tarjeta;
    acc.transferencia += breakdown.transferencia;
    return acc;
  }, { efectivo: 0, tarjeta: 0, transferencia: 0 });

  const salesHtml = sales.length ? sales.map((sale, index) => {
    const time = formatAppDateTime(sale.sale_date, { hour: '2-digit', minute: '2-digit' });
    const person = sale.customer?.name || sale.employee?.full_name || 'Venta general';
    const itemsHtml = (sale.items || []).map(item => `
      <div class="report-detail-item">
        <span>${Number(item.quantity || 0)}x ${escapeHtml(item.product?.name || 'Producto')}</span>
        <span>$${formatMoneyMX(item.subtotal)}</span>
      </div>
    `).join('') || '<div class="text-muted">Sin detalle de productos.</div>';

    return `
      <div class="report-sale-block">
        <button class="report-sale-toggle" onclick="toggleAccordion('report-sale-${sale.id || index}')">
          <span>
            <strong>$${formatMoneyMX(sale.total)}</strong>
            <small>${escapeHtml(getReportPaymentLabel(sale))} - ${escapeHtml(person)} - ${time}</small>
          </span>
          <span>Ver detalle</span>
        </button>
        <div id="report-sale-${sale.id || index}" class="report-sale-items" style="display:none;">
          ${itemsHtml}
        </div>
      </div>
    `;
  }).join('') : '<p class="text-muted">Esta tienda no tuvo ventas en la fecha seleccionada.</p>';

  document.getElementById('modalContainer').innerHTML = `
    <div class="modal active">
      <div class="modal-content report-detail-modal">
        <div class="modal-header">
          <div>
            <h3>${escapeHtml(state.store.name)}</h3>
            <p class="text-muted" style="margin:4px 0 0;">Detalle de ventas del ${escapeHtml(state.labelDate)}</p>
          </div>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="report-detail-summary">
          <div><span>Total</span><strong>$${formatMoneyMX(total)}</strong></div>
          <div><span>Efectivo</span><strong>$${formatMoneyMX(payments.efectivo)}</strong></div>
          <div><span>Tarjeta</span><strong>$${formatMoneyMX(payments.tarjeta)}</strong></div>
          <div><span>Transferencia</span><strong>$${formatMoneyMX(payments.transferencia)}</strong></div>
        </div>
        <div class="report-detail-list">${salesHtml}</div>
      </div>
    </div>
  `;
}

window.openReportStoreDetail = openReportStoreDetail;

async function loadHistoricalSalesByStore(dateStr) {
  const container = document.getElementById('historicalSalesByStore');
  const totalEl = document.getElementById('historicalSalesTotal');
  if (!container || !totalEl || !dateStr) return;

  container.innerHTML = '<p class="text-muted">Cargando ventas...</p>';

  try {
    const { startIso, endIso } = getLocalDateRange(dateStr);
    const [storesRes, salesData] = await Promise.all([
      supabaseClient
        .from('stores')
        .select('id, name, type, is_active')
        .eq('is_active', true)
        .order('type', { ascending: false })
        .order('name'),
      fetchSalesForDateRange('store_id, total', startIso, endIso)
    ]);

    if (storesRes.error) throw storesRes.error;

    const totalsByStore = {};
    (salesData || []).forEach(sale => {
      const total = parseFloat(sale.total || 0);
      totalsByStore[sale.store_id] = (totalsByStore[sale.store_id] || 0) + total;
    });

    const rows = (storesRes.data || [])
      .map(store => ({
        name: store.name,
        type: store.type,
        total: totalsByStore[store.id] || 0
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const dayTotal = rows.reduce((sum, row) => sum + row.total, 0);
    const maxVal = Math.max(...rows.map(row => row.total), 0);
    const labelDate = formatAppDateTime(getAppDateFromInputValue(dateStr), {
      weekday: 'long',
      day: '2-digit',
      month: 'short'
    });

    totalEl.textContent = `Total ${labelDate}: $${formatMoneyMX(dayTotal)}`;

    if (rows.length === 0) {
      container.innerHTML = '<p class="text-muted">No hay tiendas activas para mostrar.</p>';
      return;
    }

    container.innerHTML = rows.map(row => {
      const pct = maxVal > 0 ? (row.total / maxVal * 100) : 0;
      const share = dayTotal > 0 ? (row.total / dayTotal * 100).toFixed(1) : '0.0';
      const icon = row.type === 'bodega' ? '📦' : '🏪';
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;">
            <span style="font-size:0.9rem; color:#374151; font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${icon} ${row.name}</span>
            <span style="color:var(--primary); font-weight:800; white-space:nowrap;">$${formatMoneyMX(row.total)}</span>
          </div>
          <div style="background:#e9ecef; border-radius:999px; height:12px; overflow:hidden;">
            <div style="background:linear-gradient(90deg, var(--primary), #4caf50); width:${pct}%; height:100%; border-radius:999px;"></div>
          </div>
          <div style="text-align:right; font-size:0.72rem; color:#888; margin-top:3px;">${share}% del total del dia</div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading historical sales report:', error);
    container.innerHTML = `<p class="text-danger">Error al cargar ventas: ${error.message}</p>`;
  }
}

async function loadReports(selectedDateStr = null) {
  try {
    const todayStr = toLocalDateInputValue(new Date());

    const dateInput = document.getElementById('historicalSalesDate');
    const reportDateStr = clampReportDate(selectedDateStr || dateInput?.value || todayStr);
    if (dateInput && dateInput.value !== reportDateStr) dateInput.value = reportDateStr;

    const { startIso: todayStartIso, endIso: todayEndIso } = getLocalDateRange(reportDateStr);
    const reportDate = getAppDateFromInputValue(reportDateStr);
    const todayLabel = formatAppDateTime(reportDate);
    const longDateLabel = formatAppDateTime(reportDate, {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });

    // Sales by store for the selected day
    const [storesRes, salesByStore] = await Promise.all([
      supabaseClient
        .from('stores')
        .select('id, name, type, is_active')
        .eq('is_active', true)
        .order('type', { ascending: false })
        .order('name'),
      fetchSalesForDateRange('id, store_id, total, payment_method, cash_amount, card_amount, transfer_amount, mixed_method, sale_date, sale_type, store:stores(name, type), employee:employees(full_name), customer:customers(name), items:sale_items(quantity, unit_price, subtotal, product:products(name, cost_price, retail_price, wholesale_price, distributor_price))', todayStartIso, todayEndIso)
    ]);

    if (storesRes.error) throw storesRes.error;

    const activeStores = storesRes.data || [];

    // Aggregate by store & payment method
    const storeMap = {};
    const storeSalesMap = {};
    const paymentMap = { efectivo: 0, tarjeta: 0, transferencia: 0 };
    let totalSalesRevenue = 0;

    activeStores.forEach(store => {
      storeMap[store.id] = { store, total: 0, count: 0 };
      storeSalesMap[store.id] = [];
    });

    salesByStore.forEach(s => {
      const store = s.store || activeStores.find(item => item.id === s.store_id) || { id: s.store_id, name: 'Sin tienda', type: 'tienda' };
      const total = parseFloat(s.total || 0);
      if (!storeMap[s.store_id]) storeMap[s.store_id] = { store, total: 0, count: 0 };
      if (!storeSalesMap[s.store_id]) storeSalesMap[s.store_id] = [];
      storeMap[s.store_id].total += total;
      storeMap[s.store_id].count += 1;
      storeSalesMap[s.store_id].push(s);

      const breakdown = getReportPaymentBreakdown(s);
      paymentMap.efectivo += breakdown.efectivo;
      paymentMap.tarjeta += breakdown.tarjeta;
      paymentMap.transferencia += breakdown.transferencia;
      totalSalesRevenue += total;
    });

    window.reportSalesByStore = {};
    Object.entries(storeMap).forEach(([storeId, entry]) => {
      window.reportSalesByStore[storeId] = {
        store: entry.store,
        sales: storeSalesMap[storeId] || [],
        labelDate: longDateLabel
      };
    });

    // Aggregate profit and price types
    const topItems = salesByStore.flatMap(sale => sale.items || []);
    let totalCost = 0;
    const priceTypeMap = { menudeo: 0, mayoreo: 0, distribuidor: 0, otro: 0 };

    const productMap = {};
    if (topItems) {
      topItems.forEach(item => {
        const name = item.product?.name || 'Desconocido';
        const qty = item.quantity;
        const sub = parseFloat(item.subtotal || 0);
        const uPrice = parseFloat(item.unit_price || 0);

        // Count top products by units sold.
        productMap[name] = (productMap[name] || 0) + Number(qty || 0);

        if (item.product) {
          // Calculate cost
          const cost = parseFloat(item.product.cost_price || 0);
          totalCost += (cost * qty);

          // Infer price type
          const retail = parseFloat(item.product.retail_price || -1);
          const wholesale = parseFloat(item.product.wholesale_price || -1);
          const dist = parseFloat(item.product.distributor_price || -1);

          if (uPrice === wholesale && wholesale > 0) priceTypeMap.mayoreo += sub;
          else if (uPrice === dist && dist > 0) priceTypeMap.distribuidor += sub;
          else if (uPrice === retail) priceTypeMap.menudeo += sub;
          else priceTypeMap.otro += sub;
        }
      });
    }

    const totalProfit = Math.max(0, totalSalesRevenue - totalCost);

    // Sort and take top 50 (used to be 10, increased for scrollable view)
    const topProductsSorted = Object.entries(productMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    // Update Section Title to reflect "Today"
    document.getElementById('pageSubtitle').textContent = `Estadisticas de ${todayLabel}`;

    // Update KPI summary cards
    const totalTickets = salesByStore.length;
    const marginPct = totalSalesRevenue > 0 ? ((totalProfit / totalSalesRevenue) * 100).toFixed(1) : '0.0';
    const kpiTotalEl = document.getElementById('kpiTotalVentas');
    const kpiGananciaEl = document.getElementById('kpiGanancia');
    const kpiTicketsEl = document.getElementById('kpiTickets');
    const kpiMargenEl = document.getElementById('kpiMargen');
    if (kpiTotalEl) kpiTotalEl.textContent = `$${formatMoneyMX(totalSalesRevenue)}`;
    if (kpiGananciaEl) kpiGananciaEl.textContent = `$${formatMoneyMX(totalProfit)}`;
    if (kpiTicketsEl) kpiTicketsEl.textContent = totalTickets.toLocaleString('es-MX');
    if (kpiMargenEl) kpiMargenEl.textContent = `${marginPct}%`;

    await setupHistoricalSalesByStoreReport(todayStr);

    // Render top products
    const topProductsEl = document.getElementById('topProducts');
    if (topProductsEl) {
      if (topProductsSorted.length === 0) {
        topProductsEl.innerHTML = `<p class="text-muted" style="text-align:center; padding: 2rem;">No hay ventas registradas el ${longDateLabel}.</p>`;
      } else {
        topProductsEl.innerHTML = topProductsSorted.map(([name, qty], i) => {
          let bColor = (i === 0) ? '#16a34a' : (i === 1) ? '#2563eb' : (i === 2) ? '#d97706' : 'var(--primary)';
          let bgLig = (i === 0) ? '#dcfce7' : (i === 1) ? '#dbeafe' : (i === 2) ? '#fef3c7' : '#eef7ee';
          return `
          <div class="d-flex justify-content-between align-items-center mb-3 p-3" style="background: white; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.04); border-left: 5px solid ${bColor}; transition: transform 0.2s ease;">
            <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;">
              <span style="background: ${bgLig}; color: ${bColor}; font-weight: 800; width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.9rem;">#${i + 1}</span>
              <strong style="font-size: 1rem; color: #2d3748; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;" title="${name}">${name}</strong>
            </div>
            <span style="background: ${bColor}; color: white; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; flex-shrink: 0; margin-left: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${Number(qty).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} pz</span>
          </div>
        `}).join('');
      }
    }

    // Render sales by store (HTML bars)
    const storeEntries = Object.entries(storeMap)
      .map(([storeId, entry]) => ({ storeId, ...entry }))
      .sort((a, b) => b.total - a.total || a.store.name.localeCompare(b.store.name));
    const salesByStoreContainer = document.getElementById('salesByStoreContainer') || document.getElementById('salesByStoreChart')?.parentElement;
    if (salesByStoreContainer) {
      const parent = salesByStoreContainer;
      parent.innerHTML = '';
      if (storeEntries.length === 0) {
        parent.innerHTML = '<p class="text-muted">No hay datos de ventas por tienda aún.</p>';
      } else {
        const maxVal = Math.max(...storeEntries.map(e => e.total), 0);
        parent.innerHTML = storeEntries.map(({ storeId, store, total, count }) => {
          const pct = maxVal > 0 ? (total / maxVal * 100).toFixed(1) : 0;
          const share = totalSalesRevenue > 0 ? (total / totalSalesRevenue * 100).toFixed(1) : '0.0';
          const formattedTotal = Number(total).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
          return `
            <button type="button" class="report-store-row" onclick="openReportStoreDetail('${storeId}')">
              <div class="d-flex justify-content-between mb-2">
                <span style="font-size: 1.1rem; color: #444;">${store.type === 'bodega' ? '📦' : '🏪'} <strong>${escapeHtml(store.name)}</strong></span>
                <span style="color: var(--primary); font-weight: 700; font-size: 1.1rem;">$${formattedTotal}</span>
              </div>
              <div style="background:#e9ecef; border-radius:6px; height:16px; overflow: hidden;">
                <div style="background: linear-gradient(90deg, var(--primary), #4caf50); width:${pct}%; height:100%; border-radius:6px; transition: width 1s ease-out; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></div>
              </div>
              <div style="display:flex; justify-content:space-between; font-size: 0.8rem; color: #888; margin-top: 4px;">
                <span>${count} venta(s)</span>
                <span>${share}% del total del dia</span>
              </div>
            </button>
          `;
        }).join('');
      }
    }

    const historicalTotalEl = document.getElementById('historicalSalesTotal');
    const historicalContainer = document.getElementById('historicalSalesByStore');
    if (historicalTotalEl && historicalContainer) {
      const maxVal = Math.max(...storeEntries.map(e => e.total), 0);
      historicalTotalEl.textContent = `Total ${longDateLabel}: $${formatMoneyMX(totalSalesRevenue)}`;
      historicalContainer.innerHTML = storeEntries.map(({ storeId, store, total }) => {
        const pct = maxVal > 0 ? (total / maxVal * 100).toFixed(1) : 0;
        const share = totalSalesRevenue > 0 ? (total / totalSalesRevenue * 100).toFixed(1) : '0.0';
        return `
          <button type="button" class="report-store-row report-store-row-compact" onclick="openReportStoreDetail('${storeId}')">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;">
              <span style="font-size:0.9rem; color:#374151; font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${store.type === 'bodega' ? '📦' : '🏪'} ${escapeHtml(store.name)}</span>
              <span style="color:var(--primary); font-weight:800; white-space:nowrap;">$${formatMoneyMX(total)}</span>
            </div>
            <div style="background:#e9ecef; border-radius:999px; height:12px; overflow:hidden;">
              <div style="background:linear-gradient(90deg, var(--primary), #4caf50); width:${pct}%; height:100%; border-radius:999px;"></div>
            </div>
            <div style="text-align:right; font-size:0.72rem; color:#888; margin-top:3px;">${share}% del total del dia</div>
          </button>
        `;
      }).join('') || '<p class="text-muted">No hay tiendas activas para mostrar.</p>';
    }

    // --- RENDER CHART.JS CHARTS ---
    if (typeof Chart !== 'undefined') {

      // Register DataLabels Plugin
      if (typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
        Chart.defaults.set('plugins.datalabels', {
          color: '#fff',
          font: { weight: '700', size: 11 },
          textShadowBlur: 4,
          textShadowColor: 'rgba(0,0,0,0.45)',
          display: function(ctx) {
            const val = parseFloat(ctx.dataset.data[ctx.dataIndex]) || 0;
            const total = ctx.dataset.data.reduce((a, b) => a + (parseFloat(b) || 0), 0);
            return total > 0 && (val / total * 100) >= 6;
          },
          formatter: (value) => {
            if (!value || value === 0) return '';
            return '$' + Number(value).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
          }
        });
      }

      // Destroy old charts to prevent overlapping and memory leaks
      if (window.posCharts.profit) window.posCharts.profit.destroy();
      if (window.posCharts.payment) window.posCharts.payment.destroy();
      if (window.posCharts.priceType) window.posCharts.priceType.destroy();

      // 1. Profit Chart
      const ctxProfit = document.getElementById('profitChart');
      document.getElementById('profitTotalText').textContent = `Total Bruto: $${Number(totalSalesRevenue).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

      if (ctxProfit) {
        window.posCharts.profit = new Chart(ctxProfit, {
          type: 'doughnut',
          data: {
            labels: ['Ganancia Neta (Profit)', 'Costo de los Productos'],
            datasets: [{
              data: [totalProfit, totalCost],
              backgroundColor: ['#22c55e', '#ef4444'], // Green for profit, red for cost
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 13 } } },
              tooltip: {
                callbacks: {
                  label: function (context) {
                    let value = context.raw || 0;
                    return ' $' + Number(value).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                  }
                }
              }
            }
          }
        });
      }

      // 2. Payment Method Chart
      const ctxPayment = document.getElementById('paymentMethodChart');
      document.getElementById('paymentTotalText').textContent = `Total: $${Number(totalSalesRevenue).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

      if (ctxPayment) {
        window.posCharts.payment = new Chart(ctxPayment, {
          type: 'pie',
          data: {
            labels: ['Efectivo', 'Tarjeta', 'Transferencia'],
            datasets: [{
              data: [paymentMap.efectivo, paymentMap.tarjeta, paymentMap.transferencia],
              backgroundColor: ['#3b82f6', '#f59e0b', '#10b981'],
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 13 } } },
              tooltip: {
                callbacks: {
                  label: function (context) {
                    let value = context.raw || 0;
                    return ' $' + Number(value).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                  }
                }
              }
            }
          }
        });
      }

      // 3. Price Types Chart
      const ctxPrice = document.getElementById('priceTypeChart');
      const totalUnits = priceTypeMap.menudeo + priceTypeMap.mayoreo + priceTypeMap.distribuidor + priceTypeMap.otro;
      document.getElementById('priceTotalText').textContent = `Total: $${Number(totalUnits).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

      if (ctxPrice) {
        window.posCharts.priceType = new Chart(ctxPrice, {
          type: 'doughnut',
          data: {
            labels: ['Menudeo', 'Mayoreo', 'Distribuidor', 'Manual/Otros'],
            datasets: [{
              data: [priceTypeMap.menudeo, priceTypeMap.mayoreo, priceTypeMap.distribuidor, priceTypeMap.otro],
              backgroundColor: ['#8b5cf6', '#06b6d4', '#f43f5e', '#94a3b8'],
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 13 } } },
              tooltip: {
                callbacks: {
                  label: function (context) {
                    let value = context.raw || 0;
                    return ' $' + Number(value).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                  }
                }
              }
            }
          }
        });
      }
    }

  } catch (e) {
    console.error('Error loading reports:', e);
  }
}

// ------ Camera Capture Logic for Customer Avatar ------ //
let currentStream = null;

document.addEventListener('DOMContentLoaded', () => {
  const btnStartCamera = document.getElementById('btnStartCamera');
  const btnCapturePhoto = document.getElementById('btnCapturePhoto');
  const btnStopCamera = document.getElementById('btnStopCamera');
  const cameraContainer = document.getElementById('cameraContainer');
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraCanvas = document.getElementById('cameraCanvas');
  const customerAvatarPreview = document.getElementById('customerAvatarPreview');
  const customerAvatarText = document.getElementById('customerAvatarText');

  if (btnStartCamera) {
    btnStartCamera.addEventListener('click', async () => {
      try {
        currentStream = await navigator.mediaDevices.getUserMedia({ video: true });
        cameraVideo.srcObject = currentStream;
        cameraContainer.style.display = 'flex';
      } catch (err) {
        console.error("Error accessing webcam:", err);
        showToast("No se pudo acceder a la cámara o no hay permisos.", "error");
      }
    });
  }

  if (btnCapturePhoto) {
    btnCapturePhoto.addEventListener('click', () => {
      if (!currentStream) return;

      // Set canvas dimensions to match video
      cameraCanvas.width = cameraVideo.videoWidth;
      cameraCanvas.height = cameraVideo.videoHeight;

      const ctx = cameraCanvas.getContext('2d');
      // Draw the video frame to the canvas
      ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

      // Convert to base64
      const dataUrl = cameraCanvas.toDataURL('image/png');
      customerAvatarPreview.src = dataUrl;
      customerAvatarPreview.dataset.source = 'camera';
      customerAvatarPreview.style.display = 'block';
      customerAvatarText.style.display = 'none';

      // Clear file input so priority goes to canvas if they were mixed up
      document.getElementById('customerAvatarInput').value = '';

      stopCamera();
    });
  }

  function stopCamera() {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
    if (cameraContainer) {
      cameraContainer.style.display = 'none';
      cameraVideo.srcObject = null;
    }
  }

  if (btnStopCamera) {
    btnStopCamera.addEventListener('click', stopCamera);
  }

  // Hook into the modal close to stop camera if active and modal closes unexpectedly
  const originalCloseModal = window.closeCustomerModal;
  window.closeCustomerModal = function () {
    stopCamera();
    if (originalCloseModal) originalCloseModal();
  };

  // ==========================================
  // RECETAS MODULE
  // ==========================================

  let globalRecipeCategories = [];
  let globalRecipesList = [];
  let globalPrescriptionsList = [];
  let draftRecipeProducts = [];
  let draftMonthlyDescriptions = {};
  let currentEditingRecipeId = null;
  let prescriptionTargetRecipeId = null;
  let prescriptionSelectedCustomer = null;
  let rxPrescriptionsFilter = 'activo';

  const RX_CAT_COLORS = [
    '#7c3aed','#dc2626','#d97706','#059669','#2563eb',
    '#db2777','#0891b2','#65a30d','#ea580c','#6366f1'
  ];

  function rxCatColor(categoryId) {
    const idx = globalRecipeCategories.findIndex(c => c.id === categoryId);
    return RX_CAT_COLORS[Math.max(idx, 0) % RX_CAT_COLORS.length];
  }

  window.switchRecetasTab = function(tabName) {
    const tabIds = { consultar: 'recetasTabConsultar', prescripciones: 'recetasTabPrescripciones', crear: 'recetasTabCrear' };
    const btnIds = { consultar: 'btnTabConsultar', prescripciones: 'btnTabPrescripciones', crear: 'btnTabCrear' };
    Object.entries(tabIds).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) el.style.display = k === tabName ? 'block' : 'none';
    });
    Object.entries(btnIds).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', k === tabName);
    });
  };

  window.loadRecetas = async function() {
    try {
      const user = Auth.getCurrentUser();
      const btnCrear = document.getElementById('btnTabCrear');
      if (user && user.role !== 'admin' && btnCrear) {
        btnCrear.style.display = 'none';
      } else if (btnCrear) {
        btnCrear.style.display = 'inline-flex';
      }
      if (!window.globalProductsList || !window.globalProductsList.length) {
        await window.loadProducts();
      }
      await Promise.all([loadRecipeCategories(), loadRecipesList(), loadPrescriptionsList()]);
    } catch (err) {
      console.error('Error loading recetas module:', err);
      showToast('Error al cargar módulo de recetas', 'error');
    }
  };

  async function loadRecipeCategories() {
    try {
      const { data, error } = await supabaseClient.from('recipe_categories').select('*').order('name');
      if (error) throw error;
      globalRecipeCategories = data || [];
      renderRecipeCategories();
    } catch (err) { console.error(err); }
  }

  function renderRecipeCategories() {
    const listEl = document.getElementById('recipeCategoryList');
    const selectEl = document.getElementById('recipeCategorySelect');
    if (!listEl || !selectEl) return;

    const isAdmin = Auth.getCurrentUser()?.role === 'admin';

    if (!globalRecipeCategories.length) {
      listEl.innerHTML = '<li style="padding:12px 15px; text-align:center; color:#94a3b8; font-size:0.85rem;">No hay categorías aún.</li>';
      selectEl.innerHTML = '<option value="">Sin categorías disponibles</option>';
      return;
    }

    listEl.innerHTML = globalRecipeCategories.map((c, i) => {
      const color = RX_CAT_COLORS[i % RX_CAT_COLORS.length];
      return `<li style="padding:10px 15px; border-bottom:1px solid var(--border-light); display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="width:10px; height:10px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
          <span style="font-size:0.9rem; font-weight:600;">${escapeHtml(c.name)}</span>
        </div>
        ${isAdmin ? `<button onclick="window.deleteRecipeCategory('${c.id}')" style="background:none; border:none; color:#94a3b8; cursor:pointer; padding:2px 6px; border-radius:4px; font-size:0.85rem; line-height:1;" title="Eliminar">🗑️</button>` : ''}
      </li>`;
    }).join('');

    selectEl.innerHTML = '<option value="">Seleccione un padecimiento...</option>' +
      globalRecipeCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  const addCatBtn = document.getElementById('addRecipeCategoryBtn');
  if (addCatBtn) {
    addCatBtn.addEventListener('click', async () => {
      const input = document.getElementById('newRecipeCategoryInput');
      const name = input.value.trim().toUpperCase();
      if (!name) return showToast('Ingrese un nombre de categoría', 'error');
      try {
        const { error } = await supabaseClient.from('recipe_categories').insert({
          name, organization_id: Auth.getCurrentUser().organization_id
        });
        if (error) throw error;
        input.value = '';
        showToast('Categoría agregada', 'success');
        await loadRecipeCategories();
      } catch (err) {
        console.error(err);
        showToast('Error al agregar categoría', 'error');
      }
    });
  }

  window.deleteRecipeCategory = async function(categoryId) {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') return showToast('Sin permisos', 'error');
    const category = globalRecipeCategories.find(c => c.id === categoryId);
    if (!category) return;
    try {
      const { data: linked } = await supabaseClient.from('recipes').select('id').eq('category_id', categoryId);
      if (linked && linked.length > 0) {
        showToast(`No se puede eliminar: ${linked.length} receta(s) usan esta categoría`, 'error');
        return;
      }
      if (!confirm(`¿Eliminar la categoría "${category.name}"?`)) return;
      const { error } = await supabaseClient.from('recipe_categories').delete().eq('id', categoryId);
      if (error) throw error;
      showToast('Categoría eliminada', 'success');
      await loadRecipeCategories();
    } catch (err) {
      console.error(err);
      showToast('Error al eliminar categoría', 'error');
    }
  };

  // Recipe Product Search
  const rSearchInp = document.getElementById('recipeProductSearch');
  const rSearchRes = document.getElementById('recipeProductSearchResults');

  if (rSearchInp && rSearchRes) {
    rSearchInp.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      if (!term) { rSearchRes.style.display = 'none'; return; }
      const matches = (window.globalProductsList || []).filter(p =>
        p.is_active && (p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.toLowerCase().includes(term)))
      ).slice(0, 15);
      if (!matches.length) {
        rSearchRes.innerHTML = '<div style="padding:10px 14px; color:#94a3b8; font-size:0.85rem;">Sin resultados</div>';
      } else {
        rSearchRes.innerHTML = matches.map(p => `
          <button type="button" onclick='selectProductForRecipe(${JSON.stringify(p).replace(/'/g, "&#39;")})' style="width:100%; background:white; border:none; border-bottom:1px solid #f1f5f9; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; text-align:left; font-family:inherit;">
            <div>
              <div style="font-weight:600; font-size:0.88rem;">${escapeHtml(p.name)}</div>
              <div style="font-size:0.72rem; color:#94a3b8;">${escapeHtml(p.barcode || 'Sin código')}</div>
            </div>
            <span style="font-weight:700; color:#16a34a; font-size:0.88rem; flex-shrink:0; margin-left:8px;">$${Number(p.retail_price || 0).toFixed(2)}</span>
          </button>`).join('');
      }
      rSearchRes.style.display = 'block';
    });
    document.addEventListener('click', (e) => {
      if (!rSearchInp.contains(e.target) && !rSearchRes.contains(e.target)) {
        rSearchRes.style.display = 'none';
      }
    });
  }

  const durationSel = document.getElementById('recipeDurationMonths');
  const targetMonthSel = document.getElementById('recipeTargetMonth');

  if (durationSel && targetMonthSel) {
    durationSel.addEventListener('change', (e) => {
      const duration = parseInt(e.target.value) || 1;
      const toRemove = draftRecipeProducts.filter(dp => dp.month > duration);
      if (toRemove.length > 0) {
        if (!confirm(`Al reducir la duración se eliminarán ${toRemove.length} producto(s) asignados a meses que ya no existen. ¿Continuar?`)) {
          const maxMonth = Math.max(...draftRecipeProducts.map(dp => dp.month), 1);
          durationSel.value = maxMonth;
          return;
        }
        draftRecipeProducts = draftRecipeProducts.filter(dp => dp.month <= duration);
      }
      let opts = '';
      for (let i = 1; i <= duration; i++) opts += `<option value="${i}">Mes ${i}</option>`;
      targetMonthSel.innerHTML = opts;
      renderDraftRecipeProducts();
    });
  }

  window.selectProductForRecipe = function(product) {
    const targetMonth = parseInt(document.getElementById('recipeTargetMonth')?.value) || 1;
    if (draftRecipeProducts.find(dp => dp.product.id === product.id && dp.month === targetMonth)) {
      showToast(`Este producto ya está en el Mes ${targetMonth}`, 'error');
      return;
    }
    draftRecipeProducts.push({ product, usage: '', month: targetMonth });
    document.getElementById('recipeProductSearch').value = '';
    document.getElementById('recipeProductSearchResults').style.display = 'none';
    renderDraftRecipeProducts();
  };

  window.removeDraftProduct = function(index) {
    draftRecipeProducts.splice(index, 1);
    renderDraftRecipeProducts();
  };

  window.updateDraftProductUsage = function(index, value) {
    if (draftRecipeProducts[index]) draftRecipeProducts[index].usage = value;
  };

  window.updateDraftMonthDescription = function(month, value) {
    draftMonthlyDescriptions[month] = value;
  };

  function renderDraftRecipeProducts() {
    const container = document.getElementById('draftRecipeProductsContainer');
    if (!container) return;
    if (!draftRecipeProducts.length) {
      container.innerHTML = '<div class="text-muted" style="font-size:0.8rem; padding:12px 0; text-align:center;">No hay productos agregados.</div>';
      return;
    }
    const duration = parseInt(document.getElementById('recipeDurationMonths')?.value) || 1;
    let html = '';
    for (let m = 1; m <= duration; m++) {
      const prods = draftRecipeProducts.filter(dp => dp.month === m);
      if (!prods.length) continue;
      const desc = draftMonthlyDescriptions[m] || '';
      html += `<div style="margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #e0f2fe; padding-bottom:6px; margin-bottom:8px;">
          <span style="font-weight:800; color:#0369a1; font-size:0.88rem;">📅 Mes ${m}</span>
          <input type="text" class="form-control" style="width:65%; font-size:0.78rem; padding:3px 8px;" placeholder="Descripción de la etapa..." value="${escapeHtml(desc)}" onchange="updateDraftMonthDescription(${m}, this.value)">
        </div>`;
      prods.forEach(dp => {
        const idx = draftRecipeProducts.indexOf(dp);
        html += `<div style="background:white; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:0.88rem;">${escapeHtml(dp.product.name)}</span>
            <button onclick="removeDraftProduct(${idx})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1rem; padding:0 4px; line-height:1;">✕</button>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:0.72rem; color:#64748b; font-weight:700; white-space:nowrap;">Uso:</span>
            <input type="text" class="form-control" style="font-size:0.82rem; padding:3px 8px;" placeholder="Ej: 1 pastilla cada 8h..." value="${escapeHtml(dp.usage)}" onchange="updateDraftProductUsage(${idx}, this.value)">
          </div>
        </div>`;
      });
      html += '</div>';
    }
    container.innerHTML = html;
  }

  const saveRecipeBtn = document.getElementById('saveRecipeBtn');
  if (saveRecipeBtn) {
    saveRecipeBtn.addEventListener('click', async () => {
      const catId = document.getElementById('recipeCategorySelect').value;
      const rName = document.getElementById('newRecipeName').value.trim();
      const duration = parseInt(document.getElementById('recipeDurationMonths').value) || 1;
      if (!catId || !rName) return showToast('Seleccione un padecimiento y nombre', 'error');
      if (!draftRecipeProducts.length) return showToast('Agregue al menos un producto', 'error');
      try {
        saveRecipeBtn.disabled = true;
        saveRecipeBtn.textContent = 'Guardando...';
        const isUpdate = !!currentEditingRecipeId;
        let recipeId;
        if (isUpdate) {
          const { data, error } = await supabaseClient.from('recipes')
            .update({ category_id: catId, name: rName, duration_months: duration, monthly_descriptions: draftMonthlyDescriptions })
            .eq('id', currentEditingRecipeId).select().single();
          if (error) throw error;
          recipeId = data.id;
          const { error: dErr } = await supabaseClient.from('recipe_products').delete().eq('recipe_id', recipeId);
          if (dErr) throw dErr;
        } else {
          const { data, error } = await supabaseClient.from('recipes').insert({
            organization_id: Auth.getCurrentUser().organization_id,
            category_id: catId, name: rName, duration_months: duration, monthly_descriptions: draftMonthlyDescriptions
          }).select().single();
          if (error) throw error;
          recipeId = data.id;
        }
        const { error: rpErr } = await supabaseClient.from('recipe_products').insert(
          draftRecipeProducts.map(dp => ({
            recipe_id: recipeId, product_id: dp.product.id,
            usage_instructions: dp.usage, month_number: dp.month
          }))
        );
        if (rpErr) throw rpErr;
        currentEditingRecipeId = null;
        document.getElementById('recipeCategorySelect').value = '';
        document.getElementById('newRecipeName').value = '';
        document.getElementById('recipeDurationMonths').value = '1';
        document.getElementById('recipeDurationMonths').dispatchEvent(new Event('change'));
        draftRecipeProducts = [];
        draftMonthlyDescriptions = {};
        renderDraftRecipeProducts();
        const titleEl = document.getElementById('recipeFormTitle');
        if (titleEl) titleEl.textContent = 'Nueva Receta';
        showToast(isUpdate ? 'Receta actualizada exitosamente' : 'Receta creada exitosamente', 'success');
        await loadRecipesList();
        window.switchRecetasTab('consultar');
      } catch (err) {
        console.error(err);
        showToast('Error al guardar la receta', 'error');
      } finally {
        saveRecipeBtn.disabled = false;
        saveRecipeBtn.innerHTML = '💾 Guardar Receta';
      }
    });
  }

  async function loadRecipesList() {
    try {
      const { data, error } = await supabaseClient.from('recipes')
        .select('*, category:recipe_categories(id, name), products:recipe_products(month_number, usage_instructions, product:products(*))')
        .order('name');
      if (error) throw error;
      globalRecipesList = data || [];
      renderRecipes(globalRecipesList);
    } catch (err) { console.error('Error fetching recipes', err); }
  }

  function renderRecipes(recipes) {
    const isAdmin = Auth.getCurrentUser()?.role === 'admin';
    const acc = document.getElementById('recipesAccordionContainer');
    if (!acc) return;
    if (!recipes.length) {
      acc.innerHTML = `<div style="text-align:center; padding:60px 20px; color:#94a3b8;">
        <div style="font-size:2.5rem; margin-bottom:12px;">🌿</div>
        <div style="font-weight:600; font-size:0.95rem;">No se encontraron recetas</div>
        <div style="font-size:0.83rem; margin-top:4px;">Crea la primera desde la pestaña "Nueva Receta"</div>
      </div>`;
      return;
    }

    // Group by category
    const grouped = {};
    recipes.forEach(r => {
      const cat = r.category?.name || 'General';
      if (!grouped[cat]) grouped[cat] = { catId: r.category?.id || null, list: [] };
      grouped[cat].list.push(r);
    });

    let html = '';
    Object.entries(grouped).forEach(([catName, { catId, list }]) => {
      const catColor = rxCatColor(catId);
      html += `<div style="margin-bottom:22px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
          <span style="width:12px; height:12px; border-radius:50%; background:${catColor}; flex-shrink:0;"></span>
          <span style="font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:${catColor};">${escapeHtml(catName)}</span>
          <span style="font-size:0.72rem; color:#94a3b8;">(${list.length})</span>
        </div>`;

      list.forEach(r => {
        const duration = r.duration_months || 1;
        const totalProds = r.products.length;
        let monthsHtml = '';
        for (let m = 1; m <= duration; m++) {
          const mProds = r.products.filter(rp => rp.month_number === m);
          const desc = r.monthly_descriptions?.[m] || '';
          monthsHtml += `<div style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:6px; margin-bottom:8px; border-bottom:2px solid #e0f2fe;">
              <div>
                <span style="font-weight:800; color:#0369a1; font-size:0.88rem;">Mes ${m}</span>
                ${desc ? `<span style="font-size:0.78rem; color:#64748b; font-style:italic; margin-left:8px;">${escapeHtml(desc)}</span>` : ''}
              </div>
              <button onclick="window.pasarAVenta('${r.id}', ${m})" style="background:#dcfce7; color:#16a34a; border:1px solid #86efac; border-radius:8px; padding:4px 12px; font-size:0.78rem; font-weight:700; cursor:pointer; font-family:inherit;">🛒 Mes ${m}</button>
            </div>
            ${mProds.map(rp => `
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; margin-bottom:6px;">
                <div style="font-weight:700; font-size:0.88rem; color:#1e293b;">${escapeHtml(rp.product?.name || '?')}</div>
                ${rp.usage_instructions ? `<div style="font-size:0.78rem; color:#64748b; margin-top:3px;">📌 ${escapeHtml(rp.usage_instructions)}</div>` : ''}
              </div>`).join('') || '<div style="color:#94a3b8; font-size:0.8rem; padding:4px 0;">Sin productos asignados.</div>'}
          </div>`;
        }

        html += `<div style="border:1px solid #e2e8f0; border-radius:12px; margin-bottom:10px; overflow:hidden; background:white; box-shadow:0 1px 4px rgba(0,0,0,0.04);">
          <div onclick="const b=this.nextElementSibling;const ch=this.querySelector('.rx-chev');const open=b.style.display!=='none';b.style.display=open?'none':'block';ch.style.transform=open?'rotate(0deg)':'rotate(180deg)';"
               style="padding:14px 16px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none; background:#fafafa;">
            <div>
              <div style="font-size:0.95rem; font-weight:700; color:#1e293b;">${escapeHtml(r.name)}</div>
              <div style="display:flex; align-items:center; gap:7px; margin-top:4px; flex-wrap:wrap;">
                ${duration > 1 ? `<span style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; border-radius:20px; padding:1px 9px; font-size:0.7rem; font-weight:700;">${duration} meses</span>` : ''}
                <span style="background:#f1f5f9; color:#475569; border-radius:20px; padding:1px 9px; font-size:0.7rem;">${totalProds} producto${totalProds !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <span class="rx-chev" style="font-size:1rem; color:#94a3b8; transition:transform .2s; transform:rotate(0deg); flex-shrink:0;">▾</span>
          </div>
          <div style="display:none; padding:16px; border-top:1px solid #e2e8f0;">
            ${monthsHtml}
            <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:10px; border-top:1px dashed #e2e8f0;">
              <button onclick="window.prescribeRecipe('${r.id}')" style="flex:1; min-width:140px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:8px; padding:8px 12px; font-size:0.82rem; font-weight:700; cursor:pointer; font-family:inherit;">💊 Prescribir a Cliente</button>
              ${isAdmin ? `
              <button onclick="window.editRecipe('${r.id}')" style="background:#f8fafc; color:#475569; border:1px solid #e2e8f0; border-radius:8px; padding:8px 14px; font-size:0.82rem; cursor:pointer; font-family:inherit;">✏️ Editar</button>
              <button onclick="window.deleteRecipe('${r.id}')" style="background:#fff1f2; color:#e11d48; border:1px solid #fecdd3; border-radius:8px; padding:8px 14px; font-size:0.82rem; cursor:pointer; font-family:inherit;">🗑️</button>
              ` : ''}
            </div>
          </div>
        </div>`;
      });
      html += '</div>';
    });
    acc.innerHTML = html;
  }

  const recipeSearchInput = document.getElementById('recipeSearchInput');
  if (recipeSearchInput) {
    recipeSearchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      renderRecipes(term ? globalRecipesList.filter(r =>
        r.name.toLowerCase().includes(term) || (r.category?.name || '').toLowerCase().includes(term)
      ) : globalRecipesList);
    });
  }

  window.pasarAVenta = function(recipeId, monthNumber = null) {
    const recipe = globalRecipesList.find(r => r.id === recipeId);
    if (!recipe) return;
    let added = 0;
    recipe.products.forEach(rp => {
      if (monthNumber !== null && rp.month_number !== monthNumber) return;
      if (rp.product && typeof addToCart === 'function') { addToCart(rp.product); added++; }
    });
    if (!added) {
      showToast(monthNumber ? `Sin productos para el Mes ${monthNumber}` : 'Sin productos en la receta', 'error');
      return;
    }
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const salesNav = document.querySelector('.nav-item[data-section="sales"]');
    if (salesNav) salesNav.classList.add('active');
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    const salesSec = document.getElementById('section-sales');
    if (salesSec) salesSec.classList.add('active');
    if (typeof updatePageTitle === 'function') updatePageTitle('sales');
    if (typeof loadSales === 'function') loadSales();
    showToast(`${added} producto(s) agregados a la caja`, 'success');
  };

  window.deleteRecipe = async function(recipeId) {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') return showToast('Sin permisos', 'error');
    if (!confirm('¿Eliminar esta receta permanentemente?')) return;
    try {
      const { error: a } = await supabaseClient.from('recipe_products').delete().eq('recipe_id', recipeId);
      if (a) throw a;
      const { error: b } = await supabaseClient.from('recipes').delete().eq('id', recipeId);
      if (b) throw b;
      showToast('Receta eliminada', 'success');
      await loadRecipesList();
    } catch (err) {
      console.error(err);
      showToast('Error al eliminar', 'error');
    }
  };

  window.editRecipe = function(recipeId) {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') return showToast('Sin permisos', 'error');
    const recipe = globalRecipesList.find(r => r.id === recipeId);
    if (!recipe) return;
    currentEditingRecipeId = recipe.id;
    document.getElementById('recipeCategorySelect').value = recipe.category_id;
    document.getElementById('newRecipeName').value = recipe.name;
    const durEl = document.getElementById('recipeDurationMonths');
    if (durEl) { durEl.value = recipe.duration_months || 1; durEl.dispatchEvent(new Event('change')); }
    draftRecipeProducts = recipe.products.map(rp => ({
      product: rp.product, usage: rp.usage_instructions, month: rp.month_number || 1
    }));
    draftMonthlyDescriptions = recipe.monthly_descriptions || {};
    renderDraftRecipeProducts();
    const titleEl = document.getElementById('recipeFormTitle');
    if (titleEl) titleEl.textContent = 'Editar Receta';
    const saveBtn = document.getElementById('saveRecipeBtn');
    if (saveBtn) saveBtn.innerHTML = '💾 Actualizar Receta';
    showToast('Modo edición activo', 'info');
    window.switchRecetasTab('crear');
    document.querySelector('.content-section.active')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ==========================================
  // PRESCRIPTIONS
  // ==========================================

  async function loadPrescriptionsList() {
    try {
      const { data, error } = await supabaseClient
        .from('customer_prescriptions')
        .select('*, customer:customers(id, name, customer_code), recipe:recipes(id, name, duration_months, category:recipe_categories(id, name), products:recipe_products(month_number, usage_instructions, product:products(id, name, retail_price, wholesale_price, distributor_price, cost_price, barcode, is_active))), employee:employees(full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      globalPrescriptionsList = data || [];
      renderPrescriptions();
      updatePrescriptionsBadge();
    } catch (err) { console.error('Error loading prescriptions:', err); }
  }

  function updatePrescriptionsBadge() {
    const badge = document.getElementById('prescriptionsCountBadge');
    if (!badge) return;
    const active = globalPrescriptionsList.filter(p => p.status === 'activo').length;
    badge.textContent = active;
    badge.style.display = active > 0 ? 'inline-flex' : 'none';
  }

  window.filterPrescriptions = function(filter) {
    rxPrescriptionsFilter = filter;
    const btnA = document.getElementById('rxFilterActivo');
    const btnAll = document.getElementById('rxFilterAll');
    if (btnA) { btnA.classList.toggle('btn-primary', filter === 'activo'); btnA.classList.toggle('btn-secondary', filter !== 'activo'); }
    if (btnAll) { btnAll.classList.toggle('btn-primary', filter === 'all'); btnAll.classList.toggle('btn-secondary', filter !== 'all'); }
    renderPrescriptions();
  };

  function renderPrescriptions() {
    const container = document.getElementById('prescriptionsContainer');
    if (!container) return;
    const list = rxPrescriptionsFilter === 'all'
      ? globalPrescriptionsList
      : globalPrescriptionsList.filter(p => p.status === 'activo');
    const activeCount = globalPrescriptionsList.filter(p => p.status === 'activo').length;
    const statusText = document.getElementById('prescriptionsStatusText');
    if (statusText) statusText.textContent = `${activeCount} activa${activeCount !== 1 ? 's' : ''} · ${globalPrescriptionsList.length} total`;
    if (!list.length) {
      container.innerHTML = `<div style="text-align:center; padding:60px 20px; color:#94a3b8;">
        <div style="font-size:2.5rem; margin-bottom:12px;">👥</div>
        <div style="font-weight:600; font-size:0.95rem;">${rxPrescriptionsFilter === 'activo' ? 'No hay prescripciones activas' : 'No hay prescripciones registradas'}</div>
        <div style="font-size:0.83rem; margin-top:4px;">Prescribe un tratamiento a un cliente desde la pestaña Recetas</div>
      </div>`;
      return;
    }

    const STATUS_COLORS = { activo: '#16a34a', completado: '#2563eb', abandonado: '#dc2626' };
    const STATUS_LABELS = { activo: 'Activa', completado: 'Completada', abandonado: 'Abandonada' };

    container.innerHTML = list.map(p => {
      if (!p.recipe) return '';
      const duration = p.recipe.duration_months || 1;
      const currentMonth = p.current_month || 1;
      const pct = Math.round(((currentMonth - 1) / duration) * 100);
      const sColor = STATUS_COLORS[p.status] || '#64748b';
      const sLabel = STATUS_LABELS[p.status] || p.status;
      const startDate = p.start_date
        ? new Date(p.start_date + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';
      const catColor = rxCatColor(p.recipe.category?.id || null);
      const isActive = p.status === 'activo';
      const isLast = currentMonth >= duration;

      return `<div style="background:white; border:1px solid #e2e8f0; border-radius:14px; padding:18px; margin-bottom:12px; box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:42px; height:42px; border-radius:50%; background:#e0f2fe; display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">👤</div>
            <div>
              <div style="font-weight:800; font-size:1rem; color:#1e293b;">${escapeHtml(p.customer?.name || 'Cliente desconocido')}</div>
              <div style="font-size:0.75rem; color:#94a3b8;">${escapeHtml(p.customer?.customer_code || '')}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="background:${sColor}20; color:${sColor}; border:1px solid ${sColor}40; border-radius:20px; padding:2px 12px; font-size:0.7rem; font-weight:700;">${sLabel}</span>
            ${p.employee ? `<span style="font-size:0.72rem; color:#94a3b8;">por ${escapeHtml(p.employee.full_name)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
          <span style="width:8px; height:8px; border-radius:50%; background:${catColor}; flex-shrink:0;"></span>
          <span style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:${catColor}; letter-spacing:.05em;">${escapeHtml(p.recipe.category?.name || 'General')}</span>
          <span style="color:#94a3b8; font-size:0.8rem;">·</span>
          <span style="font-weight:700; color:#1e293b; font-size:0.9rem;">${escapeHtml(p.recipe.name)}</span>
        </div>
        ${duration > 1 ? `
        <div style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="font-size:0.75rem; font-weight:600; color:#64748b;">Mes ${currentMonth} de ${duration}</span>
            <span style="font-size:0.75rem; color:#94a3b8;">${pct}% completado</span>
          </div>
          <div style="background:#f1f5f9; border-radius:999px; height:8px; overflow:hidden;">
            <div style="background:${catColor}; width:${pct}%; height:100%; border-radius:999px; transition:width .5s;"></div>
          </div>
        </div>` : ''}
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <span style="font-size:0.75rem; color:#94a3b8;">Inicio: ${startDate}${p.notes ? ` · <em>${escapeHtml(p.notes)}</em>` : ''}</span>
          ${isActive ? `
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button onclick="window.pasarPrescripcionAVenta('${p.id}')" style="background:#dcfce7; color:#16a34a; border:1px solid #86efac; border-radius:8px; padding:6px 14px; font-size:0.8rem; font-weight:700; cursor:pointer; font-family:inherit;">🛒 Pasar Mes ${currentMonth}</button>
            ${isLast
              ? `<button onclick="window.completePrescription('${p.id}')" style="background:#dbeafe; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:8px; padding:6px 12px; font-size:0.8rem; font-weight:700; cursor:pointer; font-family:inherit;">✓ Completar</button>`
              : `<button onclick="window.advancePrescriptionMonth('${p.id}')" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:8px; padding:6px 12px; font-size:0.8rem; cursor:pointer; font-family:inherit;">→ Solo Avanzar</button>`
            }
            <button onclick="window.abandonPrescription('${p.id}')" style="background:#fff1f2; color:#e11d48; border:1px solid #fecdd3; border-radius:8px; padding:6px 10px; font-size:0.8rem; cursor:pointer; font-family:inherit;" title="Abandonar">✕</button>
          </div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  window.pasarPrescripcionAVenta = async function(prescriptionId) {
    const p = globalPrescriptionsList.find(x => x.id === prescriptionId);
    if (!p || !p.recipe) return;
    const month = p.current_month || 1;
    const duration = p.recipe.duration_months || 1;
    const mProds = (p.recipe.products || []).filter(rp => rp.month_number === month && rp.product);
    if (!mProds.length) { showToast(`Sin productos para el Mes ${month}`, 'error'); return; }
    if (typeof addToCart === 'function') mProds.forEach(rp => addToCart(rp.product));
    const isLast = month >= duration;
    try {
      if (isLast) {
        await supabaseClient.from('customer_prescriptions').update({ status: 'completado', updated_at: new Date().toISOString() }).eq('id', prescriptionId);
        showToast(`Tratamiento de ${p.customer?.name || 'cliente'} completado ✓`, 'success');
      } else {
        await supabaseClient.from('customer_prescriptions').update({ current_month: month + 1, updated_at: new Date().toISOString() }).eq('id', prescriptionId);
        showToast(`${mProds.length} producto(s) del Mes ${month} — avanza al Mes ${month + 1}`, 'success');
      }
      await loadPrescriptionsList();
    } catch (err) { console.error(err); showToast('Error al actualizar prescripción', 'error'); }
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const salesNav = document.querySelector('.nav-item[data-section="sales"]');
    if (salesNav) salesNav.classList.add('active');
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    const salesSec = document.getElementById('section-sales');
    if (salesSec) salesSec.classList.add('active');
    if (typeof updatePageTitle === 'function') updatePageTitle('sales');
    if (typeof loadSales === 'function') loadSales();
  };

  window.advancePrescriptionMonth = async function(prescriptionId) {
    const p = globalPrescriptionsList.find(x => x.id === prescriptionId);
    if (!p) return;
    const newMonth = (p.current_month || 1) + 1;
    if (!confirm(`¿Avanzar al Mes ${newMonth} sin agregar productos a la caja?`)) return;
    try {
      const { error } = await supabaseClient.from('customer_prescriptions').update({ current_month: newMonth, updated_at: new Date().toISOString() }).eq('id', prescriptionId);
      if (error) throw error;
      showToast(`Avanzado al Mes ${newMonth}`, 'success');
      await loadPrescriptionsList();
    } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
  };

  window.completePrescription = async function(prescriptionId) {
    if (!confirm('¿Marcar este tratamiento como completado?')) return;
    try {
      const { error } = await supabaseClient.from('customer_prescriptions').update({ status: 'completado', updated_at: new Date().toISOString() }).eq('id', prescriptionId);
      if (error) throw error;
      showToast('Tratamiento completado ✓', 'success');
      await loadPrescriptionsList();
    } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
  };

  window.abandonPrescription = async function(prescriptionId) {
    if (!confirm('¿Marcar este tratamiento como abandonado?')) return;
    try {
      const { error } = await supabaseClient.from('customer_prescriptions').update({ status: 'abandonado', updated_at: new Date().toISOString() }).eq('id', prescriptionId);
      if (error) throw error;
      showToast('Tratamiento marcado como abandonado', 'info');
      await loadPrescriptionsList();
    } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
  };

  // Prescription Modal

  window.prescribeRecipe = function(recipeId) {
    const recipe = globalRecipesList.find(r => r.id === recipeId);
    if (!recipe) return;
    prescriptionTargetRecipeId = recipeId;
    prescriptionSelectedCustomer = null;
    const modal = document.getElementById('prescriptionModal');
    if (!modal) return;
    const nameEl = document.getElementById('prescriptionModalRecipeName');
    if (nameEl) nameEl.textContent = `${recipe.name} — ${recipe.duration_months || 1} mes${(recipe.duration_months || 1) > 1 ? 'es' : ''}`;
    const searchInput = document.getElementById('prescriptionCustomerSearch');
    if (searchInput) searchInput.value = '';
    const results = document.getElementById('prescriptionCustomerResults');
    if (results) { results.innerHTML = ''; results.style.display = 'none'; }
    const selectedDiv = document.getElementById('prescriptionSelectedCustomer');
    if (selectedDiv) selectedDiv.style.display = 'none';
    const notesEl = document.getElementById('prescriptionNotes');
    if (notesEl) notesEl.value = '';
    modal.style.display = 'flex';
  };

  window.closePrescriptionModal = function() {
    const modal = document.getElementById('prescriptionModal');
    if (modal) modal.style.display = 'none';
    prescriptionTargetRecipeId = null;
    prescriptionSelectedCustomer = null;
  };

  window.clearPrescriptionCustomer = function() {
    prescriptionSelectedCustomer = null;
    const sel = document.getElementById('prescriptionSelectedCustomer');
    if (sel) sel.style.display = 'none';
    const inp = document.getElementById('prescriptionCustomerSearch');
    if (inp) { inp.value = ''; inp.focus(); }
  };

  const prescCustSearch = document.getElementById('prescriptionCustomerSearch');
  const prescCustResults = document.getElementById('prescriptionCustomerResults');
  let prescSearchTimer = null;

  if (prescCustSearch && prescCustResults) {
    prescCustSearch.addEventListener('input', (e) => {
      clearTimeout(prescSearchTimer);
      const term = e.target.value.trim();
      if (term.length < 2) { prescCustResults.style.display = 'none'; return; }
      prescSearchTimer = setTimeout(async () => {
        try {
          const { data } = await supabaseClient.from('customers')
            .select('id, name, customer_code')
            .or(`name.ilike.%${term}%,customer_code.ilike.%${term}%`)
            .limit(8);
          if (!data || !data.length) {
            prescCustResults.innerHTML = '<div style="padding:10px 14px; color:#94a3b8; font-size:0.85rem;">Sin resultados</div>';
          } else {
            prescCustResults.innerHTML = data.map(c => `
              <div onclick="window.selectPrescriptionCustomer(${JSON.stringify(c).replace(/"/g, '&quot;')})"
                   style="padding:10px 14px; cursor:pointer; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;"
                   onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                <div style="font-weight:600; font-size:0.88rem;">${escapeHtml(c.name)}</div>
                <div style="font-size:0.75rem; color:#94a3b8;">${escapeHtml(c.customer_code || '')}</div>
              </div>`).join('');
          }
          prescCustResults.style.display = 'block';
        } catch (err) { console.error(err); }
      }, 300);
    });
    document.addEventListener('click', (e) => {
      if (!prescCustSearch.contains(e.target) && !prescCustResults.contains(e.target)) {
        prescCustResults.style.display = 'none';
      }
    });
  }

  window.selectPrescriptionCustomer = function(customer) {
    prescriptionSelectedCustomer = customer;
    const sel = document.getElementById('prescriptionSelectedCustomer');
    const nm = document.getElementById('prescriptionSelectedCustomerName');
    if (sel) sel.style.display = 'flex';
    if (nm) nm.textContent = `✓ ${customer.name}`;
    const inp = document.getElementById('prescriptionCustomerSearch');
    if (inp) inp.value = '';
    const res = document.getElementById('prescriptionCustomerResults');
    if (res) res.style.display = 'none';
  };

  window.confirmPrescription = async function() {
    if (!prescriptionTargetRecipeId) return;
    if (!prescriptionSelectedCustomer) { showToast('Seleccione un cliente', 'error'); return; }
    const confirmBtn = document.getElementById('prescriptionConfirmBtn');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Guardando...'; }
    try {
      const user = Auth.getCurrentUser();
      const notes = document.getElementById('prescriptionNotes')?.value.trim() || null;
      const { error } = await supabaseClient.from('customer_prescriptions').insert({
        customer_id: prescriptionSelectedCustomer.id,
        recipe_id: prescriptionTargetRecipeId,
        employee_id: user?.id || null,
        organization_id: user?.organization_id || null,
        current_month: 1,
        start_date: new Date().toISOString().split('T')[0],
        status: 'activo',
        notes
      });
      if (error) throw error;
      showToast(`Tratamiento prescrito a ${prescriptionSelectedCustomer.name}`, 'success');
      window.closePrescriptionModal();
      await loadPrescriptionsList();
    } catch (err) {
      console.error(err);
      showToast('Error al guardar la prescripción', 'error');
    } finally {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerHTML = '💊 Confirmar'; }
    }
  };

  // ==========================================
  // TAREAS MODULE
  // ==========================================

  let globalStoreTasks = [];

  window.switchTareasTab = function (tabName) {
    const tabMisTareas = document.getElementById('tareasTabMisTareas');
    const tabAsignar = document.getElementById('tareasTabAsignarTareas');
    const btnMisTareas = document.getElementById('btnTabMisTareas');
    const btnAsignar = document.getElementById('btnTabAsignarTareas');

    if (!tabMisTareas || !tabAsignar) return;

    if (tabName === 'mis-tareas') {
      tabMisTareas.style.display = 'block';
      tabAsignar.style.display = 'none';
      if (btnMisTareas) { btnMisTareas.classList.add('btn-primary'); btnMisTareas.classList.remove('btn-outline-primary'); }
      if (btnAsignar) { btnAsignar.classList.add('btn-outline-primary'); btnAsignar.classList.remove('btn-primary'); }
    } else if (tabName === 'asignar-tareas') {
      tabMisTareas.style.display = 'none';
      tabAsignar.style.display = 'block';
      if (btnAsignar) { btnAsignar.classList.add('btn-primary'); btnAsignar.classList.remove('btn-outline-primary'); }
      if (btnMisTareas) { btnMisTareas.classList.add('btn-outline-primary'); btnMisTareas.classList.remove('btn-primary'); }
    }
  };

  async function cleanupOldTasks() {
    try {
      const today = new Date();
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);
      // Format as YYYY-MM-DD
      const cutoffDateStr = toLocalDateInputValue(twoDaysAgo);

      // Delete tasks where task_date is older than 2 days ago
      const { error } = await supabaseClient
        .from('store_tasks')
        .delete()
        .lt('task_date', cutoffDateStr);

      if (error) {
        console.error("Error cleaning up old tasks:", error);
      }
    } catch (err) {
      console.error("Exception cleaning up old tasks:", err);
    }
  }

  window.loadTareas = async function () {
    try {
      const currentUser = Auth.getCurrentUser();

      // Automatically clean up old tasks in the background
      cleanupOldTasks();

      // Setup UI based on role
      const btnAsignar = document.getElementById('btnTabAsignarTareas');
      if (currentUser && currentUser.role !== 'admin' && btnAsignar) {
        btnAsignar.style.display = 'none';
      } else if (btnAsignar) {
        btnAsignar.style.display = 'inline-block';
      }

      // Automatically set date inputs to today
      const today = toLocalDateInputValue(new Date());
      const dateInp = document.getElementById('taskDateInput');
      const fDateInp = document.getElementById('taskFilterDateInput');
      if (dateInp && !dateInp.value) dateInp.value = today;
      if (fDateInp && !fDateInp.value) fDateInp.value = today;

      // Ensure stores are populated for admin view
      if (currentUser && currentUser.role === 'admin') {
        await populateTaskStoreSelects();
      }

      await loadMyTasks();
      if (currentUser && currentUser.role === 'admin') {
        await loadAllTasks();
      }

    } catch (err) {
      console.error("Error al cargar tareas:", err);
      showToast("Error al cargar módulo de tareas", "error");
    }
  };

  async function populateTaskStoreSelects() {
    const s1 = document.getElementById('taskStoreSelect');
    const s2 = document.getElementById('taskFilterStoreSelect');
    if (!s1 || !s2) return;

    // We can reuse window.globalStoresList if available, otherwise fetch
    let stores = window.globalStoresList || [];
    if (stores.length === 0) {
      const { data, error } = await supabaseClient.from('stores').select('*').order('name');
      if (!error) stores = data || [];
    }

    let opts = '<option value="">Seleccione una tienda...</option>';
    opts += stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    s1.innerHTML = opts;

    let filterOpts = '<option value="all">Todas las sucursales</option>';
    filterOpts += stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    s2.innerHTML = filterOpts;
  }

  async function loadMyTasks() {
    const container = document.getElementById('myTasksContainer');
    if (!container) return;
    const user = Auth.getCurrentUser();

    // Attempt to retrieve store id from local or session storage
    let myStoreId = null;
    const loginStoreStr = localStorage.getItem('selectedStore') || sessionStorage.getItem('pos_current_store');
    if (loginStoreStr) {
      try {
        myStoreId = JSON.parse(loginStoreStr).id;
      } catch (e) {
        console.warn('Error parsing store from storage', e);
      }
    }

    if (!user || !myStoreId) {
      container.innerHTML = '<div class="text-center text-muted" style="padding:40px;">No estás asignado a ninguna tienda.</div>';
      return;
    }

    const today = toLocalDateInputValue(new Date());

    try {
      const { data, error } = await supabaseClient
        .from('store_tasks')
        .select('*')
        .eq('store_id', myStoreId)
        .eq('task_date', today)
        .order('is_completed', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;

      renderMyTasks(data || []);
    } catch (err) {
      console.error("Error loadMyTasks:", err);
      container.innerHTML = '<div class="text-center text-danger" style="padding:40px;">Error al cargar tus tareas.</div>';
    }
  }

  function renderMyTasks(tasks) {
    const container = document.getElementById('myTasksContainer');
    if (!container) return;

    if (tasks.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:50px 20px;">
          <i class="fas fa-glass-cheers" style="font-size:3rem; color:#bae6fd; margin-bottom:15px;"></i>
          <h4 style="color:#64748b; font-weight:600;">¡Genial!</h4>
          <p class="text-muted">No tienes tareas asignadas para hoy (o ya terminaste todas).</p>
        </div>
      `;
      return;
    }

    container.innerHTML = tasks.map(t => `
      <div style="background:${t.is_completed ? '#f8fafc' : '#fff'}; border:1px solid ${t.is_completed ? '#e2e8f0' : '#bae6fd'}; border-left:4px solid ${t.is_completed ? '#94a3b8' : '#0284c7'}; border-radius:8px; padding:15px; margin-bottom:12px; display:flex; align-items:center; transition:all 0.2s; opacity:${t.is_completed ? '0.7' : '1'};">
        <div style="flex:auto;">
          <div style="font-size:1.05rem; font-weight:700; color:${t.is_completed ? '#64748b' : '#0f172a'}; text-decoration:${t.is_completed ? 'line-through' : 'none'};">${t.task_name}</div>
        </div>
        <div>
          ${Auth.getCurrentUser()?.role === 'admin' ? `
            <button class="btn btn-sm text-danger mr-2" onclick="window.deleteTask('${t.id}')" style="padding:8px 12px; background:transparent; border:none; opacity:0.7;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Eliminar Tarea">🗑️</button>
          ` : ''}
          <button class="btn ${t.is_completed ? 'btn-outline-secondary' : 'btn-success'}" style="font-weight:700; border-radius:50px; padding:8px 20px; box-shadow:${t.is_completed ? 'none' : '0 2px 4px rgba(34,197,94,0.3)'};" onclick="window.toggleTaskComplete('${t.id}', ${!t.is_completed})">
            ${t.is_completed ? '⏪ Deshacer' : '✅ Completar'}
          </button>
        </div>
      </div>
    `).join('');
  }

  window.toggleTaskComplete = async function (taskId, newValue) {
    try {
      const { error } = await supabaseClient
        .from('store_tasks')
        .update({ is_completed: newValue })
        .eq('id', taskId);

      if (error) throw error;
      showToast(newValue ? "¡Tarea marcada como completada!" : "Tarea reabierta", "success");

      await loadMyTasks();
      const user = Auth.getCurrentUser();
      if (user && user.role === 'admin') await loadAllTasks();

    } catch (err) {
      console.error(err);
      showToast("Error al actualizar la tarea", "error");
    }
  };

  // Dynamic Task Inputs Logic
  const addAnotherTaskBtn = document.getElementById('addAnotherTaskBtn');
  const dynamicTasksContainer = document.getElementById('dynamicTasksContainer');

  if (dynamicTasksContainer) {
    // Event delegation for remove buttons
    dynamicTasksContainer.addEventListener('click', (e) => {
      const target = e.target.closest('.remove-task-btn');
      if (target) {
        const row = target.closest('.task-input-row');
        if (row) {
          row.remove();
          updateRemoveButtonsVisibility();
        }
      }
    });
  }

  if (addAnotherTaskBtn && dynamicTasksContainer) {
    addAnotherTaskBtn.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'd-flex align-items-center mb-2 task-input-row';
      row.innerHTML = `
        <input type="text" class="form-control task-name-input" placeholder="Ej: Nueva tarea..." style="border-radius:6px;">
        <button type="button" class="btn btn-danger btn-sm ml-2 remove-task-btn" style="border-radius:6px; background:#ef4444; color:white; border:none; padding:5px 10px; flex-shrink:0;">✖</button>
      `;
      dynamicTasksContainer.appendChild(row);

      updateRemoveButtonsVisibility();
    });
  }

  function updateRemoveButtonsVisibility() {
    if (!dynamicTasksContainer) return;
    const rows = dynamicTasksContainer.querySelectorAll('.task-input-row');
    rows.forEach((r, index) => {
      const btn = r.querySelector('.remove-task-btn');
      if (btn) {
        btn.style.display = rows.length > 1 ? 'inline-block' : 'none';
      }
    });
  }

  const assignTaskBtn = document.getElementById('assignTaskBtn');
  if (assignTaskBtn) {
    assignTaskBtn.addEventListener('click', async () => {
      const user = Auth.getCurrentUser();
      if (!user || user.role !== 'admin') return;

      const storeId = document.getElementById('taskStoreSelect').value;
      const dateStr = document.getElementById('taskDateInput').value;

      const inputs = document.querySelectorAll('.task-name-input');
      const lines = [];
      inputs.forEach(inp => {
        const val = inp.value.trim();
        if (val) lines.push(val);
      });

      if (!storeId || !dateStr || lines.length === 0) {
        showToast("Todos los campos son obligatorios y debes ingresar al menos una tarea", "error");
        return;
      }

      try {
        const inserts = lines.map(line => ({
          organization_id: user.organization_id,
          store_id: storeId,
          task_name: line,
          task_date: dateStr,
          is_completed: false
        }));

        const { error } = await supabaseClient.from('store_tasks').insert(inserts);

        if (error) throw error;

        if (dynamicTasksContainer) {
          dynamicTasksContainer.innerHTML = `
             <div class="d-flex align-items-center mb-2 task-input-row">
                 <input type="text" class="form-control task-name-input" placeholder="Ej: Realizar limpieza profunda del anaquel 4" style="border-radius:6px;">
                 <button type="button" class="btn btn-danger btn-sm ml-2 remove-task-btn" style="border-radius:6px; background:#ef4444; color:white; border:none; padding:5px 10px; flex-shrink:0; display:none;">✖</button>
             </div>
           `;
        }

        showToast(`Se asignaron ${lines.length} tareas correctamente`, "success");
        await loadAllTasks();

      } catch (err) {
        console.error(err);
        showToast("Error al asignar tarea", "error");
      }
    });
  }

  const tFilterStore = document.getElementById('taskFilterStoreSelect');
  const tFilterDate = document.getElementById('taskFilterDateInput');
  if (tFilterStore) tFilterStore.addEventListener('change', () => loadAllTasks());
  if (tFilterDate) tFilterDate.addEventListener('change', () => loadAllTasks());

  async function loadAllTasks() {
    const container = document.getElementById('allTasksContainer');
    if (!container) return;

    const storeId = document.getElementById('taskFilterStoreSelect')?.value || 'all';
    const dateStr = document.getElementById('taskFilterDateInput')?.value || toLocalDateInputValue(new Date());

    try {
      let query = supabaseClient
        .from('store_tasks')
        .select('*, stores(name)')
        .eq('task_date', dateStr)
        .order('store_id')
        .order('is_completed', { ascending: true })
        .order('created_at', { ascending: false });

      if (storeId !== 'all') {
        query = query.eq('store_id', storeId);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        container.innerHTML = '<div class="text-center text-muted" style="padding:40px;">No hay tareas para esta fecha.</div>';
        return;
      }

      // Group by store
      const groupedData = {};
      data.forEach(t => {
        const sName = t.stores?.name || 'Desconocida';
        if (!groupedData[sName]) groupedData[sName] = [];
        groupedData[sName].push(t);
      });

      let html = '';
      for (const [storeName, tasks] of Object.entries(groupedData)) {
        const total = tasks.length;
        const completed = tasks.filter(t => t.is_completed).length;
        const percent = Math.round((completed / total) * 100);

        html += `
        <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:15px; overflow:hidden;">
          <div style="background:#f8fafc; padding:12px 15px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:700; color:#0f172a; font-size:1.05rem;"><i class="fas fa-store text-muted mr-2"></i> ${storeName}</div>
            <div style="font-size:0.85rem; font-weight:600; color:#64748b; background:#e2e8f0; padding:3px 8px; border-radius:12px;">${completed} / ${total} completadas (${percent}%)</div>
          </div>
          <!-- Progress bar -->
          <div style="height: 5px; background: #e2e8f0; width: 100%;">
            <div style="height: 100%; background: ${percent === 100 ? '#22c55e' : '#0284c7'}; width: ${percent}%; transition: width 0.4s ease-in-out;"></div>
          </div>
          <div style="padding:15px; display:flex; flex-direction:column; gap:8px;">
        `;

        tasks.forEach(t => {
          html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:6px; background:${t.is_completed ? '#f8fafc' : '#fff'}; border:1px solid ${t.is_completed ? '#e2e8f0' : '#bae6fd'}; transition:all 0.2s;">
              <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <div style="width:22px; height:22px; border-radius:6px; border:2px solid ${t.is_completed ? '#22c55e' : '#cbd5e1'}; background:${t.is_completed ? '#22c55e' : 'transparent'}; display:flex; justify-content:center; align-items:center; color:white; font-size:12px; transition:all 0.2s;">
                  ${t.is_completed ? '<i class="fas fa-check"></i>' : ''}
                </div>
                <div style="font-weight:600; color:${t.is_completed ? '#94a3b8' : '#334155'}; text-decoration:${t.is_completed ? 'line-through' : 'none'}; font-size:0.95rem;">${t.task_name}</div>
              </div>
              <button class="btn btn-sm text-danger" onclick="window.deleteTask('${t.id}')" style="padding:4px 8px; background:transparent; border:none; opacity:0.7;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Eliminar Tarea">🗑️</button>
            </div>
          `;
        });

        html += `</div></div>`;
      }
      container.innerHTML = html;

    } catch (err) {
      console.error(err);
      container.innerHTML = '<div class="text-center text-danger" style="padding:40px;">Error cargando historial de tareas.</div>';
    }
  }

  window.deleteTask = async function (taskId) {
    if (!confirm("¿Eliminar esta tarea definitivamente?")) return;
    try {
      const { error } = await supabaseClient.from('store_tasks').delete().eq('id', taskId);
      if (error) throw error;
      showToast("Tarea eliminada", "success");
      await loadAllTasks();
      await loadMyTasks();
    } catch (err) {
      console.error(err);
      showToast("Error al eliminar", "error");
    }
  };

  // ── Devoluciones / Notas de Crédito ───────────────────────────────────────

  window.openReturnModal = function () {
    let modal = document.getElementById('returnModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'returnModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:680px;">
          <div class="modal-header">
            <h3 class="modal-title">🔄 Devolución / Nota de Crédito</h3>
            <button class="modal-close" onclick="document.getElementById('returnModal').classList.remove('active')">✕</button>
          </div>
          <div style="margin-bottom:12px; display:flex; gap:8px;">
            <input id="returnSearchInput" class="form-control" placeholder="Buscar por nombre de cliente o folio de venta…" style="flex:1;"
              onkeydown="if(event.key==='Enter') window.searchSaleForReturn()"/>
            <button class="btn btn-primary" onclick="window.searchSaleForReturn()">Buscar</button>
          </div>
          <div id="returnSearchResults" style="max-height:380px; overflow-y:auto;"></div>
          <div id="returnActions" style="display:none; margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
            <button class="btn btn-secondary" onclick="document.getElementById('returnModal').classList.remove('active')">Cancelar</button>
            <button class="btn btn-danger" onclick="window.processReturn()">Confirmar Devolución</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    document.getElementById('returnSearchInput').value = '';
    document.getElementById('returnSearchResults').innerHTML = '';
    document.getElementById('returnActions').style.display = 'none';
    modal.classList.add('active');
  };

  window.searchSaleForReturn = async function () {
    const query = document.getElementById('returnSearchInput')?.value.trim();
    const resultsEl = document.getElementById('returnSearchResults');
    if (!query) return;

    resultsEl.innerHTML = '<div style="text-align:center;padding:20px;">Buscando…</div>';

    try {
      let sales = [];

      // Search by customer name
      const { data: customers } = await supabaseClient
        .from('customers')
        .select('id, name')
        .ilike('name', `%${query}%`)
        .limit(10);

      if (customers && customers.length > 0) {
        const custIds = customers.map(c => c.id);
        const { data: custSales } = await supabaseClient
          .from('sales')
          .select('id, store_id, sale_date, total, sale_type, payment_method, cash_amount, card_amount, transfer_amount, mixed_method, customer_id, customers(name), store:stores(name)')
          .in('customer_id', custIds)
          .gt('total', 0)
          .order('sale_date', { ascending: false })
          .limit(20);
        if (custSales) sales.push(...custSales);
      }

      // Search by partial folio (last 8 chars of UUID without dashes)
      const { data: allSales } = await supabaseClient
        .from('sales')
        .select('id, store_id, sale_date, total, sale_type, payment_method, cash_amount, card_amount, transfer_amount, mixed_method, customer_id, customers(name), store:stores(name)')
        .gt('total', 0)
        .order('sale_date', { ascending: false })
        .limit(200);

      if (allSales) {
        const folioMatches = allSales.filter(s =>
          s.id.replace(/-/g, '').slice(-8).toUpperCase().includes(query.toUpperCase())
        );
        sales.push(...folioMatches);
      }

      // Deduplicate by id
      const seen = new Set();
      sales = sales.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
      sales = sales.filter(s => {
        const saleType = String(s.sale_type || '').toLowerCase();
        return !saleType.includes('devoluci') && !saleType.includes('prueba');
      });

      if (sales.length === 0) {
        resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:#000;">No se encontraron ventas.</div>';
        return;
      }

      // Fetch items for found sales
      const saleIds = sales.map(s => s.id);
      const { data: items } = await supabaseClient
        .from('sale_items')
        .select('id, sale_id, product_id, quantity, unit_price, product:products(name)')
        .in('sale_id', saleIds);

      const returnLogResults = await Promise.all(sales.map(async sale => {
        const folio = sale.id.replace(/-/g, '').slice(-8).toUpperCase();
        const { data } = await supabaseClient
          .from('inventory_logs')
          .select('product_id, quantity')
          .eq('type', 'devolucion')
          .ilike('description', `%${folio}%`);
        return { saleId: sale.id, logs: data || [] };
      }));

      const returnedBySaleProduct = {};
      returnLogResults.forEach(({ saleId, logs }) => {
        logs.forEach(log => {
          const key = `${saleId}|${log.product_id}`;
          returnedBySaleProduct[key] = (returnedBySaleProduct[key] || 0) + parseInt(log.quantity || 0);
        });
      });

      const itemsBySale = {};
      (items || []).forEach(it => {
        if (!itemsBySale[it.sale_id]) itemsBySale[it.sale_id] = [];
        itemsBySale[it.sale_id].push(it);
      });

      let html = '';
      sales.forEach(sale => {
        const folio = sale.id.replace(/-/g, '').slice(-8).toUpperCase();
        const dateStr = formatAppDateTime(sale.sale_date, { day: 'numeric', month: 'short', year: 'numeric' });
        const custName = sale.customers?.name || 'Sin cliente';
        const saleItems = itemsBySale[sale.id] || [];
        const returnedRemainder = {};

        html += `<div style="border:1px solid #e2e8f0; border-radius:8px; margin-bottom:10px; overflow:hidden;">
          <div style="background:#f8fafc; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0;">
            <div>
              <span style="font-weight:700; font-size:0.85rem;">Folio: ${folio}</span>
              <span style="color:#64748b; font-size:0.8rem; margin-left:10px;">${dateStr}</span>
              <span style="color:#64748b; font-size:0.8rem; margin-left:10px;">👤 ${custName}</span>
              <span style="color:#64748b; font-size:0.8rem; margin-left:10px;">🏪 ${sale.store?.name || 'Sin tienda'}</span>
            </div>
            <span style="font-weight:700; color:#1e4d0f;">$${parseFloat(sale.total).toFixed(2)}</span>
          </div>
          <div style="padding:8px 12px;">`;

        if (saleItems.length === 0) {
          html += '<div style="color:#999; font-size:0.8rem;">Sin productos registrados</div>';
        } else {
          saleItems.forEach(it => {
            const productName = it.product?.name || 'Producto sin nombre';
            const safeProductName = escapeHtml(productName);
            const returnedKey = `${sale.id}|${it.product_id}`;
            const alreadyReturned = returnedRemainder[returnedKey] ?? returnedBySaleProduct[returnedKey] ?? 0;
            const availableToReturn = Math.max(0, parseInt(it.quantity || 0) - alreadyReturned);
            returnedRemainder[returnedKey] = Math.max(0, alreadyReturned - parseInt(it.quantity || 0));
            const disabledAttr = availableToReturn <= 0 ? 'disabled' : '';
            const returnedText = availableToReturn <= 0 ? '<span style="color:#16a34a; font-size:0.75rem; font-weight:700;">Devuelto</span>' : '';
            html += `<label style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:0.85rem; cursor:pointer;">
              <input type="checkbox" class="return-item-check"
                data-sale-id="${sale.id}"
                data-store-id="${sale.store_id}"
                data-customer-id="${sale.customer_id || ''}"
                data-sale-total="${parseFloat(sale.total || 0)}"
                data-payment-method="${sale.payment_method || 'efectivo'}"
                data-cash-amount="${parseFloat(sale.cash_amount || 0)}"
                data-card-amount="${parseFloat(sale.card_amount || 0)}"
                data-transfer-amount="${parseFloat(sale.transfer_amount || 0)}"
                data-mixed-method="${sale.mixed_method || ''}"
                data-item-id="${it.id}"
                data-product-id="${it.product_id}"
                data-product-name="${safeProductName}"
                data-max-qty="${availableToReturn}"
                data-unit-price="${parseFloat(it.unit_price || 0)}"
                style="width:15px;height:15px;cursor:pointer;"
                ${disabledAttr}
              />
              <span style="flex:1;">${safeProductName}</span>
              <span style="color:#64748b;">x${it.quantity}</span>
              ${returnedText}
              <span style="color:#1e4d0f; font-weight:600;">$${parseFloat(it.unit_price).toFixed(2)}</span>
              <input type="number" class="return-item-qty"
                min="1" max="${availableToReturn}" value="${availableToReturn || 1}"
                style="width:52px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; text-align:center; font-size:0.8rem;"
                ${disabledAttr}
              />
            </label>`;
          });
        }

        html += '</div></div>';
      });

      resultsEl.innerHTML = html;
      document.getElementById('returnActions').style.display = 'flex';

    } catch (err) {
      console.error('Error buscando ventas:', err);
      resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:#c62828;">Error al buscar ventas.</div>';
    }
  };

  window.processReturn = async function () {
    const checks = document.querySelectorAll('.return-item-check:checked');
    if (checks.length === 0) {
      showToast('Selecciona al menos un producto para devolver', 'warning');
      return;
    }

    const items = Array.from(checks).map(cb => {
      const row = cb.closest('label');
      const qtyInput = row?.querySelector('.return-item-qty');
      const maxQty = parseInt(cb.dataset.maxQty || '0');
      const qty = Math.min(parseInt(qtyInput?.value || '1'), maxQty);
      return {
        saleId: cb.dataset.saleId,
        storeId: cb.dataset.storeId,
        customerId: cb.dataset.customerId || null,
        saleTotal: parseFloat(cb.dataset.saleTotal || 0),
        paymentMethod: cb.dataset.paymentMethod || 'efectivo',
        cashAmount: parseFloat(cb.dataset.cashAmount || 0),
        cardAmount: parseFloat(cb.dataset.cardAmount || 0),
        transferAmount: parseFloat(cb.dataset.transferAmount || 0),
        mixedMethod: cb.dataset.mixedMethod || null,
        itemId: cb.dataset.itemId,
        productId: cb.dataset.productId,
        productName: cb.dataset.productName,
        unitPrice: parseFloat(cb.dataset.unitPrice || 0),
        maxQty,
        qty: qty < 1 ? 0 : qty
      };
    });

    const invalidItem = items.find(item => !item.storeId || !item.productId || item.qty < 1 || item.qty > item.maxQty);
    if (invalidItem) {
      showToast('Cantidad de devolución inválida. Revisa los productos seleccionados.', 'warning');
      return;
    }

    const names = items.map(i => `• ${i.productName} (x${i.qty})`).join('\n');
    if (!confirm(`¿Confirmar devolución de ${items.length} artículo(s)?\n\n${names}\n\nEl inventario será restaurado.`)) return;

    const processBtn = document.querySelector('#returnActions .btn-danger');
    if (processBtn) {
      processBtn.disabled = true;
      processBtn.textContent = 'Procesando...';
    }

    const createdCreditSales = [];
    const restoredItems = [];

    try {
      const itemsBySale = {};
      items.forEach(item => {
        if (!itemsBySale[item.saleId]) itemsBySale[item.saleId] = [];
        itemsBySale[item.saleId].push(item);
      });

      for (const [saleId, saleItems] of Object.entries(itemsBySale)) {
        const first = saleItems[0];
        const refundTotal = saleItems.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
        const ratio = first.saleTotal > 0 ? Math.min(1, refundTotal / first.saleTotal) : 1;
        const paymentMethod = first.paymentMethod;

        const creditSalePayload = {
          store_id: first.storeId,
          employee_id: Auth.getCurrentUser()?.id || null,
          customer_id: first.customerId || null,
          total: -refundTotal,
          payment_method: paymentMethod,
          sale_date: new Date().toISOString(),
          sale_type: 'Devolución',
          cash_amount: paymentMethod === 'mixto'
            ? -Math.abs(first.cashAmount * ratio)
            : null,
          card_amount: paymentMethod === 'mixto' && first.mixedMethod?.includes('tarjeta')
            ? -Math.abs(first.cardAmount * ratio)
            : null,
          transfer_amount: paymentMethod === 'transferencia'
            ? -refundTotal
            : (paymentMethod === 'mixto' && first.mixedMethod?.includes('transferencia')
              ? -Math.abs(first.transferAmount * ratio)
              : null),
          mixed_method: paymentMethod === 'mixto' ? first.mixedMethod : null
        };

        const { data: creditSale, error: creditSaleError } = await supabaseClient
          .from('sales')
          .insert(creditSalePayload)
          .select()
          .single();

        if (creditSaleError) throw creditSaleError;
        createdCreditSales.push(creditSale);

        const creditItems = saleItems.map(item => ({
          sale_id: creditSale.id,
          product_id: item.productId,
          quantity: -item.qty,
          unit_price: item.unitPrice,
          subtotal: -(item.qty * item.unitPrice)
        }));

        const { error: creditItemsError } = await supabaseClient
          .from('sale_items')
          .insert(creditItems);

        if (creditItemsError) throw creditItemsError;
      }

      for (const item of items) {
        await restoreInventory(item.storeId, item.productId, item.qty);
        restoredItems.push(item);

        const { error: logError } = await supabaseClient.from('inventory_logs').insert({
          store_id: item.storeId,
          product_id: item.productId,
          employee_id: Auth.getCurrentUser()?.id || null,
          type: 'devolucion',
          quantity: item.qty,
          description: `Devolución de venta ${item.saleId.replace(/-/g, '').slice(-8).toUpperCase()}`
        });

        if (logError) throw logError;
      }

      const refundTotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
      showToast(`Devolución procesada: ${items.length} artículo(s) | Nota: -$${refundTotal.toFixed(2)}`, 'success');
      document.getElementById('returnModal').classList.remove('active');

    } catch (err) {
      console.error('Error procesando devolución:', err);
      try {
        for (const item of restoredItems) {
          await adjustInventoryQuantity(item.storeId, item.productId, -item.qty);
        }
        for (const sale of createdCreditSales) {
          await supabaseClient.from('sale_items').delete().eq('sale_id', sale.id);
          await supabaseClient.from('sales').delete().eq('id', sale.id);
        }
      } catch (rollbackError) {
        console.error('Error revirtiendo devolución:', rollbackError);
      }
      showToast('Error al procesar la devolución', 'error');
    } finally {
      if (processBtn) {
        processBtn.disabled = false;
        processBtn.textContent = 'Confirmar Devolución';
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MÓDULO COMPRAS
  // ═══════════════════════════════════════════════════════════════════════════

  let comprasCart = [];          // { productId, barcode, name, quantity, unitCost, subtotal }
  let comprasStoreId = null;
  let comprasStoreName = '';
  let comprasSupplierId = null;
  let comprasSupplierNameVal = '';
  let comprasProductsCache = null;
  let comprasListenersReady = false;
  let printTicketOnCompra = false;
  const PURCHASE_TICKET_HISTORY_DAYS = 3;
  const comprasTicketCache = [];
  let comprasTicketsLoadedForStore = null;
  let comprasTicketsLoading = false;
  let comprasRectification = null;

  function getPurchaseHistoryStartIso() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (PURCHASE_TICKET_HISTORY_DAYS - 1));
    return start.toISOString();
  }

  function getLocalDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function isPurchaseRectifiable(ticket) {
    return getLocalDateKey(ticket?.createdAt || ticket?.date) === getLocalDateKey();
  }

  function setPurchaseRectificationMode(rectification = null) {
    comprasRectification = rectification;
    const banner = document.getElementById('comprasRectificationBanner');
    const button = document.getElementById('btnRegistrarCompra');

    if (rectification) {
      if (banner) {
        banner.style.display = 'block';
        banner.innerHTML = `<div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;"><div><strong>Rectificando compra ${escapeHtml(rectification.folio)}</strong><br>Al guardar, solo se ajustara la diferencia de inventario.</div><button type="button" onclick="window.cancelPurchaseRectification()" title="Cancelar rectificación" style="border:0; background:transparent; color:#1d4ed8; font-size:1.15rem; line-height:1; cursor:pointer; padding:0;">×</button></div>`;
      }
      if (button) button.innerHTML = 'Guardar rectificacion';
      return;
    }

    if (banner) {
      banner.style.display = 'none';
      banner.textContent = '';
    }
    if (button) button.innerHTML = '📦 REGISTRAR COMPRA';
  }

  window.cancelPurchaseRectification = function() {
    if (!comprasRectification) return;
    comprasCart = [];
    renderComprasCart();
    window.clearComprasSupplier();
    const notes = document.getElementById('comprasNotes');
    if (notes) notes.value = '';
    setPurchaseRectificationMode(null);
    showToast('Rectificación cancelada', 'info');
  };

  async function loadRecentPurchaseTickets(force = false) {
    if (!comprasStoreId || comprasTicketsLoading) return;
    if (!force && comprasTicketsLoadedForStore === comprasStoreId) return;

    comprasTicketsLoading = true;
    try {
      const { data: purchases, error } = await supabaseClient
        .from('purchases')
        .select(`
          id, supplier_id, purchase_date, created_at, total, notes,
          supplier:suppliers(name),
          employee:employees(full_name, username),
          items:purchase_items(id, product_id, quantity, unit_cost, subtotal, product:products(name))
        `)
        .eq('store_id', comprasStoreId)
        .gte('purchase_date', getPurchaseHistoryStartIso())
        .order('purchase_date', { ascending: false })
        .limit(150);

      if (error) throw error;

      const tickets = (purchases || []).map(purchase => ({
        id: purchase.id,
        folio: purchase.id.replace(/-/g, '').slice(-8).toUpperCase(),
        supplierId: purchase.supplier_id,
        supplierName: purchase.supplier?.name || 'Sin proveedor',
        storeName: comprasStoreName,
        employeeName: purchase.employee?.full_name || purchase.employee?.username || 'Usuario',
        date: purchase.purchase_date,
        createdAt: purchase.created_at || purchase.purchase_date,
        total: Number(purchase.total || 0),
        notes: purchase.notes || '',
        items: (purchase.items || []).map(item => ({
          purchaseItemId: item.id,
          productId: item.product_id,
          name: item.product?.name || 'Producto no disponible',
          quantity: Number(item.quantity || 0),
          unitCost: Number(item.unit_cost || 0),
          subtotal: Number(item.subtotal || 0)
        }))
      }));

      comprasTicketCache.splice(0, comprasTicketCache.length, ...tickets);
      comprasTicketsLoadedForStore = comprasStoreId;
    } catch (error) {
      console.error('Error cargando historial reciente de compras:', error);
      showToast('No se pudo cargar el historial de compras: ' + error.message, 'error');
    } finally {
      comprasTicketsLoading = false;
    }
  }

  function rememberPurchaseTicket(compraData) {
    if (!compraData?.id) return;
    const snapshot = cloneTicketData(compraData);
    const existingIndex = comprasTicketCache.findIndex(item => item.id === snapshot.id);
    if (existingIndex >= 0) comprasTicketCache.splice(existingIndex, 1);
    comprasTicketCache.unshift(snapshot);
    renderPurchaseTicketsList();
  }

  function renderPurchaseTicketsList() {
    const list = document.getElementById('comprasTicketsList');
    if (!list) return;

    if (comprasTicketCache.length === 0) {
      list.innerHTML = `
        <div style="text-align:center; padding:14px 10px; color:#94a3b8; font-size:0.78rem;">
          No hay compras registradas en los últimos 3 días.
        </div>`;
      return;
    }

    list.innerHTML = comprasTicketCache.map(ticket => {
      const created = new Date(ticket.createdAt || ticket.date || Date.now());
      const purchaseDate = new Date(ticket.date || ticket.createdAt || Date.now());
      const timeText = created.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      const dateText = purchaseDate.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
      const itemCount = (ticket.items || []).reduce((sum, item) => sum + parseInt(item.quantity || 0), 0);
      const folio = ticket.folio || ticket.id?.replace(/-/g, '').slice(-8).toUpperCase() || 'SIN FOLIO';
      const canRectify = isPurchaseRectifiable(ticket);

      return `
        <div style="display:flex; gap:6px; border-bottom:1px solid #edf2f7; padding:8px 2px;">
          <button type="button" onclick="window.previewCompraTicket('${ticket.id}')"
                  title="Ver o reimprimir ticket de compra"
                  style="flex:1; min-width:0; border:none; background:white; padding:2px 0; text-align:left; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:3px;">
            <strong style="font-size:0.82rem; color:#111827; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(ticket.supplierName || 'Sin proveedor')}</strong>
            <span style="font-size:0.74rem; color:#64748b; flex-shrink:0;">${escapeHtml(dateText)} · ${escapeHtml(timeText)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; color:#64748b; font-size:0.74rem;">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(folio)} · ${itemCount} art.</span>
            <strong style="color:#1d4ed8; flex-shrink:0;">$${Number(ticket.total || 0).toFixed(2)}</strong>
          </div>
          </button>
          ${canRectify
            ? `<button type="button" onclick="window.rectifyPurchase('${ticket.id}')" title="Editar esta compra y ajustar solo la diferencia"
                  style="align-self:center; border:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; border-radius:6px; padding:6px 7px; cursor:pointer; font-size:0.72rem; font-weight:800;">Rectificar</button>`
            : `<span title="Solo se puede rectificar el mismo día de la compra" style="align-self:center; color:#94a3b8; font-size:0.68rem; font-weight:700; text-align:center;">Solo hoy</span>`}
        </div>`;
    }).join('');
  }

  window.renderPurchaseTicketsList = renderPurchaseTicketsList;
  window.refreshPurchaseTickets = async function () {
    await loadRecentPurchaseTickets(true);
    renderPurchaseTicketsList();
  };

  window.toggleComprasTicket = function() {
    printTicketOnCompra = !printTicketOnCompra;
    const btn = document.getElementById('btnComprasTicketToggle');
    if (!btn) return;

    if (printTicketOnCompra) {
      btn.style.background = '#1d4ed8';
      btn.style.color = 'white';
      btn.style.borderColor = '#1d4ed8';
      btn.textContent = '✅ Imprimir Ticket';
    } else {
      btn.style.background = '#f8f9fa';
      btn.style.color = '#334155';
      btn.style.borderColor = '#dbe4ef';
      btn.textContent = '🖨️ Imprimir Ticket';
    }
  };

  function printCompraTicket(compraData, autoPrint = false, allowManualPrint = autoPrint) {
    if (!compraData?.items?.length) return;

    const fecha = new Date(compraData.date || Date.now()).toLocaleDateString('es-MX', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const hora = new Date(compraData.createdAt || Date.now()).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const folio = compraData.folio || compraData.id?.replace(/-/g, '').slice(-8).toUpperCase() || '';
    const rows = compraData.items.map(item => `
      <tr>
        <td style="padding:4px 2px;">${escapeHtml(item.name)}</td>
        <td style="text-align:center;padding:4px 2px;">${item.quantity}</td>
        <td style="text-align:right;padding:4px 2px;">$${Number(item.unitCost || 0).toFixed(2)}</td>
        <td style="text-align:right;padding:4px 2px;">$${Number(item.subtotal || 0).toFixed(2)}</td>
      </tr>`).join('');

    const ticketBody = `
      <h2>LA CASA DEL AJO</h2>
      <div class="sub">Ticket de Compra</div>
      <div class="folio">COMPRA ${folio}</div>
      <div class="sub">${escapeHtml(compraData.storeName || 'Tienda')}</div>
      <div class="sub">${fecha} · ${hora}</div>
      <hr>
      <div style="font-size:0.83rem;line-height:1.5;">
        <strong>Proveedor:</strong> ${escapeHtml(compraData.supplierName || 'Sin proveedor')}<br>
        <strong>Registró:</strong> ${escapeHtml(compraData.employeeName || 'Usuario')}<br>
        ${compraData.notes ? `<strong>Notas:</strong> ${escapeHtml(compraData.notes)}<br>` : ''}
      </div>
      <hr>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;">Producto</th>
            <th>Cant</th>
            <th style="text-align:right;">Costo</th>
            <th style="text-align:right;">Importe</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="3" style="text-align:right;padding:5px 2px;">TOTAL COMPRA</td>
            <td style="text-align:right;padding:5px 2px;">$${Number(compraData.total || 0).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      <hr>
      <div class="footer">Inventario actualizado por compra a proveedor.</div>
    `;

    const ticketStyles = `
      ${getThermalTicketStyles('.folio { background:#fff; }')}`;

    async function triggerPrint() {
      const ticketHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${ticketStyles}</style></head><body>${ticketBody}</body></html>`;
      try {
        await printHtmlSilently(ticketHTML);
        showToast('Ticket de compra enviado a imprimir', 'success');
      } catch (error) {
        console.error('Error imprimiendo ticket de compra:', error);
        showToast('No se pudo imprimir el ticket de compra: ' + error.message, 'error');
      }
    }

    let modal = document.getElementById('_compraTicketPreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = '_compraTicketPreviewModal';
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:0;max-width:420px;width:94%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.35);">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid #e5e7eb;flex-shrink:0;">
            <span style="font-weight:700;font-size:1rem;color:#111;">Ticket de compra</span>
            <div style="display:flex;gap:8px;">
              <button id="_compraTicketPrintBtn" style="background:#1d4ed8;color:white;border:none;border-radius:6px;padding:7px 16px;font-size:0.875rem;font-weight:600;cursor:pointer;">🖨️ Imprimir</button>
              <button id="_compraTicketCloseBtn" style="background:#f3f4f6;color:#374151;border:none;border-radius:6px;padding:7px 12px;font-size:0.875rem;cursor:pointer;">✕ Cerrar</button>
            </div>
          </div>
          <div style="overflow-y:auto;padding:18px;display:flex;justify-content:center;">
            <div id="_compraTicketPreviewContent" style="${getThermalTicketPreviewStyle()}"></div>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    document.getElementById('_compraTicketPreviewContent').innerHTML = ticketBody;
    modal.style.display = 'flex';
    document.getElementById('_compraTicketCloseBtn').onclick = () => { modal.style.display = 'none'; };
    const compraPrintBtn = document.getElementById('_compraTicketPrintBtn');
    if (compraPrintBtn) {
      compraPrintBtn.style.display = allowManualPrint ? '' : 'none';
      compraPrintBtn.onclick = () => triggerPrint();
    }

    if (autoPrint) triggerPrint();
  }

  window.previewCompraTicket = async function(purchaseId) {
    await loadRecentPurchaseTickets();
    const ticket = comprasTicketCache.find(item => item.id === purchaseId);
    if (!ticket) {
      showToast('Ese ticket ya no está disponible en el historial reciente', 'warning');
      renderPurchaseTicketsList();
      return;
    }
    printCompraTicket(cloneTicketData(ticket), false, true);
  };

  window.rectifyPurchase = async function(purchaseId) {
    await loadRecentPurchaseTickets(true);
    const ticket = comprasTicketCache.find(item => item.id === purchaseId);
    if (!ticket) {
      showToast('No se encontró la compra para rectificar', 'warning');
      return;
    }
    if (!ticket.supplierId || !ticket.items?.length) {
      showToast('Esta compra no tiene información suficiente para rectificarla', 'error');
      return;
    }
    if (!isPurchaseRectifiable(ticket)) {
      showToast('Solo puedes rectificar compras registradas el día de hoy', 'warning');
      return;
    }
    if (comprasCart.length && !confirm('La rectificación reemplazará los productos que tienes en la compra actual. ¿Continuar?')) return;

    comprasCart = ticket.items.map(item => ({
      productId: item.productId,
      barcode: '',
      name: item.name,
      quantity: Number(item.quantity || 1),
      unitCost: Number(item.unitCost || 0),
      subtotal: Number(item.subtotal || (item.quantity * item.unitCost) || 0)
    }));
    selectComprasSupplier(ticket.supplierId, ticket.supplierName);

    const folio = ticket.folio || ticket.id.replace(/-/g, '').slice(-8).toUpperCase();
    setPurchaseRectificationMode({
      purchaseId: ticket.id,
      folio,
      createdAt: ticket.createdAt,
      originalItems: ticket.items.map(item => ({
        purchaseItemId: item.purchaseItemId,
        productId: item.productId,
        quantity: Number(item.quantity || 0),
        unitCost: Number(item.unitCost || 0)
      }))
    });

    const notesInput = document.getElementById('comprasNotes');
    if (notesInput) {
      const prefix = `Rectificación de compra ${folio}`;
      notesInput.value = ticket.notes ? `${prefix}. ${ticket.notes}` : prefix;
    }
    const dateInput = document.getElementById('comprasDateInput');
    if (dateInput && ticket.date) dateInput.value = String(ticket.date).slice(0, 10);
    renderComprasCart();
    document.getElementById('comprasSearchProduct')?.focus();
    showToast('Compra cargada. Al guardar, el inventario recibirá solo la diferencia.', 'success');
  };

  async function loadCompras() {
    // Fecha por defecto = hoy
    const dateInput = document.getElementById('comprasDateInput');
    if (dateInput) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      dateInput.value = `${yyyy}-${mm}-${dd}`;
    }

    // Badge de fecha
    const dateEl = document.getElementById('comprasDateDisplay');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('es-MX', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    // Tienda del login (igual que ventas)
    const loginStore = localStorage.getItem('selectedStore') || sessionStorage.getItem('pos_current_store');
    if (loginStore) {
      try {
        const store = JSON.parse(loginStore);
        comprasStoreId = store.id;
        comprasStoreName = store.name;
      } catch (e) { /* ignore */ }
    }
    const titleEl = document.getElementById('comprasStoreTitle');
    if (titleEl) titleEl.textContent = comprasStoreName || 'Sin tienda seleccionada';

    // Precarga de productos (reutiliza caché del POS si existe)
    if (!comprasProductsCache) {
      comprasProductsCache = await fetchComprasProducts();
    }

    if (!comprasListenersReady) {
      setupComprasListeners();
      comprasListenersReady = true;
    }

    const ticketBtn = document.getElementById('btnComprasTicketToggle');
    if (ticketBtn) {
      ticketBtn.style.background = printTicketOnCompra ? '#1d4ed8' : '#f8f9fa';
      ticketBtn.style.color = printTicketOnCompra ? 'white' : '#334155';
      ticketBtn.style.borderColor = printTicketOnCompra ? '#1d4ed8' : '#dbe4ef';
      ticketBtn.textContent = printTicketOnCompra ? '✅ Imprimir Ticket' : '🖨️ Imprimir Ticket';
    }

    await loadRecentPurchaseTickets();
    renderComprasCart();
    renderPurchaseTicketsList();
    setupComprasSupplierSearch();
  }

  async function fetchComprasProducts() {
    return (await getCachedFullProducts())
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  function setupComprasListeners() {
    const searchInput = document.getElementById('comprasSearchProduct');
    const resultsBox  = document.getElementById('comprasSearchResults');
    if (!searchInput || !resultsBox) return;

    searchInput.addEventListener('input', () => {
      const term = searchInput.value.toLowerCase().trim();
      resultsBox.innerHTML = '';
      if (!term) { resultsBox.style.display = 'none'; return; }

      const matches = (comprasProductsCache || []).filter(p =>
        p.name.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term))
      ).slice(0, 50);

      if (matches.length === 0) { resultsBox.style.display = 'none'; return; }

      matches.forEach(p => {
        const item = document.createElement('a');
        item.href = '#';
        item.className = 'list-group-item list-group-item-action';
        item.style.cssText = 'padding:10px 14px; font-size:0.88rem; border-bottom:1px solid #f3f4f6; cursor:pointer;';
        const cost = parseFloat(p.cost_price || 0).toFixed(2);
        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div>
              <strong>${p.name}</strong>
              ${p.brand ? `<small style="color:#9ca3af; margin-left:6px;">${p.brand.name}</small>` : ''}
              ${p.barcode ? `<small style="color:#6b7280; margin-left:6px;">| ${p.barcode}</small>` : ''}
            </div>
            <span style="font-size:0.8rem; color:#1d4ed8; font-weight:700; white-space:nowrap;">$${cost}</span>
          </div>`;
        item.addEventListener('click', e => {
          e.preventDefault();
          addToComprasCart(p);
          searchInput.value = '';
          resultsBox.style.display = 'none';
          searchInput.focus();
        });
        resultsBox.appendChild(item);
      });
      resultsBox.style.display = 'block';
    });

    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { resultsBox.style.display = 'none'; searchInput.value = ''; }
    });

    document.addEventListener('click', e => {
      if (!searchInput.contains(e.target) && !resultsBox.contains(e.target)) {
        resultsBox.style.display = 'none';
      }
    }, { capture: false });
  }

  function addToComprasCart(product) {
    const existing = comprasCart.find(i => i.productId === product.id);
    const cost = parseFloat(product.cost_price || 0);
    if (existing) {
      existing.quantity += 1;
      existing.unitCost = cost;
      existing.subtotal = existing.quantity * cost;
    } else {
      comprasCart.push({
        productId: product.id,
        barcode: product.barcode || '',
        name: product.name,
        quantity: 1,
        unitCost: cost,
        subtotal: cost
      });
    }
    renderComprasCart();
  }

  function renderComprasCart() {
    const tbody      = document.getElementById('comprasCartBody');
    const emptyState = document.getElementById('comprasEmptyState');
    const totalEl    = document.getElementById('comprasTotal');
    const countEl    = document.getElementById('comprasItemCount');
    if (!tbody) return;

    if (comprasCart.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'flex';
      if (totalEl) totalEl.textContent = '$0.00';
      if (countEl) countEl.textContent = '0 artículos';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = comprasCart.map((item, idx) => `
      <tr>
        <td style="font-size:0.8rem; color:#6b7280;">${item.barcode || '—'}</td>
        <td class="text-center">
          <input type="number" min="1" value="${item.quantity}"
            style="width:58px; text-align:center; border:1px solid #e5e7eb; border-radius:6px; padding:3px 4px; font-weight:700; font-size:0.9rem;"
            onchange="window.updateComprasQty(${idx}, this.value)">
        </td>
        <td style="font-size:0.88rem; font-weight:600;">${item.name}</td>
        <td class="text-right">
          <input type="number" min="0" step="0.01" value="${item.unitCost.toFixed(2)}"
            style="width:80px; text-align:right; border:1px solid #e5e7eb; border-radius:6px; padding:3px 6px; font-weight:700; font-size:0.88rem;"
            onchange="window.updateComprasCost(${idx}, this.value)">
        </td>
        <td class="text-right" style="font-weight:700;">$${item.subtotal.toFixed(2)}</td>
        <td class="text-center">
          <button onclick="window.removeFromComprasCart(${idx})"
            style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1rem; padding:0;">✕</button>
        </td>
      </tr>`).join('');

    const total = comprasCart.reduce((s, i) => s + i.subtotal, 0);
    const totalItems = comprasCart.reduce((s, i) => s + i.quantity, 0);
    if (totalEl) totalEl.textContent = `$${total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (countEl) countEl.textContent = `${totalItems} artículo${totalItems !== 1 ? 's' : ''}`;
  }

  window.updateComprasQty = function(idx, val) {
    const qty = parseInt(val);
    if (isNaN(qty) || qty < 1) { renderComprasCart(); return; }
    comprasCart[idx].quantity = qty;
    comprasCart[idx].subtotal = qty * comprasCart[idx].unitCost;
    renderComprasCart();
  };

  window.updateComprasCost = function(idx, val) {
    const cost = parseFloat(val);
    if (isNaN(cost) || cost < 0) { renderComprasCart(); return; }
    comprasCart[idx].unitCost = cost;
    comprasCart[idx].subtotal = comprasCart[idx].quantity * cost;
    renderComprasCart();
  };

  window.removeFromComprasCart = function(idx) {
    comprasCart.splice(idx, 1);
    renderComprasCart();
  };

  // ── Proveedor ──────────────────────────────────────────────────────────────

  function setupComprasSupplierSearch() {
    const input   = document.getElementById('comprasSupplierSearch');
    const results = document.getElementById('comprasSupplierResults');
    if (!input || !results) return;

    // Limpia listeners clonando
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('input', async () => {
      const term = newInput.value.trim();
      results.innerHTML = '';
      if (!term) { results.style.display = 'none'; return; }

      const { data: suppliers, error } = await supabaseClient
        .from('suppliers')
        .select('id, name, phone')
        .ilike('name', `%${term}%`)
        .eq('is_active', true)
        .limit(20);

      if (error || !suppliers || suppliers.length === 0) {
        results.style.display = 'none'; return;
      }

      suppliers.forEach(s => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 14px; cursor:pointer; border-bottom:1px solid #f3f4f6; font-size:0.88rem; display:flex; align-items:center; justify-content:space-between; gap:12px;';
        item.innerHTML = `
          <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <strong>${escapeHtml(s.name)}</strong>${s.phone ? `<small style="color:#9ca3af; margin-left:8px;">${escapeHtml(s.phone)}</small>` : ''}
          </span>
          <button type="button"
                  title="Eliminar proveedor"
                  style="border:none; background:transparent; color:#dc2626; font-size:1.1rem; line-height:1; width:28px; height:28px; border-radius:6px; cursor:pointer; flex-shrink:0;"
                  onmouseover="this.style.background='#fee2e2'"
                  onmouseout="this.style.background='transparent'">&times;</button>`;
        item.addEventListener('mouseover', () => item.style.background = '#f0f4ff');
        item.addEventListener('mouseout',  () => item.style.background = 'white');
        item.addEventListener('click', () => {
          selectComprasSupplier(s.id, s.name);
          newInput.value = '';
          results.style.display = 'none';
        });
        item.querySelector('button')?.addEventListener('click', async e => {
          e.preventDefault();
          e.stopPropagation();
          await deleteComprasSupplier(s.id, s.name);
          newInput.dispatchEvent(new Event('input'));
        });
        results.appendChild(item);
      });
      results.style.display = 'block';
    });

    document.addEventListener('click', e => {
      if (!newInput.contains(e.target) && !results.contains(e.target)) {
        results.style.display = 'none';
      }
    });
  }

  async function deleteComprasSupplier(id, name) {
    if (!id) return;
    if (!confirm(`Seguro que quieres eliminar el proveedor "${name}"?`)) return;

    try {
      const { error } = await supabaseClient
        .from('suppliers')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      if (comprasSupplierId === id) {
        window.clearComprasSupplier();
      }

      showToast('Proveedor eliminado', 'success');
    } catch (err) {
      console.error('Error eliminando proveedor:', err);
      showToast('Error al eliminar proveedor: ' + err.message, 'error');
    }
  }

  function selectComprasSupplier(id, name) {
    comprasSupplierId = id;
    comprasSupplierNameVal = name;
    const badge = document.getElementById('comprasSupplierBadge');
    const nameEl = document.getElementById('comprasSupplierName');
    const searchInput = document.getElementById('comprasSupplierSearch');
    if (badge)  { badge.style.display = 'flex'; }
    if (nameEl) nameEl.textContent = name;
    if (searchInput) searchInput.style.display = 'none';
  }

  window.clearComprasSupplier = function() {
    comprasSupplierId = null;
    comprasSupplierNameVal = '';
    const badge = document.getElementById('comprasSupplierBadge');
    const searchInput = document.getElementById('comprasSupplierSearch');
    if (badge) badge.style.display = 'none';
    if (searchInput) { searchInput.style.display = ''; searchInput.value = ''; searchInput.focus(); }
  };

  window.openNewSupplierModal = function() {
    const existing = document.getElementById('newSupplierModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'newSupplierModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.5); z-index:9999; display:flex; align-items:center; justify-content:center;';
    modal.innerHTML = `
      <div style="background:white; border-radius:14px; width:100%; max-width:440px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,.2); overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb); color:white; padding:18px 24px; display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1.1rem;">Nuevo Proveedor</h3>
          <button onclick="document.getElementById('newSupplierModal').remove()"
            style="background:none; border:none; color:white; font-size:1.5rem; cursor:pointer; line-height:1;">×</button>
        </div>
        <div style="padding:24px;">
          <div class="form-group" style="margin-bottom:14px;">
            <label style="font-weight:600; font-size:0.85rem; color:#374151; display:block; margin-bottom:6px;">Nombre del proveedor *</label>
            <input type="text" id="newSupplierName" class="form-control" placeholder="Ej. Distribuidora Jesús" style="border-radius:8px;">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label style="font-weight:600; font-size:0.85rem; color:#374151; display:block; margin-bottom:6px;">Teléfono (opcional)</label>
            <input type="text" id="newSupplierPhone" class="form-control" placeholder="Ej. 555-123-4567" style="border-radius:8px;">
          </div>
          <div class="form-group" style="margin-bottom:20px;">
            <label style="font-weight:600; font-size:0.85rem; color:#374151; display:block; margin-bottom:6px;">Notas (opcional)</label>
            <textarea id="newSupplierNotes" class="form-control" rows="2" placeholder="Observaciones..." style="border-radius:8px; resize:none;"></textarea>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button onclick="document.getElementById('newSupplierModal').remove()"
              class="btn btn-secondary" style="border-radius:8px;">Cancelar</button>
            <button onclick="window.saveNewSupplier()"
              class="btn btn-primary" style="border-radius:8px; background:#1d4ed8; border:none;">Guardar Proveedor</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('newSupplierName').focus();
  };

  window.saveNewSupplier = async function() {
    const name  = document.getElementById('newSupplierName')?.value.trim();
    const phone = document.getElementById('newSupplierPhone')?.value.trim();
    const notes = document.getElementById('newSupplierNotes')?.value.trim();

    if (!name) { showToast('El nombre del proveedor es obligatorio', 'warning'); return; }

    try {
      const { data, error } = await supabaseClient
        .from('suppliers')
        .insert({ name, phone: phone || null, notes: notes || null, organization_id: Auth.getCurrentUser()?.organization_id })
        .select()
        .single();

      if (error) throw error;

      document.getElementById('newSupplierModal').remove();
      selectComprasSupplier(data.id, data.name);
      showToast(`Proveedor "${data.name}" creado y seleccionado`, 'success');
    } catch (err) {
      console.error('Error guardando proveedor:', err);
      showToast('Error al guardar proveedor: ' + err.message, 'error');
    }
  };

  function groupPurchaseItemsByProduct(items) {
    return new Map((items || []).map(item => [item.productId, item]));
  }

  async function savePurchaseRectification(rectification, cartSnapshot, purchaseData, employee) {
    if (!isPurchaseRectifiable(rectification)) {
      throw new Error('La compra ya no se puede rectificar porque no fue registrada hoy');
    }

    const originalByProduct = groupPurchaseItemsByProduct(rectification.originalItems);
    const currentByProduct = groupPurchaseItemsByProduct(cartSnapshot);
    const productIds = new Set([...originalByProduct.keys(), ...currentByProduct.keys()]);
    const deltas = [...productIds].map(productId => ({
      productId,
      previousQuantity: Number(originalByProduct.get(productId)?.quantity || 0),
      currentQuantity: Number(currentByProduct.get(productId)?.quantity || 0)
    })).map(item => ({ ...item, delta: item.currentQuantity - item.previousQuantity }));

    // Check reductions before changing the purchase so stock never becomes negative.
    for (const item of deltas.filter(item => item.delta < 0)) {
      const inventory = await getInventoryRow(comprasStoreId, item.productId, true);
      if (!inventory || Number(inventory.quantity || 0) + item.delta < 0) {
        throw new Error('La rectificación dejaría el inventario de un producto por debajo de cero');
      }
    }

    const userName = employee.full_name || employee.username || 'Usuario';
    const auditLine = `[Rectificación ${rectification.folio} - ${new Date().toLocaleString('es-MX')} - ${userName}]`;
    const notesWithAudit = [purchaseData.notes, auditLine].filter(Boolean).join('\n');
    const { data: purchase, error: purchaseError } = await supabaseClient
      .from('purchases')
      .update({
        supplier_id: comprasSupplierId,
        purchase_date: purchaseData.purchaseDate,
        total: purchaseData.total,
        notes: notesWithAudit
      })
      .eq('id', rectification.purchaseId)
      .eq('store_id', comprasStoreId)
      .select()
      .single();

    if (purchaseError) throw purchaseError;

    for (const [productId, originalItem] of originalByProduct) {
      const currentItem = currentByProduct.get(productId);
      if (!originalItem.purchaseItemId) {
        throw new Error('No se pudo identificar un producto de la compra original');
      }
      if (!currentItem) {
        const { error } = await supabaseClient
          .from('purchase_items')
          .delete()
          .eq('id', originalItem.purchaseItemId)
          .eq('purchase_id', rectification.purchaseId);
        if (error) throw error;
        continue;
      }

      const { error } = await supabaseClient
        .from('purchase_items')
        .update({
          quantity: currentItem.quantity,
          unit_cost: currentItem.unitCost,
          subtotal: currentItem.subtotal
        })
        .eq('id', originalItem.purchaseItemId)
        .eq('purchase_id', rectification.purchaseId);
      if (error) throw error;
    }

    const newItems = cartSnapshot
      .filter(item => !originalByProduct.has(item.productId))
      .map(item => ({
        purchase_id: rectification.purchaseId,
        product_id: item.productId,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        subtotal: item.subtotal
      }));
    if (newItems.length) {
      const { error } = await supabaseClient.from('purchase_items').insert(newItems);
      if (error) throw error;
    }

    for (const item of deltas.filter(item => item.delta !== 0)) {
      await adjustInventoryQuantity(comprasStoreId, item.productId, item.delta);
      const direction = item.delta > 0 ? `+${item.delta}` : String(item.delta);
      const { error } = await supabaseClient.from('inventory_logs').insert({
        store_id: comprasStoreId,
        product_id: item.productId,
        employee_id: employee.id,
        type: 'ajuste',
        quantity: item.delta,
        description: `Rectificación compra ${rectification.folio}: ${item.previousQuantity} a ${item.currentQuantity} (${direction})`
      });
      if (error) throw error;
    }

    return { purchase, notes: notesWithAudit };
  }

  // ── Registrar compra ───────────────────────────────────────────────────────

  window.registrarCompra = async function() {
    if (!comprasSupplierId) {
      showToast('Selecciona o crea un proveedor primero', 'warning'); return;
    }
    if (comprasCart.length === 0 && !comprasRectification) {
      showToast('Agrega al menos un producto a la compra', 'warning'); return;
    }
    if (!comprasStoreId) {
      showToast('No hay tienda seleccionada. Cierra sesión y vuelve a entrar', 'error'); return;
    }

    const dateVal = document.getElementById('comprasDateInput')?.value;
    const notes   = document.getElementById('comprasNotes')?.value.trim() || null;
    const total   = comprasCart.reduce((s, i) => s + i.subtotal, 0);
    const cartSnapshot = comprasCart.map(item => ({ ...item }));
    const rectification = comprasRectification ? {
      ...comprasRectification,
      originalItems: comprasRectification.originalItems.map(item => ({ ...item }))
    } : null;

    const comprasCurrentUser = Auth.getCurrentUser();
    if (!comprasCurrentUser?.id) {
      showToast('Sesion invalida. Cierra sesion y vuelve a entrar antes de registrar la compra.', 'error');
      return;
    }

    const btn = document.getElementById('btnRegistrarCompra');
    if (btn) { btn.disabled = true; btn.textContent = rectification ? 'Guardando rectificación...' : 'Guardando...'; }

    try {
      const purchaseDate = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
      let purchase;
      let savedNotes = notes;

      if (rectification) {
        const result = await savePurchaseRectification(rectification, cartSnapshot, {
          purchaseDate,
          total,
          notes
        }, comprasCurrentUser);
        purchase = result.purchase;
        savedNotes = result.notes;
      } else {
        // 1. Insertar cabecera de compra
        const { data: newPurchase, error: purchaseError } = await supabaseClient
          .from('purchases')
          .insert({
            supplier_id: comprasSupplierId,
            store_id: comprasStoreId,
            employee_id: comprasCurrentUser.id,
            purchase_date: purchaseDate,
            total,
            notes
          })
          .select()
          .single();
        if (purchaseError) throw purchaseError;
        purchase = newPurchase;

        // 2. Insertar items
        const itemsToInsert = cartSnapshot.map(item => ({
          purchase_id: purchase.id,
          product_id: item.productId,
          quantity: item.quantity,
          unit_cost: item.unitCost,
          subtotal: item.subtotal
        }));
        const { error: itemsError } = await supabaseClient.from('purchase_items').insert(itemsToInsert);
        if (itemsError) throw itemsError;

        // 3. Actualizar inventario + log por cada item
        for (const item of cartSnapshot) {
          await incrementInventoryForPurchase(comprasStoreId, item.productId, item.quantity);
          const { error: logError } = await supabaseClient.from('inventory_logs').insert({
            store_id: comprasStoreId,
            product_id: item.productId,
            employee_id: comprasCurrentUser.id,
            type: 'compra',
            quantity: item.quantity,
            description: `Compra a ${comprasSupplierNameVal}`
          });
          if (logError) throw logError;
        }
      }

      // Invalidar caché del POS para que refleje el nuevo stock
      comprasProductsCache = await fetchComprasProducts();

      showToast(rectification ? `Compra ${rectification.folio} rectificada correctamente` : `Compra registrada correctamente — $${total.toFixed(2)}`, 'success');

      const compraTicketData = {
        id: purchase.id,
        folio: purchase.id.replace(/-/g, '').slice(-8).toUpperCase(),
        supplierId: comprasSupplierId,
        supplierName: comprasSupplierNameVal,
        storeName: comprasStoreName,
        employeeName: comprasCurrentUser.full_name || comprasCurrentUser.username || 'Usuario',
        date: purchase.purchase_date || dateVal || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        total,
        notes: savedNotes,
        items: cartSnapshot
      };
      if (rectification) {
        await loadRecentPurchaseTickets(true);
        renderPurchaseTicketsList();
      } else {
        rememberPurchaseTicket(compraTicketData);
      }

      if (printTicketOnCompra) {
        printCompraTicket(compraTicketData, true, true);

        printTicketOnCompra = false;
        const ticketBtn = document.getElementById('btnComprasTicketToggle');
        if (ticketBtn) {
          ticketBtn.style.background = '#f8f9fa';
          ticketBtn.style.color = '#334155';
          ticketBtn.style.borderColor = '#dbe4ef';
          ticketBtn.textContent = '🖨️ Imprimir Ticket';
        }
      }

      // Limpiar
      comprasCart = [];
      comprasSupplierId = null;
      comprasSupplierNameVal = '';
      renderComprasCart();
      window.clearComprasSupplier();
      if (document.getElementById('comprasNotes')) document.getElementById('comprasNotes').value = '';
      setPurchaseRectificationMode(null);

    } catch (err) {
      console.error('Error registrando compra:', err);
      showToast('Error al registrar la compra: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = comprasRectification ? 'Guardar rectificacion' : '📦 REGISTRAR COMPRA';
      }
    }
  };

  window.loadCompras = loadCompras;

});

// Auto-zoom del panel de cobro para pantallas pequeñas o con DPI alto
(function () {
  function adjustCheckoutZoom() {
    const panel = document.getElementById('posCheckoutPanel');
    if (!panel) return;

    // Resetear zoom para medir altura real
    panel.style.zoom = '1';

    const section = document.getElementById('section-sales');
    if (!section || !section.classList.contains('active')) return;

    const tabsBar = document.getElementById('posSaleTabsBar');
    const tabsH = tabsBar ? tabsBar.getBoundingClientRect().height + 8 : 48;
    const available = section.getBoundingClientRect().height - tabsH;
    const natural = panel.scrollHeight;

    if (natural > available && available > 100) {
      panel.style.zoom = Math.max(0.75, available / natural).toFixed(3);
    }
  }

  // Ejecutar cuando se activa la sección de ventas
  const observer = new MutationObserver(() => {
    const section = document.getElementById('section-sales');
    if (section && section.classList.contains('active')) {
      requestAnimationFrame(adjustCheckoutZoom);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('section-sales');
    if (section) {
      observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('resize', adjustCheckoutZoom);
    // Verificar en carga si ya está activo
    requestAnimationFrame(adjustCheckoutZoom);
  });
})();
