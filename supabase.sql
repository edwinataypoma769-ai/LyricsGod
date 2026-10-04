-- Pega TODO este archivo en Supabase > SQL Editor > Run

create table if not exists salons (
  id serial primary key,
  name text not null,
  icon text not null
);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  salon_id int references salons(id) on delete cascade,
  name text not null,
  gender text not null check (gender in ('F','M')),
  role text not null default 'student' check (role in ('student','teacher')),
  created_at timestamptz default now()
);

create table if not exists access_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  salon_id int references salons(id) on delete cascade,
  label text,
  created_at timestamptz default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete cascade,
  salon_id int references salons(id) on delete cascade,
  day date not null,
  status text not null check (status in ('P','T','F')), -- Presente, Tarde, Falta
  unique (person_id, day)
);

insert into salons (name, icon) values
 ('Programa de Guitarra','guitarra'),
 ('Programa de Canto','canto'),
 ('Programa de Piano','piano'),
 ('Programa de Batería','bateria'),
 ('Programa de Bajo Eléctrico','bajo'),
 ('Taller de Himnos y Coros','himnos')
on conflict do nothing;

-- Seguridad: nadie anónimo toca las tablas directamente
alter table salons enable row level security;
alter table people enable row level security;
alter table access_codes enable row level security;
alter table attendance enable row level security;

-- El administrador (usuario autenticado) puede todo
create policy admin_salons on salons for all to authenticated using (true) with check (true);
create policy admin_people on people for all to authenticated using (true) with check (true);
create policy admin_codes on access_codes for all to authenticated using (true) with check (true);
create policy admin_att on attendance for all to authenticated using (true) with check (true);

-- El usuario con código solo accede por estas funciones
create or replace function salon_login(p_code text)
returns table(id int, name text, icon text)
language sql security definer set search_path = public as $$
  select s.id, s.name, s.icon from salons s
  join access_codes c on c.salon_id = s.id where c.code = upper(trim(p_code));
$$;

create or replace function salon_people(p_code text)
returns setof people
language sql security definer set search_path = public as $$
  select p.* from people p
  join access_codes c on c.salon_id = p.salon_id
  where c.code = upper(trim(p_code)) order by p.role desc, p.name;
$$;

create or replace function salon_attendance(p_code text, p_day date)
returns setof attendance
language sql security definer set search_path = public as $$
  select a.* from attendance a
  join access_codes c on c.salon_id = a.salon_id
  where c.code = upper(trim(p_code)) and a.day = p_day;
$$;

create or replace function mark_attendance(p_code text, p_person uuid, p_day date, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare sid int;
begin
  select p.salon_id into sid from people p
    join access_codes c on c.salon_id = p.salon_id
    where p.id = p_person and c.code = upper(trim(p_code));
  if sid is null then raise exception 'Código inválido'; end if;
  insert into attendance(person_id, salon_id, day, status)
  values (p_person, sid, p_day, p_status)
  on conflict (person_id, day) do update set status = excluded.status;
end $$;

grant execute on function salon_login(text), salon_people(text),
  salon_attendance(text, date), mark_attendance(text, uuid, date, text) to anon, authenticated;

-- ADMINISTRADOR: crea tu usuario en Supabase > Authentication > Users > Add user
-- (correo y contraseña). Desactiva "Allow new users to sign up" en Authentication > Sign In.
