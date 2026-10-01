-- Lignum RLS hardening
-- Applied to Supabase project uccocqmihvdxklpheymf.
-- Company/profile admin policies already exist through is_company_admin(...).
-- These rules narrow tracks and time entries to the owning user or a company admin.

drop policy if exists "tracks policy" on public.tracks;
create policy "tracks select company" on public.tracks for select to public using (company_id=get_my_company_id());
create policy "tracks insert own" on public.tracks for insert to public with check (company_id=get_my_company_id() and created_by=auth.uid());
create policy "tracks update own or admin" on public.tracks for update to public
using (company_id=get_my_company_id() and (created_by=auth.uid() or is_company_admin(company_id)))
with check (company_id=get_my_company_id());
create policy "tracks delete own or admin" on public.tracks for delete to public
using (company_id=get_my_company_id() and (created_by=auth.uid() or is_company_admin(company_id)));

drop policy if exists "time_entries policy" on public.time_entries;
create policy "time entries select company" on public.time_entries for select to public using (company_id=get_my_company_id());
create policy "time entries insert own" on public.time_entries for insert to public with check (company_id=get_my_company_id() and profile_id=auth.uid());
create policy "time entries update own or admin" on public.time_entries for update to public
using (company_id=get_my_company_id() and (profile_id=auth.uid() or is_company_admin(company_id)))
with check (company_id=get_my_company_id());
create policy "time entries delete own or admin" on public.time_entries for delete to public
using (company_id=get_my_company_id() and (profile_id=auth.uid() or is_company_admin(company_id)));
