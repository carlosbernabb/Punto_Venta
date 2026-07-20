// Initialize Supabase client
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Fix Electron/Windows: tras cerrar un dialogo nativo (alert/confirm/prompt) la
// ventana queda sin foco de entrada — los clicks en inputs no responden hasta
// presionar Alt dos veces. Envolvemos los dialogos para re-enfocar la ventana
// desde el proceso principal en cuanto se cierran.
(function patchNativeDialogsFocus() {
    if (!window.electronAPI?.refocusWindow) return;
    ['alert', 'confirm', 'prompt'].forEach(name => {
        const native = window[name].bind(window);
        window[name] = (...args) => {
            const result = native(...args);
            window.electronAPI.refocusWindow();
            return result;
        };
    });
})();

// Authentication helper functions
const Auth = {
    isMissingRpcError(error) {
        const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
        return msg.includes('function') && (msg.includes('does not exist') || msg.includes('not found'));
    },

    normalizeUserData(employee) {
        return {
            id: employee.id,
            username: employee.username,
            full_name: employee.full_name,
            role: employee.role,
            organization_id: employee.organization_id,
            store_id: employee.store_id || null,
            avatar_url: employee.avatar_url,
            module_permissions: employee.module_permissions || null
        };
    },

    async hydrateEmployeePermissions(employee) {
        if (!employee?.id) return employee;

        try {
            const { data, error } = await supabaseClient
                .from('employees')
                .select('module_permissions')
                .eq('id', employee.id)
                .maybeSingle();

            if (!error && data) {
                employee.module_permissions = data.module_permissions || null;
            }
        } catch (err) {
            console.warn('No se pudieron cargar permisos de modulos:', err);
        }

        if (!employee.module_permissions) {
            try {
                const localPermissions = localStorage.getItem(`employeeModulePermissions:${employee.id}`);
                if (localPermissions) {
                    employee.module_permissions = JSON.parse(localPermissions);
                }
            } catch (err) {
                console.warn('No se pudieron leer permisos locales:', err);
            }
        }

        return employee;
    },

    // Login with username and password
    async login(username, password) {
        try {
            let { data: employee, error: employeeError } = await supabaseClient
                .rpc('login_employee', {
                    p_username: username,
                    p_password: password
                })
                .single();

            if (this.isMissingRpcError(employeeError)) {
                throw new Error('Falta actualizar la función login_employee en Supabase');
            }

            if (employeeError || !employee) {
                throw new Error(employeeError?.message || 'Usuario o contraseña incorrectos');
            }

            // Store user data locally
            const userData = this.normalizeUserData(employee);
            await this.hydrateEmployeePermissions(userData);

            localStorage.setItem('userData', JSON.stringify(userData));
            localStorage.setItem('authToken', 'local-session-' + Date.now());

            return userData;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    },

    // Logout
    async logout() {
        try {
            localStorage.removeItem('userData');
            localStorage.removeItem('authToken');
            return true;
        } catch (error) {
            console.error('Logout error:', error);
            throw error;
        }
    },

    // Get current user
    getCurrentUser() {
        try {
            const userData = localStorage.getItem('userData');
            if (!userData) return null;

            const parsed = JSON.parse(userData);
            const requiredFields = ['id', 'username', 'role', 'organization_id'];
            const isValid = requiredFields.every(field => parsed && parsed[field]);
            if (!isValid) {
                this.logout();
                return null;
            }

            return parsed;
        } catch (error) {
            console.error('Invalid local session:', error);
            this.logout();
            return null;
        }
    },

    // Check if user is authenticated
    isAuthenticated() {
        return !!this.getCurrentUser();
    },

    // Check if user is admin
    isAdmin() {
        const user = this.getCurrentUser();
        return user && user.role === 'admin';
    },

    // Get user role
    getUserRole() {
        const user = this.getCurrentUser();
        return user ? user.role : null;
    }
};

// Global logo management function
window.handleLogoUpload = function (event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const base64Image = e.target.result;
            // Guardar en localStorage
            localStorage.setItem('customAppLogo', base64Image);

            // Actualizar la imagen en vivo si existe en el DOM
            const logoEl = document.getElementById('mainAppLogo');
            if (logoEl) logoEl.src = base64Image;
        };
        reader.readAsDataURL(file);
    }
};

// Apply custom logo on page load for all pages referencing auth.js
document.addEventListener('DOMContentLoaded', () => {
    const customLogo = localStorage.getItem('customAppLogo');
    if (customLogo) {
        const logoEl = document.getElementById('mainAppLogo');
        if (logoEl) logoEl.src = customLogo;
    }
});
