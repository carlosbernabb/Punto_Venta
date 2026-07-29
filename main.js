const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let isClosingAfterSessionClear = false;
const allowedPages = new Set(['login', 'admin-dashboard']);
const uploadSessions = new Map();
const inventorySessions = new Map();
const PHOTO_UPLOAD_PORT = 3737;
const PHOTO_UPLOAD_TTL_MS = 15 * 60 * 1000;
const INVENTORY_QR_TTL_MS = 8 * 60 * 60 * 1000;
const SERVER_INSTANCE_ID = crypto.randomBytes(8).toString('hex');
let photoUploadServer;
let photoUploadServerReadyPromise;
let cleanupUploadSessionsTimer;
let supabaseConfig;
let updateCheckTimer;
let updateInstallPromptOpen = false;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function isSafeLocalPage(page) {
  return allowedPages.has(page);
}

function printerConfigPath() {
  return path.join(app.getPath('userData'), 'printer-config.json');
}

function readPrinterConfig() {
  try {
    return JSON.parse(fs.readFileSync(printerConfigPath(), 'utf8'));
  } catch (error) {
    return {};
  }
}

function writePrinterConfig(config) {
  try {
    fs.writeFileSync(printerConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.warn('No se pudo guardar la configuracion de impresora:', error);
  }
}

function getSupabaseConfig() {
  if (supabaseConfig) return supabaseConfig;

  const configPath = path.join(__dirname, 'src', 'config', 'supabase.js');
  const source = fs.readFileSync(configPath, 'utf8');
  const url = source.match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
  const anonKey = source.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)?.[1];

  if (!url || !anonKey) {
    throw new Error('No se pudo leer la configuracion de Supabase');
  }

  supabaseConfig = { url, anonKey };
  return supabaseConfig;
}

function requestJsonOrText(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const request = https.request({
      method: options.method || 'GET',
      hostname: parsedUrl.hostname,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers: options.headers || {}
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(text ? tryParseJson(text) : null);
          return;
        }

        const parsed = tryParseJson(text);
        reject(new Error(parsed?.message || parsed?.error || text || `HTTP ${response.statusCode}`));
      });
    });

    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function supabaseHeaders(extra = {}) {
  const { anonKey } = getSupabaseConfig();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    ...extra
  };
}

function supabaseRestUrl(table, params = {}) {
  const { url } = getSupabaseConfig();
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) endpoint.searchParams.set(key, value);
  });
  return endpoint.toString();
}

function supabaseRpcUrl(functionName) {
  const { url } = getSupabaseConfig();
  return `${url}/rest/v1/rpc/${functionName}`;
}

async function fetchSupabaseRestPage(table, params, from, to) {
  return requestJsonOrText(supabaseRestUrl(table, params), {
    method: 'GET',
    headers: supabaseHeaders({
      Range: `${from}-${to}`,
      Prefer: 'count=exact'
    })
  });
}

async function fetchSupabaseRestAll(table, params = {}, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchSupabaseRestPage(table, params, from, from + pageSize - 1);
    const items = Array.isArray(page) ? page : [];
    rows.push(...items);
    if (items.length < pageSize) break;
  }
  return rows;
}

async function uploadAvatarToSupabase(fileName, buffer, mimeType) {
  const { url, anonKey } = getSupabaseConfig();
  const uploadUrl = `${url}/storage/v1/object/avatars/${encodeURIComponent(fileName)}`;

  await requestJsonOrText(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
      'Cache-Control': '3600',
      'x-upsert': 'true'
    }
  }, buffer);
}

async function updateCustomerAvatar(customerId, fileName) {
  const { url, anonKey } = getSupabaseConfig();
  const endpoint = new URL(`${url}/rest/v1/customers`);
  endpoint.searchParams.set('id', `eq.${customerId}`);

  const payload = Buffer.from(JSON.stringify({ avatar_url: fileName }), 'utf8');
  await requestJsonOrText(endpoint.toString(), {
    method: 'PATCH',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      Prefer: 'return=minimal'
    }
  }, payload);
}

async function loadInventorySnapshot(storeId) {
  const [products, inventory] = await Promise.all([
    fetchSupabaseRestAll('products', {
      select: 'id,name,barcode,brand:brands(name),category:categories(name)',
      is_active: 'eq.true',
      order: 'name.asc'
    }),
    fetchSupabaseRestAll('inventory', {
      select: 'id,product_id,store_id,quantity,min_stock,updated_at',
      store_id: `eq.${storeId}`
    })
  ]);

  const stockMap = new Map();
  inventory.forEach(row => {
    stockMap.set(row.product_id, row);
  });

  return products.map(product => {
    const stock = stockMap.get(product.id) || {};
    return {
      id: product.id,
      name: product.name,
      barcode: product.barcode || '',
      brand: product.brand?.name || '',
      category: product.category?.name || '',
      quantity: parseFloat(stock.quantity || 0),
      min_stock: stock.min_stock == null ? 10 : parseInt(stock.min_stock || 0),
      updated_at: stock.updated_at || null
    };
  });
}

async function upsertInventoryCount(
  session,
  productId,
  quantity,
  minStock,
  expectedUpdatedAt,
  requestId,
  productName = ''
) {
  const payload = Buffer.from(JSON.stringify({
    p_store_id: session.storeId,
    p_product_id: productId,
    p_quantity: quantity,
    p_min_stock: minStock,
    p_employee_id: session.employeeId || null,
    p_expected_updated_at: expectedUpdatedAt || null,
    p_request_id: requestId,
    p_source: 'qr'
  }), 'utf8');

  const saved = await requestJsonOrText(supabaseRpcUrl('apply_inventory_count_v2'), {
    method: 'POST',
    headers: supabaseHeaders({
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      Prefer: 'return=representation'
    })
  }, payload);

  if (!saved || !['ok', 'conflict'].includes(saved.status)) {
    throw new Error('Supabase no devolvio una confirmacion valida del inventario');
  }

  if (saved.status === 'ok' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('inventory-count-updated', {
      storeId: session.storeId,
      storeName: session.storeName,
      productId,
      productName,
      quantity: parseFloat(saved.quantity || 0),
      minStock: parseInt(saved.minStock || 0, 10),
      oldQty: parseFloat(saved.oldQty || 0),
      deltaQty: parseFloat(saved.deltaQty || 0),
      savedAt: saved.updatedAt
    });
  }

  return {
    ...saved,
    quantity: parseFloat(saved.quantity || 0),
    minStock: parseInt(saved.minStock || 0, 10),
    oldQty: saved.oldQty == null ? null : parseFloat(saved.oldQty),
    deltaQty: saved.deltaQty == null ? null : parseFloat(saved.deltaQty),
    savedAt: saved.updatedAt || null
  };
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  return '127.0.0.1';
}

function sendHtml(response, html, statusCode = 200) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(html);
}

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function getPhotoUploadPage(session) {
  const customerName = escapeHtml(session.customerName || 'Cliente');
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Foto de cliente</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f4f7f0; color: #172018; min-height: 100vh; display: grid; place-items: center; padding: 20px; box-sizing: border-box; }
    main { width: min(420px, 100%); background: #fff; border-radius: 16px; padding: 22px; box-shadow: 0 16px 40px rgba(16, 43, 12, .16); }
    h1 { font-size: 1.35rem; margin: 0 0 4px; }
    p { margin: 0 0 18px; color: #5f6b5b; }
    input, button { width: 100%; box-sizing: border-box; font: inherit; }
    input { border: 1px solid #cfd8c9; border-radius: 10px; padding: 12px; background: #fbfcfa; }
    button { margin-top: 14px; border: 0; border-radius: 10px; padding: 13px; background: #164f0e; color: white; font-weight: 700; }
    button:disabled { opacity: .65; }
    img { display: none; width: 160px; height: 160px; object-fit: cover; border-radius: 50%; margin: 16px auto 0; border: 4px solid #eef5ea; }
    .status { margin-top: 14px; min-height: 22px; text-align: center; font-weight: 650; }
    .ok { color: #176917; }
    .error { color: #b42318; }
  </style>
</head>
<body>
  <main>
    <h1>Foto de ${customerName}</h1>
    <p>Toma una foto o elige una imagen para subirla a este cliente.</p>
    <input id="photoInput" type="file" accept="image/*" capture="environment">
    <img id="preview" alt="Vista previa">
    <button id="uploadBtn" type="button" disabled>Subir foto</button>
    <div id="status" class="status"></div>
  </main>
  <script>
    const input = document.getElementById('photoInput');
    const preview = document.getElementById('preview');
    const button = document.getElementById('uploadBtn');
    const statusEl = document.getElementById('status');
    let selectedDataUrl = '';

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      button.disabled = true;
      selectedDataUrl = '';
      statusEl.textContent = '';
      statusEl.className = 'status';
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        selectedDataUrl = reader.result;
        preview.src = selectedDataUrl;
        preview.style.display = 'block';
        button.disabled = false;
      };
      reader.readAsDataURL(file);
    });

    button.addEventListener('click', async () => {
      if (!selectedDataUrl) return;
      button.disabled = true;
      statusEl.textContent = 'Subiendo foto...';
      statusEl.className = 'status';
      try {
        const response = await fetch(location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: selectedDataUrl })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo subir la foto');
        statusEl.textContent = 'Foto subida. Ya puedes cerrar esta pantalla.';
        statusEl.className = 'status ok';
      } catch (error) {
        statusEl.textContent = error.message || 'Error al subir la foto';
        statusEl.className = 'status error';
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function getInventoryCountPage(session) {
  const storeName = escapeHtml(session.storeName || 'Tienda');
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inventario - ${storeName}</title>
  <style>
    :root { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172018; background: #f4f7f0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f7f0; }
    header { position: sticky; top: 0; z-index: 2; background: rgba(244, 247, 240, .96); backdrop-filter: blur(10px); padding: 14px 14px 10px; border-bottom: 1px solid #dfe8d8; }
    .topbar { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
    h1 { margin: 0; font-size: 1.2rem; }
    .store { color: #60725a; margin-top: 2px; font-size: .9rem; }
    .ping-btn { width: 42px; height: 42px; flex: 0 0 42px; border-radius: 12px; padding: 0; display: grid; place-items: center; background: #2563eb; font-size: 1.1rem; line-height: 1; }
    .ping-btn::before { content: '↻'; }
    .search { width: 100%; margin: 10px 0 12px; padding: 12px 14px; border: 1px solid #cddac7; border-radius: 12px; font: inherit; background: white; }
    .summary { display: flex; justify-content: space-between; gap: 10px; margin-top: 9px; color: #60725a; font-size: .82rem; }
    .link-status { display: none; margin-top: 7px; min-height: 18px; color: #60725a; font-size: .82rem; font-weight: 700; }
    main { padding: 10px 14px 28px; }
    .item { background: white; border: 1px solid #e1eadb; border-radius: 14px; padding: 13px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(18, 45, 8, .05); }
    .name { font-weight: 800; line-height: 1.25; }
    .meta { margin-top: 4px; color: #72806d; font-size: .8rem; }
    .controls { display: grid; grid-template-columns: 1fr 1fr auto; gap: 9px; align-items: end; margin-top: 12px; }
    label { color: #43513f; font-size: .74rem; font-weight: 750; text-transform: uppercase; letter-spacing: .04em; }
    input[type=number] { width: 100%; margin-top: 5px; border: 1px solid #cddac7; border-radius: 10px; padding: 11px 9px; font: inherit; font-size: 1.05rem; text-align: center; }
    button { border: 0; border-radius: 10px; padding: 12px 14px; background: #164f0e; color: white; font-weight: 800; font: inherit; white-space: nowrap; }
    button:disabled { opacity: .6; }
    .status { min-height: 18px; margin-top: 8px; font-size: .82rem; font-weight: 700; }
    .ok { color: #176917; }
    .error { color: #b42318; }
    .log { background: #fff; border: 1px solid #dfe8d8; border-radius: 14px; padding: 9px 12px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(18, 45, 8, .04); }
    .log h2 { margin: 0 0 5px; font-size: .88rem; }
    .log-list { display: grid; gap: 6px; max-height: 52px; overflow: auto; }
    .log-entry { color: #43513f; font-size: .8rem; line-height: 1.2; border-top: 1px solid #edf3e9; padding-top: 6px; }
    .log-entry:first-child { border-top: 0; padding-top: 0; }
    .log-time { color: #72806d; font-size: .76rem; font-weight: 700; }
    .empty { text-align: center; color: #60725a; padding: 28px 10px; }
    @media (max-width: 520px) {
      .controls { grid-template-columns: 1fr 1fr; }
      .controls button { grid-column: 1 / -1; }
    }
    .search-row { display: flex; align-items: center; gap: 8px; margin: 10px 0 12px; }
    .search-row .search { flex: 1; width: auto; margin: 0; }
    .scan-btn { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 12px; padding: 0; display: flex; align-items: center; justify-content: center; background: #1a6610; font-size: 1.25rem; line-height: 1; cursor: pointer; border: 0; }
    #scannerVideo { display: none; position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 99; background: #000; }
    #scannerOverlay { position: fixed; inset: 0; background: transparent; z-index: 100; display: none; flex-direction: column; }
    .scan-ui { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 52px 16px 40px; }
    .scan-guide { width: 260px; height: 140px; border: 3px solid #4ade80; border-radius: 14px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.52); }
    #scanStatus { color: white; font-size: 1rem; font-weight: 700; text-align: center; background: rgba(0,0,0,0.52); padding: 8px 20px; border-radius: 20px; }
    .scan-close-btn { background: rgba(0,0,0,0.52); border: 1.5px solid rgba(255,255,255,0.45); border-radius: 14px; padding: 14px 44px; color: white; font: inherit; font-weight: 700; font-size: 1rem; cursor: pointer; }
    .photo-fallback-label { display: none; position: fixed; bottom: 44px; left: 50%; transform: translateX(-50%); background: #164f0e; color: white; padding: 15px 28px; border-radius: 14px; font: inherit; font-weight: 700; font-size: 1rem; z-index: 201; cursor: pointer; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .item.highlight { animation: highlightPulse 1.8s ease; }
    @keyframes highlightPulse { 0%,100% { box-shadow: 0 2px 8px rgba(18,45,8,.05); } 25%,75% { box-shadow: 0 0 0 5px #4ade80, 0 2px 8px rgba(18,45,8,.05); } }
    .notif-not-found { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #b42318; color: white; padding: 14px 22px; border-radius: 14px; font-weight: 700; text-align: center; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.35); min-width: 220px; }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <h1>Conteo de inventario</h1>
        <div class="store">${storeName}</div>
      </div>
      <button id="pingBtn" class="ping-btn" type="button" aria-label="Probar enlace" title="Probar enlace"></button>
    </div>
    <div class="summary"><span id="count">Cargando...</span><span>QR temporal</span></div>
    <div id="linkStatus" class="link-status"></div>
  </header>
  <main>
    <section class="log" aria-live="polite">
      <h2>Registro del iPad</h2>
      <div id="logList" class="log-list"><div class="log-entry">Aqui apareceran las confirmaciones de guardado y enlace.</div></div>
    </section>
    <div class="search-row">
      <input id="search" class="search" placeholder="Buscar por producto, marca o codigo..." autocomplete="off">
      <button id="scanBtn" class="scan-btn" type="button" aria-label="Escanear código" title="Escanear código de barras">📷</button>
    </div>
    <input type="file" id="barcodePhotoInput" accept="image/*" capture="environment" style="display:none">
    <div id="list"><div class="empty">Cargando inventario...</div></div>
  </main>
  <video id="scannerVideo" playsinline autoplay muted></video>
  <div id="scannerOverlay">
    <div class="scan-ui">
      <div id="scanStatus">Iniciando cámara...</div>
      <div class="scan-guide"></div>
      <button id="closeScanBtn" class="scan-close-btn" type="button">✕ Cancelar</button>
    </div>
  </div>
  <label id="photoFallbackLabel" class="photo-fallback-label" for="barcodePhotoInput">📸 Tomar foto para escanear</label>
  <script>
    const list = document.getElementById('list');
    const search = document.getElementById('search');
    const count = document.getElementById('count');
    const pingBtn = document.getElementById('pingBtn');
    const linkStatus = document.getElementById('linkStatus');
    const logList = document.getElementById('logList');
    let products = [];
    let logEntries = [];
    const dirtyProductIds = new Set();
    const pendingRequestIds = new Map();
    let inventoryRefreshTimer = null;

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
    }

    function normalize(value) {
      return String(value || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
    }

    function formatTime(value) {
      const date = value ? new Date(value) : new Date();
      return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function addLog(message, type = 'ok', timeValue = '') {
      logEntries.unshift({ message, type, time: formatTime(timeValue) });
      logEntries = logEntries.slice(0, 12);
      logList.innerHTML = logEntries.map(entry =>
        '<div class="log-entry ' + (entry.type === 'error' ? 'error' : 'ok') + '">' +
          '<div class="log-time">' + escapeHtml(entry.time) + '</div>' +
          '<div>' + escapeHtml(entry.message) + '</div>' +
        '</div>'
      ).join('');
    }

    function newRequestId() {
      if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(char) {
        const random = Math.random() * 16 | 0;
        return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
      });
    }

    async function loadInventory(silent = false) {
      const response = await fetch(location.pathname + '/data');
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo cargar inventario');
      const incoming = result.products || [];

      if (!products.length) {
        products = incoming;
      } else {
        const currentById = new Map(products.map(product => [product.id, product]));
        products = incoming.map(product => {
          const current = currentById.get(product.id);
          return current && dirtyProductIds.has(product.id) ? current : product;
        });
      }

      const activeElement = document.activeElement;
      if (!silent || !activeElement || !activeElement.matches('input[type=number]')) render();
    }

    function render() {
      const term = normalize(search.value.trim());
      const filtered = term
        ? products.filter(p => normalize([p.name, p.barcode, p.brand, p.category].join(' ')).includes(term))
        : products;
      const visible = filtered.slice(0, term ? 500 : 180);
      count.textContent = 'Mostrando ' + visible.length + ' de ' + filtered.length;

      if (!visible.length) {
        list.innerHTML = '<div class="empty">No se encontraron productos.</div>';
        return;
      }

      list.innerHTML = visible.map(p => {
        const meta = [p.barcode ? 'Ref: ' + p.barcode : '', p.brand, p.category].filter(Boolean).join(' | ');
        return '<section class="item" data-id="' + p.id + '">' +
          '<div class="name">' + escapeHtml(p.name) + '</div>' +
          '<div class="meta">' + escapeHtml(meta) + '</div>' +
          '<div class="controls">' +
            '<div><label>Cantidad</label><input type="number" min="0" step="0.001" class="qty" value="' + Number(p.quantity || 0) + '"></div>' +
            '<div><label>Minimo</label><input type="number" min="0" step="1" class="min" value="' + Number(p.min_stock || 0) + '"></div>' +
            '<button type="button" class="save">Guardar</button>' +
          '</div>' +
          '<div class="status"></div>' +
        '</section>';
      }).join('');

      list.querySelectorAll('.item').forEach(row => {
        const productId = row.dataset.id;
        const quantityInput = row.querySelector('.qty');
        const minStockInput = row.querySelector('.min');
        const saveButton = row.querySelector('.save');

        const preserveDraft = () => {
          const product = products.find(item => item.id === productId);
          if (!product) return;

          const draftQuantity = parseFloat(quantityInput.value);
          const draftMinStock = parseInt(minStockInput.value, 10);
          if (!Number.isNaN(draftQuantity)) product.quantity = draftQuantity;
          if (!Number.isNaN(draftMinStock)) product.min_stock = draftMinStock;
          dirtyProductIds.add(productId);
        };

        quantityInput.addEventListener('input', preserveDraft);
        minStockInput.addEventListener('input', preserveDraft);
        saveButton.addEventListener('click', () => saveItem(productId));
      });
    }

    async function saveItem(productId) {
      const row = document.querySelector('[data-id="' + productId + '"]');
      const button = row.querySelector('button');
      const status = row.querySelector('.status');
      const quantity = parseFloat(row.querySelector('.qty').value);
      const minStock = parseInt(row.querySelector('.min').value, 10);
      if (Number.isNaN(quantity) || quantity < 0 || Number.isNaN(minStock) || minStock < 0) {
        status.textContent = 'Revisa las cantidades.';
        status.className = 'status error';
        return;
      }

      button.disabled = true;
      status.textContent = 'Guardando...';
      status.className = 'status';
      try {
        const product = products.find(p => p.id === productId);
        const requestId = pendingRequestIds.get(productId) || newRequestId();
        pendingRequestIds.set(productId, requestId);
        const response = await fetch(location.pathname + '/item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId,
            quantity,
            minStock,
            productName: product?.name || '',
            expectedUpdatedAt: product?.updated_at || null,
            requestId
          })
        });
        const result = await response.json();
        if (response.status === 409 && result.conflict) {
          pendingRequestIds.delete(productId);
          dirtyProductIds.delete(productId);
          if (product) {
            product.quantity = Number(result.quantity || 0);
            product.min_stock = Number(result.minStock || 0);
            product.updated_at = result.updatedAt || null;
          }
          row.querySelector('.qty').value = Number(result.quantity || 0);
          row.querySelector('.min').value = Number(result.minStock || 0);
          const conflictText = 'No se guardo: otro dispositivo cambio este producto. Valor vigente: '
            + Number(result.quantity || 0) + '. Revisa y captura de nuevo.';
          status.textContent = conflictText;
          status.className = 'status error';
          addLog((product?.name || 'Producto') + ': ' + conflictText, 'error');
          return;
        }
        if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo guardar');
        pendingRequestIds.delete(productId);
        dirtyProductIds.delete(productId);
        if (product) {
          product.quantity = Number(result.quantity || 0);
          product.min_stock = Number(result.minStock || 0);
          product.updated_at = result.updatedAt || result.savedAt || null;
        }
        row.querySelector('.qty').value = Number(result.quantity || 0);
        row.querySelector('.min').value = Number(result.minStock || 0);
        const savedText = 'Confirmado en la base ' + formatTime(result.savedAt)
          + '. Cantidad: ' + Number(result.quantity || 0)
          + ', minimo: ' + Number(result.minStock || 0) + '.';
        status.textContent = savedText;
        status.className = 'status ok';
        addLog((product?.name || 'Producto') + ': ' + savedText, 'ok', result.savedAt);
      } catch (error) {
        status.textContent = error.message || 'Error al guardar';
        status.className = 'status error';
        addLog((products.find(p => p.id === productId)?.name || 'Producto') + ': ' + status.textContent, 'error');
      } finally {
        button.disabled = false;
      }
    }

    async function testLink() {
      pingBtn.disabled = true;
      linkStatus.textContent = 'Probando enlace...';
      try {
        const response = await fetch(location.pathname + '/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'ipad' })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo probar el enlace');
        const message = 'Enlazados correctamente con la PC ' + formatTime(result.receivedAt) + '.';
        linkStatus.textContent = message;
        linkStatus.className = 'link-status ok';
        linkStatus.style.display = 'block';
        addLog(message, 'ok', result.receivedAt);
      } catch (error) {
        const message = error.message || 'No se pudo enlazar con la PC';
        linkStatus.textContent = message;
        linkStatus.className = 'link-status error';
        linkStatus.style.display = 'block';
        addLog(message, 'error');
      } finally {
        pingBtn.disabled = false;
      }
    }

    search.addEventListener('input', render);
    pingBtn.addEventListener('click', testLink);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadInventory(true).catch(error => addLog(error.message || 'No se pudo actualizar inventario', 'error'));
      }
    });

    // ── Barcode Scanner ──────────────────────────────────────────────────────
    var scanBtn = document.getElementById('scanBtn');
    var scannerOverlay = document.getElementById('scannerOverlay');
    var scannerVideo = document.getElementById('scannerVideo');
    var closeScanBtn = document.getElementById('closeScanBtn');
    var scanStatus = document.getElementById('scanStatus');
    var barcodePhotoInput = document.getElementById('barcodePhotoInput');
    var photoFallbackLabel = document.getElementById('photoFallbackLabel');
    var scannerActive = false;
    var scannerStream = null;
    var scanFrameId = null;
    var zxingReader = null;

    function loadZxing() {
      return new Promise(function(resolve, reject) {
        if (window.ZXing) { resolve(); return; }
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
        s.onload = resolve;
        s.onerror = function() { reject(new Error('Sin conexión para cargar el escáner')); };
        document.head.appendChild(s);
      });
    }

    function closeScanner() {
      scannerActive = false;
      if (scanFrameId) { cancelAnimationFrame(scanFrameId); scanFrameId = null; }
      if (scannerStream) { scannerStream.getTracks().forEach(function(t) { t.stop(); }); scannerStream = null; }
      if (zxingReader) { try { zxingReader.reset(); } catch(e) {} }
      scannerVideo.srcObject = null;
      scannerVideo.style.display = 'none';
      scannerOverlay.style.display = 'none';
      scanBtn.disabled = false;
      scanBtn.innerHTML = '📷';
    }

    // BarcodeDetector rAF loop — works on iOS 17+ natively, no CDN
    function startBarcodeDetectorLoop() {
      var detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'] });
      function detect() {
        if (!scannerActive) return;
        detector.detect(scannerVideo).then(function(barcodes) {
          if (!scannerActive) return;
          if (barcodes && barcodes.length > 0) {
            closeScanner();
            handleScannedCode(barcodes[0].rawValue);
          } else {
            scanFrameId = requestAnimationFrame(detect);
          }
        }).catch(function() {
          if (scannerActive) scanFrameId = requestAnimationFrame(detect);
        });
      }
      detect();
    }

    function handleScannedCode(code) {
      var trimCode = String(code || '').trim();
      var normalCode = trimCode.replace(/^0+/, '') || '0';
      var found = null;
      for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (!p.barcode) continue;
        var pb = String(p.barcode).trim();
        if (pb === trimCode || (pb.replace(/^0+/, '') || '0') === normalCode) { found = p; break; }
      }
      if (found) {
        addLog('Escaneado: ' + found.name + ' (' + trimCode + ')', 'ok');
        search.value = String(found.barcode || found.name || '');
        render();
        setTimeout(function() {
          var el = document.querySelector('[data-id="' + found.id + '"]');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight');
            setTimeout(function() { el.classList.remove('highlight'); }, 2000);
          }
        }, 120);
      } else {
        addLog('Código: ' + trimCode + ' — Producto no encontrado', 'error');
        var notif = document.createElement('div');
        notif.className = 'notif-not-found';
        notif.innerHTML = '<strong>Producto no encontrado</strong><br>Código: ' + escapeHtml(trimCode);
        document.body.appendChild(notif);
        setTimeout(function() { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 3500);
      }
    }

    // getUserMedia is blocked on iOS over HTTP local IPs — always use photo input on iOS.
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    scanBtn.addEventListener('click', async function() {
      if (scannerActive) return;

      if (isIOS || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        barcodePhotoInput.value = '';
        barcodePhotoInput.click();
        return;
      }

      // Non-iOS: live scanner
      scannerActive = true;
      scanBtn.disabled = true;
      scannerVideo.style.display = 'block';
      scannerOverlay.style.display = 'flex';
      scanStatus.textContent = 'Iniciando cámara...';

      try {
        scannerStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
        });
        scannerVideo.srcObject = scannerStream;
        await scannerVideo.play();
        scanStatus.textContent = 'Apunta al código de barras...';

        if ('BarcodeDetector' in window) {
          startBarcodeDetectorLoop();
        } else {
          await loadZxing();
          if (!zxingReader) zxingReader = new window.ZXing.BrowserMultiFormatReader();
          zxingReader.decodeFromStream(scannerStream, scannerVideo, function(result, err) {
            if (!scannerActive) return;
            if (result) { closeScanner(); handleScannedCode(result.getText()); }
          });
        }
        scanBtn.disabled = false;
      } catch(err) {
        closeScanner();
        photoFallbackLabel.style.display = 'block';
      }
    });

    closeScanBtn.addEventListener('click', closeScanner);
    scannerOverlay.addEventListener('click', function(e) { if (e.target === scannerOverlay) closeScanner(); });

    // Photo fallback: decode barcode from captured image (label trigger is synchronous user gesture)
    barcodePhotoInput.addEventListener('change', async function() {
      photoFallbackLabel.style.display = 'none';
      var file = barcodePhotoInput.files[0];
      if (!file) return;
      scanBtn.innerHTML = '⏳';
      scanBtn.disabled = true;
      var url = URL.createObjectURL(file);
      try {
        var code = null;
        if ('BarcodeDetector' in window) {
          try {
            var img = new Image();
            await new Promise(function(res, rej) { img.onload = res; img.onerror = rej; img.src = url; });
            var det = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'] });
            var hits = await det.detect(img);
            if (hits && hits.length) code = hits[0].rawValue;
          } catch(e) { /* fall through to ZXing */ }
        }
        if (!code) {
          await loadZxing();
          if (!zxingReader) zxingReader = new window.ZXing.BrowserMultiFormatReader();
          code = (await zxingReader.decodeFromImageUrl(url)).getText();
        }
        handleScannedCode(code);
      } catch(e) {
        addLog('No se detectó código de barras en la foto', 'error');
        var n = document.createElement('div');
        n.className = 'notif-not-found';
        n.innerHTML = '<strong>No se detectó código</strong><br>Intenta con mejor iluminación';
        document.body.appendChild(n);
        setTimeout(function() { if (n.parentNode) n.parentNode.removeChild(n); }, 4000);
      } finally {
        URL.revokeObjectURL(url);
        scanBtn.innerHTML = '📷';
        scanBtn.disabled = false;
        barcodePhotoInput.value = '';
      }
    });

    loadInventory().catch(error => {
      list.innerHTML = '<div class="empty">' + escapeHtml(error.message || 'Error al cargar inventario') + '</div>';
      count.textContent = 'Error';
      addLog(error.message || 'Error al cargar inventario', 'error');
    });
    inventoryRefreshTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadInventory(true).catch(error => addLog(error.message || 'No se pudo actualizar inventario', 'error'));
    }, 10000);
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readRequestBody(request, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        request.destroy();
        reject(new Error('La imagen es demasiado grande'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) {
    throw new Error('Formato de imagen no valido');
  }

  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const extByMime = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
  };

  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType,
    extension: extByMime[mimeType] || 'jpg'
  };
}

async function uploadCustomerPhoto(token, imageData) {
  const session = uploadSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    uploadSessions.delete(token);
    throw new Error('Este QR ya expiro. Genera uno nuevo.');
  }

  const { buffer, mimeType, extension } = parseDataUrl(imageData);
  const fileName = `customer_${session.customerId}_${Date.now()}.${extension}`;

  await uploadAvatarToSupabase(fileName, buffer, mimeType);
  await updateCustomerAvatar(session.customerId, fileName);
  uploadSessions.delete(token);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('customer-photo-uploaded', {
      customerId: session.customerId,
      avatarUrl: fileName
    });
  }

  return fileName;
}

function cleanupUploadSessions() {
  const now = Date.now();
  for (const [token, session] of uploadSessions.entries()) {
    if (session.expiresAt < now) uploadSessions.delete(token);
  }
  for (const [token, session] of inventorySessions.entries()) {
    if (session.expiresAt < now) inventorySessions.delete(token);
  }
}

function startPhotoUploadServer() {
  if (photoUploadServer?.listening) return Promise.resolve();
  if (photoUploadServerReadyPromise) return photoUploadServerReadyPromise;

  photoUploadServer = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      const photoMatch = requestUrl.pathname.match(/^\/customer-photo\/([a-f0-9]+)$/);
      const inventoryMatch = requestUrl.pathname.match(/^\/inventory-count\/([a-f0-9]+)(?:\/(data|item|ping))?$/);
      if (!photoMatch && !inventoryMatch) {
        sendHtml(response, '<h1>Ruta no encontrada</h1>', 404);
        return;
      }

      if (inventoryMatch) {
        const token = inventoryMatch[1];
        const action = inventoryMatch[2] || '';
        const session = inventorySessions.get(token);
        if (!session || session.expiresAt < Date.now()) {
          inventorySessions.delete(token);
          if (action) sendJson(response, { ok: false, error: 'Este QR ya expiro. Genera uno nuevo.' }, 410);
          else sendHtml(response, '<h1>QR expirado</h1><p>Genera un nuevo QR desde la computadora.</p>', 410);
          return;
        }

        if (request.method === 'GET' && !action) {
          sendHtml(response, getInventoryCountPage(session));
          return;
        }

        if (request.method === 'GET' && action === 'data') {
          const products = await loadInventorySnapshot(session.storeId);
          sendJson(response, { ok: true, storeName: session.storeName, products });
          return;
        }

        if (request.method === 'POST' && action === 'item') {
          if (session.canEditInventory !== true) {
            sendJson(response, { ok: false, error: 'Sin permiso para modificar inventario' }, 403);
            return;
          }

          const body = await readRequestBody(request, 1024 * 1024);
          const payload = JSON.parse(body || '{}');
          const quantity = parseFloat(payload.quantity);
          const minStock = parseInt(payload.minStock, 10);
          const requestId = String(payload.requestId || '');
          const expectedUpdatedAt = payload.expectedUpdatedAt || null;
          if (
            !payload.productId
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
            || Number.isNaN(quantity)
            || quantity < 0
            || Math.round(quantity * 1000) / 1000 !== quantity
            || Number.isNaN(minStock)
            || minStock < 0
          ) {
            sendJson(response, { ok: false, error: 'Cantidades invalidas' }, 400);
            return;
          }

          const saved = await upsertInventoryCount(
            session,
            payload.productId,
            quantity,
            minStock,
            expectedUpdatedAt,
            requestId,
            String(payload.productName || '')
          );
          if (saved.status === 'conflict') {
            sendJson(response, {
              ok: false,
              conflict: true,
              error: 'El inventario cambio en otro dispositivo. No se sobrescribio el valor nuevo.',
              ...saved
            }, 409);
            return;
          }
          sendJson(response, { ok: true, ...saved });
          return;
        }

        if (request.method === 'POST' && action === 'ping') {
          const receivedAt = new Date().toISOString();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('inventory-count-link-test', {
              storeId: session.storeId,
              storeName: session.storeName,
              receivedAt
            });
          }
          sendJson(response, {
            ok: true,
            storeId: session.storeId,
            storeName: session.storeName,
            receivedAt,
            serverInstanceId: SERVER_INSTANCE_ID
          });
          return;
        }

        sendJson(response, { ok: false, error: 'Metodo no permitido' }, 405);
        return;
      }

      const token = photoMatch[1];
      const session = uploadSessions.get(token);
      if (!session || session.expiresAt < Date.now()) {
        uploadSessions.delete(token);
        sendHtml(response, '<h1>QR expirado</h1><p>Genera un nuevo QR desde la computadora.</p>', 410);
        return;
      }

      if (request.method === 'GET') {
        sendHtml(response, getPhotoUploadPage(session));
        return;
      }

      if (request.method === 'POST') {
        const body = await readRequestBody(request);
        const payload = JSON.parse(body || '{}');
        const avatarUrl = await uploadCustomerPhoto(token, payload.imageData);
        sendJson(response, { ok: true, avatarUrl });
        return;
      }

      sendJson(response, { ok: false, error: 'Metodo no permitido' }, 405);
    } catch (error) {
      sendJson(response, { ok: false, error: error.message || 'Error al subir la foto' }, 500);
    }
  });

  photoUploadServerReadyPromise = new Promise((resolve, reject) => {
    const handleListenError = (error) => {
      photoUploadServer = null;
      photoUploadServerReadyPromise = null;
      if (error?.code === 'EADDRINUSE') {
        reject(new Error('El puerto del QR ya esta ocupado por otra instancia del sistema. Cierra el Punto de Venta en segundo plano o reinicia la app.'));
        return;
      }
      reject(error);
    };

    photoUploadServer.once('error', handleListenError);
    photoUploadServer.listen(PHOTO_UPLOAD_PORT, '0.0.0.0', () => {
      photoUploadServer.off('error', handleListenError);
      if (!cleanupUploadSessionsTimer) {
        cleanupUploadSessionsTimer = setInterval(cleanupUploadSessions, 60 * 1000);
        cleanupUploadSessionsTimer.unref();
      }
      resolve();
    });
  });

  return photoUploadServerReadyPromise;
}

async function getSavedOrDefaultPrinterName() {
  const config = readPrinterConfig();
  if (!mainWindow || mainWindow.isDestroyed()) return '';
  const printers = await mainWindow.webContents.getPrintersAsync();
  if (config.printerName && printers.some(printer => printer.name === config.printerName)) {
    return config.printerName;
  }

  const defaultPrinter = printers.find(printer => printer.isDefault) || printers[0];
  if (defaultPrinter?.name) {
    writePrinterConfig({ ...config, printerName: defaultPrinter.name });
    return defaultPrinter.name;
  }
  return '';
}

function createWindow() {
  isClosingAfterSessionClear = false;

  mainWindow = new BrowserWindow({
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'src', 'assets', 'app-icon.ico'),
    show: false
  });

  mainWindow.loadFile('src/pages/login.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();

    // Auto-zoom: ajusta la escala de toda la app según el monitor donde corre.
    // En PCs con DPI alto (125%, 150%) o pantallas pequeñas el viewport CSS efectivo
    // se reduce; si queda por debajo de 720px aplicamos zoom-out proporcional
    // para que login, ventas y todas las secciones entren sin scroll forzado.
    const { workAreaSize, scaleFactor } = screen.getPrimaryDisplay();
    const cssH = workAreaSize.height / scaleFactor;
    if (cssH < 720) {
      const zoom = Math.max(0.70, cssH / 720);
      mainWindow.webContents.setZoomFactor(zoom);
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol !== 'file:') {
      event.preventDefault();
    }
  });

  mainWindow.on('close', async (event) => {
    if (isClosingAfterSessionClear) return;

    event.preventDefault();
    isClosingAfterSessionClear = true;

    try {
      await mainWindow.webContents.executeJavaScript(`
        localStorage.removeItem('userData');
        localStorage.removeItem('authToken');
        localStorage.removeItem('selectedStore');
        sessionStorage.clear();
        true;
      `);
    } catch (error) {
      console.warn('No se pudo limpiar la sesion al cerrar:', error);
    } finally {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initializeAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    // Una tienda puede quedarse temporalmente sin internet. No interrumpir la venta.
    console.warn('No se pudo comprobar o descargar la actualizacion:', error?.message || error);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`Actualizacion ${info.version} disponible; descargando en segundo plano.`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    if (updateInstallPromptOpen) return;
    updateInstallPromptOpen = true;

    try {
      const messageBoxOptions = {
        type: 'info',
        title: 'Actualizacion lista',
        message: `La version ${info.version} ya esta lista para instalar.`,
        detail: 'La aplicacion se cerrara, instalara la actualizacion y volvera a abrirse.',
        buttons: ['Reiniciar e instalar', 'Mas tarde'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      };
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, messageBoxOptions)
        : await dialog.showMessageBox(messageBoxOptions);

      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    } finally {
      updateInstallPromptOpen = false;
    }
  });

  autoUpdater.on('before-quit-for-update', () => {
    // Permitir que el instalador cierre la ventana sin bloquearse en la limpieza normal.
    isClosingAfterSessionClear = true;
  });

  const checkForUpdates = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn('No se pudo buscar una actualizacion:', error?.message || error);
    });
  };

  // Dar tiempo a que login y los servicios locales terminen de iniciar.
  setTimeout(checkForUpdates, 15 * 1000);
  updateCheckTimer = setInterval(checkForUpdates, AUTO_UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref?.();
}

if (hasSingleInstanceLock) {
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    await startPhotoUploadServer();
  } catch (error) {
    console.error('No se pudo iniciar el servidor local de QR:', error);
  }
  createWindow();
  initializeAutoUpdater();
});
}

app.on('window-all-closed', () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Tras un dialogo nativo (alert/confirm/prompt) o una ventana oculta (impresion),
// Windows deja la ventana sin foco de entrada: los clicks y el teclado no responden
// hasta presionar Alt dos veces. Quitar y devolver el foco restablece el enrutamiento.
function refocusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    // El toggle de setEnabled obliga a Windows a recalcular el estado de entrada
    // de la ventana sin quitarle el foco visual (blur/focus causaba un parpadeo).
    mainWindow.setEnabled(false);
    mainWindow.setEnabled(true);
    if (!mainWindow.isFocused()) {
      mainWindow.focus();
    }
    mainWindow.webContents.focus();
  } catch (err) {
    console.warn('No se pudo re-enfocar la ventana:', err);
  }
}

ipcMain.handle('refocus-window', () => {
  refocusMainWindow();
});

ipcMain.handle('get-app-info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron
}));

// --- Configuracion de impresora (por equipo) ---
ipcMain.handle('list-printers', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { printers: [], selected: '' };
  const printers = await mainWindow.webContents.getPrintersAsync();
  const selected = await getSavedOrDefaultPrinterName();
  return {
    printers: printers.map(p => ({ name: p.name, isDefault: !!p.isDefault })),
    selected
  };
});

ipcMain.handle('set-printer', (event, printerName) => {
  if (typeof printerName !== 'string') {
    throw new Error('Impresora no valida');
  }
  const config = readPrinterConfig();
  writePrinterConfig({ ...config, printerName });
  return { ok: true };
});

ipcMain.handle('navigate', (event, page) => {
  if (!isSafeLocalPage(page)) {
    throw new Error('Pagina no permitida');
  }
  mainWindow.loadFile(`src/pages/${page}.html`);
});

ipcMain.handle('get-user-data', () => {
  return mainWindow.webContents.executeJavaScript('localStorage.getItem("userData")');
});

ipcMain.handle('print-html', async (event, html) => {
  if (!html || typeof html !== 'string') {
    throw new Error('No hay contenido para imprimir');
  }

  const printerName = await getSavedOrDefaultPrinterName();
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    await new Promise((resolve, reject) => {
      printWindow.webContents.print({
        silent: true,
        printBackground: true,
        deviceName: printerName || undefined,
        margins: { marginType: 'none' }
      }, (success, failureReason) => {
        if (success) {
          resolve();
        } else {
          reject(new Error(failureReason || 'No se pudo imprimir'));
        }
      });
    });

    return { ok: true, printerName };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
    // La ventana oculta de impresion roba el foco de entrada; devolverlo
    refocusMainWindow();
  }
});

// The formal ticket uses the system dialog so it can be sent to an office
// printer without changing the thermal printer configured for this computer.
ipcMain.handle('print-html-with-dialog', async (event, html) => {
  if (!html || typeof html !== 'string') {
    throw new Error('No hay contenido para imprimir');
  }

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    await new Promise((resolve, reject) => {
      printWindow.webContents.print({
        silent: false,
        printBackground: true,
        margins: { marginType: 'default' }
      }, (success, failureReason) => {
        if (success || failureReason === 'canceled') {
          resolve();
        } else {
          reject(new Error(failureReason || 'No se pudo imprimir'));
        }
      });
    });

    return { ok: true };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
    refocusMainWindow();
  }
});

ipcMain.handle('save-html-as-pdf', async (event, html, suggestedFileName = 'ticket.pdf') => {
  if (!html || typeof html !== 'string') {
    throw new Error('No hay contenido para exportar');
  }

  const safeFileName = `${path.basename(String(suggestedFileName || 'ticket.pdf'), '.pdf') || 'ticket'}.pdf`;
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar ticket en PDF',
    defaultPath: path.join(app.getPath('downloads'), safeFileName),
    filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
  });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await pdfWindow.webContents.printToPDF({
      landscape: false,
      printBackground: true,
      pageSize: 'Letter',
      margins: { marginType: 'default' }
    });
    await fs.promises.writeFile(saveResult.filePath, pdf);
    return { ok: true, filePath: saveResult.filePath };
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.close();
    refocusMainWindow();
  }
});

ipcMain.handle('create-customer-photo-upload-link', async (event, customer) => {
  if (!customer || !customer.id) {
    throw new Error('Cliente invalido');
  }

  await startPhotoUploadServer();
  const token = crypto.randomBytes(18).toString('hex');
  const expiresAt = Date.now() + PHOTO_UPLOAD_TTL_MS;
  uploadSessions.set(token, {
    customerId: customer.id,
    customerName: customer.name || 'Cliente',
    expiresAt
  });

  const url = `http://${getLocalIpAddress()}:${PHOTO_UPLOAD_PORT}/customer-photo/${token}`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 260,
    color: {
      dark: '#164f0e',
      light: '#ffffff'
    }
  });

  return { url, qrDataUrl, expiresAt };
});

ipcMain.handle('create-inventory-count-link', async (event, payload) => {
  if (!payload || (payload.userRole !== 'admin' && payload.canEditInventory !== true)) {
    throw new Error('No tienes permiso para generar este QR');
  }
  if (!payload.storeId) {
    throw new Error('Selecciona una tienda para generar el QR');
  }

  await startPhotoUploadServer();
  cleanupUploadSessions();
  for (const [existingToken, session] of inventorySessions.entries()) {
    if (session.storeId === payload.storeId) inventorySessions.delete(existingToken);
  }

  const token = crypto.randomBytes(18).toString('hex');
  const expiresAt = Date.now() + INVENTORY_QR_TTL_MS;
  inventorySessions.set(token, {
    storeId: payload.storeId,
    storeName: payload.storeName || 'Tienda',
    employeeId: payload.employeeId || null,
    canEditInventory: payload.userRole === 'admin' || payload.canEditInventory === true,
    serverInstanceId: SERVER_INSTANCE_ID,
    expiresAt
  });

  const url = `http://${getLocalIpAddress()}:${PHOTO_UPLOAD_PORT}/inventory-count/${token}?v=${SERVER_INSTANCE_ID}&t=${Date.now()}`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 260,
    color: {
      dark: '#164f0e',
      light: '#ffffff'
    }
  });

  return { url, qrDataUrl, expiresAt, serverInstanceId: SERVER_INSTANCE_ID };
});

ipcMain.handle('revoke-inventory-count-links-for-employee', async (event, employeeId) => {
  if (!employeeId) return { revoked: 0 };

  let revoked = 0;
  for (const [token, session] of inventorySessions.entries()) {
    if (session.employeeId === employeeId) {
      inventorySessions.delete(token);
      revoked++;
    }
  }

  return { revoked };
});
