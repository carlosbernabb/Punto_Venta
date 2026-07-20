const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const cfg = fs.readFileSync(path.join(__dirname, 'src', 'config', 'supabase.js'), 'utf8');
const supabaseUrl = cfg.match(/SUPABASE_URL = '([^']+)'/)[1];
const supabaseKey = cfg.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1];
const supabase = createClient(supabaseUrl, supabaseKey);

const outDir = path.join(__dirname, 'dist', 'reportes');
const htmlPath = path.join(outDir, 'productos_mayoreo_cliente.html');
const pdfPath = path.join(outDir, 'productos_mayoreo_cliente.pdf');

const money = (value) => {
  const number = Number(value || 0);
  return number.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
};

const clean = (value) => (value || '').toString().trim();
const upper = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const byName = (a, b) => clean(a.displayName || a.name).localeCompare(clean(b.displayName || b.name), 'es-MX');

function row(product, displayName) {
  return {
    name: product.name,
    displayName: displayName || product.name,
    wholesale: product.wholesale_price,
  };
}

function rows(products, predicate, display = (p) => p.name) {
  return products.filter(predicate).map((p) => row(p, display(p))).sort(byName);
}

async function loadProducts() {
  const products = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('name, barcode, retail_price, wholesale_price, is_active')
      .eq('is_active', true)
      .order('name')
      .range(from, from + 999);

    if (error) throw error;
    products.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return products;
}

function buildGroups(products) {
  const u = (p) => upper(`${p.name} ${p.barcode || ''}`);
  const has = (p, text) => u(p).includes(upper(text));

  return [
    { title: 'Eucalin', items: rows(products, (p) => has(p, 'EUCALIN')) },
    { title: 'Pulmo bronquio', items: rows(products, (p) => has(p, 'BRONQUIO') || has(p, 'BRONQUIOLIN')) },
    { title: 'Pulmo calcio', items: rows(products, (p) => has(p, 'PULMO CALCIO')) },
    { title: 'Castaña de indias', items: rows(products, (p) => has(p, 'CASTANA DE INDIAS') || has(p, 'CASTANO DE INDIAS')) },
    { title: 'Artri King', items: rows(products, (p) => has(p, 'ARTRI FAN KING') || has(p, 'ARTRIFAN KING') || has(p, 'AJO KING ARTRITIS')) },
    {
      title: 'Mariguanon',
      items: [
        { displayName: 'MARIGUANON GEL 250 G', wholesale: 25 },
        { displayName: 'POMADA MARIGUANON 250 G', wholesale: 30 },
      ],
      note: 'Nombre y presentaciones ajustadas segun indicacion interna.',
    },
    { title: 'Pomada de peyote', items: rows(products, (p) => has(p, 'PEYOTE')) },
    { title: 'Bálsamo blanco', items: rows(products, (p) => has(p, 'BALSAMO BLANCO')) },
    { title: 'Gotas de zanahoria', items: rows(products, (p) => has(p, 'ZANAHORIA')) },
    { title: 'Bio Relax', items: rows(products, (p) => has(p, 'RELAX')) },
    { title: 'Piñalim', items: rows(products, (p) => has(p, 'PINALIM')) },
    {
      title: 'Me vale madre gotas',
      items: rows(
        products,
        (p) => has(p, 'MVM GOTAS'),
        (p) => p.name.replace(/^MVM/i, 'ME VALE MADRE')
      ),
    },
    { title: 'Duo colitis', items: rows(products, (p) => has(p, 'DUO LIFE COLITIS') || has(p, 'COLITIS')) },
    { title: 'Ajo negro', items: rows(products, (p) => has(p, 'AJO NEGRO')) },
    {
      title: 'Colágeno cápsulas',
      items: rows(products, (p) => has(p, 'COLAGENO') && /(CAP|CAPS|CAPSULAS|TAB|TABS|SOFTGEL|GOMITAS)/.test(u(p))),
    },
    { title: 'Sukrol vigor', items: rows(products, (p) => has(p, 'SUKROL VIGOR') || has(p, 'SUKROLL VIGOR')) },
    { title: 'Ajo King', items: rows(products, (p) => has(p, 'AJO KING')) },
    { title: 'Ginkgo biloba', items: rows(products, (p) => has(p, 'GINKGO BILOBA')) },
    {
      title: 'Aceites esenciales',
      items: rows(products, (p) => has(p, 'ACEITE ESENCIAL') || has(p, 'ACEITE ESCENCIAL') || has(p, 'ACEITE ESENCIALE') || has(p, 'ESENTIAL OILS')),
    },
    { title: 'Clorofila', items: rows(products, (p) => has(p, 'CLOROFILA')) },
    { title: 'Shampoo cola de caballo', items: rows(products, (p) => has(p, 'SHAMPOO') && (has(p, 'COLA DE CABALLO') || has(p, 'CABALLO'))) },
    { title: 'Shampoo de bergamota', items: rows(products, (p) => has(p, 'SHAMPOO') && has(p, 'BERGAMOTA')) },
    { title: 'Gomitas de melatonina', items: rows(products, (p) => has(p, 'MELATONINA') && (has(p, 'GOMITA') || has(p, 'GUMI'))) },
    {
      title: 'Chupapanza',
      items: rows(
        products,
        (p) => has(p, 'SINPAN'),
        (p) => p.name.replace(/^SINPAN/i, 'CHUPAPANZA')
      ),
      note: 'En sistema aparece como SINPAN; aqui se muestra como Chupapanza para el cliente.',
    },
    { title: 'Raíz de tejocote', items: rows(products, (p) => has(p, 'RAIZ DE TEJOCOTE') || has(p, 'ALIPOTEC')) },
    { title: 'Ajo King diabetes', items: rows(products, (p) => has(p, 'AJO KING DIABETES')) },
    { title: 'Ajo King próstata', items: rows(products, (p) => has(p, 'AJO KING PROSTATA')) },
    {
      title: 'Aceite de coco',
      items: rows(products, (p) => {
        const name = upper(p.name);
        return name.startsWith('ACEITE DE COCO') || name.startsWith('ACITE DE COCO');
      }),
    },
  ].filter((group) => group.items.length > 0);
}

function renderHtml(groups) {
  const date = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const body = groups.map((group) => `
    <section class="group">
      <h2>${escapeHtml(group.title)}</h2>
      ${group.note ? `<p class="note">${escapeHtml(group.note)}</p>` : ''}
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th class="price">Mayoreo</th>
          </tr>
        </thead>
        <tbody>
          ${group.items.map((item) => `
            <tr>
              <td>${escapeHtml(item.displayName || item.name)}</td>
              <td class="price">${money(item.wholesale)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `).join('');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Productos solicitados - Mayoreo</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1f2a24;
      font-family: "Segoe UI", Arial, sans-serif;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.35;
    }
    header {
      border-bottom: 3px solid #2f6b3c;
      margin-bottom: 18px;
      padding-bottom: 12px;
    }
    h1 {
      margin: 0;
      color: #174f25;
      font-size: 25px;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 5px 0 0;
      color: #667267;
      font-size: 12px;
    }
    .group {
      break-inside: avoid;
      margin: 0 0 18px;
    }
    h2 {
      margin: 0 0 7px;
      padding: 7px 10px;
      border-radius: 6px;
      background: #edf5eb;
      color: #174f25;
      font-size: 15px;
      letter-spacing: 0;
    }
    .note {
      margin: -2px 0 7px;
      color: #6d756e;
      font-size: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #dce6d9;
      border-radius: 6px;
      overflow: hidden;
    }
    th {
      background: #f6f8f4;
      color: #566456;
      font-size: 10px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    th, td {
      border-bottom: 1px solid #e3eadf;
      padding: 6px 8px;
      vertical-align: top;
    }
    tr:last-child td { border-bottom: 0; }
    .price {
      width: 110px;
      text-align: right;
      white-space: nowrap;
      font-weight: 700;
      color: #17602f;
    }
    footer {
      margin-top: 20px;
      color: #7d877d;
      font-size: 10px;
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <h1>Productos solicitados - precios de mayoreo</h1>
    <p class="subtitle">La Casa del Ajo · Generado el ${escapeHtml(date)}</p>
  </header>
  ${body}
  <footer>Precios consultados en el catálogo del sistema. Revisar disponibilidad por sucursal al momento de venta.</footer>
</body>
</html>`;
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const products = await loadProducts();
  const groups = buildGroups(products);
  fs.writeFileSync(htmlPath, renderHtml(groups), 'utf8');

  const edgePath = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => fs.existsSync(candidate));

  if (!edgePath) {
    throw new Error('No se encontro Microsoft Edge para generar el PDF.');
  }

  execFileSync(edgePath, [
    '--headless',
    '--disable-gpu',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'inherit' });

  console.log(pdfPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
