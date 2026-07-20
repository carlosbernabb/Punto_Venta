const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://laskydhitnaovxfksthd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'app-updates';
const REMOTE_PATH = 'windows/latest.yml';

if (!SUPABASE_KEY) {
  throw new Error('Define SUPABASE_SECRET_KEY para publicar el manifiesto puente.');
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = packageJson.version;
const installerName = `Punto de Venta ${version}.exe`;
const releaseUrl = `https://github.com/carlosbernabb/Punto_Venta/releases/download/v${version}/${encodeURIComponent(installerName)}`;
const sourcePath = path.join(__dirname, '..', 'dist', 'latest.yml');

if (!fs.existsSync(sourcePath)) {
  throw new Error('No se encontro dist/latest.yml. Ejecuta npm run dist antes de publicar.');
}

const sourceManifest = fs.readFileSync(sourcePath, 'utf8');
const bootstrapManifest = sourceManifest
  .replace(/^  - url: .*$/m, `  - url: ${releaseUrl}`)
  .replace(/^path: .*$/m, `path: ${releaseUrl}`);

if (!bootstrapManifest.includes(`version: ${version}`) || !bootstrapManifest.includes(releaseUrl)) {
  throw new Error('No se pudo preparar el manifiesto puente de actualizacion.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function publish() {
  const { error } = await supabase.storage.from(BUCKET).upload(
    REMOTE_PATH,
    Buffer.from(bootstrapManifest, 'utf8'),
    {
      contentType: 'text/yaml; charset=utf-8',
      cacheControl: '60',
      upsert: true,
    },
  );

  if (error) throw error;
  console.log(`Manifiesto puente v${version} publicado en ${BUCKET}/${REMOTE_PATH}.`);
}

publish().catch((error) => {
  console.error('No se pudo publicar el manifiesto puente:', error.message || error);
  process.exitCode = 1;
});
