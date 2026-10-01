"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  LockKeyhole,
  LockOpen,
  Loader2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sun,
  TriangleAlert,
  UserRound,
  UserRoundCog,
  Users,
  UserX,
  WandSparkles,
  X,
} from "lucide-react";

import { baseShiftId, shiftSlots, secondSlot, setReinforcements } from "@/lib/schedule/slots";
import { ShiftActions } from "@/components/shift-actions";
import { EmployeeProfile, type EmployeeMonthEntry } from "@/components/employee-profile";
import { EmployeesPanel } from "@/components/employees-panel";
import { absencePeriod, compactEmployeeName, shiftAbsences, isEmployeeAvailable, isEmployeeRecord, MAX_MONTH_EMPLOYEES } from "@/lib/schedule/employees";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  addDays,
  addMonths,
  dateKey,
  daysInMonth,
  formatMonthGenitive,
  formatMonthLabel,
  monthKey,
  parseMonthKey,
  periodForMonth,
  utcDate,
} from "@/lib/schedule/calendar";
import {
  createOctober2026Schedule,
  createBlankMonthSchedule,
  createPatternSchedule,
  EMPLOYEES,
} from "@/lib/schedule/sample";
import { lifecycleLabel, lifecycleStatus } from "@/lib/schedule/month";
import { coefficientHoursForEmployee, type CoefficientHours } from "@/lib/schedule/coefficients";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { loadScheduleSnapshot, saveScheduleSnapshot, type ScheduleSnapshot } from "@/lib/supabase/schedule-store";
import { getOrCreateWorkspace } from "@/lib/supabase/workspaces";
import { countMonthlyFullOffDays, countMonthlyOffPairs, findWorkBlock, validateSchedule } from "@/lib/schedule/validator";
import type { Absence, Employee, GeneratedScheduleOption, GenerationMode, Period, ScheduleOption, Shift, ShiftChange, StoredScheduleStatus } from "@/lib/schedule/types";

// A person is identified by permanent employee ID, including when names are equal.
type Person = string;
type ShiftKind = "day" | "night";
type Workflow = "remove" | "replace" | null;
type ModelContextDocument = Document & {
  modelContext?: {
    registerTool: (tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    }, options: { signal: AbortSignal }) => void | Promise<void>;
  };
};

const NAV_ITEMS = [
  { label: "График", icon: CalendarDays, active: true },
  { label: "Сотрудники", icon: Users },
  { label: "Правила", icon: ShieldCheck },
  { label: "История", icon: History },
  { label: "Выгрузка", icon: FileSpreadsheet },
];

const DAY_WIDTH = 154;
const NAME_WIDTH = 196;
const GENERATION_SEED_DAYS = 8;
type DraftMode = "seed" | "manual";
const LEGACY_STORAGE_KEY = "monitoring-schedule:october-2026:v1";
const MONTHS_STORAGE_KEY = "monitoring-schedule:months:v1";
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

type PersistedSchedule = {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  employeeRates?: Record<string, number>;
  isTest?: boolean;
  historyCount: number;
  status?: StoredScheduleStatus;
  draftMode?: DraftMode;
  employeeIds?: string[];
  lockedEmployeeIds?: string[];
  draftAbsences?: PersistedAbsence[];
  schedule: Array<Omit<Shift, "start" | "end"> & { start: string; end: string }>;
  baselineSchedule?: Array<Omit<Shift, "start" | "end"> & { start: string; end: string }>;
  changeEvents?: PersistedChangeEvent[];
};

type PersistedMonthStore = {
  version: 1;
  employees?: Employee[];
  selectedMonthKey: string;
  months: Record<string, PersistedSchedule>;
};

function isValidMonthStore(value: unknown): value is PersistedMonthStore {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedMonthStore>;
  if (candidate.version !== 1 || !candidate.months || typeof candidate.months !== "object" || Array.isArray(candidate.months)) return false;
  if (!candidate.selectedMonthKey || !Object.hasOwn(candidate.months, candidate.selectedMonthKey)) return false;
  if (candidate.employees !== undefined && (!Array.isArray(candidate.employees) || !candidate.employees.every(isEmployeeRecord) || new Set(candidate.employees.map((employee) => employee.id)).size !== candidate.employees.length)) return false;
  try {
    return Object.entries(candidate.months).every(([key, record]) => {
      const month = parseMonthKey(key);
      return month && restoreMonthRecord(record, periodForMonth(month.year, month.month)) !== null;
    });
  } catch {
    return false;
  }
}

type PersistedAbsence = Omit<Absence, "start" | "end"> & {
  start: string;
  end: string;
};

type AppliedChange = {
  id: number;
  start: Date;
  appliedAt: Date;
  triggerShiftId: string;
  employeeId: string;
  workflow: Exclude<Workflow, null>;
  scope: string;
  reason: string;
  absences: Absence[];
  optionNumber: number;
  changes: ShiftChange[];
  beforeSchedule: Shift[];
};

type PersistedChangeEvent = Omit<AppliedChange, "start" | "appliedAt" | "absences" | "beforeSchedule"> & {
  start: string;
  appliedAt: string;
  absences?: PersistedAbsence[];
  beforeSchedule: PersistedSchedule["schedule"];
};

type PendingChange = Omit<AppliedChange, "id" | "appliedAt" | "optionNumber" | "changes" | "beforeSchedule">;

type RearrangeWorkerRequest = {
  action?: "rearrange";
  schedule: Shift[];
  employees: Employee[];
  period: Period;
  absences: Absence[];
  recalculationStart: Date;
  requiredAssignments: Record<string, string>;
  maxOptions: number;
};

type GenerationWorkerRequest = {
  action: "generate";
  schedule: Shift[];
  employees: Employee[];
  period: Period;
  seedDays: number;
  mode: GenerationMode;
  maxOptions: number;
  manual?: boolean;
  lockedEmployeeIds?: string[];
  absences?: Absence[];
};

type WorkerRequest = RearrangeWorkerRequest | GenerationWorkerRequest;

type RearrangeWorkerResult =
  | { found: true; minimumChangeCount: number; recommendedKey: string; options: ScheduleOption[] }
  | { found: false; options: []; reason: string };

type GenerationWorkerResult =
  | { found: true; recommendedKey: string; options: GeneratedScheduleOption[] }
  | { found: false; options: []; reason: string };

type ShiftSelection = {
  shiftId?: string;
  person: Person;
  kind: ShiftKind;
  startDay: number;
};

function dayInfo(period: Period, day: number) {
  const date = utcDate(period.year, period.month, day);
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(".", "");
  const dayOfWeek = date.getUTCDay();
  return { weekday, weekend: dayOfWeek === 0 || dayOfWeek === 6 };
}

function shortDateTime(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date);
}

function shiftDate(period: Period, startDay: number) {
  return startDay === 0 ? addDays(period.start, -1) : utcDate(period.year, period.month, startDay);
}

function nightLabel(period: Period, startDay: number) {
  const start = shiftDate(period, startDay);
  const end = addDays(start, 1);
  start.setUTCHours(20);
  end.setUTCHours(8);
  return `${shortDateTime(start)} — ${shortDateTime(end)}`;
}

function shiftLabel(shift: ShiftSelection | null, period: Period) {
  if (!shift) return "";
  if (shift.kind === "night") return nightLabel(period, shift.startDay);
  const date = shiftDate(period, shift.startDay);
  return `${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(date)}, 08:00–20:00`;
}

function shiftIdFor(period: Period, startDay: number, kind: ShiftKind) {
  return `${dateKey(shiftDate(period, startDay))}:${kind === "day" ? "D" : "N"}`;
}

function personStats(person: Person, schedule: Shift[], period: Period) {
  const employeeId = person;
  const periodHours = (period.end.getTime() - period.start.getTime()) / 3_600_000;
  const monthly = schedule.filter((shift) => shift.start >= period.start && shift.start < period.end && shift.employeeId === employeeId);
  const dayCount = monthly.filter((shift) => shift.type === "D").length;
  const nightCount = monthly.filter((shift) => shift.type === "N").length;
  const overlapHours = (shift: Shift) => {
    const start = Math.max(shift.start.getTime(), period.start.getTime());
    const end = Math.min(shift.end.getTime(), period.end.getTime());
    return Math.max(0, end - start) / 3_600_000;
  };
  const hours = schedule
    .filter((shift) => shift.employeeId === employeeId)
    .reduce((sum, shift) => sum + overlapHours(shift), 0);
  const planned = schedule
    .filter((shift) => shift.plannedEmployeeId === employeeId)
    .reduce((sum, shift) => sum + overlapHours(shift), 0);
  const fullOffDays = countMonthlyFullOffDays(schedule, employeeId, period);
  return {
    dayCount,
    nightCount,
    total: monthly.length,
    hours,
    planned,
    delta: hours - planned,
    restHours: periodHours - hours,
    plannedRestHours: periodHours - planned,
    fullOffDays,
    fullOffHours: fullOffDays * 24,
    offPairs: countMonthlyOffPairs(schedule, employeeId, period),
  };
}

function signedHours(value: number) {
  return `${value > 0 ? "+" : ""}${value} ч`;
}

function runScheduleWorker<Result>(request: WorkerRequest, signal?: AbortSignal) {
  return new Promise<Result>((resolve, reject) => {
    const workerUrl = new URL("workers/schedule-worker.js", document.baseURI);
    const worker = new Worker(workerUrl, { type: "module" });
    let settled = false;

    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Расчёт отменён", "AbortError"));
    };

    worker.onmessage = (event: MessageEvent<{ type: "result"; result: unknown } | { type: "error"; message: string }>) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (event.data.type === "error") reject(new Error(event.data.message));
      else resolve(event.data.result as Result);
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Фоновый расчёт завершился с ошибкой"));
    };
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage(request);
  });
}

function mergeAbsences(...groups: Absence[][]) {
  const unique = new Map<string, Absence>();
  for (const absence of groups.flat()) {
    const key = `${absence.employeeId}|${absence.start.toISOString()}|${absence.end.toISOString()}`;
    unique.set(key, absence);
  }
  return [...unique.values()];
}

function inferLegacyAbsence(change: PersistedChangeEvent, beforeSchedule: Shift[]): Absence[] {
  if (change.reason === "legacy") return [];
  const start = new Date(change.start);
  const trigger = beforeSchedule.find((shift) => shift.id === change.triggerShiftId);
  if (!trigger || Number.isNaN(start.getTime())) return [];

  if (change.workflow === "replace" || change.scope === "shift") {
    return [{ employeeId: change.employeeId, start, end: trigger.end }];
  }
  if (change.scope === "week") {
    return [{ employeeId: change.employeeId, start, end: addDays(start, 7) }];
  }
  if (change.scope === "block") {
    const block = findWorkBlock(beforeSchedule, change.employeeId, change.triggerShiftId);
    const triggerIndex = block.findIndex((shift) => shift.id === change.triggerShiftId);
    const remainingBlock = triggerIndex >= 0 ? block.slice(triggerIndex) : [];
    const end = remainingBlock.at(-1)?.end;
    return end ? [{ employeeId: change.employeeId, start, end }] : [];
  }
  return [];
}

function serializeShifts(shifts: Shift[]): PersistedSchedule["schedule"] {
  return shifts.map((shift) => ({ ...shift, start: shift.start.toISOString(), end: shift.end.toISOString() }));
}

function deserializeShifts(shifts: PersistedSchedule["schedule"] | undefined) {
  if (!Array.isArray(shifts)) return null;
  const restored = shifts.map((shift) => ({ ...shift, start: new Date(shift.start), end: new Date(shift.end) }));
  return restored.every((shift) => !Number.isNaN(shift.start.getTime()) && !Number.isNaN(shift.end.getTime())) ? restored : null;
}

function restoreMonthRecord(persisted: Partial<PersistedSchedule>, period: Period) {
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(persisted.version ?? 0)) return null;
  const restored = deserializeShifts(persisted.schedule);
  if (!restored) return null;
  const restoredBaseline = deserializeShifts(persisted.baselineSchedule)
    ?? (persisted.status === "draft" ? [] : restored.map((shift) => ({ ...shift, employeeId: shift.plannedEmployeeId })));
  let restoredEvents = (persisted.changeEvents ?? []).flatMap((change) => {
    const beforeSchedule = deserializeShifts(change.beforeSchedule);
    if (!beforeSchedule) return [];
    const start = new Date(change.start);
    const appliedAt = new Date(change.appliedAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(appliedAt.getTime())) return [];
    const restoredAbsences = Array.isArray(change.absences)
      ? change.absences.flatMap((absence) => {
          const absenceStart = new Date(absence.start);
          const absenceEnd = new Date(absence.end);
          return !Number.isNaN(absenceStart.getTime()) && !Number.isNaN(absenceEnd.getTime()) && absenceStart < absenceEnd
            ? [{ ...absence, start: absenceStart, end: absenceEnd }]
            : [];
        })
      : inferLegacyAbsence(change, beforeSchedule);
    return [{ ...change, start, appliedAt, absences: restoredAbsences, beforeSchedule }];
  });
  if (persisted.version === 1 && restoredEvents.length === 0) {
    const original = createPatternSchedule(period);
    const originalById = new Map(original.map((shift) => [shift.id, shift]));
    const legacyChanges = restored
      .filter((shift) => shift.start >= period.start && shift.start < period.end)
      .flatMap((shift) => {
        const originalShift = originalById.get(shift.id);
        if (!originalShift || originalShift.employeeId === shift.employeeId) return [];
        return [{ shiftId: shift.id, type: shift.type, fromEmployeeId: originalShift.employeeId, toEmployeeId: shift.employeeId } satisfies ShiftChange];
      });
    const firstChangedShift = legacyChanges.length ? restored.find((shift) => shift.id === legacyChanges[0].shiftId) : undefined;
    if (firstChangedShift) {
      restoredEvents = [{
        id: 1,
        start: firstChangedShift.start,
        appliedAt: new Date(),
        triggerShiftId: firstChangedShift.id,
        employeeId: legacyChanges[0].fromEmployeeId,
        workflow: "remove",
        scope: "custom",
        reason: "legacy",
        absences: [],
        optionNumber: 1,
        changes: legacyChanges,
        beforeSchedule: original,
      }];
    }
  }
  const persistedCount = persisted.version === 1 && restoredEvents.length
    ? 1
    : Number.isInteger(persisted.historyCount) ? persisted.historyCount! : 0;
  return {
    employeeRates: persisted.employeeRates ?? {},
    isTest: Boolean(persisted.isTest),
    schedule: restored,
    baselineSchedule: restoredBaseline,
    changeEvents: restoredEvents,
    historyCount: Math.max(persistedCount, ...restoredEvents.map((change) => change.id), 0),
    status: persisted.status === "draft" ? "draft" as const : "published" as const,
    draftMode: persisted.draftMode === "manual" ? "manual" as const : "seed" as const,
    employeeIds: Array.isArray(persisted.employeeIds) ? [...new Set(persisted.employeeIds.filter((id) => typeof id === "string"))] : EMPLOYEES.map((employee) => employee.id),
    lockedEmployeeIds: Array.isArray(persisted.lockedEmployeeIds) ? persisted.lockedEmployeeIds.filter((id) => typeof id === "string") : [],
    draftAbsences: (persisted.draftAbsences ?? []).flatMap((absence) => {
      const start = new Date(absence.start), end = new Date(absence.end);
      return start < end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) ? [{ ...absence, start, end }] : [];
    }),
  };
}

function serializeMonthRecord({
  isTest = false,
  employeeRates = {},
  schedule,
  baselineSchedule,
  changeEvents,
  historyCount,
  status,
  draftMode = "seed",
  employeeIds = EMPLOYEES.map((employee) => employee.id),
  lockedEmployeeIds = [],
  draftAbsences = [],
}: {
  isTest?: boolean;
  employeeRates?: Record<string, number>;
  schedule: Shift[];
  baselineSchedule: Shift[];
  changeEvents: AppliedChange[];
  historyCount: number;
  status: StoredScheduleStatus;
  draftMode?: DraftMode;
  employeeIds?: string[];
  lockedEmployeeIds?: string[];
  draftAbsences?: Absence[];
}): PersistedSchedule {
  return {
    version: 8,
    employeeRates,
    isTest,
    historyCount,
    status,
    draftMode,
    employeeIds,
    lockedEmployeeIds,
    draftAbsences: draftAbsences.map((absence) => ({ ...absence, start: absence.start.toISOString(), end: absence.end.toISOString() })),
    schedule: serializeShifts(schedule),
    baselineSchedule: serializeShifts(baselineSchedule),
    changeEvents: changeEvents.map((change) => ({
      ...change,
      start: change.start.toISOString(),
      appliedAt: change.appliedAt.toISOString(),
      absences: change.absences.map((absence) => ({ ...absence, start: absence.start.toISOString(), end: absence.end.toISOString() })),
      beforeSchedule: serializeShifts(change.beforeSchedule),
    })),
  };
}

function carryInAssignment(months: Record<string, PersistedSchedule>, year: number, month: number, isTest = false) {
  const previous = addMonths(year, month, -1);
  const previousRecord = months[monthKey(previous.year, previous.month)];
  if (!previousRecord || Boolean(previousRecord.isTest) !== isTest) return null;
  const boundary = periodForMonth(year, month).start.getTime();
  const shift = previousRecord.schedule.find((item) => item.slot !== 2 && item.type === "N" && new Date(item.start).getTime() < boundary && new Date(item.end).getTime() > boundary);
  if (!shift?.employeeId) return null;
  const secondary = previousRecord.schedule.find((item) => item.slot === 2 && item.id === `${shift.id}:2`);
  return { employeeId: shift.employeeId, plannedEmployeeId: shift.plannedEmployeeId || shift.employeeId, secondary: secondary?.employeeId ? { employeeId: secondary.employeeId, plannedEmployeeId: secondary.plannedEmployeeId || secondary.employeeId } : undefined };
}

function synchronizeCarryIn<T extends { schedule: Shift[]; baselineSchedule: Shift[] }>(
  record: T,
  period: Period,
  assignment: { employeeId: string; plannedEmployeeId: string; secondary?: { employeeId: string; plannedEmployeeId: string } } | null,
) {
  if (!assignment) return record;
  const isCarryIn = (shift: Shift) => shift.type === "N" && shift.start < period.start && shift.end > period.start;
  const sync = (shifts: Shift[], baseline: boolean) => {
    const result = shifts.filter((shift) => !(isCarryIn(shift) && shift.slot === 2)).map((shift) => isCarryIn(shift) ? { ...shift, employeeId: baseline ? assignment.plannedEmployeeId : assignment.employeeId, plannedEmployeeId: assignment.plannedEmployeeId } : shift);
    const primary = result.find(isCarryIn);
    if (primary && assignment.secondary) result.push({ ...secondSlot(primary), employeeId: baseline ? assignment.secondary.plannedEmployeeId : assignment.secondary.employeeId, plannedEmployeeId: assignment.secondary.plannedEmployeeId });
    return result;
  };
  return { ...record, schedule: sync(record.schedule, false), baselineSchedule: sync(record.baselineSchedule, true) };
}

function mergeAdjacentContext(
  currentSchedule: Shift[],
  months: Record<string, PersistedSchedule>,
  selectedKey: string,
  period: Period,
  isTest = false,
) {
  const merged = new Map(currentSchedule.map((shift) => [shift.id, shift]));
  const current = parseMonthKey(selectedKey);
  if (!current) return [...merged.values()];
  const contextStart = addDays(period.start, -7);
  const contextEnd = addDays(period.end, 7);
  for (const amount of [-1, 1]) {
    const adjacent = addMonths(current.year, current.month, amount);
    const record = months[monthKey(adjacent.year, adjacent.month)];
    if (Boolean(record?.isTest) !== isTest) continue;
    const shifts = deserializeShifts(record?.schedule);
    if (!shifts) continue;
    for (const shift of shifts) {
      if (shift.end <= contextStart || shift.start >= contextEnd || merged.has(shift.id)) continue;
      merged.set(shift.id, shift);
    }
  }
  return [...merged.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

function changeMarkerLeft(start: Date, period: Period, dayCount: number) {
  if (start < period.start) return NAME_WIDTH;
  if (start >= period.end) return NAME_WIDTH + dayCount * DAY_WIDTH;
  const dayIndex = start.getUTCDate() - 1;
  const hour = start.getUTCHours();
  const hourOffset = hour >= 20 ? 120 : hour >= 8 ? 34 : 0;
  return NAME_WIDTH + dayIndex * DAY_WIDTH + hourOffset;
}

function reasonLabel(reason: string, workflow: Exclude<Workflow, null>) {
  if (reason === "legacy") return "Ранее применённое изменение";
  if (workflow === "replace") return "Ручная замена";
  return ({ absence: "Неявка", sickday: "Sick day", medical: "Больничный", vacation: "Отпуск", other: "Другое" } as Record<string, string>)[reason] ?? "Отсутствие";
}

function scopeLabel(scope: string, workflow: Exclude<Workflow, null>) {
  if (workflow === "replace") return "Одна выбранная смена";
  return ({ shift: "Одна выбранная смена", block: "До конца рабочего блока", week: "7 календарных дней", custom: "Указанный период" } as Record<string, string>)[scope] ?? "Указанный период";
}

function changeDateLabel(shiftId: string) {
  const [date, type] = shiftId.split(":");
  const parsed = new Date(`${date}T00:00:00Z`);
  const label = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(parsed);
  return type === "D" ? `${label}, день` : `${label}, ночь`;
}

function changeStartLabel(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function NavButton({ label, icon: Icon, active, expanded, onClick }: {
  label: string;
  icon: typeof CalendarDays;
  active?: boolean;
  expanded: boolean;
  onClick?: () => void;
}) {
  const comingSoon = !active && !onClick;
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn("nav-button", active && "nav-button-active", comingSoon && "nav-button-coming")}
      aria-current={active ? "page" : undefined}
      aria-disabled={comingSoon || undefined}
      title={comingSoon ? `${label} — будет позже` : undefined}
    >
      <Icon className="size-[19px]" />
      {expanded && <span className="nav-label">{label}</span>}
      {expanded && comingSoon && <small className="nav-coming-label">Будет позже</small>}
    </button>
  );
  if (expanded) return button;
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right" sideOffset={10}>{label}{comingSoon && " · Будет позже"}</TooltipContent></Tooltip>;
}

function ScheduleOptionsList({
  employees,
  options,
  selectedOptionKey,
  expandedOptionKey,
  focusedPreviewShiftId,
  schedule,
  period,
  onChoose,
  onToggleDetails,
  onFocusShift,
}: {
  employees: Employee[];
  options: ScheduleOption[];
  selectedOptionKey: string;
  expandedOptionKey: string;
  focusedPreviewShiftId: string | null;
  schedule: Shift[];
  period: Period;
  onChoose: (option: ScheduleOption) => void;
  onToggleDetails: (key: string) => void;
  onFocusShift: (shiftId: string) => void;
}) {
  const PEOPLE = employees.map((employee) => employee.id);
  const employeeNameById = Object.fromEntries(employees.map((employee) => [employee.id, employee.name]));
  return (
    <div className="options-list">
      {options.map((option, index) => {
        const selected = option.key === selectedOptionKey;
        const expanded = option.key === expandedOptionKey;
        const affectedEmployeeIds = new Set(option.metrics.changes.flatMap((change) => [change.fromEmployeeId, change.toEmployeeId]));
        const affectedPeople = PEOPLE.filter((person) => affectedEmployeeIds.has(person));
        return (
          <article key={option.key} className={cn("option-card", selected && "option-card-selected")}>
            <button type="button" className="option-main" onClick={() => onChoose(option)}>
              <span className="option-title">Вариант {index + 1}{index === 0 && <em><WandSparkles />Лучший</em>}</span>
              <span className="option-compact"><span>Изменено: <strong>{option.metrics.changedCount} смен</strong></span><span>Затронуто: <strong>{option.metrics.affectedEmployeeCount} сотрудника</strong></span></span>
            </button>
            <button type="button" className="details-toggle" onClick={() => onToggleDetails(expanded ? "" : option.key)}>{expanded ? "Скрыть подробности" : "Подробнее"}<ChevronRight className={cn(expanded && "rotate-90")} /></button>
            {expanded && (
              <div className="option-details">
                <h4>Перестановки</h4>
                {option.metrics.changes.map((change) => <button type="button" className={cn("change-line", focusedPreviewShiftId === change.shiftId && "change-line-active")} key={change.shiftId} onClick={() => onFocusShift(change.shiftId)}><span>{changeDateLabel(change.shiftId)}</span><strong>{employeeNameById[change.fromEmployeeId]} → {employeeNameById[change.toEmployeeId]}</strong><ChevronRight /></button>)}
                <h4>Влияние на сотрудников</h4>
                <div className="employee-impact-list">
                  {affectedPeople.map((person) => {
                    const employeeId = person;
                    const before = personStats(person, schedule, period);
                    const after = personStats(person, option.schedule, period);
                    const workDelta = after.hours - before.hours;
                    const restDelta = after.restHours - before.restHours;
                    const fullOffDelta = after.fullOffHours - before.fullOffHours;
                    const blocks = option.metrics.hours[employeeId]?.blocks ?? [];
                    const maxBlock = blocks.reduce((maximum, block) => Math.max(maximum, block.length), 0);
                    const beforeCoefficients = coefficientHoursForEmployee(schedule, employeeId, period);
                    const afterCoefficients = coefficientHoursForEmployee(option.schedule, employeeId, period);
                    return (
                      <div className="employee-impact-card" key={employeeId}>
                        <div className="employee-impact-head">
                          <strong>{employeeNameById[person]}</strong>
                          <span className={workDelta > 0 ? "work-increase" : workDelta < 0 ? "work-decrease" : "no-change"}>{signedHours(workDelta)} рабочих</span>
                        </div>
                        <div className="employee-impact-grid">
                          <div><span>Рабочие часы</span><strong>{before.hours} → {after.hours}</strong><small>за выбранный месяц</small></div>
                          <div><span>Часы полных выходных</span><strong>{before.fullOffHours} → {after.fullOffHours}</strong><small className={fullOffDelta > 0 ? "rest-increase" : fullOffDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(fullOffDelta)} · {before.fullOffDays} → {after.fullOffDays} дней</small></div>
                          <div><span>Все свободные часы</span><strong>{before.restHours} → {after.restHours}</strong><small className={restDelta > 0 ? "rest-increase" : restDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(restDelta)}</small></div>
                          <div><span>День / ночь</span><strong>{before.dayCount}/{before.nightCount} → {after.dayCount}/{after.nightCount}</strong><small>количество смен</small></div>
                          <div><span>Всего смен</span><strong>{before.total} → {after.total}</strong><small>с началом в месяце</small></div>
                          <div><span>Пары выходных</span><strong>{before.offPairs} → {after.offPairs}</strong><small>минимум 2</small></div>
                          <div><span>Макс. рабочий блок</span><strong>{maxBlock} смен</strong><small>допустимо до 5</small></div>
                          <div><span>Отклонение от плана</span><strong className={after.delta > 0 ? "positive-delta" : after.delta < 0 ? "negative-delta" : "no-change"}>{signedHours(after.delta)}</strong><small>после перестановки</small></div>
                        </div>
                        <CoefficientImpact before={beforeCoefficients} after={afterCoefficients} year={period.year} />
                      </div>
                    );
                  })}
                </div>
                <div className="checks-box"><CheckCircle2 /><span>Покрытие 24/7, отдых 12 часов, блоки до 5 смен, две пары выходных и 42 часа отдыха в неделю соблюдены.</span></div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

const coefficientNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function formatCoefficient(value: number) {
  return `${coefficientNumber.format(value)}x`;
}

function CoefficientBreakdown({ hours }: { hours: CoefficientHours }) {
  return (
    <div className="coefficient-breakdown">
      <div><span>Обычные часы · 1x</span><strong>{coefficientNumber.format(hours.regularHours)} ч · {formatCoefficient(hours.regularHours)}</strong></div>
      <div><span>Ночные часы · 1,2x</span><strong>{coefficientNumber.format(hours.nightHours)} ч · {formatCoefficient(hours.nightHours * 1.2)}</strong></div>
      <div><span>Праздничные часы · 2x</span><strong>{coefficientNumber.format(hours.holidayHours)} ч · {formatCoefficient(hours.holidayHours * 2)}</strong></div>
      <div className="coefficient-breakdown-total"><span>Оплачиваемых часов</span><strong>{coefficientNumber.format(hours.payableHours)} ч</strong></div>
    </div>
  );
}

function CoefficientImpact({ before, after, year }: { before: CoefficientHours | null; after: CoefficientHours | null; year: number }) {
  if (!before || !after) return <div className="coefficient-unavailable">Часы с коэффициентами: календарь праздников за {year} год ещё не загружен.</div>;
  const difference = after.weightedHours - before.weightedHours;
  return (
    <details className="coefficient-impact">
      <summary><span>Часы с коэффициентами</span><strong>{formatCoefficient(before.weightedHours)} → {formatCoefficient(after.weightedHours)} <small>({difference > 0 ? "+" : ""}{formatCoefficient(difference)})</small></strong><ChevronRight /></summary>
      <div className="coefficient-comparison">
        <div><span>Обычные · 1x</span><strong>{coefficientNumber.format(before.regularHours)} → {coefficientNumber.format(after.regularHours)} ч</strong></div>
        <div><span>Ночные · 1,2x</span><strong>{coefficientNumber.format(before.nightHours)} → {coefficientNumber.format(after.nightHours)} ч</strong></div>
        <div><span>Праздничные · 2x</span><strong>{coefficientNumber.format(before.holidayHours)} → {coefficientNumber.format(after.holidayHours)} ч</strong></div>
        <div><span>Оплачиваемых часов</span><strong>{coefficientNumber.format(before.payableHours)} → {coefficientNumber.format(after.payableHours)} ч</strong></div>
      </div>
    </details>
  );
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<"График" | "Сотрудники">("График");
  const [staffProfileId, setStaffProfileId] = useState<string | null>(null);
  const [employeeEditorId, setEmployeeEditorId] = useState<string | null>(null);
  const [employeeMonthId, setEmployeeMonthId] = useState<string | null>(null);
  const [monthEmployeeRates, setMonthEmployeeRates] = useState<Record<string, number>>({});
  const [absenceMode, setAbsenceMode] = useState<"days" | "time">("days");
  const [absenceReason, setAbsenceReason] = useState("");
  const [focusedAbsence, setFocusedAbsence] = useState<Absence | null>(null);
  const [pendingShiftBlock, setPendingShiftBlock] = useState<{ employeeId: string; shiftId: string } | null>(null);
  const [pendingAbsenceClose, setPendingAbsenceClose] = useState(false);
  const [absenceSaved, setAbsenceSaved] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [membershipIds, setMembershipIds] = useState<string[]>([]);
  const [membershipError, setMembershipError] = useState("");
  const [monthIsTest, setMonthIsTest] = useState(false);
  const scheduleScrollRef = useRef<HTMLDivElement>(null);
  const calculationAbortRef = useRef<AbortController | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState("2026-10");
  const [monthStore, setMonthStore] = useState<PersistedMonthStore>({ version: 1, selectedMonthKey: "2026-10", months: {} });
  const [schedule, setSchedule] = useState<Shift[]>(() => createOctober2026Schedule());
  const [baselineSchedule, setBaselineSchedule] = useState<Shift[]>(() => createOctober2026Schedule());
  const [scheduleStatus, setScheduleStatus] = useState<StoredScheduleStatus>("published");
  const [draftMode, setDraftMode] = useState<DraftMode>("seed");
  const [employeeIds, setEmployeeIds] = useState<string[]>(EMPLOYEES.map((employee) => employee.id));
  const [lockedEmployeeIds, setLockedEmployeeIds] = useState<string[]>([]);
  const [draftAbsences, setDraftAbsences] = useState<Absence[]>([]);
  const [absenceStart, setAbsenceStart] = useState("");
  const [absenceEnd, setAbsenceEnd] = useState("");
  const [absenceError, setAbsenceError] = useState("");
  const [previewSchedule, setPreviewSchedule] = useState<Shift[] | null>(null);
  const [options, setOptions] = useState<ScheduleOption[]>([]);
  const [selectedOptionKey, setSelectedOptionKey] = useState("");
  const [expandedOptionKey, setExpandedOptionKey] = useState("");
  const [focusedPreviewShiftId, setFocusedPreviewShiftId] = useState<string | null>(null);
  const [calculationError, setCalculationError] = useState("");
  const [calculating, setCalculating] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [changeEvents, setChangeEvents] = useState<AppliedChange[]>([]);
  const [selectedChangeId, setSelectedChangeId] = useState<number | null>(null);
  const [rollbackConfirmId, setRollbackConfirmId] = useState<number | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [hoveredPerson, setHoveredPerson] = useState<Person | null>(null);
  const [focusPerson, setFocusPerson] = useState<Person | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Person | null>(null);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<ShiftSelection | null>(null);
  const [workflow, setWorkflow] = useState<Workflow>(null);
  const [scope, setScope] = useState("shift");
  const [reason, setReason] = useState("absence");
  const [replacement, setReplacement] = useState("");
  const [customStart, setCustomStart] = useState("2026-10-03T08:00");
  const [customEnd, setCustomEnd] = useState("2026-10-03T20:00");
  const [storageReady, setStorageReady] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [accessStatus, setAccessStatus] = useState<"checking" | "signed-out" | "authorized" | "forbidden">("checking");
  const [authEpoch, setAuthEpoch] = useState(0);
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<"checking" | "signed-out" | "choose" | "connected" | "saving" | "error" | "conflict">("checking");
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState("");
  const [cloudRemote, setCloudRemote] = useState<ScheduleSnapshot<PersistedMonthStore> | null>(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const cloudRevisionRef = useRef(0);
  const cloudLastSavedRef = useRef("");
  const cloudSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const hadLocalStoreRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [newMonthConfirmOpen, setNewMonthConfirmOpen] = useState(false);
  const [newMonthStep, setNewMonthStep] = useState<"mode" | "employees">("mode");
  const [newDraftMode, setNewDraftMode] = useState<DraftMode>("seed");
  const [newEmployeeIds, setNewEmployeeIds] = useState<string[]>(EMPLOYEES.map((employee) => employee.id));
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [draftPublishError, setDraftPublishError] = useState("");
  const [reinforcementEditing, setReinforcementEditing] = useState(false);
  const [reinforcementSelection, setReinforcementSelection] = useState<string[]>([]);
  const [reinforcementError, setReinforcementError] = useState("");
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("pattern");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationOptions, setGenerationOptions] = useState<GeneratedScheduleOption[]>([]);
  const [selectedGenerationKey, setSelectedGenerationKey] = useState("");
  const [generationPreview, setGenerationPreview] = useState<Shift[] | null>(null);
  const initialNextMonth = addMonths(2026, 10, 1);
  const [newMonthYear, setNewMonthYear] = useState(String(initialNextMonth.year));
  const [newMonthNumber, setNewMonthNumber] = useState(String(initialNextMonth.month));
  const selectedMonth = parseMonthKey(selectedMonthKey) ?? { year: 2026, month: 10 };
  const period = useMemo(() => periodForMonth(selectedMonth.year, selectedMonth.month), [selectedMonth.month, selectedMonth.year]);
  const employees = monthStore.employees ?? EMPLOYEES;
  const PEOPLE = employees.map((employee) => employee.id);
  const employeeNameById = Object.fromEntries(employees.map((employee) => [employee.id, employee.name]));
  const activeEmployees = useMemo(() => employees.filter((employee) => employeeIds.includes(employee.id)), [employees, employeeIds]);
  const visiblePeople = PEOPLE.filter((person) => employeeIds.includes(person));
  const dayCount = daysInMonth(period.year, period.month);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, index) => index + 1), [dayCount]);
  const monthLabel = formatMonthLabel(period.year, period.month);
  const monthGenitive = formatMonthGenitive(period.year, period.month);
  const currentLifecycle = lifecycleStatus(scheduleStatus, period);
  const scheduleReadOnly = currentLifecycle === "completed" || Boolean(employeeMonthId) || reinforcementEditing;
  const displaySchedule = previewSchedule ?? generationPreview ?? schedule;
  const contextualSchedule = useMemo(
    () => mergeAdjacentContext(displaySchedule, monthStore.months, selectedMonthKey, period, monthIsTest),
    [displaySchedule, monthStore.months, period, selectedMonthKey, monthIsTest],
  );
  const baseContextualSchedule = useMemo(
    () => mergeAdjacentContext(schedule, monthStore.months, selectedMonthKey, period, monthIsTest),
    [schedule, monthStore.months, period, selectedMonthKey, monthIsTest],
  );
  const hasAppliedChanges = useMemo(
    () => schedule.some((shift) => shift.employeeId !== shift.plannedEmployeeId),
    [schedule],
  );
  const activeAbsences = useMemo(
    () => mergeAbsences(draftAbsences, ...changeEvents.map((change) => change.absences.map((absence) => ({ ...absence, createdAt: absence.createdAt ?? change.appliedAt.toISOString(), reason: absence.reason ?? (change.reason === "legacy" ? undefined : reasonLabel(change.reason, change.workflow)) })))),
    [changeEvents, draftAbsences],
  );
  const currentValidation = useMemo(
    () => validateSchedule({ schedule: contextualSchedule, employees: activeEmployees, period, absences: activeAbsences }),
    [activeAbsences, activeEmployees, contextualSchedule, period],
  );

  useEffect(() => {
    const scrollContainer = scheduleScrollRef.current;
    if (!scrollContainer) return;

    function handleWheel(event: WheelEvent) {
      const container = scheduleScrollRef.current;
      if (!container) return;
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return;

      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * container.clientWidth
          : event.deltaY;
      const maxScrollLeft = container.scrollWidth - container.clientWidth;
      const canScrollHorizontally = pixels > 0
        ? container.scrollLeft < maxScrollLeft - 1
        : container.scrollLeft > 1;

      if (!canScrollHorizontally) return;
      event.preventDefault();
      container.scrollLeft += pixels;
    }

    scrollContainer.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollContainer.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => () => {
    calculationAbortRef.current?.abort();
    generationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    try {
      const storedRaw = window.localStorage.getItem(MONTHS_STORAGE_KEY);
      hadLocalStoreRef.current = Boolean(storedRaw || window.localStorage.getItem(LEGACY_STORAGE_KEY));
      let stored = storedRaw ? JSON.parse(storedRaw) as Partial<PersistedMonthStore> : null;
      if (stored && !isValidMonthStore(stored)) stored = null;

      if (!stored) {
        const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        const legacy = legacyRaw ? JSON.parse(legacyRaw) as Partial<PersistedSchedule> : null;
        const defaultRecord = legacy && restoreMonthRecord(legacy, periodForMonth(2026, 10))
          ? legacy as PersistedSchedule
          : serializeMonthRecord({
              schedule: createOctober2026Schedule(),
              baselineSchedule: createOctober2026Schedule(),
              changeEvents: [],
              historyCount: 0,
              status: "published",
            });
        stored = { version: 1, selectedMonthKey: "2026-10", months: { "2026-10": defaultRecord } };
      }

      const availableKeys = Object.keys(stored.months!);
      const nextSelectedKey = stored.selectedMonthKey && stored.months![stored.selectedMonthKey]
        ? stored.selectedMonthKey
        : availableKeys.sort()[0] ?? "2026-10";
      const nextMonth = parseMonthKey(nextSelectedKey) ?? { year: 2026, month: 10 };
      const nextPeriod = periodForMonth(nextMonth.year, nextMonth.month);
      const restoredRecord = restoreMonthRecord(stored.months![nextSelectedKey], nextPeriod);
      const restored = restoredRecord && lifecycleStatus(restoredRecord.status, nextPeriod) !== "completed" ? synchronizeCarryIn(restoredRecord, nextPeriod, carryInAssignment(stored.months!, nextMonth.year, nextMonth.month, restoredRecord.isTest)) : restoredRecord;
      if (restored) {
        setSelectedMonthKey(nextSelectedKey);
        setSchedule(restored.schedule);
        setBaselineSchedule(restored.baselineSchedule);
        setScheduleStatus(restored.status);
    setMonthIsTest(restored.isTest);
    setMonthEmployeeRates(restored.employeeRates);
        setDraftMode(restored.draftMode);
        setEmployeeIds(restored.employeeIds);
        setLockedEmployeeIds(restored.lockedEmployeeIds);
        setDraftAbsences(restored.draftAbsences);
        setChangeEvents(restored.changeEvents);
        setHistoryCount(restored.historyCount);
      }
      setMonthStore({ version: 1, employees: stored.employees, selectedMonthKey: nextSelectedKey, months: stored.months! });
    } catch {
      // Повреждённые локальные данные не должны мешать открыть исходный график.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const persisted = currentPersistedRecord();
    setMonthStore((current) => {
      const next = { ...current, selectedMonthKey, months: { ...current.months, [selectedMonthKey]: persisted } };
      try {
        window.localStorage.setItem(MONTHS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // График продолжит работать в текущей вкладке, даже если хранилище браузера недоступно.
      }
      return next;
    });
  }, [monthEmployeeRates, monthIsTest, baselineSchedule, changeEvents, historyCount, schedule, scheduleStatus, selectedMonthKey, storageReady, draftMode, employeeIds, lockedEmployeeIds, draftAbsences]);

  useEffect(() => {
    if (!storageReady || !Object.hasOwn(monthStore.months, monthStore.selectedMonthKey)) return;
    try {
      window.localStorage.setItem(MONTHS_STORAGE_KEY, JSON.stringify(monthStore));
    } catch { /* Cloud saving and the current tab remain available. */ }
  }, [monthStore, storageReady]);

  useEffect(() => {
    if (!storageReady || !isSupabaseConfigured()) return;
    let cancelled = false;
    async function checkCloud() {
      try {
        const client = getSupabaseBrowserClient()!;
        const { data, error: authError } = await client.auth.getUser();
        if (cancelled) return;
        if (authError && authError.name !== "AuthSessionMissingError") throw authError;
        if (!data.user) {
          setAccessStatus("signed-out");
          setCloudStatus("signed-out");
          return;
        }
        const workspace = await getOrCreateWorkspace();
        const remote = await loadScheduleSnapshot<PersistedMonthStore>(workspace.id);
        if (cancelled) return;
        setAccessStatus("authorized");
        setCloudWorkspaceId(workspace.id);
        setCloudRemote(remote);
        if (remote && (!hadLocalStoreRef.current || JSON.stringify(remote.payload) === JSON.stringify(monthStore))) {
          loadCloudStore(remote);
        } else {
          setCloudStatus("choose");
        }
      } catch (error) {
        if (cancelled) return;
        setAccessStatus("forbidden");
        setCloudMessage(error instanceof Error ? error.message : "Не удалось подключиться к Supabase");
        setCloudStatus("error");
      }
    }
    void checkCloud();
    return () => { cancelled = true; };
  }, [storageReady, authEpoch]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setCloudEnabled(false);
        setCloudWorkspaceId("");
        setCloudOpen(false);
        setAccessStatus("signed-out");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!cloudEnabled || !cloudWorkspaceId || !storageReady) return;
    const json = JSON.stringify(monthStore);
    if (json === cloudLastSavedRef.current) return;
    const timer = window.setTimeout(() => {
      setCloudStatus("saving");
      cloudSaveChainRef.current = cloudSaveChainRef.current.then(async () => {
        if (json === cloudLastSavedRef.current) return;
        try {
          const revision = await saveScheduleSnapshot(cloudWorkspaceId, JSON.parse(json) as PersistedMonthStore, cloudRevisionRef.current);
          cloudRevisionRef.current = revision;
          cloudLastSavedRef.current = json;
          setCloudStatus("connected");
        } catch (error) {
          setCloudEnabled(false);
          setCloudStatus("conflict");
          setCloudMessage(error instanceof Error ? error.message : "Не удалось сохранить график в облаке");
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [cloudEnabled, cloudWorkspaceId, monthStore, storageReady]);

  function loadCloudStore(remote: ScheduleSnapshot<PersistedMonthStore>) {
    if (!isValidMonthStore(remote.payload)) {
      setCloudMessage("Данные облачного графика повреждены. Локальная копия не затронута.");
      setCloudStatus("error");
      return;
    }
    const nextKey = remote.payload.selectedMonthKey;
    const month = parseMonthKey(nextKey)!;
    const nextPeriod = periodForMonth(month.year, month.month);
    const restored = restoreMonthRecord(remote.payload.months[nextKey], nextPeriod)!;
    const synchronized = lifecycleStatus(restored.status, nextPeriod) === "completed" ? restored : synchronizeCarryIn(restored, nextPeriod, carryInAssignment(remote.payload.months, month.year, month.month, restored.isTest));
    try {
      window.localStorage.setItem(`${MONTHS_STORAGE_KEY}:before-cloud-import`, JSON.stringify(monthStore));
    } catch { /* Резервная копия останется в текущей вкладке. */ }
    resetTransientView();
    setSelectedMonthKey(nextKey);
    setSchedule(synchronized.schedule);
    setBaselineSchedule(synchronized.baselineSchedule);
    setScheduleStatus(synchronized.status);
    setMonthIsTest(synchronized.isTest);
    setMonthEmployeeRates(synchronized.employeeRates);
    setDraftMode(synchronized.draftMode);
    setEmployeeIds(synchronized.employeeIds);
    setLockedEmployeeIds(synchronized.lockedEmployeeIds);
    setDraftAbsences(synchronized.draftAbsences);
    setChangeEvents(synchronized.changeEvents);
    setHistoryCount(synchronized.historyCount);
    setMonthStore(remote.payload);
    cloudRevisionRef.current = remote.revision;
    cloudLastSavedRef.current = JSON.stringify(remote.payload);
    setCloudEnabled(true);
    setCloudStatus("connected");
  }

  async function importLocalStore() {
    if (!cloudWorkspaceId || cloudRemote) return;
    const snapshot: PersistedMonthStore = {
      ...monthStore,
      selectedMonthKey,
      months: { ...monthStore.months, [selectedMonthKey]: currentPersistedRecord() },
    };
    setCloudStatus("saving");
    try {
      const revision = await saveScheduleSnapshot(cloudWorkspaceId, snapshot, 0);
      cloudRevisionRef.current = revision;
      cloudLastSavedRef.current = JSON.stringify(snapshot);
      setCloudRemote({ payload: snapshot, revision });
      setCloudEnabled(true);
      setCloudStatus("connected");
    } catch (error) {
      setCloudStatus("conflict");
      setCloudMessage(error instanceof Error ? error.message : "Не удалось перенести графики");
    }
  }

  async function signInWithPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setAuthBusy(true);
    setCloudMessage("");
    const { data, error } = await client.functions.invoke("admin-login", { body: { login: loginName.trim().toLowerCase(), password: loginPassword } });
    setLoginPassword("");
    if (error || !data?.access_token || !data?.refresh_token) {
      setAuthBusy(false);
      setCloudMessage("Не удалось войти. Проверьте логин и пароль администратора.");
      return;
    }
    const { error: sessionError } = await client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    setAuthBusy(false);
    if (sessionError) { setCloudMessage("Не удалось восстановить сеанс. Повторите вход."); return; }
    setAccessStatus("checking");
    setAuthEpoch((value) => value + 1);
  }

  async function signOutCloud() {
    setCloudEnabled(false);
    await getSupabaseBrowserClient()?.auth.signOut();
    setCloudWorkspaceId("");
    setCloudRemote(null);
    setCloudStatus("signed-out");
    setAccessStatus("signed-out");
    setCloudOpen(false);
    setCloudMessage("Локальная копия графиков осталась в этом браузере.");
  }

  function downloadLocalBackup() {
    const snapshot: PersistedMonthStore = {
      ...monthStore,
      selectedMonthKey,
      months: { ...monthStore.months, [selectedMonthKey]: currentPersistedRecord() },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `monitoring-schedule-backup-${selectedMonthKey}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => {
    if (!resetConfirmOpen && !newMonthConfirmOpen && !cancelDraftConfirmOpen && rollbackConfirmId === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (rollbackConfirmId !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        setResetConfirmOpen(false);
        setNewMonthConfirmOpen(false);
        setCancelDraftConfirmOpen(false);
        setRollbackConfirmId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape, { capture: true });
    return () => window.removeEventListener("keydown", closeOnEscape, { capture: true });
  }, [cancelDraftConfirmOpen, newMonthConfirmOpen, resetConfirmOpen, rollbackConfirmId]);

  function openWorkflow(shift: ShiftSelection, nextWorkflow: Exclude<Workflow, null>) {
    if (scheduleReadOnly) return;
    setSelectedShift(shift);
    setWorkflow(nextWorkflow);
    setScope("shift");
    setReplacement("");
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setFocusedPreviewShiftId(null);
    setCalculationError("");
    setPreviewSchedule(null);
    setPendingChange(null);
    const target = schedule.find((item) => item.id === (shift.shiftId ?? shiftIdFor(period, shift.startDay, shift.kind)));
    if (target) {
      setCustomStart(target.start.toISOString().slice(0, 16));
      setCustomEnd(target.end.toISOString().slice(0, 16));
    }
  }

  function scrollToPreviewShift(shiftId: string) {
    const [date] = shiftId.split(":");
    const targetDate = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(targetDate.getTime())) return;
    const dayIndex = Math.max(0, targetDate.getUTCDate() - 1);
    const targetLeft = Math.max(0, dayIndex * (DAY_WIDTH + 1) - DAY_WIDTH);
    setFocusedPreviewShiftId(shiftId);
    scheduleScrollRef.current?.scrollTo({ left: targetLeft, behavior: "smooth" });
  }

  function closeWorkflow() {
    calculationAbortRef.current?.abort();
    calculationAbortRef.current = null;
    setCalculating(false);
    setWorkflow(null);
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setFocusedPreviewShiftId(null);
    setCalculationError("");
    setPreviewSchedule(null);
    setPendingChange(null);
  }

  useEffect(() => {
    if (!options.length) return;
    const closePreviewOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeWorkflow();
    };
    window.addEventListener("keydown", closePreviewOnEscape);
    return () => window.removeEventListener("keydown", closePreviewOnEscape);
  }, [options.length]);

  function openEmployeeAbsence(person: Person) {
    if (scheduleReadOnly) return;
    setSelectedEmployee(person);
    setSelectedShift(null);
    setEmployeeOpen(false);
    setWorkflow("remove");
    setScope("custom");
    setCustomStart(period.start.toISOString().slice(0, 16));
    setCustomEnd(addDays(period.start, 1).toISOString().slice(0, 16));
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setFocusedPreviewShiftId(null);
    setCalculationError("");
    setPreviewSchedule(null);
    setPendingChange(null);
  }

  useEffect(() => {
    const context = (document as ModelContextDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "start_shift_absence",
      title: "Открыть оформление отсутствия",
      description: "Открывает на странице форму отсутствия для конкретной назначенной смены. График не меняется, пока пользователь не выберет и не применит рассчитанный вариант.",
      inputSchema: {
        type: "object",
        properties: {
          employeeName: { type: "string", enum: employees.map((employee) => employee.name) },
          day: { type: "integer", minimum: 1, maximum: dayCount },
          shiftType: { type: "string", enum: ["day", "night"] },
        },
        required: ["employeeName", "day", "shiftType"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const value = input as { employeeName?: string; day?: number; shiftType?: string };
        const person = shiftSlots(schedule, shiftIdFor(period, value.day ?? 0, value.shiftType as ShiftKind)).find((shift) => employeeNameById[shift.employeeId] === value.employeeName)?.employeeId;
        if (!person || !Number.isInteger(value.day) || !value.day || value.day < 1 || value.day > dayCount || (value.shiftType !== "day" && value.shiftType !== "night")) throw new Error("Некорректные параметры смены");
        const engineShift = shiftSlots(schedule, shiftIdFor(period, value.day!, value.shiftType as ShiftKind)).find((shift) => shift.employeeId === person);
        if (!engineShift || engineShift.employeeId !== person) throw new Error("Сотрудник не назначен на эту смену");
        openWorkflow({ person, kind: value.shiftType as ShiftKind, startDay: value.day, shiftId: engineShift.id }, "remove");
        return { status: "opened", employeeName: employeeNameById[person], day: value.day, shiftType: value.shiftType };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [dayCount, period, schedule, employees]);

  function openEmployeeSheet(person: Person) {
    setSelectedEmployee(person); setAbsenceStart(""); setAbsenceEnd(""); setAbsenceReason("");
    setAbsenceError(""); setAbsenceSaved(false); setEmployeeOpen(true);
  }

  function closeEmployeeSheet(open: boolean) {
    if (!open && (absenceStart || absenceEnd || absenceReason)) { setPendingAbsenceClose(true); return; }
    setEmployeeOpen(open);
  }

  function markShiftUnavailable(employeeId: string, shiftId: string, confirmed = false) {
    if (scheduleReadOnly) return;
    const target = schedule.find((shift) => shift.id === shiftId) ?? schedule.find((shift) => shift.id === shiftId.replace(/:2$/, ""));
    if (!target || shiftAbsences(employeeId, target, activeAbsences).length) return;
    if (target.employeeId === employeeId && scheduleStatus !== "draft") {
      openWorkflow({ person: employeeId, kind: target.type === "D" ? "day" : "night", startDay: Math.floor((target.start.getTime() - period.start.getTime()) / 86400000) + 1, shiftId: target.id }, "remove");
      return;
    }
    if (target.employeeId === employeeId && !confirmed) { setPendingShiftBlock({ employeeId, shiftId }); return; }
    if (target.employeeId === employeeId) removeDraftAssignment(shiftId);
    setDraftAbsences((current) => mergeAbsences(current, [{ id: crypto.randomUUID(), employeeId, start: target.start, end: target.end, source: "shift", createdAt: new Date().toISOString() }]));
    generationAbortRef.current?.abort(); setGenerationPreview(null); setGenerationOptions([]);
    setPendingShiftBlock(null);
  }

  function removeAbsence(absence: Absence) {
    if (scheduleReadOnly) return;
    setDraftAbsences((current) => current.filter((item) => absence.id ? item.id !== absence.id : !(item.employeeId === absence.employeeId && item.start.getTime() === absence.start.getTime() && item.end.getTime() === absence.end.getTime())));
    setFocusedAbsence(null); generationAbortRef.current?.abort(); setGenerationPreview(null); setGenerationOptions([]);
  }

  function absenceLabel(absence: Absence) {
    if (absence.allDay) return `${new Intl.DateTimeFormat("ru", { timeZone: "UTC" }).format(absence.start)} — ${new Intl.DateTimeFormat("ru", { timeZone: "UTC" }).format(addDays(absence.end, -1))} включительно`;
    return `${shortDateTime(absence.start)} — ${shortDateTime(absence.end)}`;
  }

  function renderMonthAbsences(person: Person) {
    const absences = activeAbsences.filter((absence) => absence.employeeId === person && absence.start < period.end && absence.end > period.start);
    return <section className="employee-month-absences"><h3>Периоды недоступности · {monthLabel}</h3>{!absences.length ? <p>Недоступность не указана</p> : absences.map((absence) => <div className={cn("employee-absence-record", focusedAbsence === absence && "employee-absence-selected")} key={absence.id ?? `${absence.start.toISOString()}-${absence.end.toISOString()}`}><button onClick={() => { setFocusedAbsence(focusedAbsence === absence ? null : absence); scheduleScrollRef.current?.scrollTo({ left: Math.max(0, (Math.max(1, absence.start.getUTCDate()) - 2) * (DAY_WIDTH + 1)), behavior: "smooth" }); }}><strong>{absenceLabel(absence)}</strong>{absence.reason && <span>{absence.reason}</span>}{absence.createdAt && <small>Добавлено {new Intl.DateTimeFormat("ru", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(absence.createdAt))}</small>}</button></div>)}</section>;
  }

  function renderShiftSegment(person: Person, kind: ShiftKind, startDay: number, segment: "left" | "center" | "right") {
    const scheduleShift = shiftSlots(displaySchedule, shiftIdFor(period, startDay, kind)).find((item) => item.employeeId === person);
    const shift = { person, kind, startDay, shiftId: scheduleShift?.id } satisfies ShiftSelection;
    const longLabel = shiftLabel(shift, period);
    const changed = Boolean(scheduleShift && scheduleShift.employeeId !== scheduleShift.plannedEmployeeId);
    const highlightedByChange = Boolean(scheduleShift && selectedChangeId !== null && changeEvents.find((change) => change.id === selectedChangeId)?.changes.some((change) => change.shiftId === scheduleShift.id));
    const focusedPreviewChange = Boolean(scheduleShift && focusedPreviewShiftId === scheduleShift.id);
    const highlightedAbsence = Boolean(scheduleShift && focusedAbsence?.employeeId === person && scheduleShift.start < focusedAbsence.end && scheduleShift.end > focusedAbsence.start);
    const control = <button type="button" className={cn("shift-segment", kind === "day" ? "shift-day" : "shift-night", segment === "left" && "segment-left", segment === "right" && "segment-right", changed && "shift-changed", highlightedByChange && "shift-history-highlighted", focusedPreviewChange && "shift-preview-focused", highlightedAbsence && "absence-highlighted")} aria-label={`${employeeNameById[person]}. ${kind === "day" ? "Дневная" : "Ночная"} смена: ${longLabel}`} title={longLabel} onClick={scheduleReadOnly && !reinforcementEditing ? () => openEmployeeSheet(person) : undefined}><span>{kind === "day" ? "Д" : "Н"}</span></button>;
    if (scheduleReadOnly) return control;
    const actions = scheduleStatus === "draft" ? [
      { label: "Снять назначение", destructive: true, onSelect: () => scheduleShift && removeDraftAssignment(scheduleShift.id) },
      { label: "Снять и отметить недоступность", onSelect: () => scheduleShift && markShiftUnavailable(person, scheduleShift.id) },
    ] : [
      { label: "Убрать", destructive: true, onSelect: () => openWorkflow(shift, "remove") },
      { label: "Заменить", onSelect: () => openWorkflow(shift, "replace") },
      { label: "Убрать и отметить недоступность", onSelect: () => scheduleShift && markShiftUnavailable(person, scheduleShift.id) },
    ];
    return <ShiftActions actions={actions}><DropdownMenu><DropdownMenuTrigger asChild>{control}</DropdownMenuTrigger><DropdownMenuContent align="start" className="w-72 rounded-xl p-2 shadow-xl"><DropdownMenuLabel>{kind === "day" ? "Дневная" : "Ночная"} смена</DropdownMenuLabel><DropdownMenuSeparator />{actions.map((action) => <DropdownMenuItem key={action.label} variant={action.destructive ? "destructive" : "default"} onSelect={action.onSelect}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></ShiftActions>;
  }

  function renderDraftSlot(person: Person, kind: ShiftKind, startDay: number, segment: "left" | "center" | "right") {
    const slots = shiftSlots(displaySchedule, shiftIdFor(period, startDay, kind));
    const primary = slots.find((shift) => shift.slot !== 2);
    if (!primary) return null;
    const target = slots.find((shift) => !shift.employeeId) ?? (slots.length < 2 ? secondSlot(primary) : primary);
    const full = slots.filter((shift) => shift.employeeId).length >= 2;
    const addingSecond = slots.some((shift) => shift.employeeId);
    const employee = employees.find((item) => item.id === person);
    const blocking = shiftAbsences(person, target, activeAbsences);
    const unavailable = !employee || (!scheduleReadOnly && !isEmployeeAvailable(employee, target)) || blocking.length > 0;
    const highlighted = Boolean(focusedAbsence?.employeeId === person && target.start < focusedAbsence.end && target.end > focusedAbsence.start);
    const editable = !scheduleReadOnly && scheduleStatus === "draft" && !(draftMode === "seed" && startDay > GENERATION_SEED_DAYS && !draftGenerationStarted);
    const inheritedBoundary = target.start < period.start && Boolean(carryInAssignment(monthStore.months, period.year, period.month, monthIsTest));
    const assignable = editable && !full && !target.employeeId && !unavailable && !(inheritedBoundary && slots.length === 1 && addingSecond);
    const actions = unavailable ? [
      ...(blocking.some((absence) => absence.source === "shift" && draftAbsences.includes(absence)) ? [{ label: "Снять недоступность смены", onSelect: () => blocking.filter((absence) => absence.source === "shift" && draftAbsences.includes(absence)).forEach(removeAbsence) }] : []),
      ...(blocking.some((absence) => absence.source !== "shift") ? [{ label: "Открыть период недоступности", onSelect: () => openEmployeeSheet(person) }] : []),
    ] : [
      ...(assignable ? [{ label: "Назначить смену", onSelect: () => assignDraftShift(target.id, person) }] : []),
      { label: "Отметить недоступность", onSelect: () => markShiftUnavailable(person, target.id) },
    ];
    if (!unavailable && !editable && scheduleReadOnly) return null;
    const control = <button type="button" className={cn(assignable ? "draft-shift-slot" : "empty-shift-slot", assignable && addingSecond && "draft-second-slot", `draft-${segment}-slot`, unavailable && "unavailable-shift-slot", highlighted && "absence-highlighted")} onClick={assignable ? () => assignDraftShift(target.id, person) : unavailable && !reinforcementEditing ? () => openEmployeeSheet(person) : undefined} aria-disabled={unavailable || !assignable} aria-label={unavailable ? `${employeeNameById[person]} недоступен в эту смену` : assignable ? `${addingSecond ? "Добавить второго: " : "Назначить "}${employeeNameById[person]} на ${kind === "day" ? "дневную" : "ночную"} смену` : `${employeeNameById[person]}. Свободно: ${shiftLabel({person,kind,startDay}, period)}`} title={unavailable ? "Недоступно" : undefined}>{unavailable ? <X /> : assignable ? <Plus /> : null}</button>;
    return <ShiftActions actions={actions} disabled={scheduleReadOnly}>{control}</ShiftActions>;
  }

  async function calculateOptions() {
    if (scheduleReadOnly || calculating) return;
    const employeeId = selectedShift ? selectedShift.person : selectedEmployee ? selectedEmployee : "";
    let target = selectedShift ? schedule.find((shift) => shift.id === (selectedShift.shiftId ?? shiftIdFor(period, selectedShift.startDay, selectedShift.kind))) : undefined;
    let absence: Absence | null = target ? { id: crypto.randomUUID(), employeeId: target.employeeId, start: target.start, end: target.end, source: "shift", createdAt: new Date().toISOString() } : null;

    if (!selectedShift && workflow === "remove") {
      const start = new Date(`${customStart}:00Z`);
      const end = new Date(`${customEnd}:00Z`);
      if (!(start < end)) {
        setCalculationError("Окончание периода должно быть позже начала.");
        return;
      }
      absence = { id: crypto.randomUUID(), employeeId, start, end, source: "period", createdAt: new Date().toISOString() };
      target = schedule.find((shift) => shift.employeeId === employeeId && shift.start < end && shift.end > start);
    }

    if (!target || !absence) {
      setCalculationError("Выбранный период не затрагивает смены сотрудника.");
      return;
    }

    if (workflow === "remove" && selectedShift && scope === "block") {
      const block = findWorkBlock(schedule, target.employeeId, target.id);
      const selectedIndex = block.findIndex((shift) => shift.id === target.id);
      const remainingBlock = selectedIndex >= 0 ? block.slice(selectedIndex) : [];
      if (remainingBlock.length) absence = { employeeId: target.employeeId, start: target.start, end: remainingBlock[remainingBlock.length - 1].end };
    } else if (workflow === "remove" && selectedShift && scope === "week") {
      absence = { employeeId: target.employeeId, start: target.start, end: addDays(target.start, 7) };
    } else if (workflow === "remove" && selectedShift && scope === "custom") {
      const start = new Date(`${customStart}:00Z`);
      const end = new Date(`${customEnd}:00Z`);
      if (!(start < end)) {
        setCalculationError("Окончание периода должно быть позже начала.");
        return;
      }
      absence = { employeeId: target.employeeId, start, end };
    }

    absence = { ...absence, id: absence.id ?? crypto.randomUUID(), source: selectedShift && scope === "shift" ? "shift" : "period", createdAt: absence.createdAt ?? new Date().toISOString() };
    const requiredAssignments = workflow === "replace" && replacement
      ? { [target.id]: replacement }
      : {};
    setPendingChange({
      start: target.start,
      triggerShiftId: target.id,
      employeeId: target.employeeId,
      workflow: workflow ?? "remove",
      scope: workflow === "replace" ? "shift" : scope,
      reason,
      absences: [absence],
    });
    setCalculationError("");
    setCalculating(true);
    const calculationController = new AbortController();
    calculationAbortRef.current = calculationController;

    try {
      const result = await runScheduleWorker<RearrangeWorkerResult>({
        schedule: mergeAdjacentContext(schedule, monthStore.months, selectedMonthKey, period, monthIsTest),
        employees: activeEmployees,
        period,
        absences: mergeAbsences(activeAbsences, [absence]),
        recalculationStart: target.start,
        requiredAssignments,
        maxOptions: 3,
      }, calculationController.signal);

      if (!result.found) {
        setOptions([]);
        setCalculationError(result.reason);
        setPreviewSchedule(null);
        return;
      }
      setOptions(result.options);
      setSelectedOptionKey(result.recommendedKey);
      const recommended = result.options.find((option) => option.key === result.recommendedKey) ?? result.options[0];
      setPreviewSchedule(recommended.schedule);
      const firstChangeId = recommended.metrics.changes[0]?.shiftId;
      if (firstChangeId) window.requestAnimationFrame(() => scrollToPreviewShift(firstChangeId));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setOptions([]);
      setPreviewSchedule(null);
      setCalculationError(error instanceof Error ? error.message : "Не удалось рассчитать варианты");
    } finally {
      if (calculationAbortRef.current === calculationController) {
        calculationAbortRef.current = null;
        setCalculating(false);
      }
    }
  }

  function chooseOption(option: ScheduleOption) {
    setSelectedOptionKey(option.key);
    setPreviewSchedule(option.schedule);
    const firstChangeId = option.metrics.changes[0]?.shiftId;
    if (firstChangeId) window.requestAnimationFrame(() => scrollToPreviewShift(firstChangeId));
  }

  function applySelectedOption() {
    if (scheduleReadOnly) return;
    const option = options.find((item) => item.key === selectedOptionKey);
    if (!option || !pendingChange) return;
    const nextId = historyCount + 1;
    const appliedAt = new Date();
    const appliedChange: AppliedChange = {
      ...pendingChange,
      id: nextId,
      appliedAt,
      absences: pendingChange.absences.map((absence) => ({ ...absence, createdAt: appliedAt.toISOString(), reason: absence.reason ?? reasonLabel(pendingChange.reason, pendingChange.workflow) })),
      optionNumber: options.findIndex((item) => item.key === option.key) + 1,
      changes: option.metrics.changes,
      beforeSchedule: schedule.map((shift) => ({ ...shift })),
    };
    const currentShiftIds = new Set(schedule.map((shift) => shift.id));
    setSchedule(option.schedule.filter((shift) => currentShiftIds.has(shift.id)).map(({ baseEmployeeId: _baseEmployeeId, ...shift }) => shift));
    setChangeEvents((events) => [...events, appliedChange]);
    setHistoryCount(nextId);
    closeWorkflow();
  }

  function rollbackChange(changeId: number) {
    if (scheduleReadOnly) return;
    const index = changeEvents.findIndex((change) => change.id === changeId);
    if (index < 0) return;
    const targetChange = changeEvents[index];
    setSchedule(targetChange.beforeSchedule.map(({ baseEmployeeId: _baseEmployeeId, ...shift }) => ({ ...shift })));
    setChangeEvents((events) => events.slice(0, index));
    setHistoryCount(Math.max(0, targetChange.id - 1));
    setPreviewSchedule(null);
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setFocusedPreviewShiftId(null);
    setSelectedChangeId(null);
    setRollbackConfirmId(null);
  }

  function resetTransientView() {
    setReinforcementEditing(false); setReinforcementError("");
    setFocusedAbsence(null);
    setAbsenceStart(""); setAbsenceEnd(""); setAbsenceReason(""); setAbsenceError(""); setAbsenceSaved(false);
    calculationAbortRef.current?.abort();
    generationAbortRef.current?.abort();
    setPreviewSchedule(null);
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setCalculationError("");
    setSelectedChangeId(null);
    setPendingChange(null);
    setWorkflow(null);
    setDraftPublishError("");
    setEmployeeOpen(false);
    setGeneratorOpen(false);
    setGenerationMode("pattern");
    setGenerating(false);
    setGenerationError("");
    setGenerationOptions([]);
    setSelectedGenerationKey("");
    setGenerationPreview(null);
  }

  function saveMonthStore(next: PersistedMonthStore) {
    setMonthStore(next);
    try {
      window.localStorage.setItem(MONTHS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Изменения остаются доступны в текущей вкладке.
    }
  }

  function currentPersistedRecord() {
    if (currentLifecycle === "completed" && monthStore.months[selectedMonthKey]) return monthStore.months[selectedMonthKey];
    return serializeMonthRecord({ employeeRates: monthEmployeeRates, isTest: monthIsTest, schedule, baselineSchedule, changeEvents, historyCount, status: scheduleStatus, draftMode, employeeIds, lockedEmployeeIds, draftAbsences });
  }

  function isEmployeeUsed(employeeId: string) {
    const records = { ...monthStore.months, [selectedMonthKey]: currentPersistedRecord() };
    return Object.values(records).some((record) => record.employeeIds?.includes(employeeId)
      || [...record.schedule, ...(record.baselineSchedule ?? []), ...(record.changeEvents ?? []).flatMap((change) => change.beforeSchedule)]
        .some((shift) => shift.employeeId === employeeId || shift.plannedEmployeeId === employeeId));
  }

  function saveEmployee(employee: Employee): string | null {
    if (!isEmployeeRecord(employee)) return "Проверьте ФИО и период работы сотрудника";
    const original = employees.find((item) => item.id === employee.id);
    if (original && Boolean(original.isTest) !== Boolean(employee.isTest) && isEmployeeUsed(employee.id)) return "Тип сотрудника закреплён после включения в график";
    resetTransientView();
    setMonthStore((current) => ({ ...current, employees: original
      ? employees.map((item) => item.id === employee.id ? employee : item)
      : [...employees, employee] }));
    return null;
  }

  function archiveStaff(employee: Employee) {
    // Archiving only hides from new selections; employment dates govern existing shifts.
    saveEmployee({ ...employee, archivedAt: new Date().toISOString() });
  }

  function deleteTestEmployee(employee: Employee): string | null {
    if (!employee.isTest) return "Обычного сотрудника можно перенести в архив";
    const records = { ...monthStore.months, [selectedMonthKey]: currentPersistedRecord() };
    const hasReference = (record: PersistedSchedule) => record.employeeIds?.includes(employee.id)
      || [...record.schedule, ...(record.baselineSchedule ?? []), ...(record.changeEvents ?? []).flatMap((change) => change.beforeSchedule)]
        .some((shift) => shift.employeeId === employee.id || shift.plannedEmployeeId === employee.id);
    if (Object.entries(records).some(([key, record]) => { const month = parseMonthKey(key)!; return hasReference(record) && lifecycleStatus(record.status ?? "published", periodForMonth(month.year, month.month)) === "completed"; })) return "Сотрудник используется в завершённом месяце. Перенесите его в архив.";
    if (Object.values(records).some((record) => !record.isTest && hasReference(record))) return "Удаление остановлено: сотрудник используется в рабочем графике";
    const clear = (shifts: PersistedSchedule["schedule"]) => shifts.map((shift) => ({ ...shift,
      employeeId: shift.employeeId === employee.id ? "" : shift.employeeId,
      plannedEmployeeId: shift.plannedEmployeeId === employee.id ? "" : shift.plannedEmployeeId,
      baseEmployeeId: shift.baseEmployeeId === employee.id ? undefined : shift.baseEmployeeId,
    }));
    const months = Object.fromEntries(Object.entries(records).map(([key, record]) => [key, !record.isTest ? record : {
      ...record,
      employeeIds: record.employeeIds?.filter((id) => id !== employee.id),
      lockedEmployeeIds: record.lockedEmployeeIds?.filter((id) => id !== employee.id),
      employeeRates: Object.fromEntries(Object.entries(record.employeeRates ?? {}).filter(([id]) => id !== employee.id)),
      draftAbsences: record.draftAbsences?.filter((absence) => absence.employeeId !== employee.id),
      schedule: clear(record.schedule), baselineSchedule: clear(record.baselineSchedule ?? []),
      changeEvents: (record.changeEvents ?? []).filter((change) => change.employeeId !== employee.id).map((change) => ({
        ...change, beforeSchedule: clear(change.beforeSchedule),
        absences: change.absences?.filter((absence) => absence.employeeId !== employee.id),
        changes: change.changes.filter((item) => item.fromEmployeeId !== employee.id && item.toEmployeeId !== employee.id),
      })),
    }]));
    const next = { ...monthStore, employees: employees.filter((item) => item.id !== employee.id), months };
    const restored = restoreMonthRecord(months[selectedMonthKey], period)!;
    resetTransientView();
    setSchedule(restored.schedule); setBaselineSchedule(restored.baselineSchedule);
    setEmployeeIds(restored.employeeIds); setLockedEmployeeIds(restored.lockedEmployeeIds);
    setDraftAbsences(restored.draftAbsences); setChangeEvents(restored.changeEvents);
    setSelectedEmployee(null); setFocusPerson(null); setStaffProfileId(null);
    saveMonthStore(next);
    return null;
  }

  function openMembership() {
    if (scheduleReadOnly) return;
    setMembershipIds([...employeeIds]); setMembershipError(""); setMembershipOpen(true);
  }

  function saveMembership() {
    if (scheduleReadOnly) return;
    if (!membershipIds.length || membershipIds.length > MAX_MONTH_EMPLOYEES) { setMembershipError("Выберите от 1 до 8 сотрудников"); return; }
    const removed = employeeIds.filter((id) => !membershipIds.includes(id));
    if (schedule.some((shift) => removed.includes(shift.employeeId) || removed.includes(shift.plannedEmployeeId))
      || baselineSchedule.some((shift) => removed.includes(shift.employeeId))) {
      setMembershipError("Сначала снимите или перераспределите назначения. Участники исходного плана сохраняются в составе месяца."); return;
    }
    resetTransientView();
    setEmployeeIds(membershipIds);
    setLockedEmployeeIds((ids) => ids.filter((id) => membershipIds.includes(id)));
    setMonthIsTest(monthIsTest || employees.some((employee) => membershipIds.includes(employee.id) && employee.isTest));
    setMembershipOpen(false);
  }

  function openStoredMonth(targetKey: string, source = monthStore) {
    const targetMonth = parseMonthKey(targetKey);
    const targetRecord = targetKey === selectedMonthKey ? currentPersistedRecord() : source.months[targetKey];
    if (!targetMonth || !targetRecord) return;
    const nextStore = {
      ...source,
      selectedMonthKey: targetKey,
      months: { ...source.months, [selectedMonthKey]: currentPersistedRecord() },
    };
    const targetPeriod = periodForMonth(targetMonth.year, targetMonth.month);
    const restoredRecord = restoreMonthRecord(targetRecord, targetPeriod);
    const restored = restoredRecord && lifecycleStatus(restoredRecord.status, targetPeriod) !== "completed" ? synchronizeCarryIn(restoredRecord, targetPeriod, carryInAssignment(nextStore.months, targetMonth.year, targetMonth.month, restoredRecord.isTest)) : restoredRecord;
    if (!restored) return;
    saveMonthStore(nextStore);
    setSelectedMonthKey(targetKey);
    setSchedule(restored.schedule);
    setBaselineSchedule(restored.baselineSchedule);
    setScheduleStatus(restored.status);
    setMonthIsTest(restored.isTest);
    setMonthEmployeeRates(restored.employeeRates);
    setDraftMode(restored.draftMode);
    setEmployeeIds(restored.employeeIds);
    setLockedEmployeeIds(restored.lockedEmployeeIds);
    setDraftAbsences(restored.draftAbsences);
    setChangeEvents(restored.changeEvents);
    setHistoryCount(restored.historyCount);
    resetTransientView();
  }

  function openNewMonthDialog() {
    const next = addMonths(period.year, period.month, 1);
    setNewMonthYear(String(next.year));
    setNewMonthNumber(String(next.month));
    setNewMonthStep("mode");
    setNewDraftMode("seed");
    setNewEmployeeIds(employees.filter((employee) => !employee.archivedAt && (employee.active || employee.endDateTime && new Date(`${employee.endDateTime}Z`) > period.end)).slice(0, MAX_MONTH_EMPLOYEES).map((employee) => employee.id));
    setNewMonthConfirmOpen(true);
  }

  function startBlankDraft() {
    const targetYear = Number(newMonthYear);
    const targetMonthNumber = Number(newMonthNumber);
    const targetKey = monthKey(targetYear, targetMonthNumber);
    const currentRecord = currentPersistedRecord();
    const source: PersistedMonthStore = {
      ...monthStore,
      months: { ...monthStore.months, [selectedMonthKey]: currentRecord },
    };
    if (source.months[targetKey]) {
      openStoredMonth(targetKey, source);
      setNewMonthConfirmOpen(false);
      return;
    }

    const targetPeriod = periodForMonth(targetYear, targetMonthNumber);
    const isTest = employees.some((employee) => newEmployeeIds.includes(employee.id) && employee.isTest);
    const carryIn = carryInAssignment(source.months, targetYear, targetMonthNumber, isTest);
    let blank = createBlankMonthSchedule(targetPeriod, carryIn?.employeeId ?? "").map((shift) => (
      shift.start < targetPeriod.start && carryIn
        ? { ...shift, plannedEmployeeId: carryIn.plannedEmployeeId }
        : shift
    ));
    blank = synchronizeCarryIn({ schedule: blank, baselineSchedule: [] }, targetPeriod, carryIn).schedule;
    if (!newEmployeeIds.length || newEmployeeIds.length > MAX_MONTH_EMPLOYEES) return;
    const draftRecord = serializeMonthRecord({ isTest, schedule: blank, baselineSchedule: [], changeEvents: [], historyCount: 0, status: "draft", draftMode: newDraftMode, employeeIds: newEmployeeIds, lockedEmployeeIds: [] });
    const nextStore: PersistedMonthStore = {
      ...source,
      version: 1,
      selectedMonthKey: targetKey,
      months: { ...source.months, [targetKey]: draftRecord },
    };
    saveMonthStore(nextStore);
    setSelectedMonthKey(targetKey);
    setSchedule(blank);
    setBaselineSchedule([]);
    setScheduleStatus("draft");
    setMonthIsTest(isTest);
    setMonthEmployeeRates({});
    setDraftMode(newDraftMode);
    setEmployeeIds(newEmployeeIds);
    setLockedEmployeeIds([]);
    setDraftAbsences([]);
    setHistoryCount(0);
    setChangeEvents([]);
    resetTransientView();
    setNewMonthConfirmOpen(false);
  }

  function assignDraftShift(shiftId: string, employeeId: string) {
    if (scheduleReadOnly) return;
    if (scheduleStatus !== "draft" || scheduleReadOnly) return;
    const primary = schedule.find((shift) => shift.id === shiftId.replace(/:2$/, "") && shift.slot !== 2);
    const slots = primary ? shiftSlots(schedule, primary.id) : [];
    const target = slots.find((shift) => !shift.employeeId) ?? (primary && slots.length < 2 ? secondSlot(primary) : undefined);
    const employee = employees.find((item) => item.id === employeeId);
    if (!target || (target.slot === 2 && !slots.some((shift) => shift.slot === 2) && target.start < period.start && carryInAssignment(monthStore.months, period.year, period.month, monthIsTest)) || slots.some((shift) => shift.employeeId === employeeId) || !employee || !employeeIds.includes(employeeId) || !isEmployeeAvailable(employee, target)) {
      setDraftPublishError("Эта смена вне периода работы сотрудника"); return;
    }
    if (shiftAbsences(employeeId, target, activeAbsences).length) {
      setDraftPublishError("Этот сотрудник недоступен в выбранную смену.");
      return;
    }
    setSchedule((current) => { const withSlot = current.some((shift) => shift.id === target.id) ? current : [...current, target]; return withSlot.map((shift) => shift.id === target.id ? { ...shift, employeeId, plannedEmployeeId: employeeId } : shift); });
    setDraftPublishError("");
  }

  function removeDraftAssignment(shiftId: string) {
    if (scheduleReadOnly) return;
    if (scheduleStatus !== "draft" || scheduleReadOnly) return;
    setSchedule((current) => current.map((shift) => shift.id === shiftId
      ? { ...shift, employeeId: "", plannedEmployeeId: "" }
      : shift));
    setDraftPublishError("");
  }

  function addDraftAbsence(person: Person) {
    if (scheduleStatus !== "draft" || scheduleReadOnly) return false;
    const dates = absencePeriod(absenceStart, absenceEnd, absenceMode);
    if (!dates) { setAbsenceError("Укажите корректное начало и окончание периода"); return false; }
    const { start, end } = dates;
    if (schedule.some((shift) => shift.employeeId === person && shift.start < end && shift.end > start)) {
      setAbsenceError("На этот период уже назначены смены. Сначала снимите назначения."); return false;
    }
    setDraftAbsences((current) => mergeAbsences(current, [{ id: crypto.randomUUID(), employeeId: person, start, end,
      createdAt: new Date().toISOString(), reason: absenceReason.trim() || undefined, source: "period", allDay: absenceMode === "days" }]));
    generationAbortRef.current?.abort(); setGenerationPreview(null); setGenerationOptions([]);
    setAbsenceError(""); setDraftPublishError(""); setAbsenceSaved(true);
    setAbsenceStart(""); setAbsenceEnd(""); setAbsenceReason("");
    return true;
  }

  function openReinforcementSelection() {
    setReinforcementSelection(schedule.filter((shift) => shift.slot === 2 && shift.start >= period.start && shift.start < period.end).map(baseShiftId));
    setReinforcementError(""); setGeneratorOpen(false); setReinforcementEditing(true);
  }

  function toggleReinforcement(key: string) {
    const secondary = shiftSlots(schedule, key).find((shift) => shift.slot === 2);
    if (reinforcementSelection.includes(key) && secondary?.employeeId) { setReinforcementError("Сначала снимите второе назначение этой смены"); return; }
    setReinforcementError(""); setReinforcementSelection((keys) => keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]);
  }

  function finishReinforcementSelection(save: boolean) {
    if (save) setSchedule((current) => setReinforcements(current, reinforcementSelection, period.start, period.end));
    setReinforcementEditing(false); setReinforcementError(""); setGeneratorOpen(true);
    setGenerationOptions([]); setGenerationPreview(null); setGenerationError("");
  }

  function openGenerator() {
    if (scheduleReadOnly) return;
    setGenerationMode(draftMode === "manual" ? "optimal" : "pattern");
    setGenerationError("");
    setGenerationOptions([]);
    setSelectedGenerationKey("");
    setGenerationPreview(null);
    setGeneratorOpen(true);
  }

  function closeGenerator() {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setGenerating(false);
    setGeneratorOpen(false);
    setGenerationError("");
    setGenerationOptions([]);
    setSelectedGenerationKey("");
    setGenerationPreview(null);
  }

  async function calculateGeneratedSchedule() {
    if (scheduleReadOnly) return;
    if (generating) return;
    setGenerating(true);
    setGenerationError("");
    setGenerationOptions([]);
    setSelectedGenerationKey("");
    setGenerationPreview(null);
    const generationController = new AbortController();
    generationAbortRef.current = generationController;
    try {
      const result = await runScheduleWorker<GenerationWorkerResult>({
        action: "generate",
        schedule: mergeAdjacentContext(schedule, monthStore.months, selectedMonthKey, period, monthIsTest),
        employees: activeEmployees,
        period,
        seedDays: GENERATION_SEED_DAYS,
        mode: generationMode,
        maxOptions: 3,
        manual: draftMode === "manual",
        lockedEmployeeIds,
        absences: draftAbsences,
      }, generationController.signal);
      if (!result.found) {
        setGenerationError(result.reason);
        return;
      }
      setGenerationOptions(result.options);
      setSelectedGenerationKey(result.recommendedKey);
      setGenerationPreview(result.options[0].schedule);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setGenerationError(error instanceof Error ? error.message : "Не удалось продолжить график");
    } finally {
      if (generationAbortRef.current === generationController) {
        generationAbortRef.current = null;
        setGenerating(false);
      }
    }
  }

  function chooseGenerationOption(option: GeneratedScheduleOption) {
    setSelectedGenerationKey(option.key);
    setGenerationPreview(option.schedule);
  }

  function applyGeneratedSchedule() {
    if (scheduleReadOnly) return;
    const option = generationOptions.find((item) => item.key === selectedGenerationKey);
    if (!option) return;
    const currentShiftIds = new Set(schedule.map((shift) => shift.id));
    setSchedule(option.schedule
      .filter((shift) => currentShiftIds.has(shift.id))
      .map(({ baseEmployeeId: _baseEmployeeId, ...shift }) => ({ ...shift, plannedEmployeeId: shift.employeeId })));
    setDraftPublishError("");
    setGeneratorOpen(false);
    setGenerationError("");
    setGenerationOptions([]);
    setSelectedGenerationKey("");
    setGenerationPreview(null);
  }

  function publishDraft() {
    if (scheduleReadOnly) return;
    const unassigned = schedule.filter((shift) => !shift.employeeId);
    if (unassigned.length) {
      setDraftPublishError(`Осталось назначить ${unassigned.length} ${unassigned.length === 1 ? "смену" : "смен"}.`);
      return;
    }
    const validation = validateSchedule({ schedule: mergeAdjacentContext(schedule, monthStore.months, selectedMonthKey, period, monthIsTest), employees: activeEmployees, period, absences: draftAbsences });
    if (!validation.valid) {
      setDraftPublishError(`Нельзя закрепить график: найдено ${validation.issues.length} нарушений обязательных правил.`);
      return;
    }
    setMonthEmployeeRates(Object.fromEntries(activeEmployees.filter((employee) => employee.hourlyRate !== undefined).map((employee) => [employee.id, employee.hourlyRate!])));
    const published = schedule.map((shift) => ({ ...shift, plannedEmployeeId: shift.employeeId }));
    setSchedule(published);
    setBaselineSchedule(published.map((shift) => ({ ...shift })));
    setScheduleStatus("published");
    setDraftPublishError("");
  }

  function cancelDraft() {
    if (scheduleReadOnly) return;
    if (baselineSchedule.length) {
      setSchedule(baselineSchedule.map((shift) => ({ ...shift })));
      setScheduleStatus("published");
      setLockedEmployeeIds([]);
      setDraftAbsences([]);
      setChangeEvents([]);
      setHistoryCount(0);
      resetTransientView();
      setCancelDraftConfirmOpen(false);
      return;
    }
    const months = { ...monthStore.months };
    delete months[selectedMonthKey];
    const fallbackKey = Object.keys(months)
      .sort()
      .filter((key) => key < selectedMonthKey)
      .at(-1) ?? Object.keys(months).sort()[0];
    if (fallbackKey) {
      const fallbackMonth = parseMonthKey(fallbackKey)!;
      const restored = restoreMonthRecord(months[fallbackKey], periodForMonth(fallbackMonth.year, fallbackMonth.month));
      if (restored) {
        const nextStore = { ...monthStore, version: 1 as const, selectedMonthKey: fallbackKey, months };
        saveMonthStore(nextStore);
        setSelectedMonthKey(fallbackKey);
        setSchedule(restored.schedule);
        setBaselineSchedule(restored.baselineSchedule);
        setScheduleStatus(restored.status);
    setMonthIsTest(restored.isTest);
    setMonthEmployeeRates(restored.employeeRates);
        setDraftMode(restored.draftMode);
        setEmployeeIds(restored.employeeIds);
        setLockedEmployeeIds(restored.lockedEmployeeIds);
        setDraftAbsences(restored.draftAbsences);
        setChangeEvents(restored.changeEvents);
        setHistoryCount(restored.historyCount);
        resetTransientView();
      }
    }
    setCancelDraftConfirmOpen(false);
  }

  function resetToOriginalSchedule() {
    if (scheduleReadOnly) return;
    setSchedule(baselineSchedule.map((shift) => ({ ...shift })));
    setPreviewSchedule(null);
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setCalculationError("");
    setHistoryCount(0);
    setChangeEvents([]);
    setSelectedChangeId(null);
    setRollbackConfirmId(null);
    setPendingChange(null);
    setWorkflow(null);
    setEmployeeOpen(false);
    setResetConfirmOpen(false);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const [{ default: ExcelJS }, templateResponse] = await Promise.all([
        import("exceljs"),
        fetch("./schedule-template.xlsx"),
      ]);
      if (!templateResponse.ok) throw new Error("Не удалось загрузить шаблон Excel");

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await templateResponse.arrayBuffer());
      const sheet = workbook.getWorksheet("почасовой график") ?? workbook.worksheets[0];
      if (!sheet) throw new Error("В шаблоне отсутствует лист графика");

      const cloneStyle = <T,>(style: T): T => JSON.parse(JSON.stringify(style)) as T;
      const emptyStyles = [
        cloneStyle(sheet.getCell("B9").style),
        cloneStyle(sheet.getCell("C8").style),
        cloneStyle(sheet.getCell("D9").style),
      ];
      const dayShiftStyle = cloneStyle(sheet.getCell("C9").style);
      const nightShiftStyle = cloneStyle(sheet.getCell("B8").style);
      const weekdayFill = cloneStyle(sheet.getCell("B6").fill);
      const weekendFill = cloneStyle(sheet.getCell("H6").fill);

      const extraRows = Math.max(0, visiblePeople.length - 4);
      sheet.unMergeCells("C23:AJ23");
      if (extraRows) {
        sheet.insertRows(12, Array.from({ length: extraRows }, () => []), "i+");
        sheet.insertRows(18 + extraRows, Array.from({ length: extraRows }, () => []), "i+");
      }
      const summaryHeaderRow = 13 + extraRows;
      const summaryStartRow = 14 + extraRows;
      const notesRow = 23 + extraRows * 2;
      sheet.mergeCells(`C${notesRow}:AJ${notesRow}`);
      for (let index = 0; index < Math.max(4, visiblePeople.length); index += 1) {
        const row = 8 + index;
        sheet.getRow(row).height = sheet.getRow(8).height;
        sheet.getCell(row, 1).value = visiblePeople[index] ? employeeNameById[visiblePeople[index]] : null;
        sheet.getCell(row, 1).style = cloneStyle(sheet.getCell("A8").style);
        sheet.getCell(summaryStartRow + index, 1).value = null;
        for (const column of [3, 4, 6, 9]) sheet.getCell(summaryStartRow + index, column).value = null;
      }
      sheet.getCell("R3").value = `${monthIsTest ? "Тестовый график" : "График мониторинга"} — ${monthLabel}`;
      for (let templateDay = dayCount + 1; templateDay <= 31; templateDay += 1) {
        const firstColumn = 2 + (templateDay - 1) * 3;
        sheet.getCell(6, firstColumn).value = null;
        sheet.getCell(7, firstColumn).value = null;
      }
      for (const day of days) {
        const firstColumn = 2 + (day - 1) * 3;
        const calendarDate = utcDate(period.year, period.month, day);
        const weekend = calendarDate.getUTCDay() === 0 || calendarDate.getUTCDay() === 6;
        sheet.getCell(6, firstColumn).value = day;
        sheet.getCell(7, firstColumn).value = WEEKDAYS_RU[calendarDate.getUTCDay()];
        for (const row of [6, 7]) {
          const headerCell = sheet.getCell(row, firstColumn);
          const headerStyle = cloneStyle(headerCell.style);
          headerStyle.fill = cloneStyle(weekend ? weekendFill : weekdayFill);
          headerCell.style = headerStyle;
        }
      }

      for (let row = 8; row <= 11 + extraRows; row += 1) {
        for (let day = 1; day <= 31; day += 1) {
          const firstColumn = 2 + (day - 1) * 3;
          for (let segment = 0; segment < 3; segment += 1) {
            const cell = sheet.getCell(row, firstColumn + segment);
            cell.value = null;
            cell.style = cloneStyle(emptyStyles[segment]);
          }
        }
      }

      const scheduleById = new Map(displaySchedule.map((shift) => [shift.id, shift]));
      const rowByEmployee = new Map(visiblePeople.map((person, index) => [person, 8 + index]));
      const writeShiftMarker = (shift: Shift | undefined, column: number, style: typeof dayShiftStyle) => {
        if (!shift) return;
        const row = rowByEmployee.get(shift.employeeId);
        if (!row) return;
        const cell = sheet.getCell(row, column);
        cell.value = shift.type === "D" ? "Д3" : "Н2";
        cell.style = cloneStyle(style);
        if (shift.employeeId !== shift.plannedEmployeeId) {
          cell.font = { ...cell.font, bold: true, color: { argb: "FFC00000" } };
        }
      };

      for (const day of days) {
        const firstColumn = 2 + (day - 1) * 3;
        shiftSlots(displaySchedule, shiftIdFor(period, day - 1, "night")).forEach((shift) => writeShiftMarker(shift, firstColumn, nightShiftStyle));
        shiftSlots(displaySchedule, shiftIdFor(period, day, "day")).forEach((shift) => writeShiftMarker(shift, firstColumn + 1, dayShiftStyle));
        shiftSlots(displaySchedule, shiftIdFor(period, day, "night")).forEach((shift) => writeShiftMarker(shift, firstColumn + 2, nightShiftStyle));
      }

      sheet.getCell(`C${summaryHeaderRow}`).value = "Д3";
      sheet.getCell(`D${summaryHeaderRow}`).value = "Н2";
      sheet.getCell(`E${summaryHeaderRow}`).value = "пар выходных";
      sheet.getCell(`I${summaryHeaderRow}`).value = "рабочих ч.";
      for (const [index, person] of visiblePeople.entries()) {
        const employeeId = person;
        const row = summaryStartRow + index;
        const stats = personStats(person, displaySchedule, period);
        let nightHalves = 0;
        let workedHours = 0;
        for (const shift of displaySchedule) {
          if (shift.employeeId !== employeeId) continue;
          if (shift.type === "N") {
            for (const day of days) {
              if (shiftIdFor(period, day - 1, "night") === baseShiftId(shift)) nightHalves += 1;
              if (shiftIdFor(period, day, "night") === baseShiftId(shift)) nightHalves += 1;
            }
          }
          const overlapStart = Math.max(shift.start.getTime(), period.start.getTime());
          const overlapEnd = Math.min(shift.end.getTime(), period.end.getTime());
          if (overlapEnd > overlapStart) workedHours += (overlapEnd - overlapStart) / (60 * 60 * 1000);
        }
        sheet.getCell(row, 1).value = employeeNameById[person];
        sheet.getCell(row, 3).value = stats.dayCount;
        sheet.getCell(row, 4).value = nightHalves / 2;
        sheet.getCell(row, 6).value = stats.offPairs;
        sheet.getCell(row, 9).value = workedHours;
      }

      sheet.getCell(`C${notesRow}`).value = [
        "Каждая смена длится ровно 12 часов; все дневные и ночные смены должны быть закрыты.",
        "Между сменами одного сотрудника должно быть не менее 12 часов отдыха.",
        "В одном рабочем блоке допускается не более четырех смен.",
        "После блока из трех или четырех смен обязательны два полных календарных выходных.",
        "В каждом месяце у сотрудника должно быть минимум две пары полных календарных выходных.",
        "В каждой календарной неделе должно быть не менее 42 часов отдыха суммарно.",
      ].join("\n");
      sheet.getCell(`C${notesRow}`).alignment = { ...sheet.getCell(`C${notesRow}`).alignment, wrapText: true, vertical: "top" };
      sheet.getRow(notesRow).height = 90;
      workbook.creator = "Мониторинг";
      workbook.modified = new Date();
      workbook.calcProperties.fullCalcOnLoad = true;

      const output = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([new Uint8Array(output)], { type: EXCEL_MIME }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${monthIsTest ? "Тестовый_график" : "График_мониторинга"}_${selectedMonthKey}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось сформировать Excel");
    } finally {
      setExporting(false);
    }
  }

  const profileRecords = { ...monthStore.months, [selectedMonthKey]: currentPersistedRecord() };
  const calendarParts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const calendarYear = Number(calendarParts.find((part) => part.type === "year")!.value);
  const calendarMonth = Number(calendarParts.find((part) => part.type === "month")!.value);
  const calendarKey = monthKey(calendarYear, calendarMonth);
  const staffProfile = employees.find((employee) => employee.id === staffProfileId);
  const profileCurrent = profileRecords[calendarKey] ? restoreMonthRecord(profileRecords[calendarKey], periodForMonth(calendarYear, calendarMonth)) : null;

  function employeeMonths(person: string): EmployeeMonthEntry[] {
    return Object.entries(profileRecords).flatMap(([key, record]) => {
      const month = parseMonthKey(key)!;
      const monthPeriod = periodForMonth(month.year, month.month);
      const restored = restoreMonthRecord(record, monthPeriod);
      if (!restored || !restored.employeeIds.includes(person)) return [];
      const stats = personStats(person, restored.schedule, monthPeriod);
      return [{ key, label: formatMonthLabel(month.year, month.month), year: month.year, status: lifecycleLabel(lifecycleStatus(restored.status, monthPeriod)), isTest: restored.isTest, hours: stats.hours, total: stats.total }];
    }).sort((a, b) => b.key.localeCompare(a.key));
  }

  function renderEmployeeMonthStats(person: string, shifts: Shift[], monthPeriod: Period, hourlyRate: number | undefined, label: string) {
    const stats = personStats(person, shifts, monthPeriod);
    const key = monthKey(monthPeriod.year, monthPeriod.month);
    const record = profileRecords[key];
    const contextual = mergeAdjacentContext(shifts, profileRecords, key, monthPeriod, Boolean(record?.isTest));
    const coefficients = coefficientHoursForEmployee(contextual, person, monthPeriod);
    return <section className="employee-month-stats" aria-label={`Статистика сотрудника за ${label}`}><div className="employee-stats"><div><strong>{stats.total}</strong><span>смен</span></div><div><strong>{stats.hours}</strong><span>часов</span></div><div><strong>{stats.dayCount}</strong><span>дневных</span></div><div><strong>{stats.nightCount}</strong><span>ночных</span></div></div><div className="employee-month-details"><div className="detail-line"><span>Рабочие часы по плану</span><strong>{stats.planned} ч</strong></div><div className="detail-line"><span>Отклонение от плана</span><strong>{stats.delta > 0 ? "+" : ""}{stats.delta} ч</strong></div><div className="detail-line"><span>Часы полных выходных</span><strong>{stats.fullOffHours} ч · {stats.fullOffDays} дней</strong></div><div className="detail-line"><span>Свободные от смен часы</span><strong>{stats.restHours} ч</strong></div><div className="detail-line"><span>Пар полных выходных</span><strong>{stats.offPairs}</strong></div><div className="detail-line"><span>Ставка этого месяца</span><strong>{hourlyRate === undefined ? "Не задана" : `${hourlyRate.toLocaleString("ru")} ₽/ч`}</strong></div></div>{coefficients ? <details className="coefficient-summary"><summary><span>Часы с коэффициентами</span><strong>{formatCoefficient(coefficients.weightedHours)}</strong><span className="coefficient-more">Подробнее <ChevronRight /></span></summary><CoefficientBreakdown hours={coefficients} /></details> : <p className="coefficient-unavailable">Календарь праздников за {monthPeriod.year} год ещё не загружен</p>}</section>;
  }

  function openEmployeeMonth(person: string, key: string) {
    openStoredMonth(key); setEmployeeMonthId(person); setFocusPerson(person); setActiveSection("График");
  }

  function navigateMonth(key: string) {
    const focus = focusPerson;
    openStoredMonth(key);
    if (employeeMonthId) setFocusPerson(focus);
  }

  function backToEmployeeProfile() {
    const person = employeeMonthId;
    resetTransientView(); setStaffProfileId(person); setEmployeeMonthId(null); setActiveSection("Сотрудники");
  }

  const reinforcedShifts = schedule.filter((shift) => shift.slot === 2 && shift.start >= period.start && shift.start < period.end).sort((a,b) => a.start.getTime() - b.start.getTime());
  function reinforcementControl(day: number, kind: ShiftKind) {
    const key = shiftIdFor(period, day, kind);
    const selected = reinforcementEditing ? reinforcementSelection.includes(key) : reinforcedShifts.some((shift) => baseShiftId(shift) === key);
    const count = shiftSlots(displaySchedule, key).filter((shift) => shift.employeeId).length;
    if (!reinforcementEditing && !selected) return null;
    return <button type="button" disabled={!reinforcementEditing} className={cn("reinforcement-shift", selected && "reinforcement-selected")} onClick={() => toggleReinforcement(key)} aria-pressed={selected} aria-label={`${selected ? "Снять усиление" : "Усилить"}: ${day}, ${kind === "day" ? "дневная" : "ночная"} смена`}>{kind === "day" ? "День" : "Ночь"}{selected && <strong>{reinforcementEditing ? "×2" : `${count}/2`}</strong>}</button>;
  }

  const gridStyle = { gridTemplateColumns: `${NAME_WIDTH}px repeat(${dayCount}, ${DAY_WIDTH}px)` };
  const monthShifts = schedule.filter((shift) => shift.start >= period.start && shift.start < period.end);
  const assignedMonthShifts = monthShifts.filter((shift) => Boolean(shift.employeeId)).length;
  const boundaryShiftAssigned = schedule.some((shift) => shift.start < period.start && shift.end > period.start && Boolean(shift.employeeId));
  const generationStart = addDays(period.start, GENERATION_SEED_DAYS);
  const generationSeedShifts = monthShifts.filter((shift) => shift.slot !== 2 && shift.start < generationStart);
  const assignedGenerationSeedShifts = generationSeedShifts.filter((shift) => Boolean(shift.employeeId)).length;
  const futureDraftShifts = monthShifts.filter((shift) => shift.start >= generationStart);
  const assignedFutureDraftShifts = futureDraftShifts.filter((shift) => Boolean(shift.employeeId)).length;
  const generationSeedReady = assignedGenerationSeedShifts === generationSeedShifts.length && boundaryShiftAssigned;
  const draftGenerationStarted = assignedFutureDraftShifts > 0;
  const generationBoundaryLeft = NAME_WIDTH + 1 + GENERATION_SEED_DAYS * (DAY_WIDTH + 1);
  const selectedStats = selectedEmployee ? personStats(selectedEmployee, displaySchedule, period) : null;
  const selectedCoefficients = selectedEmployee ? coefficientHoursForEmployee(contextualSchedule, selectedEmployee, period) : null;
  const selectedChange = selectedChangeId === null ? null : changeEvents.find((change) => change.id === selectedChangeId) ?? null;
  const rollbackTarget = rollbackConfirmId === null ? null : changeEvents.find((change) => change.id === rollbackConfirmId) ?? null;
  const rollbackLaterChanges = rollbackTarget ? changeEvents.filter((change) => change.id > rollbackTarget.id) : [];
  const navigationMonthKeys = employeeMonthId ? employeeMonths(employeeMonthId).map((month) => month.key).sort() : Object.keys(profileRecords).sort();
  const selectedMonthIndex = navigationMonthKeys.indexOf(selectedMonthKey);
  const navigationPreviousKey = selectedMonthIndex > 0 ? navigationMonthKeys[selectedMonthIndex - 1] : null;
  const navigationNextKey = selectedMonthIndex >= 0 && selectedMonthIndex < navigationMonthKeys.length - 1 ? navigationMonthKeys[selectedMonthIndex + 1] : null;
  const requestedNewMonthKey = monthKey(Number(newMonthYear), Number(newMonthNumber));
  const requestedMonthExists = Boolean(monthStore.months[requestedNewMonthKey]);
  const requestedCarryIn = carryInAssignment(monthStore.months, Number(newMonthYear), Number(newMonthNumber), employees.some((employee) => newEmployeeIds.includes(employee.id) && employee.isTest));
  const selectedCarryInMissing = Boolean(requestedCarryIn && (!newEmployeeIds.includes(requestedCarryIn.employeeId) || requestedCarryIn.secondary && !newEmployeeIds.includes(requestedCarryIn.secondary.employeeId)));
  const changeMarkers = useMemo(() => {
    const previousPositions: number[] = [];
    return changeEvents.map((change) => {
      const left = changeMarkerLeft(change.start, period, dayCount);
      const lane = previousPositions.filter((position) => Math.abs(position - left) < 112).length % 2;
      previousPositions.push(left);
      return { change, left, lane };
    });
  }, [changeEvents, dayCount, period]);

  if (isSupabaseConfigured() && accessStatus !== "authorized") {
    return <main className="access-page">
      <section className="access-card">
        <div className="access-icon"><LockKeyhole /></div>
        <h1>Мониторинг</h1>
        <p>Доступ к графику администратора</p>
        {accessStatus === "checking" ? <p role="status">Проверяем вход…</p> : accessStatus === "forbidden" ? <>
          <p role="alert">Не удалось подтвердить доступ к графику. {cloudMessage}</p>
          <Button variant="outline" onClick={() => { setAccessStatus("checking"); setAuthEpoch((value) => value + 1); }}>Повторить проверку</Button>
          <Button variant="outline" onClick={signOutCloud}>Выйти</Button>
        </> : <>
          <form onSubmit={signInWithPassword} className="access-form">
            <label>Логин<input type="text" autoComplete="username" required value={loginName} onChange={(event) => setLoginName(event.target.value)} aria-label="Логин" /></label>
            <label>Пароль<input type="password" autoComplete="current-password" required value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></label>
            <Button type="submit" disabled={authBusy}>{authBusy ? "Входим…" : "Войти"}</Button>
          </form>
          {cloudMessage && <p role="status" className="access-message">{cloudMessage}</p>}
        </>}
      </section>
    </main>;
  }

  return (
    <TooltipProvider>
      <div className={cn("app-shell", workflow !== null && options.length > 0 && "schedule-preview-active")}>
        <aside className={cn("sidebar", sidebarExpanded ? "sidebar-open" : "sidebar-closed")}>
          <div className="sidebar-brand">
            <div className="brand-mark" aria-hidden="true"><CalendarDays className="size-5" /></div>
            {sidebarExpanded && <div className="min-w-0"><div className="brand-title">Мониторинг</div><div className="brand-caption">Управление сменами</div></div>}
          </div>
          <nav className="sidebar-nav" aria-label="Основное меню">
            {NAV_ITEMS.map((item) => <NavButton key={item.label} {...item} active={activeSection === item.label} onClick={item.label === "График" || item.label === "Сотрудники" ? () => { resetTransientView(); setEmployeeMonthId(null); setStaffProfileId(null); setActiveSection(item.label as "График" | "Сотрудники"); } : undefined} expanded={sidebarExpanded} />)}
          </nav>
          <div className="sidebar-bottom">
            <NavButton label="Настройки" icon={Settings2} expanded={sidebarExpanded} />
            <button type="button" className="collapse-button" onClick={() => setSidebarExpanded((value) => !value)} aria-label={sidebarExpanded ? "Свернуть меню" : "Развернуть меню"}>
              {sidebarExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}{sidebarExpanded && <span>Свернуть меню</span>}
            </button>
          </div>
        </aside>

        <main className="main-area">
          <header className={cn("topbar", employeeMonthId && "employee-month-topbar", currentLifecycle === "completed" && "archive-month-topbar")}>
            <div className="topbar-heading"><h1>{employeeMonthId ? "Месяц сотрудника" : activeSection === "Сотрудники" ? "Сотрудники" : "График работы"}</h1></div>
            <div className="topbar-actions">
              {activeSection === "График" && !scheduleReadOnly && (scheduleStatus === "draft" ? <>
                <Button variant="outline" className="cancel-draft-button" onClick={() => setCancelDraftConfirmOpen(true)}>Отменить создание</Button>
                <Button className="publish-draft-button" onClick={publishDraft}><LockKeyhole />Закрепить план</Button>
              </> : <Button variant="outline" className="new-month-button" onClick={openNewMonthDialog}><Plus />Создать месяц</Button>)}
              {activeSection === "График" && !reinforcementEditing && <>
              <Button variant="outline" size="icon" onClick={() => navigationPreviousKey && navigateMonth(navigationPreviousKey)} disabled={!navigationPreviousKey} aria-label="Предыдущий сохранённый месяц"><ChevronLeft /></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="month-button"><CalendarDays />{monthLabel}<small>{monthIsTest ? "Тестовый · " : ""}{lifecycleLabel(currentLifecycle)}</small></button></DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="month-menu-content">
                  <DropdownMenuLabel>Сохранённые графики</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {navigationMonthKeys.map((key) => {
                    const value = parseMonthKey(key)!;
                    const storedStatus = profileRecords[key].status === "draft" ? "draft" : "published";
                    const status = lifecycleStatus(storedStatus, periodForMonth(value.year, value.month));
                    return <DropdownMenuItem key={key} disabled={key === selectedMonthKey} onSelect={() => navigateMonth(key)}><span className="month-menu-item"><strong>{formatMonthLabel(value.year, value.month)}</strong><small>{profileRecords[key].isTest ? "Тестовый · " : ""}{lifecycleLabel(status)}</small></span></DropdownMenuItem>;
                  })}
                  <DropdownMenuSeparator />
                  {!employeeMonthId && <DropdownMenuItem onSelect={openNewMonthDialog}><Plus />Создать новый месяц</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="icon" onClick={() => navigationNextKey && navigateMonth(navigationNextKey)} disabled={!navigationNextKey} aria-label="Следующий сохранённый месяц"><ChevronRight /></Button>
              {scheduleStatus === "published" && !scheduleReadOnly && <Button variant="outline" className="reset-schedule-button" onClick={() => setResetConfirmOpen(true)} disabled={!hasAppliedChanges} title={hasAppliedChanges ? "Отменить все применённые перестановки" : "График уже соответствует исходному"}><RotateCcw /><span>Вернуть исходный</span></Button>}
              <Button className="export-button" onClick={exportExcel} disabled={exporting || scheduleStatus === "draft" || activeSection !== "График"}><Download />{exporting ? "Готовим Excel…" : "Скачать Excel"}</Button>
              </>}
              {isSupabaseConfigured() ? <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="profile-button" aria-label="Действия пользователя">А</button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setCloudOpen(true)}><Cloud />Сохранение графиков</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void signOutCloud()}>Выйти</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu> : <button type="button" className="profile-button coming-icon-button" aria-disabled="true" aria-label="Профиль пользователя — будет позже" title="Будет позже">А</button>}
            </div>
          </header>

          <div className="content-area">
            {activeSection === "Сотрудники" ? staffProfile ? <EmployeeProfile key={staffProfile.id} employee={staffProfile} months={employeeMonths(staffProfile.id)} currentMonthLabel={formatMonthLabel(calendarYear, calendarMonth)} onBack={() => setStaffProfileId(null)} onOpenMonth={(key) => openEmployeeMonth(staffProfile.id, key)} onEdit={() => { setEmployeeEditorId(staffProfile.id); setStaffProfileId(null); }} overview={profileCurrent?.employeeIds.includes(staffProfile.id) ? <>{renderEmployeeMonthStats(staffProfile.id, profileCurrent.schedule, periodForMonth(calendarYear, calendarMonth), profileCurrent.employeeRates[staffProfile.id] ?? (profileCurrent.status === "draft" ? staffProfile.hourlyRate : undefined), formatMonthLabel(calendarYear, calendarMonth))}<Button variant="outline" onClick={() => openEmployeeMonth(staffProfile.id, calendarKey)}>Открыть график месяца</Button></> : <p className="staff-empty">Сотрудник не включён в график текущего месяца</p>} /> : <EmployeesPanel employees={employees} memberIds={employeeIds} monthLabel={monthLabel} onSave={saveEmployee} onArchive={archiveStaff} onDelete={deleteTestEmployee} onMembership={openMembership} membershipReadOnly={scheduleReadOnly} isUsed={isEmployeeUsed} onOpen={setStaffProfileId} initialEditId={employeeEditorId} onEditConsumed={() => setEmployeeEditorId(null)} /> : <>
            {employeeMonthId && <div className="employee-month-banner"><Button variant="ghost" onClick={backToEmployeeProfile}><ChevronLeft />Карточка сотрудника</Button><strong>{employeeNameById[employeeMonthId]}</strong><span>{currentLifecycle === "completed" ? "Просмотр истории" : "Просмотр месяца"}</span></div>}
            {employeeMonthId && renderEmployeeMonthStats(employeeMonthId, displaySchedule, period, monthEmployeeRates[employeeMonthId] ?? (scheduleStatus === "draft" ? employees.find((employee) => employee.id === employeeMonthId)?.hourlyRate : undefined), monthLabel)}
            {reinforcementEditing && <div className="reinforcement-bar"><span><strong>Усиление смен</strong><small>Выбрано: {reinforcementSelection.length}</small></span>{reinforcementError && <p role="alert">{reinforcementError}</p>}<Button variant="outline" onClick={() => finishReinforcementSelection(false)}>Отмена</Button><Button onClick={() => finishReinforcementSelection(true)}>Готово</Button></div>}
            <section className="schedule-card" aria-labelledby="schedule-title">
              <div className="schedule-toolbar">
                <div><h2 id="schedule-title">{scheduleStatus === "draft" ? "Черновик исходного графика" : "Расписание"}</h2><p>{scheduleStatus === "draft" ? draftMode === "manual" ? "Ручной режим" : "Заполнение по образцу" : "Дневная смена 08:00–20:00 · ночная смена 20:00–08:00"}</p></div>
                <div className="toolbar-right">
                  {focusPerson && <button className="focus-chip" onClick={() => setFocusPerson(null)}>Показан {employeeNameById[focusPerson!]}<span>Сбросить</span></button>}
                  <div className="legend" aria-label="Обозначения смен"><span><Sun />День</span><span><Moon />Ночь</span></div>
                </div>
              </div>

              {scheduleStatus === "draft" && !scheduleReadOnly && (
                <div className={cn("draft-progress", draftPublishError && "draft-progress-error")}>
                  <div><WandSparkles /><span><strong>{draftMode === "manual" || draftGenerationStarted ? `${assignedMonthShifts} из ${monthShifts.length} смен месяца назначено` : `Первые ${assignedGenerationSeedShifts} из ${generationSeedShifts.length} смен заполнены`}</strong></span></div>
                  <div className="draft-progress-actions">
                    {draftPublishError && <p><TriangleAlert />{draftPublishError}</p>}
                    <Button type="button" size="sm" onClick={openGenerator} disabled={draftMode === "manual" ? generating : !generationSeedReady || generating}><WandSparkles />{draftMode === "manual" ? "Заполнить свободные смены" : draftGenerationStarted ? "Пересчитать" : "Рассчитать продолжение"}</Button>
                  </div>
                </div>
              )}

              <div ref={scheduleScrollRef} className="schedule-scroll" tabIndex={0} aria-label={`График за ${monthGenitive}`}>
                <div className={cn("schedule-grid", changeMarkers.length > 0 && "schedule-grid-with-markers")} style={gridStyle}>
                  {scheduleStatus === "draft" && draftMode === "seed" && <div className="generation-boundary" style={{ left: generationBoundaryLeft }} aria-label={`Граница ручного заполнения после ${GENERATION_SEED_DAYS} числа`}><span>Автозаполнение с {GENERATION_SEED_DAYS + 1} числа</span><i /></div>}
                  {changeMarkers.length > 0 && <div className="change-markers-layer" aria-label="Применённые изменения">
                    {changeMarkers.map(({ change, left, lane }) => <div className={cn("change-marker", selectedChangeId === change.id && "change-marker-active")} style={{ left }} key={change.id}>
                      <button type="button" className="change-marker-label" style={{ top: 4 + lane * 24 }} onClick={() => setSelectedChangeId(change.id)}>Изменение {change.id}</button>
                      <span className="change-marker-line" />
                    </div>)}
                  </div>}
                  <div className="sticky-name header-name"><span>Сотрудники</span><span className="header-count">{visiblePeople.length}</span></div>
                  {days.map((day) => { const info = dayInfo(period, day); const locked = scheduleStatus === "draft" && draftMode === "seed" && day > GENERATION_SEED_DAYS && !draftGenerationStarted && !generationPreview; return <div key={`date-${day}`} className={cn("date-header", info.weekend && "weekend-header", locked && "draft-future-locked")}><strong>{day}</strong><span>{info.weekday}</span><div className="reinforcement-date-controls">{reinforcementControl(day, "day")}{reinforcementControl(day, "night")}</div></div>; })}

                  <div className="sticky-name time-name"><Clock3 />Время</div>
                  {days.map((day) => { const info = dayInfo(period, day); const locked = scheduleStatus === "draft" && draftMode === "seed" && day > GENERATION_SEED_DAYS && !draftGenerationStarted && !generationPreview; return <div key={`time-${day}`} className={cn("time-cell", info.weekend && "weekend-cell", locked && "draft-future-locked")}><span>00–08</span><span>08–20</span><span>20–24</span></div>; })}

                  {visiblePeople.map((person) => {
                    const personIndex = PEOPLE.indexOf(person);
                    const isFocusedOut = Boolean(focusPerson && focusPerson !== person);
                    const isHighlighted = hoveredPerson === person || focusPerson === person;
                    return [
                      <div key={`${person}-name`} className={cn("sticky-name employee-name employee-name-row", isHighlighted && "employee-highlighted", isFocusedOut && "row-muted")} onMouseEnter={() => setHoveredPerson(person)} onMouseLeave={() => setHoveredPerson(null)}>
                        {scheduleStatus === "draft" && !scheduleReadOnly && <button type="button" className={cn("employee-lock", lockedEmployeeIds.includes(person) && "employee-lock-active")} onClick={() => setLockedEmployeeIds((current) => current.includes(person) ? current.filter((id) => id !== person) : [...current, person])} title={lockedEmployeeIds.includes(person) ? `Разрешить автоматические назначения для ${employeeNameById[person]}` : `Запретить автоматические назначения для ${employeeNameById[person]}`} aria-label={lockedEmployeeIds.includes(person) ? `Разблокировать ${employeeNameById[person]}` : `Заблокировать ${employeeNameById[person]}`}>{lockedEmployeeIds.includes(person) ? <LockKeyhole /> : <LockOpen />}</button>}
                        <button type="button" className="employee-name-action" aria-label={`Открыть карточку ${employeeNameById[person]}`} onClick={() => { if (!reinforcementEditing) openEmployeeSheet(person); }}><span className={`employee-avatar avatar-${personIndex % 4 + 1}`}>{personIndex + 1}</span><span className="employee-name-label"><span className="employee-surname">{compactEmployeeName(employeeNameById[person]).surname}</span><span className="employee-initials">{compactEmployeeName(employeeNameById[person]).initials}</span></span><ChevronRight className="employee-chevron" /></button>
                      </div>,
                      ...days.map((day) => {
                        const info = dayInfo(period, day);
                        const leftShift = shiftSlots(displaySchedule, shiftIdFor(period, day - 1, "night")).find((shift) => shift.employeeId === person);
                        const dayShift = shiftSlots(displaySchedule, shiftIdFor(period, day, "day")).find((shift) => shift.employeeId === person);
                        const nightShift = shiftSlots(displaySchedule, shiftIdFor(period, day, "night")).find((shift) => shift.employeeId === person);
                        const leftOwner = leftShift?.employeeId;
                        const dayOwner = dayShift?.employeeId;
                        const nightOwner = nightShift?.employeeId;
                        const locked = scheduleStatus === "draft" && draftMode === "seed" && day > GENERATION_SEED_DAYS && !draftGenerationStarted && !generationPreview;
                        return <div key={`${person}-${day}`} className={cn("schedule-cell", info.weekend && "weekend-cell", isHighlighted && "cell-highlighted", isFocusedOut && "row-muted", locked && "draft-future-locked")} onMouseEnter={() => setHoveredPerson(person)} onMouseLeave={() => setHoveredPerson(null)}>
                          <div className="segment-slot left-slot">{leftOwner === person ? renderShiftSegment(person, "night", day - 1, "left") : renderDraftSlot(person, "night", day - 1, "left")}</div>
                          <div className="segment-slot center-slot">{dayOwner === person ? renderShiftSegment(person, "day", day, "center") : renderDraftSlot(person, "day", day, "center")}</div>
                          <div className="segment-slot right-slot">{nightOwner === person ? renderShiftSegment(person, "night", day, "right") : renderDraftSlot(person, "night", day, "right")}</div>
                        </div>;
                      }),
                    ];
                  })}

                  <button type="button" className="sticky-name add-employee-row" onClick={openMembership} disabled={scheduleReadOnly}><span className="add-icon"><Plus /></span><span>Состав месяца</span><small>{employeeIds.length}/8</small></button>
                  {days.map((day) => <div key={`add-${day}`} className="add-row-cell" />)}
                </div>
              </div>

            </section>

            {employeeMonthId && renderMonthAbsences(employeeMonthId)}
            <section className="summary-grid" aria-label="Сводка графика">
              <article className="summary-card"><span className="summary-icon blue"><CheckCircle2 /></span><div><strong>{assignedMonthShifts} из {monthShifts.length}</strong><span>назначения заполнены</span></div></article>
              <article className="summary-card"><span className="summary-icon cyan"><Clock3 /></span><div><strong>12 часов</strong><span>продолжительность смены</span></div></article>
              <article className="summary-card"><span className="summary-icon violet"><Users /></span><div><strong>{visiblePeople.length} сотрудника</strong><span>в текущем графике</span></div></article>
              <article className="summary-card"><span className="summary-icon green"><ShieldCheck /></span><div><strong>{currentValidation.valid ? "Без нарушений" : currentValidation.issues.length}</strong><span>обязательные правила</span></div></article>
            </section>
            </>}
          </div>
        </main>

        <Sheet open={membershipOpen} onOpenChange={setMembershipOpen}>
          <SheetContent className="employee-sheet sm:max-w-[460px]">
            <SheetHeader className="sheet-header-custom"><SheetTitle>Состав месяца</SheetTitle><SheetDescription>{monthLabel} · от 1 до 8 сотрудников. Новые участники добавляются без назначения смен.</SheetDescription></SheetHeader>
            <div className="sheet-body">
              <div className="new-month-employees">{employees.filter((employee) => employeeIds.includes(employee.id) || !employee.archivedAt && (employee.active || employee.endDateTime && new Date(`${employee.endDateTime}Z`) > period.start)).map((employee) => <label key={employee.id}><input type="checkbox" checked={membershipIds.includes(employee.id)} disabled={!membershipIds.includes(employee.id) && membershipIds.length >= MAX_MONTH_EMPLOYEES} onChange={() => { setMembershipError(""); setMembershipIds((ids) => ids.includes(employee.id) ? ids.filter((id) => id !== employee.id) : [...ids, employee.id]); }} /><span>{employee.name}{employee.isTest ? " · Тестовый" : ""}{!employee.active ? " · Уволен" : ""}</span></label>)}</div>
              <p className="staff-form-id">Выбрано: {membershipIds.length}/8</p>
              {!monthIsTest && employees.some((employee) => membershipIds.includes(employee.id) && employee.isTest) && <p className="new-month-warning">График будет помечен как тестовый, в том числе после закрепления плана.</p>}
              {membershipError && <p role="alert" className="staff-error">{membershipError}</p>}
              <Button variant="outline" onClick={() => { setMembershipOpen(false); setActiveSection("Сотрудники"); }}>Открыть список сотрудников</Button>
              <div className="staff-form-footer"><Button variant="outline" onClick={() => setMembershipOpen(false)}>Отмена</Button><Button onClick={saveMembership}>Сохранить состав</Button></div>
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={generatorOpen} onOpenChange={(open) => { if (!open) closeGenerator(); }}>
          <SheetContent className="generator-sheet sm:max-w-[500px]">
            <SheetHeader className="sheet-header-custom">
              <div className="sheet-avatar generator-sheet-avatar"><WandSparkles /></div>
              <SheetTitle className="text-xl">{draftMode === "manual" ? "Заполнить свободные смены" : "Продолжить график"}</SheetTitle>
              <SheetDescription>{draftMode === "manual" ? "Ручные назначения сохранятся; замочки исключат сотрудников из новых назначений" : `Первые ${GENERATION_SEED_DAYS} дней останутся без изменений`}</SheetDescription>
            </SheetHeader>
            <div className="sheet-body">
              {generating ? (
                <div className="calculation-loading" role="status" aria-live="polite">
                  <span className="calculation-spinner"><Loader2 className="animate-spin" aria-hidden="true" /></span>
                  <h3>Формируем график до конца месяца…</h3>
                  <p>Проверяем отдых, рабочие блоки, полные выходные и распределение нагрузки.</p>
                </div>
              ) : generationOptions.length ? (
                <div className="generation-results">
                  <div className="generation-success"><CheckCircle2 /><span><strong>Найдено допустимое продолжение</strong></span></div>
                  <div className="generation-option-list">
                    {generationOptions.map((option, index) => {
                      const selected = option.key === selectedGenerationKey;
                      return <button type="button" key={option.key} className={cn("generation-option", selected && "generation-option-selected")} onClick={() => chooseGenerationOption(option)}>
                        <span className="generation-option-title">Вариант {index + 1}{index === 0 && <em>Рекомендуемый</em>}</span>
                        <span className="generation-option-metrics"><span>Разброс нагрузки<strong>{option.metrics.loadSpreadHours} ч</strong></span><span>Совпадение со схемой<strong>{option.metrics.patternTotal ? `${Math.round(option.metrics.patternMatches / option.metrics.patternTotal * 100)}%` : "—"}</strong></span></span>
                      </button>;
                    })}
                  </div>
                  <div className="generation-employee-hours">
                    {visiblePeople.map((person) => {
                      const employeeId = person;
                      const option = generationOptions.find((item) => item.key === selectedGenerationKey) ?? generationOptions[0];
                      return <span key={person}><strong>{employeeNameById[person]}</strong><small>{option.metrics.workHours[employeeId]} ч · {option.metrics.dayShifts[employeeId]} день / {option.metrics.nightShifts[employeeId]} ночь</small></span>;
                    })}
                  </div>
                </div>
              ) : (
                <div className="generation-mode-section">
                  <div className="reinforcement-settings"><Button variant="outline" onClick={openReinforcementSelection}><Users />Усиление смен{reinforcedShifts.length ? ` · ${reinforcedShifts.length}` : ""}</Button>{reinforcedShifts.length > 0 && <ul>{reinforcedShifts.map((shift) => <li key={shift.id}>{changeDateLabel(shift.id)} · 2 сотрудника</li>)}</ul>}</div>
                  <h3>{draftMode === "manual" ? "Автоматическое заполнение" : "Как продолжить расписание?"}</h3>
                  {draftMode === "seed" && <button type="button" className={cn("generation-mode-card", generationMode === "pattern" && "generation-mode-card-selected")} onClick={() => { setGenerationMode("pattern"); setGenerationError(""); }}>
                    <span className="generation-mode-icon"><History /></span><span><strong>Продолжить заданную схему</strong><small>Максимально повторить порядок дневных и ночных смен, заданный в первых восьми днях.</small></span><i />
                  </button>}
                  {draftMode === "seed" && <button type="button" className={cn("generation-mode-card", generationMode === "optimal" && "generation-mode-card-selected")} onClick={() => { setGenerationMode("optimal"); setGenerationError(""); }}>
                    <span className="generation-mode-icon"><ShieldCheck /></span><span><strong>Составить оптимальный график</strong><small>В первую очередь выровнять количество часов, дневных и ночных смен.</small></span><i />
                  </button>}
                  <div className="generation-lock-note"><LockKeyhole /><span>{draftMode === "manual" ? "Назначенные вручную смены не изменятся. Сотрудникам с закрытым замочком новые смены не добавляются." : "Все назначения до голубой линии зафиксированы и не участвуют в перестановках."}</span></div>
                  {generationError && <div className="generation-error"><TriangleAlert /><span>{generationError}</span></div>}
                </div>
              )}
            </div>
            <SheetFooter className="sheet-footer-custom">
              {generating ? <><Button variant="outline" onClick={closeGenerator}>Остановить расчёт</Button><Button disabled><Loader2 className="animate-spin" />Идёт расчёт…</Button></> : generationOptions.length ? <><Button variant="outline" onClick={() => { setGenerationOptions([]); setSelectedGenerationKey(""); setGenerationPreview(null); setGenerationError(""); }}>Назад</Button><Button onClick={applyGeneratedSchedule}><CheckCircle2 />Применить продолжение</Button></> : <><Button variant="outline" onClick={closeGenerator}>Отмена</Button><Button onClick={calculateGeneratedSchedule}><WandSparkles />Рассчитать варианты</Button></>}
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={cloudOpen} onOpenChange={setCloudOpen}>
          <SheetContent className="employee-sheet sm:max-w-[430px]">
            <SheetHeader className="sheet-header-custom"><div className="sheet-avatar"><Cloud /></div><SheetTitle className="text-xl">Сохранение графиков</SheetTitle><SheetDescription>Доступ к графикам только после входа</SheetDescription></SheetHeader>
            <div className="sheet-body cloud-sheet-body">
              {cloudStatus === "checking" && <p>Проверяем подключение…</p>}
              {cloudStatus === "choose" && (cloudRemote ? <div className="cloud-choice"><p>В облаке уже есть графики. Скачайте копию данных этого браузера перед открытием облачной версии.</p><Button variant="outline" onClick={downloadLocalBackup}>Скачать локальную копию</Button><Button onClick={() => loadCloudStore(cloudRemote)}>Открыть графики из облака</Button></div> : <div className="cloud-choice"><p>В облаке пока нет графиков. Перенесём все месяцы, исходные планы и историю изменений из этого браузера.</p><Button onClick={importLocalStore}>Перенести мои графики</Button></div>)}
              {(cloudStatus === "connected" || cloudStatus === "saving") && <div className="cloud-choice"><p>{cloudStatus === "saving" ? "Сохраняем изменения…" : "Графики сохраняются автоматически после изменений."}</p><small>Локальная копия также остаётся в браузере.</small></div>}
              {cloudStatus === "conflict" && <div className="cloud-choice"><p>Автоматическое сохранение остановлено. Облачный график мог измениться в другой вкладке. Текущие правки остались в этом браузере.</p><Button variant="outline" onClick={async () => { try { const remote = await loadScheduleSnapshot<PersistedMonthStore>(cloudWorkspaceId); setCloudRemote(remote); setCloudStatus("choose"); setCloudMessage(""); } catch (error) { setCloudMessage(error instanceof Error ? error.message : "Не удалось загрузить данные"); } }}>Проверить облачную версию</Button></div>}
              {cloudMessage && <p className="cloud-message" role="status">{cloudMessage}</p>}
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={employeeOpen} onOpenChange={closeEmployeeSheet}>
          <SheetContent className="employee-sheet sm:max-w-[430px]">
            {selectedEmployee && selectedStats && <>
              <SheetHeader className="sheet-header-custom"><div className="sheet-avatar"><UserRound /></div><SheetTitle className="text-xl">{employeeNameById[selectedEmployee]}</SheetTitle><SheetDescription>Показатели за {monthGenitive}</SheetDescription></SheetHeader>
              <div className="sheet-body">
                <div className="employee-stats"><div><strong>{selectedStats.total}</strong><span>смен</span></div><div><strong>{selectedStats.hours}</strong><span>часов</span></div><div><strong>{selectedStats.dayCount}</strong><span>дневных</span></div><div><strong>{selectedStats.nightCount}</strong><span>ночных</span></div></div>
                {selectedCoefficients ? (
                  <details className="coefficient-summary">
                    <summary><span>Часы с коэффициентами</span><strong>{formatCoefficient(selectedCoefficients.weightedHours)}</strong><span className="coefficient-more">Подробнее <ChevronRight /></span></summary>
                    <CoefficientBreakdown hours={selectedCoefficients} />
                  </details>
                ) : <div className="coefficient-unavailable">Часы с коэффициентами: календарь праздников за {period.year} год ещё не загружен.</div>}
                <div className="detail-line"><span>Часы полных выходных</span><strong>{selectedStats.fullOffHours} часов <small>({selectedStats.fullOffDays} дней)</small></strong></div>
                <div className="detail-line"><span>Все свободные от смен часы</span><strong>{selectedStats.restHours} часов</strong></div>
                <div className="detail-line"><span>Рабочие часы по плану</span><strong>{selectedStats.planned} часов</strong></div>
                <div className="detail-line"><span>Отклонение от плана</span><strong>{selectedStats.delta > 0 ? "+" : ""}{selectedStats.delta} часов</strong></div>
                <div className="detail-line"><span>Пар полных выходных</span><strong>{selectedStats.offPairs}</strong></div>
                {scheduleStatus === "draft" && !scheduleReadOnly && <div className="draft-absence-panel">
                  <strong>Период недоступности</strong>
                  <label>Период <select aria-label="Формат периода недоступности" value={absenceMode} onChange={(event) => { setAbsenceMode(event.target.value as "days" | "time"); setAbsenceStart(""); setAbsenceEnd(""); setAbsenceSaved(false); }}><option value="days">Целые дни включительно</option><option value="time">Точное время</option></select></label>
                  <label>С <input aria-label="Начало недоступности" type={absenceMode === "days" ? "date" : "datetime-local"} value={absenceStart} onChange={(event) => { setAbsenceStart(event.target.value); setAbsenceError(""); setAbsenceSaved(false); }} /></label>
                  <label>По <input aria-label="Окончание недоступности" type={absenceMode === "days" ? "date" : "datetime-local"} value={absenceEnd} onChange={(event) => { setAbsenceEnd(event.target.value); setAbsenceError(""); setAbsenceSaved(false); }} /></label>
                  <label>Причина <input value={absenceReason} onChange={(event) => { setAbsenceReason(event.target.value); setAbsenceSaved(false); }} maxLength={200} /></label>
                  {absenceError && <p className="draft-absence-error" role="alert">{absenceError}</p>}
                  {absenceSaved && <p role="status" className="absence-saved">Период сохранён</p>}
                  <Button type="button" size="sm" onClick={() => addDraftAbsence(selectedEmployee)}>Сохранить период</Button>
                </div>}
                <div className="employee-sheet-absences">{activeAbsences.filter((absence) => absence.employeeId === selectedEmployee).map((absence) => <div className="draft-absence-item" key={absence.id ?? `${absence.start.toISOString()}-${absence.end.toISOString()}`}><span>{absenceLabel(absence)}{absence.reason && <small>{absence.reason}</small>}</span>{!scheduleReadOnly && draftAbsences.includes(absence) && <button type="button" aria-label="Удалить период недоступности" onClick={() => removeAbsence(absence)}><X /></button>}</div>)}</div>
                <div className="action-list">
                  {scheduleStatus !== "draft" && !scheduleReadOnly && <button type="button" onClick={() => openEmployeeAbsence(selectedEmployee)}><UserX /><span><strong>Указать недоступность</strong></span><ChevronRight /></button>}
                  <button type="button" onClick={() => { setFocusPerson(selectedEmployee); closeEmployeeSheet(false); }}><Eye /><span><strong>Показать только его график</strong></span><ChevronRight /></button>
                  <button type="button" onClick={() => { if (absenceStart || absenceEnd || absenceReason) { setPendingAbsenceClose(true); return; } setEmployeeOpen(false); setEmployeeMonthId(null); setStaffProfileId(selectedEmployee); setActiveSection("Сотрудники"); }}><UserRound /><span><strong>Полная карточка сотрудника</strong></span><ChevronRight /></button>
                  {scheduleStatus === "draft" && !scheduleReadOnly && <button type="button" onClick={() => setLockedEmployeeIds((current) => current.includes(selectedEmployee) ? current.filter((id) => id !== selectedEmployee) : [...current, selectedEmployee])}>{lockedEmployeeIds.includes(selectedEmployee) ? <LockKeyhole /> : <LockOpen />}<span><strong>{lockedEmployeeIds.includes(selectedEmployee) ? "Разблокировать для расчёта" : "Заблокировать для расчёта"}</strong></span><ChevronRight /></button>}
                </div>
              </div>
            </>}
          </SheetContent>
        </Sheet>

        <AlertDialog open={Boolean(pendingShiftBlock)} onOpenChange={(open) => { if (!open) setPendingShiftBlock(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Снять смену и отметить недоступность?</AlertDialogTitle><AlertDialogDescription>Назначение будет снято. Эта смена станет недоступной для сотрудника.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => pendingShiftBlock && markShiftUnavailable(pendingShiftBlock.employeeId, pendingShiftBlock.shiftId, true)}>Снять и отметить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        <AlertDialog open={pendingAbsenceClose} onOpenChange={setPendingAbsenceClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Период ещё не сохранён</AlertDialogTitle><AlertDialogDescription>Сохранить введённую недоступность перед закрытием?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Продолжить ввод</AlertDialogCancel><Button variant="outline" onClick={() => { setAbsenceStart(""); setAbsenceEnd(""); setAbsenceReason(""); setPendingAbsenceClose(false); setEmployeeOpen(false); }}>Не сохранять</Button><Button onClick={() => { setPendingAbsenceClose(false); if (selectedEmployee && addDraftAbsence(selectedEmployee)) setEmployeeOpen(false); }}>Сохранить</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>

        <Sheet open={Boolean(selectedChange)} onOpenChange={(open) => {
          if (!open && rollbackConfirmId === null) {
            setSelectedChangeId(null);
          }
        }}>
          <SheetContent className="change-sheet sm:max-w-[440px]">
            {selectedChange && <>
              <SheetHeader className="sheet-header-custom"><div className="sheet-avatar change-sheet-avatar"><History /></div><SheetTitle className="text-xl">Изменение {selectedChange.id}</SheetTitle><SheetDescription>{changeStartLabel(selectedChange.start)} · применён вариант {selectedChange.optionNumber}</SheetDescription></SheetHeader>
              <div className="sheet-body">
                <div className="change-summary-card">
                  <div><span>Причина</span><strong>{reasonLabel(selectedChange.reason, selectedChange.workflow)}</strong></div>
                  <div><span>Сотрудник</span><strong>{employeeNameById[selectedChange.employeeId]}</strong></div>
                  <div><span>Период</span><strong>{scopeLabel(selectedChange.scope, selectedChange.workflow)}</strong></div>
                  <div><span>Перестановок</span><strong>{selectedChange.changes.length}</strong></div>
                </div>
                <h3 className="change-sheet-title">Перестановки в пакете</h3>
                <div className="change-sheet-list">
                  {selectedChange.changes.map((change) => <div key={change.shiftId}><span>{changeDateLabel(change.shiftId)}</span><strong>{employeeNameById[change.fromEmployeeId]} → {employeeNameById[change.toEmployeeId]}</strong></div>)}
                </div>
                {!scheduleReadOnly && changeEvents.filter((change) => change.id > selectedChange.id).length > 0 && <div className="rollback-warning"><TriangleAlert /><span>При откате также будут отменены все более поздние изменения: {changeEvents.filter((change) => change.id > selectedChange.id).map((change) => `№${change.id}`).join(", ")}.</span></div>}
              </div>
              {!scheduleReadOnly && <SheetFooter className="sheet-footer-custom"><Button variant="destructive" onClick={() => setRollbackConfirmId(selectedChange.id)}><RotateCcw />Откатить изменение</Button></SheetFooter>}
            </>}
          </SheetContent>
        </Sheet>

        <AlertDialog open={Boolean(rollbackTarget)} onOpenChange={(open) => { if (!open) setRollbackConfirmId(null); }}>
          {rollbackTarget && (
            <AlertDialogContent className="rollback-dialog gap-0 rounded-[17px] p-[26px] sm:max-w-[430px]">
              <span className="reset-dialog-icon"><TriangleAlert /></span>
              <AlertDialogHeader className="block text-left">
                <AlertDialogTitle>Откатить изменение №{rollbackTarget.id}?</AlertDialogTitle>
                <AlertDialogDescription>Будут отменены {rollbackTarget.changes.length} {rollbackTarget.changes.length === 1 ? "перестановка" : rollbackTarget.changes.length < 5 ? "перестановки" : "перестановок"}. График вернётся к состоянию до применения этого изменения.</AlertDialogDescription>
              </AlertDialogHeader>
              {rollbackLaterChanges.length > 0 && <div className="rollback-dialog-warning"><TriangleAlert /><span>Также будут отменены последующие изменения: {rollbackLaterChanges.map((change) => `№${change.id}`).join(", ")}.</span></div>}
              <AlertDialogFooter className="reset-dialog-actions">
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => rollbackChange(rollbackTarget.id)}><RotateCcw />Откатить изменение</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>

        <Sheet open={workflow !== null && options.length === 0} onOpenChange={(open) => { if (!open && options.length === 0) closeWorkflow(); }}>
          <SheetContent className="workflow-sheet sm:max-w-[480px]">
            <SheetHeader className="sheet-header-custom">
              <SheetTitle className="text-xl">{calculating ? "Расчёт вариантов" : options.length ? "Варианты графика" : workflow === "remove" ? "Убрать сотрудника со смены" : "Заменить сотрудника"}</SheetTitle>
              <SheetDescription>{selectedShift ? `${employeeNameById[selectedShift.person]} · ${shiftLabel(selectedShift, period)}` : `${selectedEmployee ? employeeNameById[selectedEmployee] : "Сотрудник"} · укажите период`}</SheetDescription>
            </SheetHeader>

            <div className="sheet-body">
              {calculating ? (
                <div className="calculation-loading" role="status" aria-live="polite">
                  <span className="calculation-spinner"><Loader2 className="animate-spin" aria-hidden="true" /></span>
                  <h3>Подбираем лучшие варианты…</h3>
                  <p>Проверяем покрытие смен, интервалы отдыха, рабочие блоки и обязательные выходные.</p>
                </div>
              ) : options.length ? (
                <div className="options-list">
                  {options.map((option, index) => {
                    const selected = option.key === selectedOptionKey;
                    const expanded = option.key === expandedOptionKey;
                    const affectedEmployeeIds = new Set(option.metrics.changes.flatMap((change) => [change.fromEmployeeId, change.toEmployeeId]));
                    const affectedPeople = PEOPLE.filter((person) => affectedEmployeeIds.has(person));
                    return (
                      <article key={option.key} className={cn("option-card", selected && "option-card-selected")}>
                        <button type="button" className="option-main" onClick={() => chooseOption(option)}>
                          <span className="option-title">Вариант {index + 1}{index === 0 && <em><WandSparkles />Лучший</em>}</span>
                          <span className="option-compact"><span>Изменено: <strong>{option.metrics.changedCount} смен</strong></span><span>Затронуто: <strong>{option.metrics.affectedEmployeeCount} сотрудника</strong></span></span>
                        </button>
                        <button type="button" className="details-toggle" onClick={() => setExpandedOptionKey(expanded ? "" : option.key)}>{expanded ? "Скрыть подробности" : "Подробнее"}<ChevronRight className={cn(expanded && "rotate-90")} /></button>
                        {expanded && (
                          <div className="option-details">
                            <h4>Перестановки</h4>
                            {option.metrics.changes.map((change) => <div className="change-line" key={change.shiftId}><span>{changeDateLabel(change.shiftId)}</span><strong>{employeeNameById[change.fromEmployeeId]} → {employeeNameById[change.toEmployeeId]}</strong></div>)}
                            <h4>Влияние на сотрудников</h4>
                            <div className="employee-impact-list">
                              {affectedPeople.map((person) => {
                                const employeeId = person;
                                const before = personStats(person, schedule, period);
                                const after = personStats(person, option.schedule, period);
                                const workDelta = after.hours - before.hours;
                                const restDelta = after.restHours - before.restHours;
                                const fullOffDelta = after.fullOffHours - before.fullOffHours;
                                const blocks = option.metrics.hours[employeeId]?.blocks ?? [];
                                const maxBlock = blocks.reduce((maximum, block) => Math.max(maximum, block.length), 0);
                                const beforeCoefficients = coefficientHoursForEmployee(baseContextualSchedule, employeeId, period);
                                const afterCoefficients = coefficientHoursForEmployee(option.schedule, employeeId, period);
                                return (
                                  <div className="employee-impact-card" key={employeeId}>
                                    <div className="employee-impact-head">
                                      <strong>{employeeNameById[person]}</strong>
                                      <span className={workDelta > 0 ? "work-increase" : workDelta < 0 ? "work-decrease" : "no-change"}>{signedHours(workDelta)} рабочих</span>
                                    </div>
                                    <div className="employee-impact-grid">
                                      <div><span>Рабочие часы</span><strong>{before.hours} → {after.hours}</strong><small>за выбранный месяц</small></div>
                                      <div><span>Часы полных выходных</span><strong>{before.fullOffHours} → {after.fullOffHours}</strong><small className={fullOffDelta > 0 ? "rest-increase" : fullOffDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(fullOffDelta)} · {before.fullOffDays} → {after.fullOffDays} дней</small></div>
                                      <div><span>Все свободные часы</span><strong>{before.restHours} → {after.restHours}</strong><small className={restDelta > 0 ? "rest-increase" : restDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(restDelta)}</small></div>
                                      <div><span>День / ночь</span><strong>{before.dayCount}/{before.nightCount} → {after.dayCount}/{after.nightCount}</strong><small>количество смен</small></div>
                                      <div><span>Всего смен</span><strong>{before.total} → {after.total}</strong><small>с началом в месяце</small></div>
                                      <div><span>Пары выходных</span><strong>{before.offPairs} → {after.offPairs}</strong><small>минимум 2</small></div>
                                      <div><span>Макс. рабочий блок</span><strong>{maxBlock} смен</strong><small>допустимо до 5</small></div>
                                      <div><span>Отклонение от плана</span><strong className={after.delta > 0 ? "positive-delta" : after.delta < 0 ? "negative-delta" : "no-change"}>{signedHours(after.delta)}</strong><small>после перестановки</small></div>
                                    </div>
                                    <CoefficientImpact before={beforeCoefficients} after={afterCoefficients} year={period.year} />
                                  </div>
                                );
                              })}
                            </div>
                            <div className="checks-box"><CheckCircle2 /><span>Покрытие 24/7, отдых 12 часов, блоки до 5 смен, две пары выходных и 42 часа отдыха в неделю соблюдены.</span></div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : calculationError ? (
                <div className="calculation-error"><UserX /><h3>Вариант не найден</h3><p>{calculationError}</p><Button variant="outline" onClick={() => setCalculationError("")}>Изменить условия</Button></div>
              ) : workflow === "remove" ? (
                <>
                  {selectedShift && <div className="form-section"><h3>Период отсутствия</h3><RadioGroup value={scope} onValueChange={setScope} className="scope-list">
                    {[["shift", "Только выбранная смена", shiftLabel(selectedShift, period)], ["block", "До конца рабочего блока", "Выбранная и следующие смены блока"], ["week", "7 календарных дней", "Начиная с выбранной даты"], ["custom", "Другой период", "Указать начало и окончание"]].map(([value, title, description]) => <label key={value} className={cn("scope-option", scope === value && "scope-option-active")}><RadioGroupItem value={value} /><span><strong>{title}</strong><small>{description}</small></span></label>)}
                  </RadioGroup></div>}
                  {(!selectedShift || scope === "custom") && <div className={cn("custom-period", !selectedShift && "custom-period-standalone")}><label>Начало<input type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>Окончание<input type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
                  <div className="form-section"><h3>Причина</h3><Select value={reason} onValueChange={setReason}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="absence">Неявка</SelectItem><SelectItem value="sickday">Sick day</SelectItem><SelectItem value="medical">Больничный</SelectItem><SelectItem value="vacation">Отпуск</SelectItem><SelectItem value="other">Другое</SelectItem></SelectContent></Select></div>
                </>
              ) : (
                <div className="form-section"><h3>Кто выйдет на смену</h3><Select value={replacement} onValueChange={setReplacement}><SelectTrigger className="w-full"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger><SelectContent>{visiblePeople.filter((person) => person !== selectedShift?.person).map((person) => <SelectItem value={person} key={person}>{employeeNameById[person]}</SelectItem>)}</SelectContent></Select></div>
              )}
            </div>

            <SheetFooter className="sheet-footer-custom">
              {calculating ? <><Button variant="outline" onClick={closeWorkflow}>Остановить расчёт</Button><Button className="calculate-button" disabled><Loader2 className="animate-spin" aria-hidden="true" />Идёт расчёт…</Button></> : options.length ? <><Button variant="outline" onClick={() => { setOptions([]); setPreviewSchedule(null); }}>Назад</Button><Button className="calculate-button" onClick={applySelectedOption}>Применить вариант</Button></> : <><Button variant="outline" onClick={closeWorkflow}>Отмена</Button>{!calculationError && <Button className="calculate-button" onClick={calculateOptions} disabled={workflow === "replace" && !replacement}>{workflow === "remove" ? "Рассчитать варианты" : "Проверить замену"}</Button>}</>}
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {workflow !== null && options.length > 0 && (
          <>
            <div className="schedule-preview-shade" aria-hidden="true" />
            <aside className="schedule-preview-panel" role="dialog" aria-modal="false" aria-labelledby="schedule-preview-title">
              <button type="button" className="schedule-preview-close" onClick={closeWorkflow} aria-label="Закрыть предпросмотр"><X /></button>
              <div className="sheet-header-custom schedule-preview-header">
                <h2 id="schedule-preview-title">Варианты графика</h2>
                <p>{selectedShift ? `${employeeNameById[selectedShift.person]} · ${shiftLabel(selectedShift, period)}` : `${selectedEmployee ? employeeNameById[selectedEmployee] : "Сотрудник"} · указанный период`}</p>
              </div>
              <div className="sheet-body schedule-preview-body">
                <ScheduleOptionsList employees={employees}
                  options={options}
                  selectedOptionKey={selectedOptionKey}
                  expandedOptionKey={expandedOptionKey}
                  focusedPreviewShiftId={focusedPreviewShiftId}
                  schedule={baseContextualSchedule}
                  period={period}
                  onChoose={chooseOption}
                  onToggleDetails={setExpandedOptionKey}
                  onFocusShift={scrollToPreviewShift}
                />
              </div>
              <div className="sheet-footer-custom schedule-preview-footer">
                <Button variant="outline" onClick={() => { setOptions([]); setPreviewSchedule(null); setFocusedPreviewShiftId(null); }}>Назад</Button>
                <Button className="calculate-button" onClick={applySelectedOption}>Применить вариант</Button>
              </div>
            </aside>
          </>
        )}

        {newMonthConfirmOpen && (
          <div className="reset-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setNewMonthConfirmOpen(false)}>
            <section className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="new-month-dialog-title" aria-describedby="new-month-dialog-description">
              <span className="reset-dialog-icon new-month-dialog-icon"><CalendarDays /></span>
              <h2 id="new-month-dialog-title">{requestedMonthExists ? "График этого месяца уже существует" : newMonthStep === "employees" ? "Выберите сотрудников" : "Создать график с чистого листа?"}</h2>
              <p id="new-month-dialog-description">{requestedMonthExists ? "Можно открыть сохранённый график и продолжить работу с ним." : newMonthStep === "employees" ? "Выберите от 1 до 8 участников. Добавление тестового сотрудника пометит график как тестовый." : "Выберите месяц и способ заполнения. График будет автоматически сохраняться как черновик."}</p>
              {newMonthStep === "mode" && <><div className="new-month-picker">
                <label>Месяц<select value={newMonthNumber} onChange={(event) => setNewMonthNumber(event.target.value)}>{MONTHS_RU.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
                <label>Год<select value={newMonthYear} onChange={(event) => setNewMonthYear(event.target.value)}>{Array.from({ length: 7 }, (_, index) => 2024 + index).map((year) => <option value={year} key={year}>{year}</option>)}</select></label>
              </div>
              {!requestedMonthExists && <div className="new-month-modes"><button type="button" className={cn("generation-mode-card", newDraftMode === "seed" && "generation-mode-card-selected")} onClick={() => setNewDraftMode("seed")}><span className="generation-mode-icon"><WandSparkles /></span><span><strong>По первым восьми дням</strong><small>Назначить первые восемь дней, затем рассчитать продолжение.</small></span><i /></button><button type="button" className={cn("generation-mode-card", newDraftMode === "manual" && "generation-mode-card-selected")} onClick={() => setNewDraftMode("manual")}><span className="generation-mode-icon"><CalendarDays /></span><span><strong>Ручной режим</strong><small>Назначать смены в любой части месяца, затем заполнить свободные.</small></span><i /></button></div>}</>}
              {newMonthStep === "employees" && !requestedMonthExists && <div className="new-month-employees">{employees.filter((employee) => !employee.archivedAt && (employee.active || employee.endDateTime && new Date(`${employee.endDateTime}Z`) > periodForMonth(Number(newMonthYear), Number(newMonthNumber)).start)).map((employee) => <label key={employee.id}><input type="checkbox" checked={newEmployeeIds.includes(employee.id)} disabled={!newEmployeeIds.includes(employee.id) && newEmployeeIds.length >= MAX_MONTH_EMPLOYEES} onChange={() => setNewEmployeeIds((ids) => ids.includes(employee.id) ? ids.filter((id) => id !== employee.id) : [...ids, employee.id])} /><span>{employee.name}{employee.isTest ? " · Тестовый" : ""}</span></label>)}</div>}
              {newMonthStep === "employees" && selectedCarryInMissing && <p className="new-month-warning">Выберите сотрудника предыдущей ночной смены: она продолжается в этом месяце.</p>}
              <div className="new-month-details"><span>Период<strong>{formatMonthLabel(Number(newMonthYear), Number(newMonthNumber))}</strong></span><span>Смен<strong>{daysInMonth(Number(newMonthYear), Number(newMonthNumber)) * 2}</strong></span><span>Статус<strong>{requestedMonthExists ? "Уже создан" : "Черновик"}</strong></span></div>
              <div className="reset-dialog-actions">
                <Button variant="outline" autoFocus onClick={() => newMonthStep === "employees" && !requestedMonthExists ? setNewMonthStep("mode") : setNewMonthConfirmOpen(false)}>{newMonthStep === "employees" && !requestedMonthExists ? "Назад" : "Отмена"}</Button>
                <Button disabled={newMonthStep === "employees" && (newEmployeeIds.length === 0 || newEmployeeIds.length > MAX_MONTH_EMPLOYEES || selectedCarryInMissing)} onClick={() => requestedMonthExists || newMonthStep === "employees" ? startBlankDraft() : setNewMonthStep("employees")}>{requestedMonthExists ? <CalendarDays /> : <Plus />}{requestedMonthExists ? "Открыть график" : newMonthStep === "employees" ? "Создать черновик" : "Далее"}</Button>
              </div>
            </section>
          </div>
        )}

        {cancelDraftConfirmOpen && (
          <div className="reset-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCancelDraftConfirmOpen(false)}>
            <section className="reset-dialog cancel-draft-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-draft-dialog-title" aria-describedby="cancel-draft-dialog-description">
              <span className="reset-dialog-icon"><TriangleAlert /></span>
              <h2 id="cancel-draft-dialog-title">Отменить создание графика?</h2>
              <p id="cancel-draft-dialog-description">{baselineSchedule.length ? `Все назначения в черновике за ${monthGenitive} будут удалены. График вернётся к ранее закреплённому плану.` : `Черновик за ${monthGenitive} и все назначения в нём будут удалены. Сайт вернётся к предыдущему сохранённому месяцу.`}</p>
              <div className="reset-dialog-actions cancel-draft-dialog-actions">
                <Button variant="outline" autoFocus onClick={() => setCancelDraftConfirmOpen(false)}>Продолжить редактирование</Button>
                <Button variant="destructive" onClick={cancelDraft}>Удалить черновик</Button>
              </div>
            </section>
          </div>
        )}

        {resetConfirmOpen && (
          <div className="reset-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setResetConfirmOpen(false)}>
            <section className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-dialog-title" aria-describedby="reset-dialog-description">
              <span className="reset-dialog-icon"><TriangleAlert /></span>
              <h2 id="reset-dialog-title">Вернуть исходный график?</h2>
              <p id="reset-dialog-description">Все применённые перестановки за {monthGenitive} будут отменены. График вернётся к первоначальному состоянию.</p>
              <div className="reset-dialog-actions">
                <Button variant="outline" autoFocus onClick={() => setResetConfirmOpen(false)}>Отмена</Button>
                <Button variant="destructive" onClick={resetToOriginalSchedule}><RotateCcw />Вернуть исходный</Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
