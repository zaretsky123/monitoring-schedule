"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  LockKeyhole,
  Loader2,
  Menu,
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
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  employeeIdByName,
  employeeNameById,
  EMPLOYEES,
} from "@/lib/schedule/sample";
import { lifecycleLabel, lifecycleStatus } from "@/lib/schedule/month";
import { countMonthlyFullOffDays, countMonthlyOffPairs, findWorkBlock, validateSchedule } from "@/lib/schedule/validator";
import type { Absence, Employee, GeneratedScheduleOption, GenerationMode, Period, ScheduleOption, Shift, ShiftChange, StoredScheduleStatus } from "@/lib/schedule/types";

const PEOPLE = ["ФИО 1", "ФИО 2", "ФИО 3", "ФИО 4"] as const;
type Person = (typeof PEOPLE)[number];
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
const LEGACY_STORAGE_KEY = "monitoring-schedule:october-2026:v1";
const MONTHS_STORAGE_KEY = "monitoring-schedule:months:v1";
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

type PersistedSchedule = {
  version: 1 | 2 | 3 | 4 | 5;
  historyCount: number;
  status?: StoredScheduleStatus;
  schedule: Array<Omit<Shift, "start" | "end"> & { start: string; end: string }>;
  baselineSchedule?: Array<Omit<Shift, "start" | "end"> & { start: string; end: string }>;
  changeEvents?: PersistedChangeEvent[];
};

type PersistedMonthStore = {
  version: 1;
  selectedMonthKey: string;
  months: Record<string, PersistedSchedule>;
};

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
};

type WorkerRequest = RearrangeWorkerRequest | GenerationWorkerRequest;

type RearrangeWorkerResult =
  | { found: true; minimumChangeCount: number; recommendedKey: string; options: ScheduleOption[] }
  | { found: false; options: []; reason: string };

type GenerationWorkerResult =
  | { found: true; recommendedKey: string; options: GeneratedScheduleOption[] }
  | { found: false; options: []; reason: string };

type ShiftSelection = {
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
  const employeeId = employeeIdByName[person];
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
  if (![1, 2, 3, 4, 5].includes(persisted.version ?? 0)) return null;
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
            ? [{ employeeId: absence.employeeId, start: absenceStart, end: absenceEnd }]
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
    schedule: restored,
    baselineSchedule: restoredBaseline,
    changeEvents: restoredEvents,
    historyCount: Math.max(persistedCount, ...restoredEvents.map((change) => change.id), 0),
    status: persisted.status === "draft" ? "draft" as const : "published" as const,
  };
}

function serializeMonthRecord({
  schedule,
  baselineSchedule,
  changeEvents,
  historyCount,
  status,
}: {
  schedule: Shift[];
  baselineSchedule: Shift[];
  changeEvents: AppliedChange[];
  historyCount: number;
  status: StoredScheduleStatus;
}): PersistedSchedule {
  return {
    version: 5,
    historyCount,
    status,
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

function carryInAssignment(months: Record<string, PersistedSchedule>, year: number, month: number) {
  const previous = addMonths(year, month, -1);
  const previousRecord = months[monthKey(previous.year, previous.month)];
  if (!previousRecord) return null;
  const boundary = periodForMonth(year, month).start.getTime();
  const shift = previousRecord.schedule.find((item) => item.type === "N" && new Date(item.start).getTime() < boundary && new Date(item.end).getTime() > boundary);
  if (!shift?.employeeId) return null;
  return { employeeId: shift.employeeId, plannedEmployeeId: shift.plannedEmployeeId || shift.employeeId };
}

function synchronizeCarryIn<T extends { schedule: Shift[]; baselineSchedule: Shift[] }>(
  record: T,
  period: Period,
  assignment: { employeeId: string; plannedEmployeeId: string } | null,
) {
  if (!assignment) return record;
  const isCarryIn = (shift: Shift) => shift.type === "N" && shift.start < period.start && shift.end > period.start;
  return {
    ...record,
    schedule: record.schedule.map((shift) => isCarryIn(shift) ? { ...shift, ...assignment } : shift),
    baselineSchedule: record.baselineSchedule.map((shift) => isCarryIn(shift)
      ? { ...shift, employeeId: assignment.plannedEmployeeId, plannedEmployeeId: assignment.plannedEmployeeId }
      : shift),
  };
}

function mergeAdjacentContext(
  currentSchedule: Shift[],
  months: Record<string, PersistedSchedule>,
  selectedKey: string,
  period: Period,
) {
  const merged = new Map(currentSchedule.map((shift) => [shift.id, shift]));
  const current = parseMonthKey(selectedKey);
  if (!current) return [...merged.values()];
  const contextStart = addDays(period.start, -7);
  const contextEnd = addDays(period.end, 7);
  for (const amount of [-1, 1]) {
    const adjacent = addMonths(current.year, current.month, amount);
    const record = months[monthKey(adjacent.year, adjacent.month)];
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

function NavButton({ label, icon: Icon, active, expanded }: {
  label: string;
  icon: typeof CalendarDays;
  active?: boolean;
  expanded: boolean;
}) {
  const comingSoon = !active;
  const button = (
    <button
      type="button"
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

export default function Home() {
  const scheduleScrollRef = useRef<HTMLDivElement>(null);
  const calculationAbortRef = useRef<AbortController | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState("2026-10");
  const [monthStore, setMonthStore] = useState<PersistedMonthStore>({ version: 1, selectedMonthKey: "2026-10", months: {} });
  const [schedule, setSchedule] = useState<Shift[]>(() => createOctober2026Schedule());
  const [baselineSchedule, setBaselineSchedule] = useState<Shift[]>(() => createOctober2026Schedule());
  const [scheduleStatus, setScheduleStatus] = useState<StoredScheduleStatus>("published");
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
  const [exporting, setExporting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [newMonthConfirmOpen, setNewMonthConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [draftPublishError, setDraftPublishError] = useState("");
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
  const dayCount = daysInMonth(period.year, period.month);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, index) => index + 1), [dayCount]);
  const monthLabel = formatMonthLabel(period.year, period.month);
  const monthGenitive = formatMonthGenitive(period.year, period.month);
  const currentLifecycle = lifecycleStatus(scheduleStatus, period);
  const displaySchedule = previewSchedule ?? generationPreview ?? schedule;
  const contextualSchedule = useMemo(
    () => mergeAdjacentContext(displaySchedule, monthStore.months, selectedMonthKey, period),
    [displaySchedule, monthStore.months, period, selectedMonthKey],
  );
  const hasAppliedChanges = useMemo(
    () => schedule.some((shift) => shift.employeeId !== shift.plannedEmployeeId),
    [schedule],
  );
  const activeAbsences = useMemo(
    () => mergeAbsences(...changeEvents.map((change) => change.absences)),
    [changeEvents],
  );
  const currentValidation = useMemo(
    () => validateSchedule({ schedule: contextualSchedule, employees: EMPLOYEES, period, absences: activeAbsences }),
    [activeAbsences, contextualSchedule, period],
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
      let stored = storedRaw ? JSON.parse(storedRaw) as Partial<PersistedMonthStore> : null;
      if (stored?.version !== 1 || !stored.months || typeof stored.months !== "object") stored = null;

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
      const restored = restoredRecord ? synchronizeCarryIn(restoredRecord, nextPeriod, carryInAssignment(stored.months!, nextMonth.year, nextMonth.month)) : null;
      if (restored) {
        setSelectedMonthKey(nextSelectedKey);
        setSchedule(restored.schedule);
        setBaselineSchedule(restored.baselineSchedule);
        setScheduleStatus(restored.status);
        setChangeEvents(restored.changeEvents);
        setHistoryCount(restored.historyCount);
      }
      setMonthStore({ version: 1, selectedMonthKey: nextSelectedKey, months: stored.months! });
    } catch {
      // Повреждённые локальные данные не должны мешать открыть исходный график.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const persisted = serializeMonthRecord({ schedule, baselineSchedule, changeEvents, historyCount, status: scheduleStatus });
    setMonthStore((current) => {
      const next = { ...current, selectedMonthKey, months: { ...current.months, [selectedMonthKey]: persisted } };
      try {
        window.localStorage.setItem(MONTHS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // График продолжит работать в текущей вкладке, даже если хранилище браузера недоступно.
      }
      return next;
    });
  }, [baselineSchedule, changeEvents, historyCount, schedule, scheduleStatus, selectedMonthKey, storageReady]);

  useEffect(() => {
    if (!resetConfirmOpen && !newMonthConfirmOpen && !cancelDraftConfirmOpen && rollbackConfirmId === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setResetConfirmOpen(false);
        setNewMonthConfirmOpen(false);
        setCancelDraftConfirmOpen(false);
        if (rollbackConfirmId !== null) {
          setSelectedChangeId(rollbackConfirmId);
          setRollbackConfirmId(null);
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cancelDraftConfirmOpen, newMonthConfirmOpen, resetConfirmOpen, rollbackConfirmId]);

  function openWorkflow(shift: ShiftSelection, nextWorkflow: Exclude<Workflow, null>) {
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
    const target = schedule.find((item) => item.id === shiftIdFor(period, shift.startDay, shift.kind));
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

  function openEmployeeAbsence(person: Person) {
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
          employeeName: { type: "string", enum: PEOPLE },
          day: { type: "integer", minimum: 1, maximum: dayCount },
          shiftType: { type: "string", enum: ["day", "night"] },
        },
        required: ["employeeName", "day", "shiftType"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const value = input as { employeeName?: string; day?: number; shiftType?: string };
        const person = PEOPLE.find((item) => item === value.employeeName);
        if (!person || !Number.isInteger(value.day) || !value.day || value.day < 1 || value.day > dayCount || (value.shiftType !== "day" && value.shiftType !== "night")) throw new Error("Некорректные параметры смены");
        const engineShift = schedule.find((shift) => shift.id === shiftIdFor(period, value.day!, value.shiftType as ShiftKind));
        if (!engineShift || employeeNameById[engineShift.employeeId] !== person) throw new Error("Сотрудник не назначен на эту смену");
        openWorkflow({ person, kind: value.shiftType as ShiftKind, startDay: value.day }, "remove");
        return { status: "opened", employeeName: person, day: value.day, shiftType: value.shiftType };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [dayCount, period, schedule]);

  function renderShiftSegment(person: Person, kind: ShiftKind, startDay: number, segment: "left" | "center" | "right") {
    const shift = { person, kind, startDay } satisfies ShiftSelection;
    const longLabel = shiftLabel(shift, period);
    const scheduleShift = displaySchedule.find((item) => item.id === shiftIdFor(period, startDay, kind));
    const changed = Boolean(scheduleShift && scheduleShift.employeeId !== scheduleShift.plannedEmployeeId);
    const highlightedByChange = Boolean(scheduleShift && selectedChangeId !== null && changeEvents.find((change) => change.id === selectedChangeId)?.changes.some((change) => change.shiftId === scheduleShift.id));
    const focusedPreviewChange = Boolean(scheduleShift && focusedPreviewShiftId === scheduleShift.id);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn("shift-segment", kind === "day" ? "shift-day" : "shift-night", segment === "left" && "segment-left", segment === "right" && "segment-right", changed && "shift-changed", highlightedByChange && "shift-history-highlighted", focusedPreviewChange && "shift-preview-focused")} aria-label={`${person}. ${kind === "day" ? "Дневная" : "Ночная"} смена: ${longLabel}`} title={longLabel}>
            <span>{kind === "day" ? "Д" : "Н"}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 rounded-xl p-2 shadow-xl">
          <DropdownMenuLabel className="px-2 pb-2 pt-1">
            <span className="block text-[13px] text-slate-500">{kind === "day" ? "Дневная смена" : "Ночная смена"}</span>
            <span className="mt-0.5 block text-sm font-semibold text-slate-900">{person}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {scheduleStatus === "draft" ? (
            <DropdownMenuItem className="rounded-lg py-2.5" variant="destructive" onSelect={() => scheduleShift && removeDraftAssignment(scheduleShift.id)}><UserX />Снять назначение</DropdownMenuItem>
          ) : <>
            <DropdownMenuItem className="rounded-lg py-2.5" variant="destructive" onSelect={() => openWorkflow(shift, "remove")}><UserX />Убрать</DropdownMenuItem>
            <DropdownMenuItem className="rounded-lg py-2.5" onSelect={() => openWorkflow(shift, "replace")}><UserRoundCog />Заменить</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderDraftSlot(person: Person, kind: ShiftKind, startDay: number, segment: "left" | "center" | "right") {
    if (scheduleStatus !== "draft") return null;
    if (startDay > GENERATION_SEED_DAYS && !draftGenerationStarted) return null;
    const target = schedule.find((shift) => shift.id === shiftIdFor(period, startDay, kind));
    if (!target || target.employeeId) return null;
    const employeeId = employeeIdByName[person];
    return (
      <button
        type="button"
        className={cn("draft-shift-slot", kind === "day" ? "draft-day-slot" : "draft-night-slot", `draft-${segment}-slot`)}
        onClick={() => assignDraftShift(target.id, employeeId)}
        aria-label={`Назначить ${person} на ${kind === "day" ? "дневную" : "ночную"} смену`}
        title={`Назначить ${person}`}
      ><Plus /></button>
    );
  }

  async function calculateOptions() {
    if (calculating) return;
    const employeeId = selectedShift ? employeeIdByName[selectedShift.person] : selectedEmployee ? employeeIdByName[selectedEmployee] : "";
    let target = selectedShift ? schedule.find((shift) => shift.id === shiftIdFor(period, selectedShift.startDay, selectedShift.kind)) : undefined;
    let absence: Absence | null = target ? { employeeId: target.employeeId, start: target.start, end: target.end } : null;

    if (!selectedShift && workflow === "remove") {
      const start = new Date(`${customStart}:00Z`);
      const end = new Date(`${customEnd}:00Z`);
      if (!(start < end)) {
        setCalculationError("Окончание периода должно быть позже начала.");
        return;
      }
      absence = { employeeId, start, end };
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

    const requiredAssignments = workflow === "replace" && replacement
      ? { [target.id]: employeeIdByName[replacement] }
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
        schedule: mergeAdjacentContext(schedule, monthStore.months, selectedMonthKey, period),
        employees: EMPLOYEES,
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
      setPreviewSchedule(result.options[0].schedule);
      const firstChangeId = result.options[0].metrics.changes[0]?.shiftId;
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
    const option = options.find((item) => item.key === selectedOptionKey);
    if (!option || !pendingChange) return;
    const nextId = historyCount + 1;
    const appliedChange: AppliedChange = {
      ...pendingChange,
      id: nextId,
      appliedAt: new Date(),
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
    setSelectedChangeId(null);
    setRollbackConfirmId(null);
  }

  function openRollbackDialog(changeId: number) {
    setSelectedChangeId(null);
    setRollbackConfirmId(changeId);
  }

  function closeRollbackDialog() {
    if (rollbackConfirmId !== null) setSelectedChangeId(rollbackConfirmId);
    setRollbackConfirmId(null);
  }

  function resetTransientView() {
    setPreviewSchedule(null);
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setFocusedPreviewShiftId(null);
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
    return serializeMonthRecord({ schedule, baselineSchedule, changeEvents, historyCount, status: scheduleStatus });
  }

  function openStoredMonth(targetKey: string, source = monthStore) {
    const targetMonth = parseMonthKey(targetKey);
    const targetRecord = source.months[targetKey];
    if (!targetMonth || !targetRecord) return;
    const nextStore = {
      ...source,
      selectedMonthKey: targetKey,
      months: { ...source.months, [selectedMonthKey]: currentPersistedRecord() },
    };
    const targetPeriod = periodForMonth(targetMonth.year, targetMonth.month);
    const restoredRecord = restoreMonthRecord(targetRecord, targetPeriod);
    const restored = restoredRecord ? synchronizeCarryIn(restoredRecord, targetPeriod, carryInAssignment(nextStore.months, targetMonth.year, targetMonth.month)) : null;
    if (!restored) return;
    saveMonthStore(nextStore);
    setSelectedMonthKey(targetKey);
    setSchedule(restored.schedule);
    setBaselineSchedule(restored.baselineSchedule);
    setScheduleStatus(restored.status);
    setChangeEvents(restored.changeEvents);
    setHistoryCount(restored.historyCount);
    resetTransientView();
  }

  function openNewMonthDialog() {
    const next = addMonths(period.year, period.month, 1);
    setNewMonthYear(String(next.year));
    setNewMonthNumber(String(next.month));
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
    const carryIn = carryInAssignment(source.months, targetYear, targetMonthNumber);
    const blank = createBlankMonthSchedule(targetPeriod, carryIn?.employeeId ?? "").map((shift) => (
      shift.start < targetPeriod.start && carryIn
        ? { ...shift, plannedEmployeeId: carryIn.plannedEmployeeId }
        : shift
    ));
    const draftRecord = serializeMonthRecord({ schedule: blank, baselineSchedule: [], changeEvents: [], historyCount: 0, status: "draft" });
    const nextStore: PersistedMonthStore = {
      version: 1,
      selectedMonthKey: targetKey,
      months: { ...source.months, [targetKey]: draftRecord },
    };
    saveMonthStore(nextStore);
    setSelectedMonthKey(targetKey);
    setSchedule(blank);
    setBaselineSchedule([]);
    setScheduleStatus("draft");
    setHistoryCount(0);
    setChangeEvents([]);
    resetTransientView();
    setNewMonthConfirmOpen(false);
  }

  function assignDraftShift(shiftId: string, employeeId: string) {
    if (scheduleStatus !== "draft") return;
    setSchedule((current) => current.map((shift) => shift.id === shiftId
      ? { ...shift, employeeId, plannedEmployeeId: employeeId }
      : shift));
    setDraftPublishError("");
  }

  function removeDraftAssignment(shiftId: string) {
    if (scheduleStatus !== "draft") return;
    setSchedule((current) => current.map((shift) => shift.id === shiftId
      ? { ...shift, employeeId: "", plannedEmployeeId: "" }
      : shift));
    setDraftPublishError("");
  }

  function openGenerator() {
    setGenerationMode("pattern");
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
        schedule: mergeAdjacentContext(schedule, monthStore.months, selectedMonthKey, period),
        employees: EMPLOYEES,
        period,
        seedDays: GENERATION_SEED_DAYS,
        mode: generationMode,
        maxOptions: 3,
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
    const unassigned = schedule.filter((shift) => !shift.employeeId);
    if (unassigned.length) {
      setDraftPublishError(`Осталось назначить ${unassigned.length} ${unassigned.length === 1 ? "смену" : "смен"}.`);
      return;
    }
    const validation = validateSchedule({ schedule: mergeAdjacentContext(schedule, monthStore.months, selectedMonthKey, period), employees: EMPLOYEES, period });
    if (!validation.valid) {
      setDraftPublishError(`Нельзя закрепить график: найдено ${validation.issues.length} нарушений обязательных правил.`);
      return;
    }
    const published = schedule.map((shift) => ({ ...shift, plannedEmployeeId: shift.employeeId }));
    setSchedule(published);
    setBaselineSchedule(published.map((shift) => ({ ...shift })));
    setScheduleStatus("published");
    setDraftPublishError("");
  }

  function cancelDraft() {
    if (baselineSchedule.length) {
      setSchedule(baselineSchedule.map((shift) => ({ ...shift })));
      setScheduleStatus("published");
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
        const nextStore = { version: 1 as const, selectedMonthKey: fallbackKey, months };
        saveMonthStore(nextStore);
        setSelectedMonthKey(fallbackKey);
        setSchedule(restored.schedule);
        setBaselineSchedule(restored.baselineSchedule);
        setScheduleStatus(restored.status);
        setChangeEvents(restored.changeEvents);
        setHistoryCount(restored.historyCount);
        resetTransientView();
      }
    }
    setCancelDraftConfirmOpen(false);
  }

  function resetToOriginalSchedule() {
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

      sheet.getCell("R3").value = `График мониторинга — ${monthLabel}`;
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

      for (let row = 8; row <= 11; row += 1) {
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
      const rowByEmployee = new Map(PEOPLE.map((person, index) => [employeeIdByName[person], 8 + index]));
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
        writeShiftMarker(scheduleById.get(shiftIdFor(period, day - 1, "night")), firstColumn, nightShiftStyle);
        writeShiftMarker(scheduleById.get(shiftIdFor(period, day, "day")), firstColumn + 1, dayShiftStyle);
        writeShiftMarker(scheduleById.get(shiftIdFor(period, day, "night")), firstColumn + 2, nightShiftStyle);
      }

      sheet.getCell("C13").value = "Д3";
      sheet.getCell("D13").value = "Н2";
      sheet.getCell("E13").value = "пар выходных";
      sheet.getCell("I13").value = "рабочих ч.";
      for (const [index, person] of PEOPLE.entries()) {
        const employeeId = employeeIdByName[person];
        const row = 14 + index;
        const stats = personStats(person, displaySchedule, period);
        let nightHalves = 0;
        let workedHours = 0;
        for (const shift of displaySchedule) {
          if (shift.employeeId !== employeeId) continue;
          if (shift.type === "N") {
            for (const day of days) {
              if (scheduleById.get(shiftIdFor(period, day - 1, "night"))?.id === shift.id) nightHalves += 1;
              if (scheduleById.get(shiftIdFor(period, day, "night"))?.id === shift.id) nightHalves += 1;
            }
          }
          const overlapStart = Math.max(shift.start.getTime(), period.start.getTime());
          const overlapEnd = Math.min(shift.end.getTime(), period.end.getTime());
          if (overlapEnd > overlapStart) workedHours += (overlapEnd - overlapStart) / (60 * 60 * 1000);
        }
        sheet.getCell(row, 1).value = person;
        sheet.getCell(row, 3).value = stats.dayCount;
        sheet.getCell(row, 4).value = nightHalves / 2;
        sheet.getCell(row, 6).value = stats.offPairs;
        sheet.getCell(row, 9).value = workedHours;
      }

      sheet.getCell("C23").value = [
        "Каждая смена длится ровно 12 часов; все дневные и ночные смены должны быть закрыты.",
        "Между сменами одного сотрудника должно быть не менее 12 часов отдыха.",
        "В одном рабочем блоке допускается не более четырех смен.",
        "После блока из трех или четырех смен обязательны два полных календарных выходных.",
        "В каждом месяце у сотрудника должно быть минимум две пары полных календарных выходных.",
        "В каждой календарной неделе должно быть не менее 42 часов отдыха суммарно.",
      ].join("\n");
      sheet.getCell("C23").alignment = { ...sheet.getCell("C23").alignment, wrapText: true, vertical: "top" };
      sheet.getRow(23).height = 90;
      workbook.creator = "Мониторинг";
      workbook.modified = new Date();
      workbook.calcProperties.fullCalcOnLoad = true;

      const output = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([new Uint8Array(output)], { type: EXCEL_MIME }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `График_мониторинга_${selectedMonthKey}.xlsx`;
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

  const gridStyle = { gridTemplateColumns: `${NAME_WIDTH}px repeat(${dayCount}, ${DAY_WIDTH}px)` };
  const monthShifts = schedule.filter((shift) => shift.start >= period.start && shift.start < period.end);
  const assignedMonthShifts = monthShifts.filter((shift) => Boolean(shift.employeeId)).length;
  const boundaryShiftAssigned = schedule.some((shift) => shift.start < period.start && shift.end > period.start && Boolean(shift.employeeId));
  const generationStart = addDays(period.start, GENERATION_SEED_DAYS);
  const generationSeedShifts = monthShifts.filter((shift) => shift.start < generationStart);
  const assignedGenerationSeedShifts = generationSeedShifts.filter((shift) => Boolean(shift.employeeId)).length;
  const futureDraftShifts = monthShifts.filter((shift) => shift.start >= generationStart);
  const assignedFutureDraftShifts = futureDraftShifts.filter((shift) => Boolean(shift.employeeId)).length;
  const generationSeedReady = assignedGenerationSeedShifts === generationSeedShifts.length && boundaryShiftAssigned;
  const draftGenerationStarted = assignedFutureDraftShifts > 0;
  const generationBoundaryLeft = NAME_WIDTH + 1 + GENERATION_SEED_DAYS * (DAY_WIDTH + 1);
  const selectedStats = selectedEmployee ? personStats(selectedEmployee, displaySchedule, period) : null;
  const selectedChange = selectedChangeId === null ? null : changeEvents.find((change) => change.id === selectedChangeId) ?? null;
  const rollbackTarget = rollbackConfirmId === null ? null : changeEvents.find((change) => change.id === rollbackConfirmId) ?? null;
  const rollbackLaterChanges = rollbackTarget ? changeEvents.filter((change) => change.id > rollbackTarget.id) : [];
  const storedMonthKeys = Object.keys(monthStore.months).sort();
  const selectedMonthIndex = storedMonthKeys.indexOf(selectedMonthKey);
  const previousMonthKey = selectedMonthIndex > 0 ? storedMonthKeys[selectedMonthIndex - 1] : null;
  const nextMonthKey = selectedMonthIndex >= 0 && selectedMonthIndex < storedMonthKeys.length - 1 ? storedMonthKeys[selectedMonthIndex + 1] : null;
  const requestedNewMonthKey = monthKey(Number(newMonthYear), Number(newMonthNumber));
  const requestedMonthExists = Boolean(monthStore.months[requestedNewMonthKey]);
  const changeMarkers = useMemo(() => {
    const previousPositions: number[] = [];
    return changeEvents.map((change) => {
      const left = changeMarkerLeft(change.start, period, dayCount);
      const lane = previousPositions.filter((position) => Math.abs(position - left) < 112).length % 2;
      previousPositions.push(left);
      return { change, left, lane };
    });
  }, [changeEvents, dayCount, period]);

  return (
    <TooltipProvider>
      <div className={cn("app-shell", workflow !== null && options.length > 0 && "schedule-preview-active")}>
        <aside className={cn("sidebar", sidebarExpanded ? "sidebar-open" : "sidebar-closed")}>
          <div className="sidebar-brand">
            <div className="brand-mark" aria-hidden="true"><CalendarDays className="size-5" /></div>
            {sidebarExpanded && <div className="min-w-0"><div className="brand-title">Мониторинг</div><div className="brand-caption">Управление сменами</div></div>}
          </div>
          <nav className="sidebar-nav" aria-label="Основное меню">
            {NAV_ITEMS.map((item) => <NavButton key={item.label} {...item} expanded={sidebarExpanded} />)}
          </nav>
          <div className="sidebar-bottom">
            <NavButton label="Настройки" icon={Settings2} expanded={sidebarExpanded} />
            <button type="button" className="collapse-button" onClick={() => setSidebarExpanded((value) => !value)} aria-label={sidebarExpanded ? "Свернуть меню" : "Развернуть меню"}>
              {sidebarExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}{sidebarExpanded && <span>Свернуть меню</span>}
            </button>
          </div>
        </aside>

        <main className="main-area">
          <header className="topbar">
            <div className="topbar-heading"><h1>График работы</h1></div>
            <div className="topbar-actions">
              {scheduleStatus === "draft" ? <>
                <Button variant="outline" className="cancel-draft-button" onClick={() => setCancelDraftConfirmOpen(true)}>Отменить создание</Button>
                <Button className="publish-draft-button" onClick={publishDraft}><LockKeyhole />Закрепить план</Button>
              </> : <Button variant="outline" className="new-month-button" onClick={openNewMonthDialog}><Plus />Создать месяц</Button>}
              <Button variant="outline" size="icon" onClick={() => previousMonthKey && openStoredMonth(previousMonthKey)} disabled={!previousMonthKey} aria-label="Предыдущий сохранённый месяц"><ChevronLeft /></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="month-button"><CalendarDays />{monthLabel}<small>{lifecycleLabel(currentLifecycle)}</small></button></DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="month-menu-content">
                  <DropdownMenuLabel>Сохранённые графики</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {storedMonthKeys.map((key) => {
                    const value = parseMonthKey(key)!;
                    const storedStatus = monthStore.months[key].status === "draft" ? "draft" : "published";
                    const status = lifecycleStatus(storedStatus, periodForMonth(value.year, value.month));
                    return <DropdownMenuItem key={key} disabled={key === selectedMonthKey} onSelect={() => openStoredMonth(key)}><span className="month-menu-item"><strong>{formatMonthLabel(value.year, value.month)}</strong><small>{lifecycleLabel(status)}</small></span></DropdownMenuItem>;
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={openNewMonthDialog}><Plus />Создать новый месяц</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="icon" onClick={() => nextMonthKey && openStoredMonth(nextMonthKey)} disabled={!nextMonthKey} aria-label="Следующий сохранённый месяц"><ChevronRight /></Button>
              {scheduleStatus === "published" && <Button variant="outline" className="reset-schedule-button" onClick={() => setResetConfirmOpen(true)} disabled={!hasAppliedChanges} title={hasAppliedChanges ? "Отменить все применённые перестановки" : "График уже соответствует исходному"}><RotateCcw /><span>Вернуть исходный</span></Button>}
              <Button className="export-button" onClick={exportExcel} disabled={exporting || scheduleStatus === "draft"}><Download />{exporting ? "Готовим Excel…" : "Скачать Excel"}</Button>
              <button type="button" className="profile-button coming-icon-button" aria-disabled="true" aria-label="Профиль пользователя — будет позже" title="Будет позже">А</button>
            </div>
          </header>

          <div className="content-area">
            <section className="schedule-card" aria-labelledby="schedule-title">
              <div className="schedule-toolbar">
                <div><h2 id="schedule-title">{scheduleStatus === "draft" ? "Черновик исходного графика" : "Расписание"}</h2><p>{scheduleStatus === "draft" ? "Нажмите на свободный сегмент в строке сотрудника, чтобы назначить смену" : "Дневная смена 08:00–20:00 · ночная смена 20:00–08:00"}</p></div>
                <div className="toolbar-right">
                  {focusPerson && <button className="focus-chip" onClick={() => setFocusPerson(null)}>Показан {focusPerson}<span>Сбросить</span></button>}
                  <div className="legend" aria-label="Обозначения смен"><span><Sun />День</span><span><Moon />Ночь</span></div>
                </div>
              </div>

              {scheduleStatus === "draft" && (
                <div className={cn("draft-progress", draftPublishError && "draft-progress-error")}>
                  <div><WandSparkles /><span><strong>{draftGenerationStarted ? `${assignedMonthShifts} из ${monthShifts.length} смен месяца назначено` : `Первые ${assignedGenerationSeedShifts} из ${generationSeedShifts.length} смен заполнены`}</strong><small>{!boundaryShiftAssigned ? "Назначьте ночную смену, входящую в первое число месяца" : draftGenerationStarted ? "Продолжение рассчитано — его можно корректировать вручную" : `Заполните 1–${GENERATION_SEED_DAYS} числа, затем продолжите график автоматически`}</small></span></div>
                  <div className="draft-progress-actions">
                    {draftPublishError && <p><TriangleAlert />{draftPublishError}</p>}
                    <Button type="button" size="sm" onClick={openGenerator} disabled={!generationSeedReady || generating}><WandSparkles />{draftGenerationStarted ? "Пересчитать" : "Рассчитать продолжение"}</Button>
                  </div>
                </div>
              )}

              <div ref={scheduleScrollRef} className="schedule-scroll" tabIndex={0} aria-label={`График за ${monthGenitive}`}>
                <div className={cn("schedule-grid", changeMarkers.length > 0 && "schedule-grid-with-markers")} style={gridStyle}>
                  {scheduleStatus === "draft" && <div className="generation-boundary" style={{ left: generationBoundaryLeft }} aria-label={`Граница ручного заполнения после ${GENERATION_SEED_DAYS} числа`}><span>Автозаполнение с {GENERATION_SEED_DAYS + 1} числа</span><i /></div>}
                  {changeMarkers.length > 0 && <div className="change-markers-layer" aria-label="Применённые изменения">
                    {changeMarkers.map(({ change, left, lane }) => <div className={cn("change-marker", selectedChangeId === change.id && "change-marker-active")} style={{ left }} key={change.id}>
                      <button type="button" className="change-marker-label" style={{ top: 4 + lane * 24 }} onClick={() => setSelectedChangeId(change.id)}>Изменение {change.id}</button>
                      <span className="change-marker-line" />
                    </div>)}
                  </div>}
                  <div className="sticky-name header-name"><span>Сотрудники</span><span className="header-count">4</span></div>
                  {days.map((day) => { const info = dayInfo(period, day); const locked = scheduleStatus === "draft" && day > GENERATION_SEED_DAYS && !draftGenerationStarted && !generationPreview; return <div key={`date-${day}`} className={cn("date-header", info.weekend && "weekend-header", locked && "draft-future-locked")}><strong>{day}</strong><span>{info.weekday}</span></div>; })}

                  <div className="sticky-name time-name"><Clock3 />Время</div>
                  {days.map((day) => { const info = dayInfo(period, day); const locked = scheduleStatus === "draft" && day > GENERATION_SEED_DAYS && !draftGenerationStarted && !generationPreview; return <div key={`time-${day}`} className={cn("time-cell", info.weekend && "weekend-cell", locked && "draft-future-locked")}><span>00–08</span><span>08–20</span><span>20–24</span></div>; })}

                  {PEOPLE.map((person, personIndex) => {
                    const isFocusedOut = Boolean(focusPerson && focusPerson !== person);
                    const isHighlighted = hoveredPerson === person || focusPerson === person;
                    return [
                      <button key={`${person}-name`} type="button" className={cn("sticky-name employee-name", isHighlighted && "employee-highlighted", isFocusedOut && "row-muted")} onMouseEnter={() => setHoveredPerson(person)} onMouseLeave={() => setHoveredPerson(null)} onFocus={() => setHoveredPerson(person)} onBlur={() => setHoveredPerson(null)} onClick={() => { setSelectedEmployee(person); setEmployeeOpen(true); }}>
                        <span className={`employee-avatar avatar-${personIndex + 1}`}>{personIndex + 1}</span><span>{person}</span><ChevronRight className="employee-chevron" />
                      </button>,
                      ...days.map((day) => {
                        const info = dayInfo(period, day);
                        const leftShift = displaySchedule.find((shift) => shift.id === shiftIdFor(period, day - 1, "night"));
                        const dayShift = displaySchedule.find((shift) => shift.id === shiftIdFor(period, day, "day"));
                        const nightShift = displaySchedule.find((shift) => shift.id === shiftIdFor(period, day, "night"));
                        const leftOwner = leftShift ? employeeNameById[leftShift.employeeId] : null;
                        const dayOwner = dayShift ? employeeNameById[dayShift.employeeId] : null;
                        const nightOwner = nightShift ? employeeNameById[nightShift.employeeId] : null;
                        const locked = scheduleStatus === "draft" && day > GENERATION_SEED_DAYS && !draftGenerationStarted && !generationPreview;
                        return <div key={`${person}-${day}`} className={cn("schedule-cell", info.weekend && "weekend-cell", isHighlighted && "cell-highlighted", isFocusedOut && "row-muted", locked && "draft-future-locked")} onMouseEnter={() => setHoveredPerson(person)} onMouseLeave={() => setHoveredPerson(null)}>
                          <div className="segment-slot left-slot">{leftOwner === person ? renderShiftSegment(person, "night", day - 1, "left") : renderDraftSlot(person, "night", day - 1, "left")}</div>
                          <div className="segment-slot center-slot">{dayOwner === person ? renderShiftSegment(person, "day", day, "center") : renderDraftSlot(person, "day", day, "center")}</div>
                          <div className="segment-slot right-slot">{nightOwner === person ? renderShiftSegment(person, "night", day, "right") : renderDraftSlot(person, "night", day, "right")}</div>
                        </div>;
                      }),
                    ];
                  })}

                  <div className="sticky-name add-employee-row" aria-disabled="true"><span className="add-icon"><Plus /></span><span>Добавить сотрудника</span><small>Будет позже</small></div>
                  {days.map((day) => <div key={`add-${day}`} className="add-row-cell" />)}
                </div>
              </div>

              <div className="schedule-footer"><span><Menu />{scheduleStatus === "draft" ? `Заполните первые ${GENERATION_SEED_DAYS} дней до голубой линии; рассчитанную часть можно изменить вручную` : "Для действий нажмите на нужную смену"}</span><span>Таблица прокручивается по горизонтали</span></div>
            </section>

            <section className="summary-grid" aria-label="Сводка графика">
              <article className="summary-card"><span className="summary-icon blue"><CheckCircle2 /></span><div><strong>{assignedMonthShifts} из {monthShifts.length}</strong><span>смены закрыты</span></div></article>
              <article className="summary-card"><span className="summary-icon cyan"><Clock3 /></span><div><strong>12 часов</strong><span>продолжительность смены</span></div></article>
              <article className="summary-card"><span className="summary-icon violet"><Users /></span><div><strong>4 сотрудника</strong><span>в текущем графике</span></div></article>
              <article className="summary-card"><span className="summary-icon green"><ShieldCheck /></span><div><strong>{currentValidation.valid ? "Без нарушений" : currentValidation.issues.length}</strong><span>обязательные правила</span></div></article>
            </section>
          </div>
        </main>

        <Sheet open={generatorOpen} onOpenChange={(open) => { if (!open) closeGenerator(); }}>
          <SheetContent className="generator-sheet sm:max-w-[500px]">
            <SheetHeader className="sheet-header-custom">
              <div className="sheet-avatar generator-sheet-avatar"><WandSparkles /></div>
              <SheetTitle className="text-xl">Продолжить график</SheetTitle>
              <SheetDescription>Первые {GENERATION_SEED_DAYS} дней останутся без изменений</SheetDescription>
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
                  <div className="generation-success"><CheckCircle2 /><span><strong>Найдено допустимое продолжение</strong><small>Выберите вариант и проверьте его в основной таблице.</small></span></div>
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
                    {PEOPLE.map((person) => {
                      const employeeId = employeeIdByName[person];
                      const option = generationOptions.find((item) => item.key === selectedGenerationKey) ?? generationOptions[0];
                      return <span key={person}><strong>{person}</strong><small>{option.metrics.workHours[employeeId]} ч · {option.metrics.dayShifts[employeeId]} день / {option.metrics.nightShifts[employeeId]} ночь</small></span>;
                    })}
                  </div>
                </div>
              ) : (
                <div className="generation-mode-section">
                  <h3>Как продолжить расписание?</h3>
                  <button type="button" className={cn("generation-mode-card", generationMode === "pattern" && "generation-mode-card-selected")} onClick={() => { setGenerationMode("pattern"); setGenerationError(""); }}>
                    <span className="generation-mode-icon"><History /></span><span><strong>Продолжить заданную схему</strong><small>Максимально повторить порядок дневных и ночных смен, заданный в первых восьми днях.</small></span><i />
                  </button>
                  <button type="button" className={cn("generation-mode-card", generationMode === "optimal" && "generation-mode-card-selected")} onClick={() => { setGenerationMode("optimal"); setGenerationError(""); }}>
                    <span className="generation-mode-icon"><ShieldCheck /></span><span><strong>Составить оптимальный график</strong><small>В первую очередь выровнять количество часов, дневных и ночных смен.</small></span><i />
                  </button>
                  <div className="generation-lock-note"><LockKeyhole /><span>Все назначения до голубой линии зафиксированы и не участвуют в перестановках.</span></div>
                  {generationError && <div className="generation-error"><TriangleAlert /><span>{generationError}</span></div>}
                </div>
              )}
            </div>
            <SheetFooter className="sheet-footer-custom">
              {generating ? <><Button variant="outline" onClick={closeGenerator}>Остановить расчёт</Button><Button disabled><Loader2 className="animate-spin" />Идёт расчёт…</Button></> : generationOptions.length ? <><Button variant="outline" onClick={() => { setGenerationOptions([]); setSelectedGenerationKey(""); setGenerationPreview(null); setGenerationError(""); }}>Назад</Button><Button onClick={applyGeneratedSchedule}><CheckCircle2 />Применить продолжение</Button></> : <><Button variant="outline" onClick={closeGenerator}>Отмена</Button><Button onClick={calculateGeneratedSchedule}><WandSparkles />Рассчитать</Button></>}
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={employeeOpen} onOpenChange={setEmployeeOpen}>
          <SheetContent className="employee-sheet sm:max-w-[430px]">
            {selectedEmployee && selectedStats && <>
              <SheetHeader className="sheet-header-custom"><div className="sheet-avatar"><UserRound /></div><SheetTitle className="text-xl">{selectedEmployee}</SheetTitle><SheetDescription>Показатели за {monthGenitive}</SheetDescription></SheetHeader>
              <div className="sheet-body">
                <div className="employee-stats"><div><strong>{selectedStats.total}</strong><span>смен</span></div><div><strong>{selectedStats.hours}</strong><span>часов</span></div><div><strong>{selectedStats.dayCount}</strong><span>дневных</span></div><div><strong>{selectedStats.nightCount}</strong><span>ночных</span></div></div>
                <div className="detail-line"><span>Часы полных выходных</span><strong>{selectedStats.fullOffHours} часов <small>({selectedStats.fullOffDays} дней)</small></strong></div>
                <div className="detail-line"><span>Все свободные от смен часы</span><strong>{selectedStats.restHours} часов</strong></div>
                <div className="detail-line"><span>Рабочие часы по плану</span><strong>{selectedStats.planned} часов</strong></div>
                <div className="detail-line"><span>Отклонение от плана</span><strong>{selectedStats.delta > 0 ? "+" : ""}{selectedStats.delta} часов</strong></div>
                <div className="detail-line"><span>Пар полных выходных</span><strong>{selectedStats.offPairs}</strong></div>
                <div className="action-list">
                  <button type="button" onClick={() => openEmployeeAbsence(selectedEmployee)}><UserX /><span><strong>Указать недоступность</strong><small>Один день, рабочий блок или период</small></span><ChevronRight /></button>
                  <button type="button" onClick={() => { setFocusPerson(selectedEmployee); setEmployeeOpen(false); }}><Eye /><span><strong>Показать только его график</strong><small>Остальные дорожки будут приглушены</small></span><ChevronRight /></button>
                  <button type="button" className="action-coming-soon" aria-disabled="true" title="Будет позже"><History /><span><strong>История изменений</strong><small>{historyCount ? `Применено изменений: ${historyCount}` : "Изменений пока нет"}</small><em>Будет позже</em></span><ChevronRight /></button>
                  <button type="button" className="action-coming-soon" aria-disabled="true" title="Будет позже"><LockKeyhole /><span><strong>Закрепить смены</strong><small>Запретить автоматическую перестановку</small><em>Будет позже</em></span><ChevronRight /></button>
                </div>
              </div>
            </>}
          </SheetContent>
        </Sheet>

        <Sheet open={Boolean(selectedChange)} onOpenChange={(open) => { if (!open) setSelectedChangeId(null); }}>
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
                <div className="change-sheet-note"><Eye /><span>Все смены, относящиеся к этому пакету, подсвечены в таблице.</span></div>
                {changeEvents.filter((change) => change.id > selectedChange.id).length > 0 && <div className="rollback-warning"><TriangleAlert /><span>При откате также будут отменены все более поздние изменения: {changeEvents.filter((change) => change.id > selectedChange.id).map((change) => `№${change.id}`).join(", ")}.</span></div>}
              </div>
              <SheetFooter className="sheet-footer-custom"><Button variant="destructive" onClick={() => openRollbackDialog(selectedChange.id)}><RotateCcw />Откатить изменение</Button></SheetFooter>
            </>}
          </SheetContent>
        </Sheet>

        {rollbackTarget && (
          <div className="reset-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeRollbackDialog()}>
            <section className="reset-dialog rollback-dialog" role="alertdialog" aria-modal="true" aria-labelledby="rollback-dialog-title" aria-describedby="rollback-dialog-description">
              <span className="reset-dialog-icon"><TriangleAlert /></span>
              <h2 id="rollback-dialog-title">Откатить изменение №{rollbackTarget.id}?</h2>
              <p id="rollback-dialog-description">Будут отменены {rollbackTarget.changes.length} {rollbackTarget.changes.length === 1 ? "перестановка" : rollbackTarget.changes.length < 5 ? "перестановки" : "перестановок"}. График вернётся к состоянию до применения этого изменения.</p>
              {rollbackLaterChanges.length > 0 && <div className="rollback-dialog-warning"><TriangleAlert /><span>Также будут отменены последующие изменения: {rollbackLaterChanges.map((change) => `№${change.id}`).join(", ")}.</span></div>}
              <div className="reset-dialog-actions">
                <Button variant="outline" autoFocus onClick={closeRollbackDialog}>Отмена</Button>
                <Button variant="destructive" onClick={() => rollbackChange(rollbackTarget.id)}><RotateCcw />Откатить изменение</Button>
              </div>
            </section>
          </div>
        )}

        <Sheet modal={false} open={workflow !== null} onOpenChange={(open) => !open && closeWorkflow()}>
          <SheetContent
            className="workflow-sheet sm:max-w-[480px]"
            overlayClassName={options.length ? "schedule-preview-overlay" : undefined}
            onInteractOutside={(event) => { if (options.length) event.preventDefault(); }}
          >
            <SheetHeader className="sheet-header-custom">
              <SheetTitle className="text-xl">{calculating ? "Расчёт вариантов" : options.length ? "Варианты графика" : workflow === "remove" ? "Убрать сотрудника со смены" : "Заменить сотрудника"}</SheetTitle>
              <SheetDescription>{selectedShift ? `${selectedShift.person} · ${shiftLabel(selectedShift, period)}` : `${selectedEmployee ?? "Сотрудник"} · укажите период`}</SheetDescription>
            </SheetHeader>

            <div className="sheet-body">
              {calculating ? (
                <div className="calculation-loading" role="status" aria-live="polite">
                  <span className="calculation-spinner"><Loader2 className="animate-spin" aria-hidden="true" /></span>
                  <h3>Подбираем лучшие варианты…</h3>
                  <p>Проверяем покрытие смен, интервалы отдыха, рабочие блоки и обязательные выходные.</p>
                  <small>Длительный расчёт можно остановить кнопкой ниже или крестиком.</small>
                </div>
              ) : options.length ? (
                <div className="options-list">
                  <p className="options-intro">Все варианты закрывают смены и проходят обязательные проверки. Нажмите на вариант, чтобы увидеть его в таблице.</p>
                  {options.map((option, index) => {
                    const selected = option.key === selectedOptionKey;
                    const expanded = option.key === expandedOptionKey;
                    const affectedEmployeeIds = new Set(option.metrics.changes.flatMap((change) => [change.fromEmployeeId, change.toEmployeeId]));
                    const affectedPeople = PEOPLE.filter((person) => affectedEmployeeIds.has(employeeIdByName[person]));
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
                            {option.metrics.changes.map((change) => <button type="button" className={cn("change-line", focusedPreviewShiftId === change.shiftId && "change-line-active")} key={change.shiftId} onClick={() => scrollToPreviewShift(change.shiftId)}><span>{changeDateLabel(change.shiftId)}</span><strong>{employeeNameById[change.fromEmployeeId]} → {employeeNameById[change.toEmployeeId]}</strong><ChevronRight /></button>)}
                            <h4>Влияние на сотрудников</h4>
                            <div className="employee-impact-list">
                              {affectedPeople.map((person) => {
                                const employeeId = employeeIdByName[person];
                                const before = personStats(person, schedule, period);
                                const after = personStats(person, option.schedule, period);
                                const workDelta = after.hours - before.hours;
                                const restDelta = after.restHours - before.restHours;
                                const fullOffDelta = after.fullOffHours - before.fullOffHours;
                                const blocks = option.metrics.hours[employeeId]?.blocks ?? [];
                                const maxBlock = blocks.reduce((maximum, block) => Math.max(maximum, block.length), 0);
                                return (
                                  <div className="employee-impact-card" key={employeeId}>
                                    <div className="employee-impact-head">
                                      <strong>{person}</strong>
                                      <span className={workDelta > 0 ? "work-increase" : workDelta < 0 ? "work-decrease" : "no-change"}>{signedHours(workDelta)} рабочих</span>
                                    </div>
                                    <div className="employee-impact-grid">
                                      <div><span>Рабочие часы</span><strong>{before.hours} → {after.hours}</strong><small>за выбранный месяц</small></div>
                                      <div><span>Часы полных выходных</span><strong>{before.fullOffHours} → {after.fullOffHours}</strong><small className={fullOffDelta > 0 ? "rest-increase" : fullOffDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(fullOffDelta)} · {before.fullOffDays} → {after.fullOffDays} дней</small></div>
                                      <div><span>Все свободные часы</span><strong>{before.restHours} → {after.restHours}</strong><small className={restDelta > 0 ? "rest-increase" : restDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(restDelta)}</small></div>
                                      <div><span>День / ночь</span><strong>{before.dayCount}/{before.nightCount} → {after.dayCount}/{after.nightCount}</strong><small>количество смен</small></div>
                                      <div><span>Всего смен</span><strong>{before.total} → {after.total}</strong><small>с началом в месяце</small></div>
                                      <div><span>Пары выходных</span><strong>{before.offPairs} → {after.offPairs}</strong><small>минимум 2</small></div>
                                      <div><span>Макс. рабочий блок</span><strong>{maxBlock} смен</strong><small>допустимо до 4</small></div>
                                      <div><span>Отклонение от плана</span><strong className={after.delta > 0 ? "positive-delta" : after.delta < 0 ? "negative-delta" : "no-change"}>{signedHours(after.delta)}</strong><small>после перестановки</small></div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="checks-box"><CheckCircle2 /><span>Покрытие 24/7, отдых 12 часов, блоки до 4 смен, две пары выходных и 42 часа отдыха в неделю соблюдены.</span></div>
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
                <div className="form-section"><h3>Кто выйдет на смену</h3><Select value={replacement} onValueChange={setReplacement}><SelectTrigger className="w-full"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger><SelectContent>{PEOPLE.filter((person) => person !== selectedShift?.person).map((person) => <SelectItem value={person} key={person}>{person}</SelectItem>)}</SelectContent></Select><div className="replacement-note">Система проверит выбранную замену и при необходимости предложит перестановки до конца месяца.</div></div>
              )}
            </div>

            <SheetFooter className="sheet-footer-custom">
              {calculating ? <><Button variant="outline" onClick={closeWorkflow}>Остановить расчёт</Button><Button className="calculate-button" disabled><Loader2 className="animate-spin" aria-hidden="true" />Идёт расчёт…</Button></> : options.length ? <><Button variant="outline" onClick={() => { setOptions([]); setPreviewSchedule(null); setFocusedPreviewShiftId(null); }}>Назад</Button><Button className="calculate-button" onClick={applySelectedOption}>Применить вариант</Button></> : <><Button variant="outline" onClick={closeWorkflow}>Отмена</Button>{!calculationError && <Button className="calculate-button" onClick={calculateOptions} disabled={workflow === "replace" && !replacement}>{workflow === "remove" ? "Рассчитать варианты" : "Проверить замену"}</Button>}</>}
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {newMonthConfirmOpen && (
          <div className="reset-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setNewMonthConfirmOpen(false)}>
            <section className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="new-month-dialog-title" aria-describedby="new-month-dialog-description">
              <span className="reset-dialog-icon new-month-dialog-icon"><CalendarDays /></span>
              <h2 id="new-month-dialog-title">{requestedMonthExists ? "График этого месяца уже существует" : "Создать график с чистого листа?"}</h2>
              <p id="new-month-dialog-description">{requestedMonthExists ? "Можно открыть сохранённый график и продолжить работу с ним." : "Будет создан отдельный автоматически сохраняемый черновик. Текущий месяц останется без изменений."}</p>
              <div className="new-month-picker">
                <label>Месяц<select value={newMonthNumber} onChange={(event) => setNewMonthNumber(event.target.value)}>{MONTHS_RU.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
                <label>Год<select value={newMonthYear} onChange={(event) => setNewMonthYear(event.target.value)}>{Array.from({ length: 7 }, (_, index) => 2024 + index).map((year) => <option value={year} key={year}>{year}</option>)}</select></label>
              </div>
              <div className="new-month-details"><span>Период<strong>{formatMonthLabel(Number(newMonthYear), Number(newMonthNumber))}</strong></span><span>Смен<strong>{daysInMonth(Number(newMonthYear), Number(newMonthNumber)) * 2}</strong></span><span>Статус<strong>{requestedMonthExists ? "Уже создан" : "Черновик"}</strong></span></div>
              <div className="reset-dialog-actions">
                <Button variant="outline" autoFocus onClick={() => setNewMonthConfirmOpen(false)}>Отмена</Button>
                <Button onClick={startBlankDraft}>{requestedMonthExists ? <CalendarDays /> : <Plus />}{requestedMonthExists ? "Открыть график" : "Создать черновик"}</Button>
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
