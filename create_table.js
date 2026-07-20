require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function createTable() {
    console.log("Attempting to create store_tasks table...");
    const { data, error } = await supabase.rpc('execute_sql', {
        sql_query: `
      CREATE TABLE IF NOT EXISTS store_tasks (
          id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          task_name TEXT NOT NULL,
          task_date DATE NOT NULL,
          is_completed BOOLEAN DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE store_tasks ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS "Enable read access for users in same organization" ON store_tasks;
      CREATE POLICY "Enable read access for users in same organization" ON store_tasks FOR SELECT USING ( organization_id IN ( SELECT auth_org_id() ) );
      
      DROP POLICY IF EXISTS "Enable insert access for users in same organization" ON store_tasks;
      CREATE POLICY "Enable insert access for users in same organization" ON store_tasks FOR INSERT WITH CHECK ( organization_id IN ( SELECT auth_org_id() ) );
      
      DROP POLICY IF EXISTS "Enable update access for users in same organization" ON store_tasks;
      CREATE POLICY "Enable update access for users in same organization" ON store_tasks FOR UPDATE USING ( organization_id IN ( SELECT auth_org_id() ) );
      
      DROP POLICY IF EXISTS "Enable delete access for users in same organization" ON store_tasks;
      CREATE POLICY "Enable delete access for users in same organization" ON store_tasks FOR DELETE USING ( organization_id IN ( SELECT auth_org_id() ) );
    `
    });

    if (error) {
        console.error("Error creating table via RPC:", error);
        // If we don't have the RPC function, we might just have to do it manually or via the Supabase dashboard.
    } else {
        console.log("Success:", data);
    }
}

createTable();
