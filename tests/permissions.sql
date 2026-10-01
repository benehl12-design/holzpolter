-- Run after lignum_permission_guards.sql. Every fixture and mutation is rolled back.
begin;
create temporary table lignum_permission_fixture (
  company uuid, other_company uuid, driver uuid, admin uuid, unprovisioned uuid, lkw uuid, harvester uuid
);
insert into lignum_permission_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
grant select on lignum_permission_fixture to authenticated;
insert into public.companies(id,name)
select company,'Lignum permission test' from lignum_permission_fixture
union all select other_company,'Lignum other-company test' from lignum_permission_fixture;
insert into auth.users(id,aud,role,email,raw_user_meta_data)
select driver,'authenticated','authenticated',driver::text||'@example.invalid','{}'::jsonb from lignum_permission_fixture
union all select admin,'authenticated','authenticated',admin::text||'@example.invalid','{}'::jsonb from lignum_permission_fixture
union all select unprovisioned,'authenticated','authenticated',unprovisioned::text||'@example.invalid','{}'::jsonb from lignum_permission_fixture;
insert into public.profiles(id,company_id,name,role,is_admin)
select driver,company,'Test driver','forwarder',false from lignum_permission_fixture
union all select admin,company,'Test admin','forwarder',true from lignum_permission_fixture;
insert into public.markers(id,company_id,created_by,lat,lng,typ,done)
select lkw,company,driver,67,22,'ruecke',false from lignum_permission_fixture
union all select harvester,company,driver,67,22,'harvester',false from lignum_permission_fixture;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',driver,'role','authenticated')::text,true) from lignum_permission_fixture;
do $$
declare changed integer;
begin
  update public.profiles set name='Driver name edited' where id=auth.uid();
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Normal self-profile edits failed'; end if;
  begin
    update public.profiles set is_admin=true where id=auth.uid();
    raise exception 'FAIL: driver could set is_admin';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set role='admin' where id=auth.uid();
    raise exception 'FAIL: driver could set admin role';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set company_id=(select other_company from lignum_permission_fixture) where id=auth.uid();
    raise exception 'FAIL: driver could move company';
  exception when insufficient_privilege then null; end;
  update public.markers set done=true where id=(select harvester from lignum_permission_fixture);
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Normal collected-marker update failed'; end if;
  delete from public.markers where id=(select lkw from lignum_permission_fixture);
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'FAIL: driver deleted LKW marker'; end if;
  begin
    update public.markers set typ='harvester' where id=(select lkw from lignum_permission_fixture);
    raise exception 'FAIL: driver could change LKW type and bypass deletion guard';
  exception when insufficient_privilege then null; end;
  begin
    update public.markers set created_by=(select admin from lignum_permission_fixture) where id=(select harvester from lignum_permission_fixture);
    raise exception 'FAIL: driver could reassign marker author';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.markers(company_id,created_by,lat,lng,typ)
    select company,admin,67,22,'harvester' from lignum_permission_fixture;
    raise exception 'FAIL: driver could forge marker author';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claims',jsonb_build_object('sub',unprovisioned,'role','authenticated')::text,true) from lignum_permission_fixture;
do $$
begin
  begin
    insert into public.profiles(id,company_id,name,role,is_admin)
    select unprovisioned,company,'Uninvited admin','admin',true from lignum_permission_fixture;
    raise exception 'FAIL: unprovisioned user could insert an admin profile in another company';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated')::text,true) from lignum_permission_fixture;
do $$
declare changed integer; result text;
begin
  select public.set_admin_status((select driver from lignum_permission_fixture),true) into result;
  if result<>'ok' then raise exception 'Admin permission RPC failed: %',result; end if;
  update public.profiles set is_admin=false where id=(select driver from lignum_permission_fixture);
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Company admin could not manage permissions'; end if;
  delete from public.markers where id=(select lkw from lignum_permission_fixture);
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Company admin could not delete LKW marker'; end if;
end;
$$;
rollback;
select 'Permission regression checks passed; all fixtures rolled back' as status;
