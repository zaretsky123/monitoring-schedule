import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type ScheduleSnapshot<T> = {
  payload: T;
  revision: number;
};

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
