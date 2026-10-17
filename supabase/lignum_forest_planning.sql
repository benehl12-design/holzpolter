-- Lignum 13.44: company-scoped forest properties and stands.
-- Additive migration; no existing operating data is modified.
create or replace function public.forest_inventory_valid(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; n numeric; total numeric := 0; species jsonb;
begin
  if jsonb_typeof(value) <> 'object' or octet_length(value::text) > 25000 then return false; end if;
  foreach k in array array['volume_m3sk_ha','volume_m3sk','stock_area_ha','mean_height_m','mean_diameter_cm','basal_area_m2_ha','age_years','annual_growth_m3sk_ha','price_sek_m3sk'] loop
    if value ? k then
      if jsonb_typeof(value->k) <> 'number' then return false; end if;
      n := (value->>k)::numeric; if n < 0 or n > 100000000 then return false; end if;
    end if;
  end loop;
  foreach k in array array['scan_year','reference_year','projected_to_year'] loop
    if value ? k then n := (value->>k)::numeric; if n < 1900 or n > 2200 or n <> trunc(n) then return false; end if; end if;
  end loop;
  if value ? 'species_pct' then
    species := value->'species_pct'; if jsonb_typeof(species) <> 'object' then return false; end if;
    foreach k in array array['pine','spruce','birch','other'] loop
      if not species ? k or jsonb_typeof(species->k) <> 'number' then return false; end if;
      n := (species->>k)::numeric; if n < 0 or n > 100 then return false; end if; total := total + n;
    end loop;
    if abs(total-100) > 0.05 then return false; end if;
  end if;
  return true;
exception when others then return false;
end; $$;

create table public.forest_properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 150),
  cadastral_ref text not null default '' check(length(cadastral_ref) <= 200),
  geometry jsonb check(geometry is null or (geometry->>'type' in ('Polygon','MultiPolygon') and jsonb_typeof(geometry->'coordinates')='array' and octet_length(geometry::text) <= 1000000)),
  area_ha numeric not null check(area_ha > 0 and area_ha <= 1000000),
  notes text not null default '' check(length(notes)<=5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,company_id)
);
create table public.forest_stands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  number text not null check(length(trim(number)) between 1 and 40),
  name text not null check(length(trim(name)) between 1 and 150),
  geometry jsonb check(geometry is null or (geometry->>'type' in ('Polygon','MultiPolygon') and jsonb_typeof(geometry->'coordinates')='array' and octet_length(geometry::text) <= 1000000)),
  area_ha numeric not null check(area_ha > 0 and area_ha <= 1000000),
  land_type text not null default 'forest' check(land_type in ('forest','unproductive','wetland','other','water','agriculture')),
  hk_class text not null default '' check(hk_class in ('','K','R','G1','G2','S1','S2','E','NS','NO')),
  inventory jsonb not null default '{}' check(public.forest_inventory_valid(inventory)),
  action text not null default 'none' check(action in ('none','thinning','regeneration','tending','planting','nature')),
  removal_pct numeric not null default 0 check(removal_pct between 0 and 100),
  notes text not null default '' check(length(notes)<=5000),
  area_id uuid references public.areas(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(property_id,company_id) references public.forest_properties(id,company_id) on delete cascade,
  unique(property_id,number)
);
create index forest_properties_company_idx on public.forest_properties(company_id);
create index forest_stands_company_property_idx on public.forest_stands(company_id,property_id);
create index forest_stands_property_company_idx on public.forest_stands(property_id,company_id);
create index forest_stands_area_idx on public.forest_stands(area_id);
create index forest_stands_created_by_idx on public.forest_stands(created_by);
create index forest_properties_created_by_idx on public.forest_properties(created_by);
create or replace function public.forest_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := clock_timestamp(); return new; end; $$;
create trigger forest_properties_updated_at before update on public.forest_properties for each row execute function public.forest_set_updated_at();
create trigger forest_stands_updated_at before update on public.forest_stands for each row execute function public.forest_set_updated_at();
alter table public.forest_properties enable row level security;
alter table public.forest_stands enable row level security;
create policy forest_properties_read on public.forest_properties for select to authenticated using(company_id=(select public.get_my_company_id()));
create policy forest_properties_add on public.forest_properties for insert to authenticated with check(company_id=(select public.get_my_company_id()) and public.is_company_admin(company_id) and created_by=(select auth.uid()));
create policy forest_properties_edit on public.forest_properties for update to authenticated using(public.is_company_admin(company_id)) with check(company_id=(select public.get_my_company_id()) and public.is_company_admin(company_id));
create policy forest_properties_delete on public.forest_properties for delete to authenticated using(public.is_company_admin(company_id));
create policy forest_stands_read on public.forest_stands for select to authenticated using(company_id=(select public.get_my_company_id()));
create policy forest_stands_add on public.forest_stands for insert to authenticated with check(company_id=(select public.get_my_company_id()) and public.is_company_admin(company_id) and created_by=(select auth.uid()));
create policy forest_stands_edit on public.forest_stands for update to authenticated using(public.is_company_admin(company_id)) with check(company_id=(select public.get_my_company_id()) and public.is_company_admin(company_id));
create policy forest_stands_delete on public.forest_stands for delete to authenticated using(public.is_company_admin(company_id));
revoke all on public.forest_properties,public.forest_stands from anon;
grant select,insert,update,delete on public.forest_properties,public.forest_stands to authenticated,service_role;
revoke all on function public.forest_inventory_valid(jsonb) from public;
grant execute on function public.forest_inventory_valid(jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
