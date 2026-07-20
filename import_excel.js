const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase extraída de src/config/supabase.js
const SUPABASE_URL = 'https://laskydhitnaovxfksthd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc2t5ZGhpdG5hb3Z4ZmtzdGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NzE4ODcsImV4cCI6MjA4NjI0Nzg4N30.iKd1420knEviYzu7rnvEnbTMrpE4bqFsFZuOnH_dlMQ';
const DEFAULT_ORG_ID = '5c433440-9a2b-47d9-9aab-dcdb0303c4ff';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
    console.log("Iniciando importación desde Inventario 2.1.xlsx...");
    try {
        const workbook = xlsx.readFile('Inventario 2.1.xlsx');
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convertimos a JSON, tomando la segunda fila (range: 1) como cabeceras, ya que la fila 0 es un título
        const data = xlsx.utils.sheet_to_json(sheet, { defval: "", range: 1 });

        console.log(`Se encontraron ${data.length} filas en el Excel.`);

        // Descargar las marcas y categorías existentes para evitar duplicados
        let { data: brandsRes } = await supabase.from('brands').select('*');
        let { data: catRes } = await supabase.from('categories').select('*');

        let brands = brandsRes || [];
        let categories = catRes || [];

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        let batch = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];

            // Las columnas exactas del excel, basándonos en la imagen:
            // CÓDIGO | MARCA | CATEGORÍA | NOMBRE PRODUCTO | P. COMPRA | MENUDEO | MAYOREO
            // Nota: En la imagen hay una columna blanca o vacía entre producto y precio, el defval las filtra o podemos buscarlas.

            // Tratamos de buscar la llave exacta, o keys que incluyan la palabra para evitar problemas de espacios
            const getCol = (keyword) => {
                const upperKeyword = keyword.toUpperCase();
                // Búsqueda flexible (ej. "CÒDIGO" en vez de "CÓDIGO")
                const key = Object.keys(row).find(k => {
                    const cleanK = k.trim().toUpperCase()
                        .replace('Ò', 'Ó')
                        .replace('O', 'O');
                    return cleanK.includes(upperKeyword);
                });
                return key ? row[key] : null;
            };

            let barcode = String(getCol('CÓDIGO') || getCol('CÒDIGO') || '').trim();
            // Evitar scientific notation en barcode si xlsx lo parseó mal
            if (barcode.includes('E+')) {
                const key = Object.keys(row).find(k => k.trim().toUpperCase().includes('DIGO'));
                if (key) barcode = String(row[key]);
            }

            let brandName = String(getCol('MARCA') || '').trim() || 'Sin Marca';
            let categoryName = String(getCol('CATEGORÍA') || getCol('CATEGORIA') || '').trim();
            let name = String(getCol('NOMBRE PRODUCTO') || '').trim();

            let pCompra = parseFloat(getCol('P. COMPRA') || getCol('COMPRA')) || 0;
            let pMenudeo = parseFloat(getCol('MENUDEO')) || 0;
            let pMayoreo = parseFloat(getCol('MAYOREO')) || 0;

            if (!name || name === '') {
                skipCount++;
                continue;
            }

            // --- 1. Gestionar MARCA ---
            let brand = brands.find(b => b.name.toLowerCase() === brandName.toLowerCase());
            if (!brand) {
                console.log(`>> Creando nueva marca: ${brandName}`);
                const { data: newBrand, error } = await supabase.from('brands').insert({ name: brandName }).select('*').single();
                if (error) {
                    console.error("Error al crear marca:", error);
                    errorCount++;
                    continue;
                }
                brand = newBrand;
                brands.push(brand);
            }

            // --- 2. Gestionar CATEGORÍA ---
            let category = null;
            if (categoryName !== '') {
                category = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
                if (!category) {
                    console.log(`>> Creando nueva categoría: ${categoryName}`);
                    const { data: newCat, error } = await supabase.from('categories').insert({ name: categoryName }).select('*').single();
                    if (error) {
                        console.error("Error al crear categoría:", error);
                        errorCount++;
                        continue;
                    }
                    category = newCat;
                    categories.push(category);
                }
            }

            // --- 3. Preparar e Insertar PRODUCTO ---
            // Revisar si ya existe un producto con el mismo nombre para no duplicar todo el catálogo si se corre 2 veces
            const { data: existingProduct } = await supabase
                .from('products')
                .select('id')
                .eq('name', name)
                .maybeSingle();

            if (existingProduct) {
                console.log(`- Saltando (Ya existe): ${name}`);
                skipCount++;
                continue;
            }

            let productData = {
                name: name,
                barcode: barcode,
                brand_id: brand.id,
                category_id: category ? category.id : null,
                cost_price: pCompra,
                retail_price: pMenudeo,
                wholesale_price: pMayoreo,
                distributor_price: 0,
                unit_price: pMenudeo,
                organization_id: DEFAULT_ORG_ID,
                is_active: true
            };

            batch.push(productData);

            if (batch.length >= 500) {
                const { error: pError } = await supabase.from('products').insert(batch);
                if (pError) {
                    console.error(`X Error insertando lote de 500:`, pError.message);
                    errorCount += batch.length;
                } else {
                    successCount += batch.length;
                    console.log(`... ${successCount} procesados en lotes ...`);
                }
                batch = [];
            }
        }

        // Insert remaining elements in the last chunk
        if (batch.length > 0) {
            const { error: pError } = await supabase.from('products').insert(batch);
            if (pError) {
                console.error(`X Error insertando lote final:`, pError.message);
                errorCount += batch.length;
            } else {
                successCount += batch.length;
                console.log(`... ${successCount} insertados correctamente ...`);
            }
        }

        console.log(`\n============================`);
        console.log(`🚀 IMPORTACIÓN FINALIZADA`);
        console.log(`✅ Productos Insertados: ${successCount}`);
        console.log(`⏭️  Productos Saltados (sin nombre o repetidos): ${skipCount}`);
        console.log(`❌ Errores: ${errorCount}`);
        console.log(`============================\n`);

    } catch (err) {
        console.error("Error fatal en la importación:", err);
    }
}

run();
