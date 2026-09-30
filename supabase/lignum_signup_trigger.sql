-- Lignum v13.33
-- Run once in Supabase SQL Editor.
-- Creates a company + admin profile automatically for self-registered users.

create or replace function public.handle_lignum_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_name text;
  v_name text;
begin
  v_company_name := nullif(trim(new.raw_user_meta_data ->> 'company_name'), '');
  v_name := nullif(trim(new.raw_user_meta_data ->> 'name'), '');

  -- Only the public "new company" signup carries company_name.
  -- Driver/invited accounts are therefore left to the existing admin flow.
  if v_company_name is null then
    return new;
  end if;

  insert into public.companies (name, contact_email)
  values (v_company_name, new.email)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, name, role, is_admin)
  values (
    new.id,
    v_company_id,
    coalesce(v_name, split_part(coalesce(new.email, 'Admin'), '@', 1)),
    'admin',
    true
  );

  return new;
end;
$$;

drop trigger if exists on_lignum_auth_user_created on auth.users;

create trigger on_lignum_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_lignum_new_user();
