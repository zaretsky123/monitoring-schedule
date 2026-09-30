import type { Employee } from "@/lib/schedule/types";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type EmployeeRow = {
  id: string;
  full_name: string;
  active: boolean;
  sort_order: number;
};

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.full_name,
    active: row.active,
  };
}

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase пока не настроен");
  return client;
}

export async function listEmployees(workspaceId: string) {
  const { data, error } = await requireClient()
    .from("employees")
    .select("id, full_name, active, sort_order")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as EmployeeRow[]).map(toEmployee);
}

export async function createEmployee(workspaceId: string, name: string, sortOrder = 0) {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Укажите ФИО сотрудника");

  const { data, error } = await requireClient()
    .from("employees")
    .insert({ workspace_id: workspaceId, full_name: normalizedName, sort_order: sortOrder })
    .select("id, full_name, active, sort_order")
    .single();

  if (error) throw error;
  return toEmployee(data as EmployeeRow);
}

export async function updateEmployee(employeeId: string, values: { name?: string; active?: boolean }) {
  const update: { full_name?: string; active?: boolean } = {};
  if (values.name !== undefined) {
    const normalizedName = values.name.trim();
    if (!normalizedName) throw new Error("ФИО сотрудника не может быть пустым");
    update.full_name = normalizedName;
  }
  if (values.active !== undefined) update.active = values.active;

  const { data, error } = await requireClient()
    .from("employees")
    .update(update)
    .eq("id", employeeId)
    .select("id, full_name, active, sort_order")
    .single();

  if (error) throw error;
  return toEmployee(data as EmployeeRow);
}

export async function archiveEmployee(employeeId: string) {
  const { error } = await requireClient()
    .from("employees")
    .update({ active: false, archived_at: new Date().toISOString() })
    .eq("id", employeeId);

  if (error) throw error;
}
