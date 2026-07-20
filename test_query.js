const { createClient } = require('@supabase/supabase-js');

// Config from src/config/supabase.js
const SUPABASE_URL = 'https://laskydhitnaovxfksthd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc2t5ZGhpdG5hb3Z4ZmtzdGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NzE4ODcsImV4cCI6MjA4NjI0Nzg4N30.iKd1420knEviYzu7rnvEnbTMrpE4bqFsFZuOnH_dlMQ';

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
    const { data, error } = await supabaseClient
        .from('recipes')
        .select('*, category:recipe_categories(name), products:recipe_products(usage_instructions, product:products(*))')
        .order('name');
    console.log("Error:", error);
    console.log("Data count:", data ? data.length : 0);
}

test();
