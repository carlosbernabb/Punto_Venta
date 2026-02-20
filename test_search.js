
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://laskydhitnaovxfksthd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc2t5ZGhpdG5hb3Z4ZmtzdGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NzE4ODcsImV4cCI6MjA4NjI0Nzg4N30.iKd1420knEviYzu7rnvEnbTMrpE4bqFsFZuOnH_dlMQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testSearch(query) {
    console.log(`Searching for "${query}"...`);

    // 1. Brands
    const { data: matchingBrands, error: brandError } = await supabase
        .from('brands')
        .select('id')
        .ilike('name', `%${query}%`);

    if (brandError) {
        console.error('Brand Error:', brandError);
        return;
    }
    console.log('Matching Brands:', matchingBrands);

    const brandIds = matchingBrands?.map(b => b.id) || [];

    // 2. Products
    let orFilter = `barcode.eq.${query},name.ilike.%${query}%`;
    if (brandIds.length > 0) {
        orFilter += `,brand_id.in.(${brandIds.join(',')})`;
    }

    const { data: products, error: prodError } = await supabase
        .from('products')
        .select('*, brand:brands(name)')
        .or(orFilter)
        .limit(20);

    if (prodError) {
        console.error('Product Error:', prodError);
    } else {
        console.log('Products found:', products?.length);
        if (products?.length > 0) console.log('First product:', products[0].name);
    }
}

testSearch('ajo');
