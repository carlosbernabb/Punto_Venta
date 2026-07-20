CREATE TABLE store_tasks (
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

CREATE POLICY "Enable read access for users in same organization" ON store_tasks FOR SELECT USING ( organization_id IN ( SELECT auth_org_id() ) );

CREATE POLICY "Enable insert access for users in same organization" ON store_tasks FOR INSERT WITH CHECK ( organization_id IN ( SELECT auth_org_id() ) );

CREATE POLICY "Enable update access for users in same organization" ON store_tasks FOR UPDATE USING ( organization_id IN ( SELECT auth_org_id() ) );

CREATE POLICY "Enable delete access for users in same organization" ON store_tasks FOR DELETE USING ( organization_id IN ( SELECT auth_org_id() ) );
