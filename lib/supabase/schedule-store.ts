import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type ScheduleSnapshot<T> = {
  payload: T;
  revision: number;
};

export type SnapshotVersion = { revision: number; saved_at: string };

export async function listSnapshotVersions(workspaceId: string): Promise<SnapshotVersion[]> {
  const { data, error } = await requireClient().from("schedule_snapshot_versions")
    .select("revision, saved_at").eq("workspace_id", workspaceId).order("revision", { ascending: false }).limit(30);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, revision: Number(row.revision) }));
}

export async function loadSnapshotVersion<T>(workspaceId: string, revision: number): Promise<ScheduleSnapshot<T>> {
  const { data, error } = await requireClient().from("schedule_snapshot_versions")
    .select("payload, revision").eq("workspace_id", workspaceId).eq("revision", revision).single();
  if (error) throw error;
  return { payload: data.payload as T, revision: Number(data.revision) };
}

export async function restoreSnapshotVersion(workspaceId: string, revision: number, expectedRevision: number): Promise<number> {
  const { data, error } = await requireClient().rpc("restore_schedule_snapshot", {
    p_workspace_id: workspaceId, p_source_revision: revision, p_expected_revision: expectedRevision,
  });
  if (error) throw error;
  return Number(data);
}

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase пока не настроен");
  return client;
}

export async function loadScheduleSnapshot<T>(workspaceId: string): Promise<ScheduleSnapshot<T> | null> {
  const { data, error } = await requireClient()
    .from("schedule_snapshots")
    .select("payload, revision")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? { payload: data.payload as T, revision: Number(data.revision) } : null;
}

export async function saveScheduleSnapshot<T>(workspaceId: string, payload: T, expectedRevision: number): Promise<number> {
  const { data, error } = await requireClient().rpc("save_schedule_snapshot", {
    p_workspace_id: workspaceId,
    p_payload: payload,
    p_expected_revision: expectedRevision,
  });
  if (error) throw error;
  return Number(data);
}
