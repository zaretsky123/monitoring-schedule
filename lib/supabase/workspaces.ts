import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type Workspace = {
  id: string;
  name: string;
  timezone: string;
};

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase пока не настроен");
  return client;
}

export async function getOrCreateWorkspace() {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Для доступа к рабочим данным необходимо войти");

  const existing = await client
    .from("workspaces")
    .select("id, name, timezone")
    .eq("owner_id", userData.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as Workspace;

  const created = await client
    .from("workspaces")
    .insert({ owner_id: userData.user.id, name: "Мониторинг", timezone: "Europe/Moscow" })
    .select("id, name, timezone")
    .single();

  if (created.error) throw created.error;
  return created.data as Workspace;
}
