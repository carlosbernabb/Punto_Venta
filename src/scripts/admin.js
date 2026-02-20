// Admin dashboard script
document.addEventListener('DOMContentLoaded', async () => {
  // Check authentication
  if (!Auth.isAuthenticated()) {
    window.location.href = 'login.html';
    return;
  }

  if (!Auth.isAdmin()) {
    window.location.href = 'pos.html';
    return;
  }

  const currentUser = Auth.getCurrentUser();
  document.getElementById('userName').textContent = currentUser.full_name;

  // Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = item.dataset.section;

      navItems.forEach(nav => nav.classList.remove('active'));
      sections.forEach(sec => sec.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(`section-${sectionId}`).classList.add('active');

      updatePageTitle(sectionId);
      loadSectionData(sectionId);
    });
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await Auth.logout();
    window.location.href = 'login.html';
  });

  function updatePageTitle(section) {
    const titles = {
      overview: { title: 'Resumen General', subtitle: 'Vista general del sistema' },
      stores: { title: 'Gestión de Tiendas', subtitle: 'Administra tus tiendas y bodegas' },
      employees: { title: 'Gestión de Empleados', subtitle: 'Administra el equipo de trabajo' },
      products: { title: 'Gestión de Productos', subtitle: 'Catálogo de productos' },
      inventory: { title: 'Control de Inventario', subtitle: 'Stock por tienda' },
      sales: { title: 'Punto de Venta', subtitle: 'Caja Registradora' },
      caja: { title: 'Corte de Caja', subtitle: 'Cierre y retiro de efectivo por tienda' },
      reports: { title: 'Reportes y Análisis', subtitle: 'Estadísticas del negocio' }
    };

    const info = titles[section];
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageSubtitle').textContent = info.subtitle;
  }

  async function loadSectionData(section) {
    switch (section) {
      case 'overview': await loadOverview(); break;
      case 'stores': await loadStores(); break;
      case 'employees': await loadEmployees(); break;
      case 'products': await loadProducts(); break;
      case 'inventory': await loadInventory(); break;
      case 'sales': await loadSales(); break;
      case 'caja': await loadCorteCaja(); break;
      case 'reports': await loadReports(); break;
    }
  }

  // Load Overview
  async function loadOverview() {
    try {
      // --- Global stats ---
      const [storesRes, empRes, prodRes, salesTodayRes] = await Promise.all([
        supabaseClient.from('stores').select('*', { count: 'exact' }),
        supabaseClient.from('employees').select('*', { count: 'exact' }).eq('is_active', true),
        supabaseClient.from('products').select('*', { count: 'exact' }),
        supabaseClient.from('sales').select('total').gte('sale_date', new Date().toISOString().split('T')[0])
      ]);
      document.getElementById('totalStores').textContent = storesRes.count || 0;
      document.getElementById('totalEmployees').textContent = empRes.count || 0;
      document.getElementById('totalProducts').textContent = prodRes.count || 0;
      const todayTotal = salesTodayRes.data?.reduce((s, r) => s + parseFloat(r.total || 0), 0) || 0;
      document.getElementById('todaySales').textContent = `$${todayTotal.toFixed(2)}`;

      // --- Stock alerts (all inventory where quantity <= min_stock) ---
      const { data: lowStock } = await supabaseClient
        .from('inventory')
        .select('quantity, min_stock, product:products(name), store:stores(name, type)')
        .filter('quantity', 'lte', 'min_stock'); // will refine below

      // Actually filter in JS because lte on same-row column isn't direct
      const { data: allInv } = await supabaseClient
        .from('inventory')
        .select('quantity, min_stock, product:products(name), store:stores(name, type)');

      const alerts = (allInv || []).filter(r => r.quantity <= r.min_stock);
      const alertBanner = document.getElementById('stockAlertsBanner');
      if (alerts.length === 0) {
        alertBanner.innerHTML = '';
      } else {
        const criticals = alerts.filter(r => r.quantity === 0);
        const lows = alerts.filter(r => r.quantity > 0);
        let html = `<div style="background:#fff8e1; border:1.5px solid #ffe082; border-radius:10px; padding:12px 16px; display:flex; flex-direction:column; gap:6px;">
          <div style="font-weight:700; color:#b45309; font-size:0.85rem; letter-spacing:.5px; margin-bottom:2px;">⚠️ ALERTAS DE INVENTARIO (${alerts.length})</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px;">`;
        criticals.forEach(r => {
          html += `<span style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:6px; padding:3px 10px; font-size:0.78rem; font-weight:600;">
            🔴 SIN STOCK — <strong>${r.product?.name}</strong> en ${r.store?.name}</span>`;
        });
        lows.forEach(r => {
          html += `<span style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d; border-radius:6px; padding:3px 10px; font-size:0.78rem; font-weight:600;">
            🟡 Stock bajo (${r.quantity}/${r.min_stock}) — <strong>${r.product?.name}</strong> en ${r.store?.name}</span>`;
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

      // Fetch all sales + items + inventory for all stores at once
      const todayStr = new Date().toISOString().split('T')[0];
      const [salesRes, invRes] = await Promise.all([
        supabaseClient
          .from('sales')
          .select('id, store_id, total, payment_method, sale_date, employee:employees(full_name), items:sale_items(quantity, product:products(name))')
          .order('sale_date', { ascending: false })
          .limit(100),
        supabaseClient
          .from('inventory')
          .select('store_id, quantity, min_stock, product:products(name)')
      ]);

      const salesAll = salesRes.data || [];
      const invAll = invRes.data || [];

      const storeIcon = t => t === 'bodega' ? '🏭' : '🏪';
      const accordion = document.getElementById('storeAccordion');

      accordion.innerHTML = stores.map((store, idx) => {
        const storeSales = salesAll.filter(s => s.store_id === store.id);
        const todaySalesStore = storeSales.filter(s => s.sale_date?.startsWith(todayStr));
        const todayRevStore = todaySalesStore.reduce((sum, s) => sum + parseFloat(s.total || 0), 0);
        const storeInv = invAll.filter(i => i.store_id === store.id);
        const lowStoreInv = storeInv.filter(i => i.quantity <= i.min_stock);

        const alertBadge = lowStoreInv.length > 0
          ? `<span style="background:#fee2e2; color:#b91c1c; border-radius:20px; padding:2px 10px; font-size:0.72rem; font-weight:700; margin-left:8px;">⚠️ ${lowStoreInv.length} alertas</span>`
          : `<span style="background:#d1fae5; color:#065f46; border-radius:20px; padding:2px 10px; font-size:0.72rem; font-weight:700; margin-left:8px;">✅ Stock OK</span>`;

        const recentRows = storeSales.slice(0, 5).map(s => {
          const empName = s.employee?.full_name || 'Desconocido';
          const timeStr = new Date(s.sale_date).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
          const method = s.payment_method === 'tarjeta' ? '💳' : '💵';
          return `<div style="display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid #f3f4f6; font-size:0.82rem;">
            <span>${method} <strong>$${parseFloat(s.total).toFixed(2)}</strong> &nbsp;·&nbsp; ${empName}</span>
            <span style="color:#9ca3af; font-size:0.75rem;">${timeStr}</span>
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

        const isOpen = idx === 0; // first store open by default
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
                <div style="font-size:0.75rem; color:#6b7280; margin-top:2px;">Hoy: <strong style="color:#2d6a2d;">$${todayRevStore.toFixed(2)}</strong> · ${todaySalesStore.length} venta(s)</div>
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
            <!-- Right: inventory bars -->
            <div style="padding:14px 18px;">
              <div style="font-size:0.7rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Stock de productos</div>
              ${invRows || '<div style="color:#9ca3af; font-size:0.8rem;">Sin inventario registrado</div>'}
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
            <div class="action-btns">
              <button class="btn btn-sm btn-secondary" onclick="editStore('${store.id}')">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="deleteStore('${store.id}')">🗑️</button>
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

  // Load Employees
  async function loadEmployees() {
    try {
      const { data: employees, error } = await supabaseClient
        .from('employees')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const tbody = document.getElementById('employeesTableBody');
      if (!employees || employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No hay empleados registrados</td></tr>';
        return;
      }

      tbody.innerHTML = employees.map(emp => `
        <tr>
          <td><strong>${emp.username}</strong></td>
          <td>${emp.full_name}</td>
          <td><span class="badge ${emp.role === 'admin' ? 'badge-error' : emp.role === 'bodeguero' ? 'badge-warning' : 'badge-success'}">${emp.role}</span></td>
          <td><span class="badge ${emp.is_active ? 'badge-success' : 'badge-error'}">${emp.is_active ? 'Activo' : 'Inactivo'}</span></td>
          <td>
            <div class="action-btns">
              <button class="btn btn-sm btn-secondary" onclick="editEmployee('${emp.id}')">✏️</button>
              ${emp.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" onclick="deleteEmployee('${emp.id}')">🗑️</button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  }

  // Add/Edit Employee Handler
  const addEmployeeBtn = document.getElementById('addEmployeeBtn');
  if (addEmployeeBtn) {
    addEmployeeBtn.addEventListener('click', () => {
      openEmployeeModal();
    });
  }

  function openEmployeeModal(employee = null) {
    const isEdit = !!employee;
    const modalTitle = isEdit ? 'Editar Empleado' : 'Agregar Nuevo Empleado';
    const btnText = isEdit ? 'Guardar Cambios' : 'Agregar Empleado';

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
        organization_id: currentUser.organization_id
      };

      // Handle password update only if provided
      /* In a real scenario with proper Auth, password update is handled differently.
         Here we assume password is not stored in this table or stored plain/hashed (insecure demo).
         Since we are strictly simulating without real Supabase Auth for employees, we skip password logic here
         unless we add a password column to employees table or use Auth Admin API.
         For this demo, we just update the metadata. */

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

  // Load Products
  // Load Products
  let globalProductsList = [];
  let currentProductPriceView = 'retail';

  async function loadProducts() {
    try {
      const { data: products, error } = await supabaseClient
        .from('products')
        .select('*, brand:brands(name), category:categories(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      globalProductsList = products || [];

      // Setup price filter listener
      const filter = document.getElementById('productPriceFilter');
      if (filter) {
        const newFilter = filter.cloneNode(true);
        filter.parentNode.replaceChild(newFilter, filter);

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
        newSearch.addEventListener('input', () => renderProductsTable());
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

    tbody.innerHTML = filtered.map(product => {
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

      return `
        <tr>
          <td class="align-middle"><code>${product.barcode || 'N/A'}</code></td>
          <td class="align-middle"><strong>${product.name}</strong></td>
          <td class="align-middle">${product.brand?.name || 'Sin marca'}</td>
          <td class="align-middle"><span class="badge badge-info">${product.category?.name || 'Sin categoría'}</span></td>
          <td class="align-middle">
            <div class="d-flex flex-column" style="gap: 2px;">
                <span class="text-success" style="font-weight: bold; font-size: 1.05rem;">
                    $${formattedPrice} <small class="text-muted">(${priceLabel})</small>
                </span>
                ${currentProductPriceView !== 'buy' ? `<small class="text-muted" style="font-size: 0.8rem;">C: $${costPrice}</small>` : ''}
            </div>
          </td>
          <td class="align-middle">
             <div class="btn-group" role="group">
              <button class="btn btn-sm btn-light border" onclick="openStockDistributionModal('${product.id}', '${product.name}')" title="Distribuir Stock" style="font-size: 1.1rem;">📦</button>
              <button class="btn btn-sm btn-white border" onclick="editProduct('${product.id}')" title="Editar">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.id}')" title="Eliminar">🗑️</button>
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

      const { data: stores } = await supabaseClient
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (!stores || stores.length === 0) {
        showToast('No hay tiendas activas para asignar stock', 'warning');
        return;
      }

      const { data: inventory } = await supabaseClient
        .from('inventory')
        .select('store_id, quantity')
        .eq('product_id', productId);

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
  }

  function setupInventorySearch() {
    const searchInput = document.getElementById('inventorySearchInput');
    if (searchInput) {
      // Clonar para limpiar listeners previos
      const newDetail = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newDetail, searchInput);

      newDetail.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        renderInventoryTable(term);
      });
      // Focus
      // newDetail.focus(); // Opcional, puede molestar si carga despues
    }
  }

  async function loadInventoryStores() {
    const select = document.getElementById('inventoryStoreSelect');
    if (!select) return;

    try {
      const { data: stores } = await supabaseClient
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .order('name');

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

    } catch (e) {
      console.error('Error loading inventory stores:', e);
      select.innerHTML = '<option value="">Error al cargar tiendas</option>';
    }
  }

  function handleStoreChange(e) {
    loadInventoryTable(e.target.value);
  }

  async function loadInventoryTable(storeId) {
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
      // 1. Get all products
      const { data: products } = await supabaseClient
        .from('products')
        .select('id, name, barcode, brand:brands(name), category:categories(name)')
        .order('name');

      // 2. Get inventory for this store (including min_stock)
      const { data: inventory } = await supabaseClient
        .from('inventory')
        .select('product_id, quantity, min_stock')
        .eq('store_id', storeId);

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

    tbody.innerHTML = filtered.map(p => {
      const stock = p.current_qty;
      const minStock = p.current_min;

      const isLowStock = stock <= minStock && stock > 0;
      const isOut = stock === 0;

      let statusBadge = '<span class="badge badge-success" style="background:#28a745; color:white;">En Stock</span>';
      if (isLowStock) statusBadge = '<span class="badge badge-warning" style="background:#ffc107; color:black;">Bajo Stock</span>';
      if (isOut) statusBadge = '<span class="badge badge-danger" style="background:#dc3545; color:white;">Agotado</span>';

      return `
                <tr style="vertical-align: middle;">
                    <td>
                        <div class="font-weight-bold" style="font-size: 1rem;">${p.name}</div>
                        <small class="text-muted d-block">
                            ${p.barcode ? `Ref: ${p.barcode}` : ''} 
                            ${p.brand ? ` | ${p.brand.name}` : ''}
                        </small>
                    </td>
                    <td class="text-center">
                        <div class="input-group input-group-sm mx-auto" style="width: 140px;">
                            <input type="number" 
                                   class="form-control text-center font-weight-bold ${isOut ? 'text-danger' : 'text-primary'}" 
                                   value="${stock}" 
                                   id="stock-input-${p.id}"
                                   min="0"
                                   placeholder="Cant"
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
                                    style="font-size: 1rem; border-color: #eee;">
                        </div>
                    </td>
                    <td class="text-center">${statusBadge}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-primary shadow-sm" 
                                onclick="updateSingleInventory('${globalCurrentStoreId}', '${p.id}', document.getElementById('stock-input-${p.id}').value, document.getElementById('min-stock-input-${p.id}').value)">
                            <small>💾 Guardar</small>
                        </button>
                    </td>
                </tr>
            `;
    }).join('');
  }

  // Hacer disponible globalmente
  window.updateSingleInventory = async (storeId, productId, newQtyRaw, newMinRaw) => {
    try {
      const qty = parseInt(newQtyRaw);
      const minStock = parseInt(newMinRaw);

      if (isNaN(qty) || qty < 0) {
        showToast('Cantidad inválida', 'warning');
        return;
      }
      if (isNaN(minStock) || minStock < 0) {
        showToast('Stock mínimo inválido', 'warning');
        return;
      }

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

      showToast('Stock actualizado', 'success');

      // Actualizar cache local para que no revierta al filtrar
      const prod = globalInventoryProducts.find(p => p.id === productId);
      if (prod) {
        prod.current_qty = qty;
        prod.current_min = minStock;
      }

      // Re-renderizar para actualizar badges si cambiaron
      const currentSearch = document.getElementById('inventorySearchInput')?.value.toLowerCase().trim() || '';
      renderInventoryTable(currentSearch);

    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, 'error');
    }
  };

  // Add/Edit Product Handler
  const addProductBtn = document.getElementById('addProductBtn');
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

    // Current brand name (if editing)
    const currentBrandName = product?.brand?.name || '';

    const modalHTML = `
        < div class="modal active" >
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
                      ${brandsRes.data?.map(b => `<option value="${b.name}">`).join('')}
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
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label text-sm">Precio de Compra</label>
                    <input type="number" step="0.01" class="form-control" name="cost_price" value="${product?.cost_price || ''}" placeholder="$0.00" required>
                  </div>
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
      </div >
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
          name: formData.get('name'),
          barcode: formData.get('barcode') || null,
          brand_id: brandId,
          category_id: formData.get('category_id') || null,
          // New Price Fields
          cost_price: parseFloat(formData.get('cost_price') || 0),
          retail_price: parseFloat(formData.get('retail_price') || 0),
          wholesale_price: parseFloat(formData.get('wholesale_price') || 0),
          distributor_price: parseFloat(formData.get('distributor_price') || 0),

          // Map unit_price to retail_price to satisfy DB constraint
          unit_price: parseFloat(formData.get('retail_price') || 0),

          description: formData.get('description') || null,
          organization_id: currentUser.organization_id
        };

        let error;
        if (productId) {
          // Update
          const result = await supabaseClient
            .from('products')
            .update(productData)
            .eq('id', productId);
          error = result.error;
        } else {
          // Create
          const result = await supabaseClient
            .from('products')
            .insert(productData);
          error = result.error;
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

  // Load initial data
  await loadOverview();
});

// Global helper functions
function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `alert alert - ${type} `;
  // Add styles dynamically or use existing css
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.padding = '1rem';
  toast.style.borderRadius = 'var(--radius-md)';
  toast.style.background = 'white';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  toast.style.zIndex = '10000';
  toast.innerHTML = message;

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
  if (!confirm('¿Estás seguro de que deseas eliminar esta tienda? Esta acción no se puede deshacer.')) return;

  try {
    const { error } = await supabaseClient
      .from('stores')
      .delete()
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
  try {
    const { data, error } = await supabaseClient
      .from('employees')
      .select('*')
      .eq('id', id)
      .single();

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
  if (!confirm('¿Estás seguro de que deseas eliminar este empleado?')) return;

  try {
    const { error } = await supabaseClient
      .from('employees')
      .delete()
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
    const { data, error } = await supabaseClient
      .from('products')
      .select('*, brand:brands(name)')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (window.openProductModal) {
      window.openProductModal(data);
    }
  } catch (error) {
    console.error('Error fetching product:', error);
    showToast('Error al cargar datos del producto', 'error');
  }
}

async function deleteProduct(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este producto?')) return;

  try {
    const { error } = await supabaseClient
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;

    showToast('Producto eliminado correctamente', 'success');
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
  const { data: stores } = await supabaseClient.from('stores').select('id, name, type').eq('is_active', true).order('name');
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

  // Find last cash_registers cut for this store (closed ones)
  const { data: lastCuts } = await supabaseClient
    .from('cash_registers')
    .select('*')
    .eq('store_id', _cajaCurrentStoreId)
    .eq('is_closed', true)
    .order('closed_at', { ascending: false })
    .limit(1);

  const lastCut = lastCuts?.[0] || null;
  _cajaSinceDate = lastCut?.closed_at || null;

  // Show last cut info
  const lastCutEl = document.getElementById('cajaLastCut');
  if (lastCut) {
    const closedAt = new Date(lastCut.closed_at).toLocaleString('es-MX');
    lastCutEl.innerHTML = `✅ Último corte: <strong>${closedAt}</strong> — Cerrado con <strong>$${parseFloat(lastCut.closing_amount || 0).toFixed(2)}</strong> | Dejado en caja: <strong>$${parseFloat(lastCut.opening_amount || 0).toFixed(2)}</strong>`;
    lastCutEl.style.display = 'block';
  } else {
    lastCutEl.innerHTML = 'ℹ️ No hay cortes previos registrados para esta tienda.';
    lastCutEl.style.display = 'block';
  }

  // Query sales since last cut (or all if no last cut)
  let salesQuery = supabaseClient
    .from('sales')
    .select('total, payment_method')
    .eq('store_id', _cajaCurrentStoreId);

  if (_cajaSinceDate) salesQuery = salesQuery.gt('sale_date', _cajaSinceDate);

  const { data: salesData } = await salesQuery;

  _cajaEfectivoTotal = (salesData || [])
    .filter(s => s.payment_method === 'efectivo')
    .reduce((sum, s) => sum + parseFloat(s.total || 0), 0);

  // Add the opening amount (fondo) from the last cut, if any
  if (lastCut) {
    _cajaEfectivoTotal += parseFloat(lastCut.opening_amount || 0);
  }

  document.getElementById('cajaEfectivoTotal').value = _cajaEfectivoTotal.toFixed(2);
  document.getElementById('cajaTarjetaTotal').textContent = `$${_cajaTarjetaTotal.toFixed(2)}`;

  // Pre-fill defaults: Withdraw = 0, Leave = Expected
  document.getElementById('cajaClosingAmount').value = ''; // Empty or 0 initially (Withdraw)
  document.getElementById('cajaLeaveAmount').value = _cajaEfectivoTotal.toFixed(2); // Default: Leave everything

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
      const dateStr = new Date(h.opened_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const diff = parseFloat(h.difference || 0);
      const diffColor = diff < 0 ? '#ef4444' : diff > 0 ? '#16a34a' : '#6b7280';
      const status = h.is_closed ? '🔒 Cerrado' : '🔓 Abierto';
      return `<div style="display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid #f3f4f6; font-size:0.82rem;">
        <span style="color:#374151;">${dateStr} &nbsp; <span style="font-size:0.72rem; color:#9ca3af;">${status}</span></span>
        <span>Cierre: <strong>$${parseFloat(h.closing_amount || 0).toFixed(2)}</strong>
          &nbsp;·&nbsp; Deja: <strong>$${parseFloat(h.opening_amount || 0).toFixed(2)}</strong>
          &nbsp;·&nbsp; Dif: <strong style="color:${diffColor}">$${diff.toFixed(2)}</strong>
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

  const expected = parseFloat(expectedInput.value || 0);
  let withdraw = parseFloat(withdrawInput.value || 0);

  // If user is typing in Withdraw (Left), update Leave (Right)
  if (source === 'withdraw') {
    const calculatedLeave = expected - withdraw;
    leaveInput.value = calculatedLeave.toFixed(2);
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
    const currentLeave = parseFloat(leaveInput.value || 0);
    const newExpected = withdraw + currentLeave;
    expectedInput.value = newExpected.toFixed(2);
    // Also likely want to ensure Withdraw is correct? 
    // If they typed 150 in Leave, and Withdraw is 0. Expected becomes 150.
  }

  // Reread leave because it might have been updated above or manually edited
  let leave = parseFloat(leaveInput.value || 0);

  // Implied Counted = Withdraw + Leave
  // Difference = Counted - Expected
  // (Withdraw + Leave) - Expected
  const counted = withdraw + leave;
  const diff = counted - expected;

  // Update Summary UI
  // "Esperado" is already in the editable input
  // "Diferencia"
  document.getElementById('cajaDiff').textContent = `${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}`;
  document.getElementById('cajaDiff').style.color = Math.abs(diff) < 0.01 ? '#6b7280' : (diff < 0 ? '#ef4444' : '#16a34a');

  // "A Retirar" (Visualization only, redundancy with input but good for summary)
  // In this logic, A Retirar IS the withdraw input.
  // The summary box "A Retirar" was calculated as Closing - Leave.
  // Now Closing IS Withdraw + Leave. So (Withdraw + Leave) - Leave = Withdraw.
  document.getElementById('cajaToRetire').textContent = `$${withdraw.toFixed(2)}`;
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

window.registrarCorte = async function () {
  if (!_cajaCurrentStoreId) { showToast('Selecciona una tienda primero', 'warning'); return; }

  const withdraw = parseFloat(document.getElementById('cajaClosingAmount').value || 0);
  const leave = parseFloat(document.getElementById('cajaLeaveAmount').value || 0);
  const expected = parseFloat(document.getElementById('cajaEfectivoTotal').value || 0);

  if (withdraw < 0) { showToast('El retiro no puede ser negativo', 'warning'); return; }
  // Leave can theoretically be whatever, but usually >= 0

  // Calculated actual money counted
  const closing = withdraw + leave;
  const difference = closing - expected;

  const confirmMsg = `Confirmar corte:\n\n💵 En Caja (Calc): $${closing.toFixed(2)}\n📊 Esperado:    $${expected.toFixed(2)}\n❕ Diferencia:  $${difference.toFixed(2)}\n\n� Se retira:   $${withdraw.toFixed(2)}\n� Se deja:     $${leave.toFixed(2)}\n\n¿Registrar corte?`;
  if (!confirm(confirmMsg)) return;

  const currentUser = Auth.getCurrentUser();
  let employeeId = null;
  if (currentUser?.id) {
    const { data: emp } = await supabaseClient.from('employees').select('id').eq('auth_user_id', currentUser.id).maybeSingle();
    employeeId = emp?.id || null;
  }

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

  showToast(`✅ Corte registrado — Retiro: $${(closing - leave).toFixed(2)} | Queda en caja: $${leave.toFixed(2)}`, 'success');

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

let isPOSInitialized = false;

async function loadSales() {
  // This is now the POS initialization
  if (!isPOSInitialized) {
    setupPOSListeners();
    isPOSInitialized = true;
  }
  await loadPOSStores();
  updatePOSDate();

  // Focus search input
  setTimeout(() => {
    document.getElementById('posSearchProduct').focus();
  }, 500);
}

function updatePOSDate() {
  const dateEl = document.getElementById('posDateDisplay');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
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

function setupPOSListeners() {
  const searchInput = document.getElementById('posSearchProduct');
  const payInput = document.getElementById('posAmountPaid');
  const processBtn = document.getElementById('btnProcessSale');
  const cancelBtn = document.getElementById('btnCancelSale');

  // Search Product
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();

      if (query.length < 2) {
        document.getElementById('posSearchResults').style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(() => searchProduct(query), 300);
    });

    // Handle Enter key for exact match (scanner)
    searchInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = e.target.value.trim();
        if (query) await searchProduct(query, true);
      }
    });
  }

  // Calculate Change
  if (payInput) {
    payInput.addEventListener('input', updateChange);
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
    }
    if (e.key === 'F2') {
      e.preventDefault();
      if (!document.getElementById('btnProcessSale').disabled) {
        processSale();
      }
    }
    if (e.key === 'Escape') {
      // If results open, close them
      const results = document.getElementById('posSearchResults');
      if (results && results.style.display !== 'none') {
        results.style.display = 'none';
        return;
      }
      // Else, maybe cancel?
    }
  });

  // Close search results on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pos-search-bar')) {
      document.getElementById('posSearchResults').style.display = 'none';
    }
  });
}

async function searchProduct(query, isEnter = false) {
  if (!posCurrentStoreId) {
    showToast('Selecciona una tienda primero', 'error');
    return;
  }

  try {
    // First, find brand IDs that match the query (brands is a separate table)
    const { data: matchingBrands } = await supabaseClient
      .from('brands')
      .select('id')
      .ilike('name', `%${query}%`);

    const brandIds = matchingBrands?.map(b => b.id) || [];

    // Build OR filter: by barcode, name, or brand
    let orFilter = `barcode.eq.${query},name.ilike.%${query}%`;
    if (brandIds.length > 0) {
      orFilter += `,brand_id.in.(${brandIds.join(',')})`;
    }

    const { data: products, error } = await supabaseClient
      .from('products')
      .select('*, brand:brands(name)')
      .or(orFilter)
      .limit(20);

    if (error) throw error;

    const resultsContainer = document.getElementById('posSearchResults');
    resultsContainer.innerHTML = '';

    if (!products || products.length === 0) {
      if (!isEnter) {
        resultsContainer.style.display = 'none'; // Don't show empty box
      } else {
        showToast('Producto no encontrado', 'error');
      }
      return;
    }

    // Direct match logic for scanners (if only 1 result and it matches barcode exact)
    if (isEnter && products.length === 1) {
      addToCart(products[0]);
      document.getElementById('posSearchProduct').value = '';
      resultsContainer.style.display = 'none';
      return;
    }

    // Also if barcode matches exactly one of the results
    const exactMatch = products.find(p => p.barcode === query);
    if (isEnter && exactMatch) {
      addToCart(exactMatch);
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
      box-shadow: 0 8px 24px rgba(0,0,0,0.1); overflow: hidden; background: white;
    `;

  } catch (error) {
    console.error('Search error:', error);
  }
}

function addToCart(product) {
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
  currentPriceMode = mode;

  // Update price of every item in cart
  currentCart.forEach(item => {
    if (item.prices) {
      item.price = item.prices[mode] || item.prices.retail;
    }
  });

  // Update button styles
  ['retail', 'wholesale', 'distributor'].forEach(m => {
    const btn = document.getElementById(`priceMode_${m}`);
    if (btn) {
      btn.style.background = m === mode ? 'var(--primary, #2d6a2d)' : 'white';
      btn.style.color = m === mode ? 'white' : '#555';
      btn.style.borderColor = 'var(--primary, #2d6a2d)';
    }
  });

  renderCart();
};

function updateQuantity(index, newQty) {
  if (newQty < 1) {
    if (confirm('¿Eliminar producto del carrito?')) {
      removeFromCart(index);
    } else {
      renderCart(); // Reset input
    }
    return;
  }
  currentCart[index].quantity = parseInt(newQty);
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
                       value="${item.quantity}" min="1"
                       onchange="window.updatePOSQuantity(${index}, this.value)"
                       onclick="this.select()">
            </td>
            <td>
                <div style="font-weight: 500; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px;">${item.name}</div>
            </td>
            <td class="text-right" style="cursor: pointer;" title="Clic para editar precio"
                onclick="window.editPOSPrice(this, ${index})">
                <span style="color: #555; border-bottom: 1px dashed #bbb;">$${item.price.toFixed(2)}</span>
            </td>
            <td class="text-right pos-total-cell">$${(item.price * item.quantity).toFixed(2)}</td>
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

  document.getElementById('posSubtotal').textContent = `$${subtotal.toFixed(2)}`;
  document.getElementById('posTotal').textContent = `$${total.toFixed(2)}`;

  // Show/hide discount row in header
  const discRow = document.getElementById('posDiscountRow');
  const discEl = document.getElementById('posDiscount');
  if (discountAmount > 0 && discRow && discEl) {
    discEl.textContent = `-$${discountAmount.toFixed(2)}`;
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
}

// --- Payment method toggle ---
function selectPayment(method) {
  document.getElementById('payCash').checked = method === 'efectivo';
  document.getElementById('payCard').checked = method === 'tarjeta';
  const lblCash = document.getElementById('lblCash');
  const lblCard = document.getElementById('lblCard');
  if (lblCash) {
    lblCash.style.borderColor = method === 'efectivo' ? '#2d6a2d' : '#ccc';
    lblCash.style.color = method === 'efectivo' ? '#2d6a2d' : '#666';
    lblCash.style.background = method === 'efectivo' ? '#f0faf0' : 'white';
  }
  if (lblCard) {
    lblCard.style.borderColor = method === 'tarjeta' ? '#2d6a2d' : '#ccc';
    lblCard.style.color = method === 'tarjeta' ? '#2d6a2d' : '#666';
    lblCard.style.background = method === 'tarjeta' ? '#f0faf0' : 'white';
  }
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
}

// --- Print Ticket ---
function printTicket() {
  if (currentCart.length === 0) {
    showToast('El carrito está vacío', 'warning');
    return;
  }

  const storeName = document.getElementById('posStoreTitle')?.textContent || 'Tienda';
  const now = new Date();
  const fecha = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const hora = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  const subtotal = currentCart.reduce((s, i) => s + i.price * i.quantity, 0);
  let discountAmount = 0;
  if (currentDiscount.value > 0) {
    discountAmount = currentDiscount.type === 'percent'
      ? subtotal * (currentDiscount.value / 100)
      : Math.min(currentDiscount.value, subtotal);
  }
  const total = Math.max(0, subtotal - discountAmount);
  const paid = parseFloat(document.getElementById('posAmountPaid')?.value || 0);
  const change = Math.max(0, paid - total);
  const payMethod = document.getElementById('payCash')?.checked ? 'Efectivo' : 'Tarjeta';

  const priceLabel = { retail: 'Menudeo', wholesale: 'Mayoreo', distributor: 'Distribuidor' }[currentPriceMode] || 'Menudeo';

  const rows = currentCart.map(item => `
    <tr>
      <td style="padding:4px 2px;">${item.name}</td>
      <td style="text-align:center; padding:4px 2px;">${item.quantity}</td>
      <td style="text-align:right; padding:4px 2px;">$${item.price.toFixed(2)}</td>
      <td style="text-align:right; padding:4px 2px;"><strong>$${(item.price * item.quantity).toFixed(2)}</strong></td>
    </tr>
  `).join('');

  const discRow = discountAmount > 0
    ? `<tr><td colspan="3" style="text-align:right; padding:3px 2px; color:#888;">Descuento</td>
        <td style="text-align:right; color:#e06000; padding:3px 2px;">-$${discountAmount.toFixed(2)}</td></tr>`
    : '';

  const win = window.open('', '_blank', 'width=400,height=620');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Ticket - ${storeName}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: 'Courier New', monospace; font-size: 13px; color: #111; padding: 20px 16px; max-width: 320px; margin: 0 auto; }
      h2 { font-size: 1.1rem; text-align: center; margin-bottom: 2px; }
      .sub { text-align: center; color: #555; font-size: 0.85rem; margin-bottom: 12px; }
      hr { border: none; border-top: 1px dashed #aaa; margin: 10px 0; }
      table { width: 100%; border-collapse: collapse; }
      th { font-size: 0.75rem; color: #666; padding: 2px; text-transform: uppercase; }
      .total-row td { font-weight: bold; font-size: 1.1rem; padding-top: 6px; }
      .footer { text-align: center; margin-top: 16px; color: #777; font-size: 0.78rem; }
    </style>
  </head><body>
    <h2>${storeName}</h2>
    <div class="sub">${fecha} &nbsp;·&nbsp; ${hora}</div>
    <div class="sub">Tipo de precio: ${priceLabel}</div>
    <hr>
    <table>
      <thead><tr>
        <th style="text-align:left;">Descripción</th>
        <th>Cant.</th>
        <th style="text-align:right;">P.U.</th>
        <th style="text-align:right;">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr>
    <table>
      <tr><td colspan="3" style="text-align:right; padding:3px 2px;">Subtotal</td><td style="text-align:right; padding:3px 2px;">$${subtotal.toFixed(2)}</td></tr>
      ${discRow}
      <tr class="total-row"><td colspan="3" style="text-align:right; padding:4px 2px;">TOTAL</td><td style="text-align:right; padding:4px 2px;">$${total.toFixed(2)}</td></tr>
      <tr><td colspan="3" style="text-align:right; padding:3px 2px; color:#555;">${payMethod} recibido</td><td style="text-align:right; padding:3px 2px;">$${paid.toFixed(2)}</td></tr>
      <tr><td colspan="3" style="text-align:right; padding:3px 2px; color:#555;">Cambio</td><td style="text-align:right; padding:3px 2px; color: #2d6a2d; font-weight:bold;">$${change.toFixed(2)}</td></tr>
    </table>
    <hr>
    <div class="footer">¡Gracias por su compra!<br>Naturalezam</div>
    <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
  </body></html>`);
  win.document.close();
}

function updateChange() {
  const totalStr = document.getElementById('posTotal').textContent.replace('$', '');
  const total = parseFloat(totalStr);
  const paid = parseFloat(document.getElementById('posAmountPaid').value || 0);
  const changeEl = document.getElementById('posChange');

  if (paid >= total && total > 0) {
    changeEl.textContent = `$${(paid - total).toFixed(2)}`;
    changeEl.style.color = '#2d6a2d';
    document.getElementById('btnProcessSale').disabled = false;
    document.getElementById('btnProcessSale').style.opacity = '1';
  } else {
    changeEl.textContent = '$0.00';
    changeEl.style.color = '#888';
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
  // Reset price mode to retail
  if (typeof setPriceMode === 'function') setPriceMode('retail');
  else currentPriceMode = 'retail';
  renderCart();
  document.getElementById('posSearchProduct').focus();
}

async function processSale() {
  if (currentCart.length === 0) return;
  if (!posCurrentStoreId) {
    showToast('Error: Tienda no seleccionada', 'error');
    return;
  }

  // Read the already-calculated (discounted) total from the DOM
  const totalStr = document.getElementById('posTotal').textContent.replace('$', '').trim();
  const total = parseFloat(totalStr);
  const paid = parseFloat(document.getElementById('posAmountPaid').value || 0);

  if (isNaN(total) || total <= 0) {
    showToast('El carrito está vacío', 'warning');
    return;
  }

  if (paid < total) {
    showToast(`Monto insuficiente. Faltan $${(total - paid).toFixed(2)}`, 'error');
    document.getElementById('posAmountPaid').focus();
    return;
  }

  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'efectivo';
  const currentUser = Auth.getCurrentUser();

  const processBtn = document.getElementById('btnProcessSale');
  processBtn.disabled = true;
  processBtn.textContent = '⏳ Procesando...';

  try {
    // 1. Resolve employee_id: look up real employee row by auth_user_id
    let employeeId = null;
    if (currentUser?.id) {
      const { data: empRow } = await supabaseClient
        .from('employees')
        .select('id')
        .eq('auth_user_id', currentUser.id)
        .maybeSingle();
      employeeId = empRow?.id || null;
    }

    // 2. Insert sale (only valid columns: store_id, employee_id, total, payment_method, sale_date)
    const { data: sale, error: saleError } = await supabaseClient
      .from('sales')
      .insert({
        store_id: posCurrentStoreId,
        employee_id: employeeId,
        total: total,
        payment_method: paymentMethod,
        sale_date: new Date().toISOString()
      })
      .select()
      .single();

    if (saleError) throw saleError;

    // 3. Insert sale items
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

    // 4. Deduct inventory for each item in this store
    for (const item of currentCart) {
      const { error: invError } = await supabaseClient.rpc('decrement_inventory', {
        p_product_id: item.id,
        p_store_id: posCurrentStoreId,
        p_qty: item.quantity
      });

      // If RPC doesn't exist, fall back to manual UPDATE
      if (invError) {
        // Fetch current quantity first
        const { data: invRow } = await supabaseClient
          .from('inventory')
          .select('id, quantity')
          .eq('product_id', item.id)
          .eq('store_id', posCurrentStoreId)
          .maybeSingle();

        if (invRow) {
          await supabaseClient
            .from('inventory')
            .update({
              quantity: Math.max(0, (invRow.quantity || 0) - item.quantity),
              updated_at: new Date().toISOString()
            })
            .eq('id', invRow.id);
        }
      }
    }

    // 5. Success!
    showToast(`✅ Venta registrada — Total: $${total.toFixed(2)} | Cambio: $${(paid - total).toFixed(2)}`, 'success');

    // Print ticket if toggle is ON
    if (printTicketOnSale) {
      printTicket();
      printTicketOnSale = false;
      const tBtn = document.getElementById('btnTicketToggle');
      if (tBtn) {
        tBtn.style.background = '#f8f9fa';
        tBtn.style.color = '#666';
        tBtn.style.borderColor = '#ddd';
        tBtn.textContent = '🖨️ Imprimir Ticket';
      }
    }

    // 6. Reset POS state
    currentCart = [];
    currentDiscount = { type: 'percent', value: 0 };
    const dInp = document.getElementById('posDiscountInput');
    if (dInp) dInp.value = '';
    document.getElementById('posAmountPaid').value = '';
    if (typeof setPriceMode === 'function') setPriceMode('retail');
    renderCart();
    processBtn.textContent = '✅ COBRAR (F2)';
    processBtn.style.opacity = '0.45';

  } catch (error) {
    console.error('Sale error:', error);
    showToast('Error al procesar venta: ' + error.message, 'error');
    processBtn.disabled = false;
    processBtn.textContent = '⚠️ Reintentar';
  }
}

// NOTE: loadInventory is defined inside the DOMContentLoaded scope above
async function loadReports() {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    // Sales by store (TODAY)
    const { data: salesByStore } = await supabaseClient
      .from('sales')
      .select('store_id, total, store:stores(name)')
      .gte('sale_date', todayStr);

    // Aggregate by store
    const storeMap = {};
    if (salesByStore) {
      salesByStore.forEach(s => {
        const name = s.store?.name || 'Sin tienda';
        storeMap[name] = (storeMap[name] || 0) + parseFloat(s.total || 0);
      });
    }

    // Top products (TODAY - approximate via sales filtering)
    // Calculating top products for a specific day via sale_items requires joining sales.
    // However, Supabase simple join doesn't easily filter parent on child query property without complex embedding.
    // For simplicity/performance on this view, we'll fetch today's sales IDs first.

    // Get sales IDs for today
    const { data: todaysSales } = await supabaseClient
      .from('sales')
      .select('id')
      .gte('sale_date', todayStr);

    const salesIds = todaysSales?.map(s => s.id) || [];

    let topItems = [];
    if (salesIds.length > 0) {
      const { data: items } = await supabaseClient
        .from('sale_items')
        .select('product_id, quantity, product:products(name)')
        .in('sale_id', salesIds);
      topItems = items || [];
    }

    const productMap = {};
    if (topItems) {
      topItems.forEach(item => {
        const name = item.product?.name || 'Desconocido';
        productMap[name] = (productMap[name] || 0) + item.quantity;
      });
    }

    // Sort and take top 10
    const topProductsSorted = Object.entries(productMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Update Section Title to reflect "Today"
    document.getElementById('pageSubtitle').textContent = `Estadísticas de Hoy (${new Date().toLocaleDateString()})`;

    // Render top products
    const topProductsEl = document.getElementById('topProducts');
    if (topProductsEl) {
      if (topProductsSorted.length === 0) {
        topProductsEl.innerHTML = '<p class="text-muted">No hay ventas registradas hoy.</p>';
      } else {
        topProductsEl.innerHTML = topProductsSorted.map(([name, qty], i) => `
          <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
            <div>
              <span class="badge badge-info mr-2">#${i + 1}</span>
              <strong>${name}</strong>
            </div>
            <span class="badge badge-success">${qty} uds.</span>
          </div>
        `).join('');
      }
    }

    // Render sales by store
    const storeEntries = Object.entries(storeMap).sort((a, b) => b[1] - a[1]);
    const chartEl = document.getElementById('salesByStoreChart');
    if (chartEl) {
      const parent = chartEl.parentElement;
      parent.innerHTML = '';
      if (storeEntries.length === 0) {
        parent.innerHTML = '<p class="text-muted">No hay datos de ventas por tienda aún.</p>';
      } else {
        const maxVal = Math.max(...storeEntries.map(e => e[1]));
        parent.innerHTML = storeEntries.map(([name, total]) => {
          const pct = maxVal > 0 ? (total / maxVal * 100).toFixed(1) : 0;
          return `
            <div class="mb-3">
              <div class="d-flex justify-content-between mb-1">
                <span><strong>${name}</strong></span>
                <span class="text-success font-weight-bold">$${total.toFixed(2)}</span>
              </div>
              <div style="background:#eee; border-radius:4px; height:12px;">
                <div style="background:var(--primary); width:${pct}%; height:100%; border-radius:4px; transition: width 0.5s;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

  } catch (e) {
    console.error('Error loading reports:', e);
  }
}
