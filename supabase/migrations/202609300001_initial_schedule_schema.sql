create extension if not exists pgcrypto;

create type public.schedule_month_status as enum ('draft', 'planned', 'active', 'completed');
create type public.shift_type as enum ('D', 'N');
create type public.assignment_state as enum ('baseline', 'current');
create type public.assignment_source as enum ('manual', 'algorithm', 'replacement');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Мониторинг',
  timezone text not null default 'Europe/Moscow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index employees_workspace_name_unique
  on public.employees (workspace_id, lower(trim(full_name)))
  where archived_at is null;

create table public.schedule_months (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  status public.schedule_month_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, year, month)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_month_id uuid not null references public.schedule_months(id) on delete cascade,
  external_key text not null,
  shift_type public.shift_type not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  required_headcount smallint not null default 1 check (required_headcount > 0),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (schedule_month_id, external_key)
);

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  state public.assignment_state not null,
  source public.assignment_source not null default 'manual',
  created_at timestamptz not null default now(),
  unique (shift_id, employee_id, state)
);

create table public.employee_unavailability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default 'other',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.change_sets (
  id uuid primary key default gen_random_uuid(),
  schedule_month_id uuid not null references public.schedule_months(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  unique (schedule_month_id, sequence_number)
);

create table public.change_items (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  from_employee_id uuid references public.employees(id) on delete restrict,
  to_employee_id uuid references public.employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (from_employee_id is distinct from to_employee_id)
);

create index employees_workspace_id_idx on public.employees(workspace_id);
create index schedule_months_workspace_id_idx on public.schedule_months(workspace_id);
create index shifts_month_start_idx on public.shifts(schedule_month_id, starts_at);
create index shift_assignments_shift_idx on public.shift_assignments(shift_id);
create index shift_assignments_employee_idx on public.shift_assignments(employee_id);
create index employee_unavailability_employee_period_idx on public.employee_unavailability(employee_id, starts_at, ends_at);
create index change_sets_month_sequence_idx on public.change_sets(schedule_month_id, sequence_number);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger employees_set_updated_at before update on public.employees
for each row execute function public.set_updated_at();
create trigger schedule_months_set_updated_at before update on public.schedule_months
for each row execute function public.set_updated_at();
create trigger shifts_set_updated_at before update on public.shifts
for each row execute function public.set_updated_at();
create trigger employee_unavailability_set_updated_at before update on public.employee_unavailability
for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.employees enable row level security;
alter table public.schedule_months enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.employee_unavailability enable row level security;
alter table public.change_sets enable row level security;
alter table public.change_items enable row level security;

create policy "owners manage workspaces" on public.workspaces
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owners manage employees" on public.employees
for all using (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
) with check (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

create policy "owners manage schedule months" on public.schedule_months
for all using (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
) with check (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

create policy "owners manage shifts" on public.shifts
for all using (
  exists (
    select 1 from public.schedule_months m
    join public.workspaces w on w.id = m.workspace_id
    where m.id = schedule_month_id and w.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.schedule_months m
    join public.workspaces w on w.id = m.workspace_id
    where m.id = schedule_month_id and w.owner_id = auth.uid()
  )
);

create policy "owners manage assignments" on public.shift_assignments
for all using (
  exists (
    select 1 from public.shifts s
    join public.schedule_months m on m.id = s.schedule_month_id
    join public.workspaces w on w.id = m.workspace_id
    where s.id = shift_id and w.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.shifts s
    join public.schedule_months m on m.id = s.schedule_month_id
    join public.workspaces w on w.id = m.workspace_id
    where s.id = shift_id and w.owner_id = auth.uid()
  )
);

create policy "owners manage unavailability" on public.employee_unavailability
for all using (
  exists (
    select 1 from public.employees e
    join public.workspaces w on w.id = e.workspace_id
    where e.id = employee_id and w.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.employees e
    join public.workspaces w on w.id = e.workspace_id
    where e.id = employee_id and w.owner_id = auth.uid()
  )
);

create policy "owners manage change sets" on public.change_sets
for all using (
  exists (
    select 1 from public.schedule_months m
    join public.workspaces w on w.id = m.workspace_id
    where m.id = schedule_month_id and w.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.schedule_months m
    join public.workspaces w on w.id = m.workspace_id
    where m.id = schedule_month_id and w.owner_id = auth.uid()
  )
);

create policy "owners manage change items" on public.change_items
for all using (
  exists (
    select 1 from public.change_sets c
    join public.schedule_months m on m.id = c.schedule_month_id
    join public.workspaces w on w.id = m.workspace_id
    where c.id = change_set_id and w.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.change_sets c
    join public.schedule_months m on m.id = c.schedule_month_id
    join public.workspaces w on w.id = m.workspace_id
    where c.id = change_set_id and w.owner_id = auth.uid()
  )
);
