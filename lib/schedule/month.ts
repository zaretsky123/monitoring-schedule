import type { Period, ScheduleLifecycleStatus, StoredScheduleStatus } from "./types";

export function lifecycleStatus(
  status: StoredScheduleStatus,
  period: Period,
  now = new Date(),
): ScheduleLifecycleStatus {
  if (status === "draft") return "draft";
  if (now < period.start) return "planned";
  if (now >= period.end) return "completed";
  return "active";
}

export function lifecycleLabel(status: ScheduleLifecycleStatus) {
  return ({
    draft: "Черновик",
    planned: "Запланирован",
    active: "Действующий",
    completed: "Завершён",
  } as const)[status];
}
