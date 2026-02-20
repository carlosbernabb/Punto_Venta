// Initialize Supabase client
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Authentication helper functions
const Auth = {
    // Login with username and password
    async login(username, password) {
        try {
            // Find employee by username
            const { data: employee, error: employeeError } = await supabaseClient
                .from('employees')
                .select('*')
                .eq('username', username)
                .eq('is_active', true)
                .single();

            if (employeeError || !employee) {
                throw new Error('Usuario no encontrado o inactivo');
            }

            // Simple password validation (for demo: password = "admin123" for all users)
            // TODO: Implement proper Supabase Auth
            if (password !== 'admin123') {
                throw new Error('Contraseña incorrecta');
            }

            // Store user data locally
            const userData = {
                id: employee.id,
                username: employee.username,
                full_name: employee.full_name,
                role: employee.role,
                organization_id: employee.organization_id
            };

            localStorage.setItem('userData', JSON.stringify(userData));
            localStorage.setItem('authToken', 'demo-token-' + Date.now());

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
        const userData = localStorage.getItem('userData');
        return userData ? JSON.parse(userData) : null;
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
