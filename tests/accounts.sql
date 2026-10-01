-- Fixtures and all account deletions are rolled back.
begin;
create temporary table lignum_account_fixture(company uuid,driver uuid,admin uuid,marker uuid,entry uuid,audit uuid,layer uuid);
insert into lignum_account_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
grant select on lignum_account_fixture to authenticated;
insert into public.companies(id,name) select company,'Lignum account test' from lignum_account_fixture;
insert into auth.users(id,aud,role,email,raw_user_meta_data)
select driver,'authenticated','authenticated',driver::text||'@example.invalid','{}'::jsonb from lignum_account_fixture
union all select admin,'authenticated','authenticated',admin::text||'@example.invalid','{}'::jsonb from lignum_account_fixture;
insert into public.profiles(id,company_id,name,role,is_admin)
select driver,company,'Test driver','forwarder',false from lignum_account_fixture
union all select admin,company,'Test admin','admin',true from lignum_account_fixture;
insert into public.markers(id,company_id,created_by,lat,lng,typ)
select marker,company,driver,67,22,'ruecke' from lignum_account_fixture;
insert into public.time_entries(id,company_id,profile_id,started_at,kategorie)
select entry,company,driver,now(),'ruecken' from lignum_account_fixture;
insert into public.time_entry_audit(id,time_entry_id,company_id,edited_by,action,prev_started_at)
select audit,entry,company,driver,'edit',now()-interval '1 hour' from lignum_account_fixture;
insert into public.geojson_layers(id,company_id,created_by,name,geojson)
select layer,company,driver,'Test map','{"type":"FeatureCollection","features":[]}'::jsonb from lignum_account_fixture;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated')::text,true) from lignum_account_fixture;
do $$begin
  if public.delete_my_account()<>'last_admin' then raise exception 'Last admin was not protected'; end if;
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',driver,'role','authenticated')::text,true) from lignum_account_fixture;
do $$begin
  if public.delete_my_account()<>'ok' then raise exception 'Own account deletion failed'; end if;
  if public.get_my_company_id() is not null then raise exception 'Deleted user retains company access'; end if;
end;$$;
set local role postgres;
do $$begin
  if exists(select 1 from auth.users where id=(select driver from lignum_account_fixture)) then raise exception 'Auth user remains'; end if;
  if exists(select 1 from public.profiles where id=(select driver from lignum_account_fixture)) then raise exception 'Profile remains'; end if;
  if exists(select 1 from public.time_entries where id=(select entry from lignum_account_fixture)) then raise exception 'Personal worktime remains'; end if;
  if not exists(select 1 from public.markers where id=(select marker from lignum_account_fixture) and created_by is null) then raise exception 'Company marker lost'; end if;
  if not exists(select 1 from public.geojson_layers where id=(select layer from lignum_account_fixture) and created_by is null) then raise exception 'Company map lost'; end if;
  if not exists(select 1 from public.time_entry_audit where id=(select audit from lignum_account_fixture)
    and edited_by is null and time_entry_id is null and prev_started_at is not null
    and source_edited_by=(select driver from lignum_account_fixture)
    and source_time_entry_id=(select entry from lignum_account_fixture)) then raise exception 'Audit history lost'; end if;
end;$$;
rollback;
select 'Account deletion checks passed; all fixtures rolled back' as status;
