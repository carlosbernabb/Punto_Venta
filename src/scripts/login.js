// Login page script
let selectedStore = null;
let stores = [];

document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== LOGIN PAGE LOADED ===');
    console.log('Supabase URL:', SUPABASE_URL);
    console.log('Default Org ID:', DEFAULT_ORG_ID);
    console.log('Supabase Client:', typeof supabaseClient);

    // Check if already logged in
    if (Auth.isAuthenticated()) {
        console.log('User already authenticated, redirecting...');
        navigateToHome();
        return;
    }

    // Load stores immediately
    console.log('Loading stores...');
    await loadStores();

    // Change store button
    const changeBtn = document.getElementById('changeStoreBtn');
    if (changeBtn) {
        changeBtn.addEventListener('click', () => {
            selectedStore = null;
            showDisabledMessage();
            displayStores(stores);
        });
    }

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
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

        console.log('Supabase response:', { data: storesData, error });

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
            return;
        }

        console.log(`Found ${storesData.length} stores`);
        stores = storesData;
        displayStores(stores);
    } catch (error) {
        console.error('Error loading stores:', error);
        container.innerHTML = `
      <div class="text-center">
        <p class="text-muted-white">Error al cargar tiendas</p>
        <p class="text-muted-white" style="font-size: 12px;">${error.message}</p>
      </div>
    `;
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
            selectStore(store);
        });
    });
}

function selectStore(store) {
    selectedStore = store;
    console.log('Selected store set:', selectedStore);

    // Update UI to show store cards with selection
    displayStores(stores);

    // Update selected store display in login form
    document.getElementById('selectedStoreName').textContent = store.name;
    document.getElementById('selectedStoreAddress').textContent = store.address;

    // Show login form, hide disabled message
    document.getElementById('disabledMessage').style.display = 'none';
    document.getElementById('loginFormStep').style.display = 'block';

    // Focus username input
    setTimeout(() => {
        document.getElementById('username').focus();
    }, 100);
}

function showDisabledMessage() {
    document.getElementById('disabledMessage').style.display = 'block';
    document.getElementById('loginFormStep').style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();

    if (!selectedStore) {
        showAlert('Por favor selecciona una tienda primero', 'error');
        return;
    }

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

        // Save selected store in session
        localStorage.setItem('selectedStore', JSON.stringify(selectedStore));

        showAlert('¡Inicio de sesión exitoso!', 'success');

        setTimeout(() => {
            navigateToHome();
        }, 500);
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

    const user = Auth.getCurrentUser();
    if (user.role === 'admin') {
        window.location.href = 'admin-dashboard.html';
    } else {
        window.location.href = 'pos.html';
    }
}
