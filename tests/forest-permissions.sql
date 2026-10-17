-- Temporary fixtures only; no real account or operating data is changed.
begin;
create temporary table forest_fixture(company uuid,other_company uuid,admin_id uuid,driver_id uuid,property uuid,stand uuid);
insert into forest_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
grant select on forest_fixture to authenticated;
insert into public.companies(id,name) select company,'Forest fixture' from forest_fixture union all select other_company,'Other forest fixture' from forest_fixture;
insert into auth.users(id,aud,role,email,raw_user_meta_data) select admin_id,'authenticated','authenticated',admin_id::text||'@example.invalid','{}'::jsonb from forest_fixture union all select driver_id,'authenticated','authenticated',driver_id::text||'@example.invalid','{}'::jsonb from forest_fixture;
insert into public.profiles(id,company_id,name,role,is_admin) select admin_id,company,'Admin','forwarder',true from forest_fixture union all select driver_id,company,'Driver','harvester',false from forest_fixture;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from forest_fixture;
insert into public.forest_properties(id,company_id,created_by,name,area_ha) select property,company,admin_id,'Property',10 from forest_fixture;
insert into public.forest_stands(id,company_id,property_id,created_by,number,name,area_ha,inventory) select stand,company,property,admin_id,'1','Stand',3,'{"volume_m3sk_ha":200,"species_pct":{"pine":60,"spruce":30,"birch":10,"other":0}}'::jsonb from forest_fixture;
do $$begin
  if (select count(*) from public.forest_stands)<>1 then raise exception 'Admin insert/read failed';end if;
  begin
    insert into public.forest_properties(company_id,created_by,name,area_ha) select other_company,admin_id,'Wrong company',5 from forest_fixture;
    raise exception 'FAIL: cross-company insert allowed';
  exception when insufficient_privilege then null;end;
  begin
    update public.forest_stands set inventory='{"volume_m3sk_ha":-1}'::jsonb where id=(select stand from forest_fixture);
    raise exception 'FAIL: negative inventory allowed';
  exception when check_violation then null;end;
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',driver_id,'role','authenticated')::text,true) from forest_fixture;
do $$declare affected integer;begin
  if (select count(*) from public.forest_stands)<>1 then raise exception 'Driver read failed';end if;
  update public.forest_stands set name='Tampered' where id=(select stand from forest_fixture);get diagnostics affected=row_count;
  if affected<>0 then raise exception 'FAIL: driver edited plan';end if;
  delete from public.forest_properties where id=(select property from forest_fixture);get diagnostics affected=row_count;
  if affected<>0 then raise exception 'FAIL: driver deleted plan';end if;
  begin
    insert into public.forest_stands(company_id,property_id,created_by,number,name,area_ha) select company,property,driver_id,'2','Driver forged',2 from forest_fixture;
    raise exception 'FAIL: driver created stand';
  exception when insufficient_privilege then null;end;
end;$$;
reset role;
update public.profiles set company_id=(select other_company from forest_fixture) where id=(select driver_id from forest_fixture);
set local role authenticated;
do $$begin if (select count(*) from public.forest_stands)<>0 then raise exception 'FAIL: foreign-company plan visible';end if;end;$$;
reset role;
set local role anon;
do $$begin
  begin perform * from public.forest_properties;raise exception 'FAIL: anonymous table access allowed';
  exception when insufficient_privilege then null;end;
end;$$;
rollback;
select 'Forest planning permissions passed; all fixtures rolled back' as status;
