-- Keep company records and audit correlation when an account is deleted.
alter table public.time_entry_audit add column if not exists source_time_entry_id uuid;
alter table public.time_entry_audit add column if not exists source_edited_by uuid;
update public.time_entry_audit set source_time_entry_id=time_entry_id, source_edited_by=edited_by
where source_time_entry_id is null;
alter table public.time_entry_audit alter column time_entry_id drop not null;
alter table public.time_entry_audit alter column edited_by drop not null;
alter table public.time_entry_audit drop constraint time_entry_audit_time_entry_id_fkey;
alter table public.time_entry_audit add constraint time_entry_audit_time_entry_id_fkey
foreign key(time_entry_id) references public.time_entries(id) on delete set null;
alter table public.time_entry_audit drop constraint time_entry_audit_edited_by_fkey;
alter table public.time_entry_audit add constraint time_entry_audit_edited_by_fkey
foreign key(edited_by) references public.profiles(id) on delete set null;
alter table public.geojson_layers drop constraint geojson_layers_created_by_fkey;
alter table public.geojson_layers add constraint geojson_layers_created_by_fkey
foreign key(created_by) references auth.users(id) on delete set null;

create or replace function lignum_private.stamp_audit_sources()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.source_time_entry_id:=new.time_entry_id;
  new.source_edited_by:=new.edited_by;
  return new;
end;
$$;
revoke all on function lignum_private.stamp_audit_sources() from public;
grant execute on function lignum_private.stamp_audit_sources() to authenticated, service_role;
drop trigger if exists lignum_stamp_audit_sources on public.time_entry_audit;
create trigger lignum_stamp_audit_sources before insert on public.time_entry_audit
for each row execute function lignum_private.stamp_audit_sources();

create or replace function public.get_my_company_id()
returns uuid language sql stable security definer set search_path='' as $$
  select company_id from public.profiles where id=auth.uid() and deleted_at is null limit 1;
$$;
create or replace function public.is_company_admin(target_company uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid()
    and p.company_id=target_company and p.deleted_at is null and (p.is_admin or p.role='admin'));
$$;
revoke execute on function public.get_my_company_id(), public.is_company_admin(uuid) from public, anon;
grant execute on function public.get_my_company_id(), public.is_company_admin(uuid) to authenticated, service_role;
revoke execute on function public.handle_lignum_new_user() from public, anon, authenticated;

create or replace function public.auto_set_drivers_offline()
returns void language sql security invoker set search_path='' as $$
  update public.profiles set is_active=false
  where company_id=public.get_my_company_id() and is_active=true
    and last_seen is not null and last_seen<now()-interval '15 minutes';
$$;

create or replace function public.set_admin_status(target_user_id uuid, make_admin boolean)
returns text language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); company uuid; target public.profiles%rowtype;
begin
  if caller is null then return 'not_authenticated'; end if;
  company:=public.get_my_company_id();
  if company is null or not public.is_company_admin(company) then return 'not_authorized'; end if;
  perform 1 from public.companies where id=company for update;
  select * into target from public.profiles where id=target_user_id and deleted_at is null;
  if not found then return 'target_not_found'; end if;
  if target.company_id is distinct from company then return 'wrong_company'; end if;
  if target_user_id=caller and not make_admin then return 'cannot_demote_self'; end if;
  if (target.is_admin or target.role='admin') and not make_admin and not exists(
    select 1 from public.profiles where company_id=company and id<>target_user_id
      and deleted_at is null and (is_admin or role='admin')
  ) then return 'last_admin'; end if;
  update public.profiles set is_admin=make_admin,
    role=case when not make_admin and role='admin' then 'worker' else role end
  where id=target_user_id;
  return 'ok';
end;
$$;

create or replace function public.delete_my_account()
returns text language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); company uuid;
begin
  if caller is null then return 'not_authenticated'; end if;
  company:=public.get_my_company_id();
  if company is null then return 'profile_not_found'; end if;
  -- Serialize deletion/demotion checks so a company cannot lose its last admin.
  perform 1 from public.companies where id=company for update;
  if public.is_company_admin(company) and not exists(
    select 1 from public.profiles where company_id=company and id<>caller
      and deleted_at is null and (is_admin or role='admin')
  ) then return 'last_admin'; end if;
  -- Revoke refresh sessions first. Removing the profile also denies old JWTs through RLS.
  delete from auth.sessions where user_id=caller;
  delete from auth.users where id=caller;
  return 'ok';
end;
$$;
revoke execute on function public.set_admin_status(uuid,boolean), public.delete_my_account(), public.auto_set_drivers_offline() from public, anon;
grant execute on function public.set_admin_status(uuid,boolean), public.delete_my_account(), public.auto_set_drivers_offline() to authenticated, service_role;
