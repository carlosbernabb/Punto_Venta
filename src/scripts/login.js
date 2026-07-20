// Login page script
// Flujo en dos pasos:
//   1. Usuario y contraseña.
//   2. Selección de tienda — solo para administradores o empleados sin
//      tienda asignada. Si el empleado tiene tienda asignada, entra directo.
let selectedStore = null;
let stores = [];
let loggedUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== LOGIN PAGE LOADED ===');
    console.log('Supabase URL:', SUPABASE_URL);
    console.log('Default Org ID:', DEFAULT_ORG_ID);
    console.log('Supabase Client:', typeof supabaseClient);

    // Check if already logged in
    if (Auth.isAuthenticated()) {
        const user = Auth.getCurrentUser();
        if (localStorage.getItem('selectedStore')) {
            console.log('User already authenticated, redirecting...');
            navigateToHome();
            return;
        }
        // Sesión iniciada pero sin tienda registrada: resolverla de nuevo
        console.log('Authenticated without store, resolving store...');
        loggedUser = user;
        const activeStores = await loadStores();
        if (user.role !== 'admin' && user.store_id) {
            const assignedStore = activeStores.find(s => s.id === user.store_id);
            if (assignedStore) {
                localStorage.setItem('selectedStore', JSON.stringify(assignedStore));
                navigateToHome();
                return;
            }
        }
        if (activeStores.length === 1) {
            localStorage.setItem('selectedStore', JSON.stringify(activeStores[0]));
            navigateToHome();
            return;
        }
        if (activeStores.length > 0) {
            showStoreSelectStep();
        }
    }

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Back to login (logout partial session and show credentials form again)
    const backBtn = document.getElementById('backToLoginBtn');
    if (backBtn) {
        backBtn.addEventListener('click', async () => {
            await Auth.logout();
            loggedUser = null;
            selectedStore = null;
            showLoginStep();
        });
    }
});

async function loadStores() {
    const container = document.getElementById('storesContainer');

    try {
        console.log('Fetching stores from Supabase...');

        const { data: storesData, error } = await supabaseClient
            .from('stores')
            .select('*')
            .eq('organization_id', DEFAULT_ORG_ID)
            .eq('is_active', true)
            .order('type', { ascending: false })
            .order('name');

        if (error) {
            console.error('Supabase error:', error);
            throw error;
        }

        if (!storesData || storesData.length === 0) {
            console.warn('No stores found');
            container.innerHTML = `
        <div class="text-center">
          <p class="text-muted-white">No hay tiendas disponibles</p>
        </div>
      `;
            return [];
        }

        console.log(`Found ${storesData.length} stores`);
        stores = storesData;
        return stores;
    } catch (error) {
        console.error('Error loading stores:', error);
        container.innerHTML = `
      <div class="text-center">
        <p class="text-muted-white">Error al cargar tiendas</p>
        <p class="text-muted-white" style="font-size: 12px;">${error.message}</p>
      </div>
    `;
        return [];
    }
}

function displayStores(stores) {
    const container = document.getElementById('storesContainer');
    console.log('Displaying stores:', stores.length);

    container.innerHTML = stores.map(store => `
    <div class="store-card-left ${selectedStore?.id === store.id ? 'selected' : ''}" data-store-id="${store.id}">
      <div class="store-card-icon-left">
        ${store.type === 'bodega' ? '📦' : '🏪'}
      </div>
      <div class="store-card-content-left">
        <div class="store-card-name-left">${store.name}</div>
        <div class="store-card-address-left">${store.address}</div>
      </div>
      <div class="store-card-badge-left">
        ${store.type === 'bodega' ? 'Bodega' : 'Tienda'}
      </div>
    </div>
  `).join('');

    // Add click handlers
    document.querySelectorAll('.store-card-left').forEach(card => {
        card.addEventListener('click', () => {
            const storeId = card.dataset.storeId;
            const store = stores.find(s => s.id === storeId);
            console.log('Store selected:', store.name);
            enterStore(store);
        });
    });
}

// Step 1 UI: credentials form
function showLoginStep() {
    document.getElementById('loginFormStep').style.display = 'block';
    document.getElementById('storeSelectStep').style.display = 'none';
    document.getElementById('storesSection').style.display = 'none';
    setLoading(false);
    const passwordInput = document.getElementById('password');
    if (passwordInput) passwordInput.value = '';
}

// Step 2 UI: store selection
function showStoreSelectStep() {
    document.getElementById('loginFormStep').style.display = 'none';
    document.getElementById('storeSelectStep').style.display = 'block';
    document.getElementById('storesSection').style.display = 'block';

    const greeting = document.getElementById('storeSelectGreeting');
    if (greeting && loggedUser) {
        greeting.textContent = `Hola ${loggedUser.full_name || loggedUser.username}, selecciona tu tienda`;
    }

    displayStores(stores);
}

// Finalize login with the given store
function enterStore(store) {
    selectedStore = store;
    localStorage.setItem('selectedStore', JSON.stringify(store));
    showAlert('¡Inicio de sesión exitoso!', 'success');
    setTimeout(() => {
        navigateToHome();
    }, 400);
}

async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        showAlert('Por favor completa todos los campos', 'error');
        return;
    }

    setLoading(true);

    try {
        console.log('Attempting login for user:', username);
        const user = await Auth.login(username, password);
        console.log('Login successful:', user);
        loggedUser = user;

        const activeStores = await loadStores();

        // Empleado con tienda asignada: entra directo a esa tienda
        if (user.role !== 'admin' && user.store_id) {
            const assignedStore = activeStores.find(s => s.id === user.store_id);
            if (assignedStore) {
                console.log('Assigned store found, entering directly:', assignedStore.name);
                enterStore(assignedStore);
                return;
            }
            console.warn('Assigned store not found or inactive, falling back to selection');
        }

        if (activeStores.length === 0) {
            await Auth.logout();
            loggedUser = null;
            showAlert('No hay tiendas activas disponibles. Contacta al administrador.', 'error');
            setLoading(false);
            return;
        }

        // Una sola tienda disponible: no hay nada que elegir
        if (activeStores.length === 1) {
            enterStore(activeStores[0]);
            return;
        }

        // Admin o empleado con acceso a varias tiendas: paso 2, elegir tienda
        showStoreSelectStep();
    } catch (error) {
        console.error('Login failed:', error);
        showAlert(error.message || 'Error al iniciar sesión. Verifica tus credenciales.', 'error');
        setLoading(false);
    }
}

function setLoading(loading) {
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = document.getElementById('loginBtnText');
    const loginBtnSpinner = document.getElementById('loginBtnSpinner');

    loginBtn.disabled = loading;
    if (loading) {
        loginBtnText.style.display = 'none';
        loginBtnSpinner.style.display = 'inline-block';
    } else {
        loginBtnText.style.display = 'inline';
        loginBtnSpinner.style.display = 'none';
    }
}

function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    alertContainer.innerHTML = `
    <div class="alert alert-${type}">
      <span>${message}</span>
    </div>
  `;

    setTimeout(() => {
        alertContainer.innerHTML = '';
    }, 5000);
}


function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '🔒'; // Change icon to lock or hidden eye
    } else {
        input.type = 'password';
        button.textContent = '👁️'; // Change icon to eye
    }
}

// Make function global
window.togglePasswordVisibility = togglePasswordVisibility;

function navigateToHome() {
    window.location.href = 'admin-dashboard.html';
}
