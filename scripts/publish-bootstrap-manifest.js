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
const sourcePath = path.join(__dirname, '..', 'dist', 'latest.yml');

if (!fs.existsSync(sourcePath)) {
  throw new Error('No se encontro dist/latest.yml. Ejecuta npm run dist antes de publicar.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function publish() {
  const releaseBaseUrl = `https://github.com/carlosbernabb/Punto_Venta/releases/download/v${version}/`;
  const releaseManifestUrl = `${releaseBaseUrl}latest.yml`;
  const response = await fetch(releaseManifestUrl);

  if (!response.ok) {
    throw new Error(`No se encontro el manifiesto del Release v${version}.`);
  }

  const releaseManifest = await response.text();
  const artifactMatch = releaseManifest.match(/^  - url: (.+)$/m);

  if (!releaseManifest.includes(`version: ${version}`) || !artifactMatch) {
    throw new Error('El manifiesto del Release no tiene un instalador valido.');
  }

  const installerUrl = new URL(artifactMatch[1].trim(), releaseBaseUrl).toString();
  const bootstrapManifest = releaseManifest
    .replace(/^  - url: .*$/m, `  - url: ${installerUrl}`)
    .replace(/^path: .*$/m, `path: ${installerUrl}`);

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
