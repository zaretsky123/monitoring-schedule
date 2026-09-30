-- Only the already verified administrator can own a workspace.
-- All schedule policies resolve ownership through this table, so another
-- authenticated account cannot create or access a workspace.
alter policy "owners manage workspaces" on public.workspaces
  to authenticated
  using (owner_id = (select auth.uid()) and owner_id = '5913bab3-0a64-401e-9c8a-fe0b5ef21eeb'::uuid)
  with check (owner_id = (select auth.uid()) and owner_id = '5913bab3-0a64-401e-9c8a-fe0b5ef21eeb'::uuid);
