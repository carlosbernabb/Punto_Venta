const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://laskydhitnaovxfksthd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc2t5ZGhpdG5hb3Z4ZmtzdGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NzE4ODcsImV4cCI6MjA4NjI0Nzg4N30.iKd1420knEviYzu7rnvEnbTMrpE4bqFsFZuOnH_dlMQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    console.log("Fetching stores and products...");

    // 1. Fetch stores
    const { data: stores, error: sErr } = await supabase.from('stores').select('id, name');
    if (sErr) throw sErr;

    // 2. Fetch products
    const { data: products, error: pErr } = await supabase.from('products').select('id, name');
    if (pErr) throw pErr;

    console.log(`Found ${stores.length} stores and ${products.length} products. total combos = ${stores.length * products.length}`);

    let upserts = [];
    for (const store of stores) {
        for (const product of products) {
            upserts.push({
                store_id: store.id,
                product_id: product.id,
                quantity: 100,
                min_stock: 5
            });
        }
    }

    console.log(`Upserting ${upserts.length} records...`);

    // Process Upserts in batches of 100
    let successCount = 0;
    for (let i = 0; i < upserts.length; i += 100) {
        const batch = upserts.slice(i, i + 100);
        const { error } = await supabase.from('inventory').upsert(batch, { onConflict: 'product_id,store_id' });
        if (error) {
            console.error("Upsert error for batch:", error);
        } else {
            successCount += batch.length;
            console.log(`Successfully upserted ${successCount}/${upserts.length}`);
        }
        await sleep(50); // small delay to prevent rate limits
    }

    console.log("Finished updating inventory to 100 for all products across all stores.");
}

run().catch(console.error);
