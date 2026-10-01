-- Lignum: protect role assignments and LKW marker type changes at the database boundary.
-- Registration and driver provisioning run as trusted server roles.
create schema if not exists lignum_private;
revoke all on schema lignum_private from public;
grant usage on schema lignum_private to authenticated, service_role;

create or replace function lignum_private.guard_profile_permissions()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  if new.id is distinct from old.id or new.company_id is distinct from old.company_id then
    raise exception 'Profile identity and company cannot be reassigned' using errcode = '42501';
  end if;
  if (new.is_admin is distinct from old.is_admin or
      (new.role = 'admin') is distinct from (old.role = 'admin'))
     and not public.is_company_admin(old.company_id) then
    raise exception 'Only a company admin may change admin permissions' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function lignum_private.guard_profile_permissions() from public;
grant execute on function lignum_private.guard_profile_permissions() to authenticated, service_role;
drop trigger if exists lignum_guard_profile_permissions on public.profiles;
create trigger lignum_guard_profile_permissions before update on public.profiles
for each row execute function lignum_private.guard_profile_permissions();

drop policy if exists "insert profile" on public.profiles;
drop policy if exists "profile insert company admin" on public.profiles;
create policy "profile insert company admin" on public.profiles for insert to authenticated
with check (company_id = public.get_my_company_id() and public.is_company_admin(company_id));

create or replace function lignum_private.guard_marker_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  if new.id is distinct from old.id or new.company_id is distinct from old.company_id or
     new.created_by is distinct from old.created_by then
    raise exception 'Marker identity, company and creator cannot be reassigned' using errcode = '42501';
  end if;
  if old.typ = 'ruecke' and new.typ is distinct from old.typ and
     not public.is_company_admin(old.company_id) then
    raise exception 'Only a company admin may change a LKW marker type' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function lignum_private.guard_marker_identity() from public;
grant execute on function lignum_private.guard_marker_identity() to authenticated, service_role;
drop trigger if exists lignum_guard_marker_identity on public.markers;
create trigger lignum_guard_marker_identity before update on public.markers
for each row execute function lignum_private.guard_marker_identity();

alter policy "markers insert company" on public.markers to authenticated
with check (company_id = public.get_my_company_id() and created_by = (select auth.uid()));
alter policy "markers delete company with lkw admin guard" on public.markers to authenticated
using (company_id = public.get_my_company_id() and (typ <> 'ruecke' or public.is_company_admin(company_id)));
alter policy "tracks update own or admin" on public.tracks
with check (company_id = public.get_my_company_id() and (created_by = (select auth.uid()) or public.is_company_admin(company_id)));
alter policy "time entries update own or admin" on public.time_entries
with check (company_id = public.get_my_company_id() and (profile_id = (select auth.uid()) or public.is_company_admin(company_id)));
