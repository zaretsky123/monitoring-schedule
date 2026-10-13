-- Preserve every server revision atomically. No cascade/FK can delete backups.
create schema if not exists schedule_private;
revoke all on schema schedule_private from public, anon, authenticated;

create table public.schedule_snapshot_versions (
  workspace_id uuid not null,
  revision bigint not null check (revision > 0),
  payload jsonb not null,
  saved_at timestamptz not null,
  archived_at timestamptz not null default now(),
  changed_by uuid,
  primary key (workspace_id, revision)
);
alter table public.schedule_snapshot_versions enable row level security;
revoke all on public.schedule_snapshot_versions from public, anon, authenticated;
grant select on public.schedule_snapshot_versions to authenticated;
create policy "owners read snapshot history" on public.schedule_snapshot_versions
for select to authenticated using (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid()))
);

-- Definer is restricted to a private trigger, not an exposed writable RPC.
-- Clients have no insert/update/delete privileges on the history table.
create function schedule_private.archive_schedule_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'schedule_snapshots' then
    raise exception 'Invalid snapshot trigger target';
  end if;
  if tg_op = 'UPDATE' and new.payload is distinct from old.payload and new.revision <= old.revision then
    raise exception 'Snapshot revision must increase' using errcode = '22023';
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    insert into public.schedule_snapshot_versions (workspace_id, revision, payload, saved_at, changed_by)
    values (old.workspace_id, old.revision, old.payload, old.updated_at, auth.uid())
    on conflict (workspace_id, revision) do nothing;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.schedule_snapshot_versions (workspace_id, revision, payload, saved_at, changed_by)
    values (new.workspace_id, new.revision, new.payload, new.updated_at, auth.uid())
    on conflict (workspace_id, revision) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function schedule_private.archive_schedule_snapshot() from public, anon, authenticated;
create trigger preserve_schedule_snapshot_versions
after insert or update or delete on public.schedule_snapshots
for each row execute function schedule_private.archive_schedule_snapshot();

-- Capture the existing live snapshot; this does not update its contents/revision.
insert into public.schedule_snapshot_versions (workspace_id, revision, payload, saved_at)
select workspace_id, revision, payload, updated_at from public.schedule_snapshots;

-- Restoring creates a NEW revision and preserves the version being replaced.
create function public.restore_schedule_snapshot(
  p_workspace_id uuid, p_source_revision bigint, p_expected_revision bigint
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare source_payload jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid()
  ) then
    raise exception 'No access to workspace' using errcode = '42501';
  end if;
  select payload into source_payload from public.schedule_snapshot_versions
  where workspace_id = p_workspace_id and revision = p_source_revision;
  if source_payload is null then
    raise exception 'Backup version not found' using errcode = '22023';
  end if;
  return public.save_schedule_snapshot(p_workspace_id, source_payload, p_expected_revision);
end;
$$;
revoke all on function public.restore_schedule_snapshot(uuid,bigint,bigint) from public, anon;
grant execute on function public.restore_schedule_snapshot(uuid,bigint,bigint) to authenticated;
