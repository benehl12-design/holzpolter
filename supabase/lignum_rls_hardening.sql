-- Lignum RLS hardening
-- Applied to Supabase project uccocqmihvdxklpheymf.
-- Purpose: company data remains company-scoped; sensitive writes are limited
-- to the owning user or a company admin.

drop policy if exists "admin can update own company" on public.companies;
create policy "admin can update own company" on public.companies for update to public
using (id=get_my_company_id() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=companies.id and (p.is_admin=true or p.role='admin')))
with check (id=get_my_company_id());

drop policy if exists "companies delete" on public.companies;
create policy "companies delete admin only" on public.companies for delete to public
using (id=get_my_company_id() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=companies.id and (p.is_admin=true or p.role='admin')));

drop policy if exists "update profile" on public.profiles;
create policy "update profile own or admin" on public.profiles for update to public
using (company_id=get_my_company_id() and (id=auth.uid() or exists(select 1 from public.profiles me where me.id=auth.uid() and me.company_id=profiles.company_id and (me.is_admin=true or me.role='admin'))))
with check (company_id=get_my_company_id());

drop policy if exists "delete profile" on public.profiles;
create policy "delete profile admin only" on public.profiles for delete to public
using (company_id=get_my_company_id() and exists(select 1 from public.profiles me where me.id=auth.uid() and me.company_id=profiles.company_id and (me.is_admin=true or me.role='admin')));

drop policy if exists "tracks policy" on public.tracks;
create policy "tracks select company" on public.tracks for select to public using (company_id=get_my_company_id());
create policy "tracks insert own" on public.tracks for insert to public with check (company_id=get_my_company_id() and created_by=auth.uid());
create policy "tracks update own or admin" on public.tracks for update to public
using (company_id=get_my_company_id() and (created_by=auth.uid() or exists(select 1 from public.profiles me where me.id=auth.uid() and me.company_id=tracks.company_id and (me.is_admin=true or me.role='admin'))))
with check (company_id=get_my_company_id());
create policy "tracks delete own or admin" on public.tracks for delete to public
using (company_id=get_my_company_id() and (created_by=auth.uid() or exists(select 1 from public.profiles me where me.id=auth.uid() and me.company_id=tracks.company_id and (me.is_admin=true or me.role='admin'))));

drop policy if exists "time_entries policy" on public.time_entries;
create policy "time entries select company" on public.time_entries for select to public using (company_id=get_my_company_id());
create policy "time entries insert own" on public.time_entries for insert to public with check (company_id=get_my_company_id() and profile_id=auth.uid());
create policy "time entries update own or admin" on public.time_entries for update to public
using (company_id=get_my_company_id() and (profile_id=auth.uid() or exists(select 1 from public.profiles me where me.id=auth.uid() and me.company_id=time_entries.company_id and (me.is_admin=true or me.role='admin'))))
with check (company_id=get_my_company_id());
create policy "time entries delete own or admin" on public.time_entries for delete to public
using (company_id=get_my_company_id() and (profile_id=auth.uid() or exists(select 1 from public.profiles me where me.id=auth.uid() and me.company_id=time_entries.company_id and (me.is_admin=true or me.role='admin'))));
