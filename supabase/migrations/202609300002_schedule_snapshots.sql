-- Переходный формат текущего редактора: графики, исходные планы и история
-- записываются одной транзакцией. Нормализованные таблицы первой миграции
-- остаются для следующей версии редактора с несколькими людьми на смене.
create table public.schedule_snapshots (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint schedule_snapshots_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload->>'version' = '1'
    and jsonb_typeof(payload->'months') = 'object'
    and jsonb_typeof(payload->'selectedMonthKey') = 'string'
  )
);

alter table public.schedule_snapshots enable row level security;

create policy "owners read schedule snapshots" on public.schedule_snapshots
for select to authenticated using (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

create policy "owners insert schedule snapshots" on public.schedule_snapshots
for insert to authenticated with check (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

create policy "owners update schedule snapshots" on public.schedule_snapshots
for update to authenticated using (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
) with check (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

create or replace function public.save_schedule_snapshot(
  p_workspace_id uuid,
  p_payload jsonb,
  p_expected_revision bigint
) returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_revision bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = auth.uid()
  ) then
    raise exception 'No access to workspace' using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid expected revision' using errcode = '22023';
  end if;

  if p_expected_revision = 0 then
    insert into public.schedule_snapshots (workspace_id, payload)
      values (p_workspace_id, p_payload)
      on conflict (workspace_id) do nothing
      returning revision into next_revision;
  else
    update public.schedule_snapshots
      set payload = p_payload, revision = revision + 1, updated_at = now()
      where workspace_id = p_workspace_id and revision = p_expected_revision
      returning revision into next_revision;
  end if;

  if next_revision is null then
    raise exception 'Schedule changed in another session' using errcode = '40001';
  end if;
  return next_revision;
end;
$$;

revoke all on function public.save_schedule_snapshot(uuid, jsonb, bigint) from public, anon;
grant execute on function public.save_schedule_snapshot(uuid, jsonb, bigint) to authenticated;
