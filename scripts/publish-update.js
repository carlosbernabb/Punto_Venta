const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://laskydhitnaovxfksthd.supabase.co';
const UPDATE_BUCKET = 'app-updates';
const UPDATE_FOLDER = 'windows';
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!secretKey) {
  console.error('Falta SUPABASE_SECRET_KEY. La clave solo debe existir en la PC que publica actualizaciones.');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;
const installerName = `Punto de Venta ${version}.exe`;
const blockmapName = `${installerName}.blockmap`;

const releaseFiles = [
  { name: installerName, contentType: 'application/vnd.microsoft.portable-executable', cacheControl: '31536000' },
  { name: blockmapName, contentType: 'application/octet-stream', cacheControl: '31536000' },
  // El manifiesto va al final: nunca anunciar una version cuyos binarios no terminaron de subir.
  { name: 'latest.yml', contentType: 'text/yaml; charset=utf-8', cacheControl: '60' }
];

const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

function uploadError(context, response, body) {
  const suffix = body ? `: ${body}` : '';
  return new Error(`${context} (${response.status} ${response.statusText})${suffix}`);
}

function toTusMetadata(metadata) {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${Buffer.from(String(value)).toString('base64')}`)
    .join(',');
}

async function uploadLargeFile(file) {
  const localPath = path.join(distDir, file.name);
  const fileSize = fs.statSync(localPath).size;
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  const objectPath = `${UPDATE_FOLDER}/${file.name}`;
  const headers = {
    authorization: `Bearer ${secretKey}`,
    apikey: secretKey,
    'tus-resumable': '1.0.0',
    'x-upsert': 'true'
  };
  const createResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...headers,
      'upload-length': String(fileSize),
      'upload-metadata': toTusMetadata({
        bucketName: UPDATE_BUCKET,
        objectName: objectPath,
        contentType: file.contentType,
        cacheControl: file.cacheControl
      })
    }
  });

  if (!createResponse.ok) {
    throw uploadError('No se pudo iniciar la carga reanudable', createResponse, await createResponse.text());
  }

  const location = createResponse.headers.get('location');
  if (!location) throw new Error('Supabase no devolvio la URL de carga reanudable');

  const uploadUrl = new URL(location, endpoint).toString();
  let offset = Number(createResponse.headers.get('upload-offset') || 0);
  const handle = await fs.promises.open(localPath, 'r');

  try {
    while (offset < fileSize) {
      const length = Math.min(TUS_CHUNK_SIZE, fileSize - offset);
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(chunk, 0, length, offset);
      const payload = bytesRead === length ? chunk : chunk.subarray(0, bytesRead);
      const patchResponse = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          ...headers,
          'upload-offset': String(offset),
          'content-type': 'application/offset+octet-stream',
          'content-length': String(payload.length)
        },
        body: payload
      });

      if (!patchResponse.ok) {
        throw uploadError('No se pudo continuar la carga reanudable', patchResponse, await patchResponse.text());
      }

      const nextOffset = Number(patchResponse.headers.get('upload-offset'));
      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        throw new Error('Supabase no confirmo el avance de la carga reanudable');
      }

      offset = nextOffset;
      console.log(`${file.name}: ${Math.min(100, Math.round((offset / fileSize) * 100))}%`);
    }
  } finally {
    await handle.close();
  }
}

for (const file of releaseFiles) {
  if (!fs.existsSync(path.join(distDir, file.name))) {
    console.error(`Falta dist/${file.name}. Ejecuta npm run dist antes de publicar.`);
    process.exit(1);
  }
}

const manifest = fs.readFileSync(path.join(distDir, 'latest.yml'), 'utf8');
if (!manifest.includes(`version: ${version}`) || !manifest.includes(`path: ${installerName}`)) {
  console.error('latest.yml no corresponde a la version actual. Vuelve a ejecutar npm run dist.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function publishRelease() {
  for (const file of releaseFiles) {
    const localPath = path.join(distDir, file.name);
    const remotePath = `${UPDATE_FOLDER}/${file.name}`;
    process.stdout.write(`Subiendo ${file.name}... `);

    if (fs.statSync(localPath).size > TUS_CHUNK_SIZE) {
      console.log('carga reanudable');
      await uploadLargeFile(file);
      console.log('OK');
      continue;
    }

    const { error } = await supabase.storage
      .from(UPDATE_BUCKET)
      .upload(remotePath, fs.readFileSync(localPath), {
        upsert: true,
        contentType: file.contentType,
        cacheControl: file.cacheControl
      });

    if (error) throw error;
    console.log('OK');
  }

  console.log(`Version ${version} publicada correctamente.`);
}

publishRelease().catch((error) => {
  console.error('No se pudo publicar la actualizacion:', error.message || error);
  process.exit(1);
});
