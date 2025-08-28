import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, where, orderBy, serverTimestamp, writeBatch, runTransaction,
    increment, Timestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- INICIALIZACIÓN DE FIREBASE ---
const firebaseConfig = window.__FIREBASE_CONFIG__;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ESTADO GLOBAL Y REFERENCIAS A COLECCIONES ---
let appState = {
    user: null, role: null, 
    unsubscribeListeners: [],
    inventoryUnsubscribers: [],
    products: [], providers: [], workers: [], inventory: {},
    activeShift: null, cashflow: [], cashBalance: 0
};

const collections = {
    users: collection(db, 'users'), products: collection(db, 'products'),
    inventory: collection(db, 'inventory'), providers: collection(db, 'providers'),
    purchases: collection(db, 'purchases'), workers: collection(db, 'workers'),
    shifts: collection(db, 'shifts'), providerSettlements: collection(db, 'providerSettlements'),
    workerSettlements: collection(db, 'workerSettlements'), cashflow_entries: collection(db, 'cashflow_entries'),
};

// --- UTILIDADES ---
const showLoader = (show) => { 
    const loader = document.getElementById('loader');
    if(loader) loader.style.display = show ? 'flex' : 'none'; 
};
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
};
const formatCurrency = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const formatDate = (timestamp) => timestamp ? timestamp.toDate().toLocaleString('es-CO') : 'N/A';

// --- LÓGICA PRINCIPAL DE LA APP ---
document.addEventListener('DOMContentLoaded', () => {

    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');
    const contentContainer = document.getElementById('content');
    
    // --- LÓGICA DE NAVEGACIÓN Y MENÚ MÓVIL ---
    const mainNav = document.getElementById('main-nav');
    document.getElementById('menu-toggle').addEventListener('click', () => {
        mainNav.classList.toggle('open');
    });

    mainNav.addEventListener('click', (e) => {
        const navLink = e.target.closest('.nav-link');
        if (navLink) {
            e.preventDefault();
            mainNav.classList.remove('open');
            const viewId = navLink.dataset.view;
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            navLink.classList.add('active');
            renderView(viewId);
        }
    });

    // --- LÓGICA DE AUTENTICACIÓN ---
    onAuthStateChanged(auth, async (user) => {
        // No mostrar loader aquí para una carga optimista
        try {
            if (user) {
                const userDocRef = doc(collections.users, user.uid);
                let userDoc = await getDoc(userDocRef);
                
                if (!userDoc.exists()) {
                    showLoader(true); // Mostrar loader solo si se crea un nuevo usuario
                    const usersQuery = query(collection(db, "users"), limit(1));
                    const usersSnapshot = await getDocs(usersQuery);
                    const isFirstUser = usersSnapshot.empty;

                    await setDoc(userDocRef, {
                        email: user.email,
                        displayName: user.displayName || 'Usuario',
                        role: isFirstUser ? 'admin' : 'vendedor',
                        active: true,
                        createdAt: serverTimestamp(),
                    });
                    userDoc = await getDoc(userDocRef);
                    showLoader(false);
                }
                
                appState.user = user;
                appState.role = userDoc.data().role;
                document.getElementById('user-email').textContent = user.email;
                document.body.dataset.role = appState.role;
                
                authContainer.style.display = 'none';
                appContainer.style.display = 'block';
                
                initRealtimeListeners();
                document.querySelector('.nav-link[data-view="dashboard-view"]').click();
            } else {
                appState.unsubscribeListeners.forEach(unsub => unsub());
                appState.inventoryUnsubscribers.forEach(unsub => unsub());
                appState = { user: null, role: null, unsubscribeListeners: [], inventoryUnsubscribers: [], products: [], providers: [], workers: [], inventory: {}, activeShift: null, cashflow: [], cashBalance: 0 };
                authContainer.style.display = 'flex';
                appContainer.style.display = 'none';
            }
        } catch (error) {
            console.error("Error during auth UI handling:", error);
            showToast("Ocurrió un error crítico. Intente recargar.", "error");
            showLoader(false);
        }
    });

    // --- Eventos de formularios de Auth ---
    document.getElementById('login-form').addEventListener('submit', async (e) => { e.preventDefault(); showLoader(true); try { await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (error) { showToast(error.message, 'error'); } finally { showLoader(false); } });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const displayName = document.getElementById('register-name').value;

        try {
            const usersQuery = query(collection(db, "users"), limit(1));
            const usersSnapshot = await getDocs(usersQuery);
            const isFirstUser = usersSnapshot.empty;
            
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            const userDocRef = doc(collections.users, user.uid);
            await setDoc(userDocRef, {
                email: user.email,
                displayName: displayName,
                role: isFirstUser ? 'admin' : 'vendedor',
                active: true,
                createdAt: serverTimestamp(),
            });
            
            showToast('¡Cuenta creada con éxito! Iniciando sesión...', 'success');
        } catch (error) {
            showToast(`Error al registrar: ${error.message}`, 'error');
        } finally {
            showLoader(false);
        }
    });

    document.getElementById('google-login-btn').addEventListener('click', async () => { showLoader(true); try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (error) { showToast(error.message, 'error'); } finally { showLoader(false); } });
    document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('login-view').style.display = 'none'; document.getElementById('register-view').style.display = 'block'; });
    document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('register-view').style.display = 'none'; document.getElementById('login-view').style.display = 'block'; });

    // --- DELEGACIÓN DE EVENTOS PARA TODA LA APP ---
    contentContainer.addEventListener('click', (e) => {
        const target = e.target;
        
        // Botones de edición
        if (target.matches('.btn-edit[data-id]')) {
            const id = target.dataset.id;
            const type = target.dataset.type;
            if (type === 'product') window.app.editProduct(id);
            if (type === 'provider') window.app.editProvider(id);
            if (type === 'worker') window.app.editWorker(id);
        }

        // Botón de liquidación de proveedor
        if (target.matches('.btn-settle[data-id]')) {
            window.app.prepareProviderSettlement(target.dataset.id);
        }
        
        // Botón para pagar liquidación
        if (target.id === 'settle-provider-btn') {
            handleProviderSettlement(target.dataset.providerId);
        }

        // Botón de cerrar turno
        if (target.id === 'close-shift-btn') {
            handleCloseShift();
        }

        // Botón de cargar datos de demo
        if (target.id === 'seed-data-btn') {
            handleSeedData();
        }
    });

    contentContainer.addEventListener('submit', (e) => {
        e.preventDefault();
        const formId = e.target.id;

        switch(formId) {
            case 'product-form': handleProductFormSubmit(e.target); break;
            case 'provider-form': handleProviderFormSubmit(e.target); break;
            case 'worker-form': handleWorkerFormSubmit(e.target); break;
            case 'purchase-form': handlePurchaseFormSubmit(e.target); break;
            case 'transfer-form': handleTransferFormSubmit(e.target); break;
            case 'cashflow-form': handleCashflowFormSubmit(e.target); break;
            case 'open-shift-form': handleOpenShiftFormSubmit(e.target); break;
            case 'sale-form': handleSaleFormSubmit(e.target); break;
            case 'loan-form': handleLoanFormSubmit(e.target); break;
        }
    });

    // --- LÓGICA DE NEGOCIO Y CRUD (en namespace global 'app') ---
    window.app = {};

    app.editProduct = (id) => {
        const p = appState.products.find(p => p.id === id);
        if (!p) return;
        const form = document.getElementById('product-form');
        form.querySelector('#product-id').value = p.id;
        form.querySelector('#product-nombre').value = p.nombre;
        form.querySelector('#product-precioVenta').value = p.precioVenta;
        form.querySelector('#product-precioCompra').value = p.precioCompra;
        form.querySelector('#product-precioFicha').value = p.precioFicha;
        form.querySelector('#product-unidadesPorCaja').value = p.unidadesPorCaja;
        form.querySelector('#product-unidadesPorCanasta').value = p.unidadesPorCanasta;
        form.querySelector('#product-activo').checked = p.activo;
        form.scrollIntoView({ behavior: 'smooth' });
    };

    app.editProvider = (id) => { 
        const p = appState.providers.find(p => p.id === id); 
        if (!p) return; 
        const form = document.getElementById('provider-form');
        form.querySelector('#provider-id').value = p.id; 
        form.querySelector('#provider-nombre').value = p.nombre; 
        form.querySelector('#provider-contacto').value = p.contacto; 
        form.querySelector('#provider-consignacion').checked = p.consignacion; 
        form.scrollIntoView({ behavior: 'smooth' });
    };
    
    app.prepareProviderSettlement = (providerId) => {
        const provider = appState.providers.find(p => p.id === providerId);
        const detailsDiv = document.getElementById('settlement-details');
        if (!provider || provider.saldoPendiente <= 0) {
            showToast('Este proveedor no tiene saldo pendiente para liquidar.', 'error');
            detailsDiv.classList.add('hidden');
            return;
        }
        document.getElementById('settlement-provider-name').textContent = provider.nombre;
        document.getElementById('settlement-provider-balance').textContent = formatCurrency(provider.saldoPendiente);
        document.getElementById('settle-provider-btn').dataset.providerId = providerId;
        detailsDiv.classList.remove('hidden');
        detailsDiv.scrollIntoView({ behavior: 'smooth' });
    };

    app.editWorker = (id) => { 
        const w = appState.workers.find(w => w.id === id); 
        if (!w) return; 
        const form = document.getElementById('worker-form');
        form.querySelector('#worker-id').value = w.id; 
        form.querySelector('#worker-nombre').value = w.nombre; 
        form.querySelector('#worker-pagoBase').value = w.pagoBase; 
        form.querySelector('#worker-activo').checked = w.activo; 
        form.scrollIntoView({ behavior: 'smooth' });
    };

}); // Fin del DOMContentLoaded


// --- LISTENERS DE FIRESTORE ---
function initRealtimeListeners() {
    appState.unsubscribeListeners.forEach(unsub => unsub());
    appState.inventoryUnsubscribers.forEach(unsub => unsub());
    appState.unsubscribeListeners = [];
    appState.inventoryUnsubscribers = [];

    const addListener = (unsub) => appState.unsubscribeListeners.push(unsub);
    const rerenderCurrentView = () => {
        const activeLink = document.querySelector('.nav-link.active');
        if (activeLink) renderView(activeLink.dataset.view);
    };

    addListener(onSnapshot(query(collections.products, orderBy('nombre')), snap => { 
        appState.products = snap.docs.map(d => ({ id: d.id, ...d.data() })); 
        rerenderCurrentView();
        initInventoryListeners();
    }));

    addListener(onSnapshot(query(collections.providers, orderBy('nombre')), snap => { appState.providers = snap.docs.map(d => ({ id: d.id, ...d.data() })); rerenderCurrentView(); }));
    addListener(onSnapshot(query(collections.workers, orderBy('nombre')), snap => { appState.workers = snap.docs.map(d => ({ id: d.id, ...d.data() })); rerenderCurrentView(); }));
    addListener(onSnapshot(query(collections.cashflow_entries, orderBy('date', 'desc')), snap => { appState.cashflow = snap.docs.map(d => ({ id: d.id, ...d.data() })); rerenderCurrentView(); }));
    
    const qShifts = query(collections.shifts, where('estado', '==', 'abierto'));
    addListener(onSnapshot(qShifts, (snapshot) => {
        if (!snapshot.empty) {
            const shiftDoc = snapshot.docs[0];
            if (appState.activeShift?.id !== shiftDoc.id) {
                appState.activeShift = { id: shiftDoc.id, ...shiftDoc.data(), sales: [], loans: [] };
                addListener(onSnapshot(query(collection(db, 'shifts', shiftDoc.id, 'sales')), s => { if(appState.activeShift) appState.activeShift.sales = s.docs.map(d => d.data()); rerenderCurrentView(); }));
                addListener(onSnapshot(query(collection(db, 'shifts', shiftDoc.id, 'loans')), l => { if(appState.activeShift) appState.activeShift.loans = l.docs.map(d => d.data()); rerenderCurrentView(); }));
            }
        } else {
            appState.activeShift = null;
        }
        rerenderCurrentView();
    }));
}

function initInventoryListeners() {
    appState.inventoryUnsubscribers.forEach(unsub => unsub());
    appState.inventoryUnsubscribers = [];

    appState.products.forEach(product => {
        const stockRef = collection(db, 'inventory', product.id, 'stock');
        const unsub = onSnapshot(stockRef, (snapshot) => {
            snapshot.docs.forEach(doc => {
                if (!appState.inventory[product.id]) appState.inventory[product.id] = {};
                appState.inventory[product.id][doc.id] = doc.data();
            });
            const activeLink = document.querySelector('.nav-link.active');
            if (activeLink) renderView(activeLink.dataset.view);
        });
        appState.inventoryUnsubscribers.push(unsub);
    });
}

// --- SISTEMA DE RENDERIZADO DE VISTAS ---
const renderView = (viewId) => {
    const contentContainer = document.getElementById('content');
    if (!contentContainer) return;

    let html = '';
    switch (viewId) {
        case 'dashboard-view': html = getDashboardHTML(); break;
        case 'shifts-view': html = getShiftsHTML(); break;
        case 'inventory-view': html = getInventoryHTML(); break;
        case 'cashflow-view': html = getCashflowHTML(); break;
        case 'products-view': html = getProductsHTML(); break;
        case 'providers-view': html = getProvidersHTML(); break;
        case 'workers-view': html = getWorkersHTML(); break;
    }
    contentContainer.innerHTML = html;
};

// --- PLANTILLAS HTML PARA CADA VISTA ---
function getDashboardHTML() {
    const balance = appState.cashflow.reduce((bal, entry) => bal + (entry.type === 'ingreso' ? entry.amount : -entry.amount), 0);
    appState.cashBalance = balance;
    const lowStock = appState.products.filter(p => (appState.inventory[p.id]?.barra?.unidades || 0) < 10).map(p => `<li>${p.nombre}: ${appState.inventory[p.id]?.barra?.unidades || 0} uds</li>`).join('');
    const totalDebt = appState.providers.reduce((sum, p) => sum + (p.saldoPendiente || 0), 0);
    const salesToday = appState.activeShift?.sales.reduce((sum, s) => sum + s.totalVenta, 0) || 0;
    
    return `
        <div class="content-view">
            <h2>Panel de Control</h2>
            <div class="dashboard-grid">
                <div class="card"><h3 class="neon-text-secondary">Saldo en Caja</h3><p>${formatCurrency(appState.cashBalance)}</p></div>
                <div class="card"><h3 class="neon-text-secondary">Ventas Turno Activo</h3><p>${formatCurrency(salesToday)}</p></div>
                <div class="card"><h3 class="neon-text-secondary">Deuda Proveedores</h3><p>${formatCurrency(totalDebt)}</p></div>
                <div class="card"><h3 class="neon-text-secondary">Stock Crítico (Barra)</h3><ul>${lowStock || '<li>Todo en orden</li>'}</ul></div>
            </div>
            <button id="seed-data-btn" class="${appState.role === 'admin' ? '' : 'hidden'}">Cargar Datos de Demostración</button>
        </div>`;
}

function getProductsHTML() {
    const productsRows = appState.products.map(p => `
        <tr>
            <td>${p.nombre}</td>
            <td>${formatCurrency(p.precioVenta)}</td>
            <td>${formatCurrency(p.precioCompra)}</td>
            <td>${p.activo ? '✅' : '❌'}</td>
            <td class="actions">${appState.role === 'admin' ? `<button class="btn-edit" data-type="product" data-id="${p.id}">Editar</button>` : ''}</td>
        </tr>`).join('');
    
    return `
        <div class="content-view">
            <h2>Gestión de Productos</h2>
            <form id="product-form" class="${appState.role === 'admin' ? '' : 'hidden'}">
                <h3>Añadir / Editar Producto</h3>
                <input type="hidden" id="product-id">
                <div class="form-grid">
                    <input type="text" id="product-nombre" placeholder="Nombre del producto" required>
                    <input type="number" id="product-precioVenta" placeholder="Precio Venta" required min="0" step="any">
                    <input type="number" id="product-precioCompra" placeholder="Precio Compra" required min="0" step="any">
                    <input type="number" id="product-precioFicha" placeholder="Precio Ficha" min="0" step="any">
                    <input type="number" id="product-unidadesPorCaja" placeholder="Unidades por Caja" min="1">
                    <input type="number" id="product-unidadesPorCanasta" placeholder="Unidades por Canasta" min="1">
                </div>
                <label><input type="checkbox" id="product-activo" checked> Activo</label>
                <button type="submit">Guardar Producto</button>
            </form>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Nombre</th><th>P. Venta</th><th>P. Compra</th><th>Activo</th><th>Acciones</th></tr></thead>
                    <tbody>${productsRows || `<tr><td colspan="5">No hay productos.</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
}

function getInventoryHTML() {
    const inventoryRows = appState.products.map(p => `
        <tr>
            <td>${p.nombre}</td>
            <td>${appState.inventory[p.id]?.bodega?.unidades || 0}</td>
            <td>${appState.inventory[p.id]?.barra?.unidades || 0}</td>
        </tr>`).join('');

    const productOptions = appState.products.filter(p => p.activo).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
    const providerOptions = appState.providers.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

    return `
        <div class="content-view">
            <h2>Inventario y Compras</h2>
            <div class="form-grid">
                <form id="purchase-form">
                    <h3>Registrar Compra</h3>
                    <select id="purchase-provider" required><option value="">Seleccione Proveedor...</option>${providerOptions}</select>
                    <select id="purchase-product" required><option value="">Seleccione Producto...</option>${productOptions}</select>
                    <input type="number" id="purchase-quantity" placeholder="Cantidad" required min="1">
                    <select id="purchase-unit" required>
                        <option value="unidades">Unidades</option>
                        <option value="cajas">Cajas</option>
                        <option value="canastas">Canastas</option>
                    </select>
                    <select id="purchase-type" required>
                        <option value="contado">Contado (Afecta caja)</option>
                        <option value="consignacion">Consignación</option>
                    </select>
                    <button type="submit">Registrar Compra</button>
                </form>
                <form id="transfer-form">
                    <h3>Trasladar Bodega → Barra</h3>
                    <select id="transfer-product" required><option value="">Seleccione Producto...</option>${productOptions}</select>
                    <input type="number" id="transfer-quantity" placeholder="Cantidad" required min="1">
                    <select id="transfer-unit" required>
                        <option value="unidades">Unidades</option>
                        <option value="cajas">Cajas</option>
                        <option value="canastas">Canastas</option>
                    </select>
                    <button type="submit">Trasladar</button>
                </form>
            </div>
            <h3>Stock Actual</h3>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Producto</th><th>Stock Bodega</th><th>Stock Barra</th></tr></thead>
                    <tbody>${inventoryRows || `<tr><td colspan="3">No hay inventario.</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
}

function getCashflowHTML() {
    const cashflowRows = appState.cashflow.map(e => `
        <tr class="cash-${e.type}">
            <td>${formatDate(e.date)}</td>
            <td>${e.description}</td>
            <td class="amount-${e.type === 'ingreso' ? 'positive' : 'negative'}">${formatCurrency(e.type === 'ingreso' ? e.amount : -e.amount)}</td>
        </tr>`).join('');

    return `
        <div class="content-view">
            <h2>Flujo de Caja</h2>
            <form id="cashflow-form">
                <h3>Registrar Movimiento Manual</h3>
                <div class="form-grid">
                    <select id="cashflow-type" required>
                        <option value="ingreso">Ingreso</option>
                        <option value="egreso">Egreso</option>
                    </select>
                    <input type="number" id="cashflow-amount" placeholder="Monto" required min="1" step="any">
                </div>
                <input type="text" id="cashflow-description" placeholder="Descripción (ej. Pago de arriendo)" required>
                <button type="submit">Registrar Movimiento</button>
            </form>
            <h3>Historial de Movimientos</h3>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Fecha</th><th>Descripción</th><th>Monto</th></tr></thead>
                    <tbody>${cashflowRows || `<tr><td colspan="3">No hay movimientos.</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
}

function getProvidersHTML() {
    const providerRows = appState.providers.map(p => `
        <tr>
            <td>${p.nombre}</td>
            <td>${p.consignacion ? '✅' : '❌'}</td>
            <td>${formatCurrency(p.saldoPendiente || 0)}</td>
            <td class="actions">${appState.role === 'admin' ? `<button class="btn-edit" data-type="provider" data-id="${p.id}">Editar</button><button class="btn-settle" data-id="${p.id}">Liquidar</button>` : ''}</td>
        </tr>`).join('');

    return `
        <div class="content-view">
            <h2>Proveedores y Liquidaciones</h2>
            <form id="provider-form" class="${appState.role === 'admin' ? '' : 'hidden'}">
                <h3>Añadir / Editar Proveedor</h3>
                <input type="hidden" id="provider-id">
                <input type="text" id="provider-nombre" placeholder="Nombre del proveedor" required>
                <input type="text" id="provider-contacto" placeholder="Contacto (teléfono/email)">
                <label><input type="checkbox" id="provider-consignacion"> Acepta consignación</label>
                <button type="submit">Guardar Proveedor</button>
            </form>
            
            <div id="provider-settlement-section" class="${appState.role === 'admin' ? '' : 'hidden'}">
                <h3>Liquidar Deuda a Proveedor</h3>
                <p>Selecciona un proveedor de la lista para ver la opción de liquidar su saldo pendiente.</p>
                <div id="settlement-details" class="hidden">
                    <h4>Liquidar a: <span id="settlement-provider-name"></span></h4>
                    <p>Saldo pendiente: <strong id="settlement-provider-balance"></strong></p>
                    <button id="settle-provider-btn">Pagar y Registrar Egreso</button>
                </div>
            </div>
            
            <h3>Lista de Proveedores</h3>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Nombre</th><th>Consignación</th><th>Saldo Pendiente</th><th>Acciones</th></tr></thead>
                    <tbody>${providerRows || `<tr><td colspan="4">No hay proveedores.</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
}

function getWorkersHTML() {
    const workerRows = appState.workers.map(w => `
        <tr>
            <td>${w.nombre}</td>
            <td>${formatCurrency(w.pagoBase || 0)}</td>
            <td>${w.activo ? '✅' : '❌'}</td>
            <td class="actions"><button class="btn-edit" data-type="worker" data-id="${w.id}">Editar</button></td>
        </tr>`).join('');

    return `
        <div class="content-view">
            <h2>Gestión de Trabajadores</h2>
            <form id="worker-form" class="${appState.role === 'admin' ? '' : 'hidden'}">
                <h3>Añadir / Editar Trabajador</h3>
                <input type="hidden" id="worker-id">
                <input type="text" id="worker-nombre" placeholder="Nombre completo" required>
                <input type="number" id="worker-pagoBase" placeholder="Pago Base por Turno (opcional)" min="0" step="any">
                <label><input type="checkbox" id="worker-activo" checked> Activo</label>
                <button type="submit">Guardar Trabajador</button>
            </form>
            <h3>Lista de Trabajadores</h3>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Nombre</th><th>Pago Base</th><th>Activo</th><th>Acciones</th></tr></thead>
                    <tbody>${workerRows || `<tr><td colspan="4">No hay trabajadores.</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
}

function getShiftsHTML() {
    if (appState.activeShift) {
        const worker = appState.workers.find(w => w.id === appState.activeShift.workerId);
        const ingresos = appState.activeShift.sales.reduce((sum, s) => sum + s.totalVenta, 0);
        const fichas = appState.activeShift.sales.reduce((sum, s) => sum + s.totalFichas, 0);
        const prestamos = appState.activeShift.loans.reduce((sum, l) => sum + l.valor, 0);
        const productOptions = appState.products.filter(p => p.activo).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
        
        return `
            <div class="content-view">
                <h2>Turno Activo: <span class="neon-text-main">${worker?.nombre || '...'}</span></h2>
                <div class="form-grid">
                    <form id="sale-form">
                        <h4>Registrar Venta</h4>
                        <select id="sale-product" required><option value="">Seleccione Producto...</option>${productOptions}</select>
                        <input type="number" id="sale-quantity" placeholder="Unidades" required min="1" value="1">
                        <button type="submit">Vender</button>
                    </form>
                    <form id="loan-form">
                        <h4>Registrar Préstamo</h4>
                        <input type="text" id="loan-description" placeholder="Descripción (ej. adelanto)" required>
                        <input type="number" id="loan-value" placeholder="Valor" required min="1" step="any">
                        <button type="submit">Añadir Préstamo</button>
                    </form>
                </div>
                <div class="card">
                    <h4>Resumen del Turno</h4>
                    <p><strong>Ingresos Brutos:</strong> <span>${formatCurrency(ingresos)}</span></p>
                    <p><strong>Fichas Ganadas:</strong> <span>${formatCurrency(fichas)}</span></p>
                    <p><strong>Préstamos:</strong> <span>${formatCurrency(prestamos)}</span></p>
                    <hr>
                    <button id="close-shift-btn">Cerrar y Liquidar Turno</button>
                </div>
            </div>`;
    } else {
        const workerOptions = appState.workers.filter(w => w.activo).map(w => `<option value="${w.id}">${w.nombre}</option>`).join('');
        return `
            <div class="content-view">
                <h2>Turnos y Ventas</h2>
                <form id="open-shift-form">
                    <h3>Abrir Nuevo Turno</h3>
                    <select id="shift-worker" required><option value="">Seleccione Trabajador...</option>${workerOptions}</select>
                    <button type="submit">Iniciar Turno</button>
                </form>
            </div>`;
    }
}


// --- MANEJADORES DE FORMULARIOS ---
async function handleProductFormSubmit(form) {
    const id = form.querySelector('#product-id').value;
    const data = {
        nombre: form.querySelector('#product-nombre').value,
        precioVenta: parseFloat(form.querySelector('#product-precioVenta').value),
        precioCompra: parseFloat(form.querySelector('#product-precioCompra').value),
        precioFicha: parseFloat(form.querySelector('#product-precioFicha').value) || 0,
        unidadesPorCaja: parseInt(form.querySelector('#product-unidadesPorCaja').value) || 1,
        unidadesPorCanasta: parseInt(form.querySelector('#product-unidadesPorCanasta').value) || 1,
        activo: form.querySelector('#product-activo').checked,
    };
    showLoader(true);
    try {
        if (id) {
            await setDoc(doc(collections.products, id), data, { merge: true });
        } else {
            const newDocRef = await addDoc(collections.products, data);
            const batch = writeBatch(db);
            batch.set(doc(db, 'inventory', newDocRef.id, 'stock', 'bodega'), { unidades: 0 });
            batch.set(doc(db, 'inventory', newDocRef.id, 'stock', 'barra'), { unidades: 0 });
            await batch.commit();
        }
        showToast('Producto guardado');
        form.reset();
        form.querySelector('#product-id').value = '';
    } catch (error) { showToast(error.message, 'error'); } finally { showLoader(false); }
}

async function handleProviderFormSubmit(form) {
    const id = form.querySelector('#provider-id').value;
    const data = {
        nombre: form.querySelector('#provider-nombre').value,
        contacto: form.querySelector('#provider-contacto').value,
        consignacion: form.querySelector('#provider-consignacion').checked,
    };
    showLoader(true);
    try {
        if (id) {
            await setDoc(doc(collections.providers, id), data, { merge: true });
        } else {
            await addDoc(collections.providers, { ...data, saldoPendiente: 0 });
        }
        showToast('Proveedor guardado');
        form.reset();
        form.querySelector('#provider-id').value = '';
    } catch(e) { showToast(e.message, 'error'); } finally { showLoader(false); }
}

async function handleWorkerFormSubmit(form) {
    const id = form.querySelector('#worker-id').value;
    const data = {
        nombre: form.querySelector('#worker-nombre').value,
        pagoBase: parseFloat(form.querySelector('#worker-pagoBase').value) || 0,
        activo: form.querySelector('#worker-activo').checked,
    };
    showLoader(true);
    try {
        if (id) {
            await setDoc(doc(collections.workers, id), data, { merge: true });
        } else {
            await addDoc(collections.workers, data);
        }
        showToast('Trabajador guardado');
        form.reset();
        form.querySelector('#worker-id').value = '';
    } catch(e) { showToast(e.message, 'error'); } finally { showLoader(false); }
}

async function handlePurchaseFormSubmit(form) {
    const providerId = form.querySelector('#purchase-provider').value;
    const productId = form.querySelector('#purchase-product').value;
    const cantidad = parseInt(form.querySelector('#purchase-quantity').value);
    const tipo = form.querySelector('#purchase-type').value;
    const product = appState.products.find(p => p.id === productId);
    if (!product || !providerId || isNaN(cantidad)) return showToast('Datos inválidos', 'error');
    const cantidadUnidades = (form.querySelector('#purchase-unit').value === 'cajas' ? cantidad * product.unidadesPorCaja : (form.querySelector('#purchase-unit').value === 'canastas' ? cantidad * product.unidadesPorCanasta : cantidad));
    const costoTotal = cantidadUnidades * product.precioCompra;

    showLoader(true);
    try {
        const batch = writeBatch(db);
        batch.set(doc(collections.purchases), { providerId, productId, fecha: serverTimestamp(), tipo, cantidadUnidades, costoTotal });
        batch.update(doc(db, 'inventory', productId, 'stock', 'bodega'), { unidades: increment(cantidadUnidades) });
        if (tipo === 'consignacion') {
            batch.update(doc(collections.providers, providerId), { saldoPendiente: increment(costoTotal) });
        } else {
            batch.set(doc(collections.cashflow_entries), { type: 'egreso', amount: costoTotal, description: `Compra contado: ${cantidadUnidades}x ${product.nombre}`, date: serverTimestamp() });
        }
        await batch.commit();
        showToast('Compra registrada');
        form.reset();
    } catch (error) { showToast(error.message, 'error'); } finally { showLoader(false); }
}

async function handleTransferFormSubmit(form) {
    const productId = form.querySelector('#transfer-product').value;
    const cantidad = parseInt(form.querySelector('#transfer-quantity').value);
    const product = appState.products.find(p => p.id === productId);
    if (!product || isNaN(cantidad)) return showToast('Datos inválidos', 'error');
    const cantidadUnidades = (form.querySelector('#transfer-unit').value === 'cajas' ? cantidad * product.unidadesPorCaja : (form.querySelector('#transfer-unit').value === 'canastas' ? cantidad * product.unidadesPorCanasta : cantidad));
    
    showLoader(true);
    try {
        await runTransaction(db, async (t) => {
            const bodegaRef = doc(db, 'inventory', productId, 'stock', 'bodega');
            const bodegaDoc = await t.get(bodegaRef);
            if (!bodegaDoc.exists() || bodegaDoc.data().unidades < cantidadUnidades) throw new Error('Stock insuficiente en bodega.');
            t.update(bodegaRef, { unidades: increment(-cantidadUnidades) });
            t.update(doc(db, 'inventory', productId, 'stock', 'barra'), { unidades: increment(cantidadUnidades) });
        });
        showToast('Traslado exitoso');
        form.reset();
    } catch (error) { showToast(error.message, 'error'); } finally { showLoader(false); }
}

async function handleCashflowFormSubmit(form) {
    const data = {
        type: form.querySelector('#cashflow-type').value,
        amount: parseFloat(form.querySelector('#cashflow-amount').value),
        description: form.querySelector('#cashflow-description').value,
        date: serverTimestamp(),
        manual: true,
        userId: appState.user.uid,
    };
    if (isNaN(data.amount) || !data.description) return showToast('Datos inválidos', 'error');
    showLoader(true);
    try {
        await addDoc(collections.cashflow_entries, data);
        showToast('Movimiento de caja registrado');
        form.reset();
    } catch (error) { showToast(error.message, 'error'); } finally { showLoader(false); }
}

async function handleOpenShiftFormSubmit(form) {
    const workerId = form.querySelector('#shift-worker').value;
    if (!workerId) return;
    const worker = appState.workers.find(w => w.id === workerId);
    showLoader(true);
    try {
        await addDoc(collections.shifts, { workerId, pagoBase: worker.pagoBase || 0, inicio: serverTimestamp(), estado: 'abierto' });
        showToast(`Turno para ${worker.nombre} iniciado.`);
    } catch(e) { showToast(e.message, 'error'); } finally { showLoader(false); }
}

async function handleSaleFormSubmit(form) {
    if (!appState.activeShift) return;
    const productId = form.querySelector('#sale-product').value;
    const unidades = parseInt(form.querySelector('#sale-quantity').value);
    const product = appState.products.find(p => p.id === productId);
    if (!product || isNaN(unidades) || unidades <= 0) return showToast('Venta inválida', 'error');
    
    showLoader(true);
    try {
        await runTransaction(db, async (t) => {
            const barraRef = doc(db, 'inventory', productId, 'stock', 'barra');
            const barraDoc = await t.get(barraRef);
            if (!barraDoc.exists() || barraDoc.data().unidades < unidades) throw new Error(`Stock insuficiente para ${product.nombre}.`);
            t.update(barraRef, { unidades: increment(-unidades) });
            t.set(doc(collection(db, 'shifts', appState.activeShift.id, 'sales')), { productId, unidades, precioUnitVenta: product.precioVenta, precioFicha: product.precioFicha, totalVenta: unidades * product.precioVenta, totalFichas: unidades * product.precioFicha, fecha: serverTimestamp() });
        });
        showToast('Venta registrada');
        form.reset();
    } catch(err) { showToast(err.message, 'error'); } finally { showLoader(false); }
}

async function handleLoanFormSubmit(form) {
    if (!appState.activeShift) return;
    const valor = parseFloat(form.querySelector('#loan-value').value);
    const descripcion = form.querySelector('#loan-description').value;
    if (isNaN(valor) || !descripcion) return;
    showLoader(true);
    try {
        await addDoc(collection(db, 'shifts', appState.activeShift.id, 'loans'), { descripcion, valor, fecha: serverTimestamp() });
        showToast('Préstamo registrado.');
        form.reset();
    } catch(e) { showToast(e.message, 'error'); } finally { showLoader(false); }
}

async function handleCloseShift() {
    if (!appState.activeShift || !confirm('¿Cerrar y liquidar turno?')) return;
    showLoader(true);
    const shift = appState.activeShift;
    const worker = appState.workers.find(w => w.id === shift.workerId);
    const ingresosBrutos = shift.sales.reduce((s, sale) => s + sale.totalVenta, 0);
    const fichasGanadas = shift.sales.reduce((s, sale) => s + sale.totalFichas, 0);
    const prestamos = shift.loans.reduce((s, loan) => s + loan.valor, 0);
    const totalAPagar = (shift.pagoBase || 0) + fichasGanadas - prestamos;

    try {
        const batch = writeBatch(db);
        batch.update(doc(collections.shifts, shift.id), { estado: 'cerrado', fin: serverTimestamp() });
        batch.set(doc(collections.workerSettlements), { workerId: shift.workerId, shiftId: shift.id, ingresosBrutos, fichasGanadas, prestamos, pagoBase: shift.pagoBase || 0, totalAPagar, fecha: serverTimestamp() });
        batch.set(doc(collections.cashflow_entries), { type: 'ingreso', amount: ingresosBrutos, description: `Cierre turno ${worker?.nombre || ''}`, date: serverTimestamp() });
        if (totalAPagar > 0) {
            batch.set(doc(collections.cashflow_entries), { type: 'egreso', amount: totalAPagar, description: `Pago liquidación ${worker?.nombre || ''}`, date: serverTimestamp() });
        }
        await batch.commit();
        showToast('Turno cerrado y liquidado');
    } catch (error) { showToast(error.message, 'error'); } finally { showLoader(false); }
}

async function handleProviderSettlement(providerId) {
    const provider = appState.providers.find(p => p.id === providerId);
    if (!provider || !confirm(`¿Pagar ${formatCurrency(provider.saldoPendiente)} a ${provider.nombre}?`)) return;
    
    showLoader(true);
    try {
        const batch = writeBatch(db);
        batch.set(doc(collections.providerSettlements), { providerId, montoPagado: provider.saldoPendiente, fecha: serverTimestamp() });
        batch.update(doc(collections.providers, providerId), { saldoPendiente: 0 });
        batch.set(doc(collections.cashflow_entries), { type: 'egreso', amount: provider.saldoPendiente, description: `Pago liquidación a proveedor: ${provider.nombre}`, date: serverTimestamp() });
        await batch.commit();
        showToast('Proveedor liquidado');
        document.getElementById('settlement-details').classList.add('hidden');
    } catch (err) { showToast(err.message, 'error'); } finally { showLoader(false); }
}

async function handleSeedData() {
    if (appState.role !== 'admin' || !confirm('¿Cargar datos de ejemplo?')) return;
    showLoader(true);
    try {
        const batch = writeBatch(db);
        const providerRef = doc(collections.providers);
        batch.set(providerRef, { nombre: "Distribuciones XYZ", consignacion: true, saldoPendiente: 0, contacto: "demo@xyz.com" });
        const workerRef = doc(collections.workers);
        batch.set(workerRef, { nombre: "María Pérez", activo: true, pagoBase: 30000 });
        const productRef = doc(collections.products);
        batch.set(productRef, { nombre: "Cerveza 330ml", precioVenta: 8000, precioCompra: 2000, precioFicha: 1000, unidadesPorCaja: 24, unidadesPorCanasta: 12, activo: true });
        batch.set(doc(db, 'inventory', productRef.id, 'stock', 'bodega'), { unidades: 0 });
        batch.set(doc(db, 'inventory', productRef.id, 'stock', 'barra'), { unidades: 0 });
        await batch.commit();
        showToast('Datos de demo cargados', 'success');
    } catch(e){showToast(e.message, 'error');} finally {showLoader(false);}
}
