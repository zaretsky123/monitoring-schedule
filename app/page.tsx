"use client";

import { useEffect, useMemo, useState } from "react";
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
import { addDays } from "@/lib/schedule/calendar";
import {
  createOctober2026Schedule,
  employeeIdByName,
  employeeNameById,
  EMPLOYEES,
  octoberPeriod,
} from "@/lib/schedule/sample";
import { countMonthlyFullOffDays, countMonthlyOffPairs, findWorkBlock, validateSchedule } from "@/lib/schedule/validator";
import type { Absence, Employee, Period, ScheduleOption, Shift, ShiftChange } from "@/lib/schedule/types";

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

const ASSIGNMENTS: { day: Person; night: Person }[] = [
  { day: "ФИО 2", night: "ФИО 1" },
  { day: "ФИО 2", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 4" },
  { day: "ФИО 3", night: "ФИО 4" },
  { day: "ФИО 3", night: "ФИО 1" },
  { day: "ФИО 2", night: "ФИО 1" },
  { day: "ФИО 2", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 4" },
  { day: "ФИО 3", night: "ФИО 4" },
  { day: "ФИО 3", night: "ФИО 1" },
  { day: "ФИО 2", night: "ФИО 1" },
  { day: "ФИО 2", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 4" },
  { day: "ФИО 3", night: "ФИО 4" },
  { day: "ФИО 3", night: "ФИО 1" },
  { day: "ФИО 2", night: "ФИО 1" },
  { day: "ФИО 2", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 3" },
  { day: "ФИО 4", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 2" },
  { day: "ФИО 1", night: "ФИО 4" },
  { day: "ФИО 3", night: "ФИО 4" },
];

const NAV_ITEMS = [
  { label: "График", icon: CalendarDays, active: true },
  { label: "Сотрудники", icon: Users },
  { label: "Правила", icon: ShieldCheck },
  { label: "История", icon: History },
  { label: "Выгрузка", icon: FileSpreadsheet },
];

const DAY_WIDTH = 154;
const NAME_WIDTH = 196;
const STORAGE_KEY = "monitoring-schedule:october-2026:v1";
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

type PersistedSchedule = {
  version: 1 | 2 | 3;
  historyCount: number;
  schedule: Array<Omit<Shift, "start" | "end"> & { start: string; end: string }>;
  changeEvents?: PersistedChangeEvent[];
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

type WorkerRequest = {
  schedule: Shift[];
  employees: Employee[];
  period: Period;
  absences: Absence[];
  recalculationStart: Date;
  requiredAssignments: Record<string, string>;
  maxExtraChanges: number;
  maxOptions: number;
};

type WorkerResult =
  | { found: true; minimumChangeCount: number; recommendedKey: string; options: ScheduleOption[] }
  | { found: false; options: []; reason: string };

type ShiftSelection = {
  person: Person;
  kind: ShiftKind;
  startDay: number;
};

function dayInfo(day: number) {
  const date = new Date(Date.UTC(2026, 9, day));
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(".", "");
  const dayOfWeek = date.getUTCDay();
  return { weekday, weekend: dayOfWeek === 0 || dayOfWeek === 6 };
}

function nightLabel(startDay: number) {
  if (startDay === 0) return "30 сентября, 20:00 — 1 октября, 08:00";
  if (startDay === 31) return "31 октября, 20:00 — 1 ноября, 08:00";
  return `${startDay} октября, 20:00 — ${startDay + 1} октября, 08:00`;
}

function shiftLabel(shift: ShiftSelection | null) {
  if (!shift) return "";
  return shift.kind === "day"
    ? `${shift.startDay} октября, 08:00–20:00`
    : nightLabel(shift.startDay);
}

function shiftIdFor(startDay: number, kind: ShiftKind) {
  const date = startDay === 0 ? "2026-09-30" : `2026-10-${String(startDay).padStart(2, "0")}`;
  return `${date}:${kind === "day" ? "D" : "N"}`;
}

function personStats(person: Person, schedule: Shift[]) {
  const employeeId = employeeIdByName[person];
  const period = octoberPeriod();
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

function runScheduleWorker(request: WorkerRequest) {
  return new Promise<WorkerResult>((resolve, reject) => {
    const workerUrl = new URL("workers/schedule-worker.js", document.baseURI);
    const worker = new Worker(workerUrl, { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type: "result"; result: WorkerResult } | { type: "error"; message: string }>) => {
      worker.terminate();
      if (event.data.type === "error") reject(new Error(event.data.message));
      else resolve(event.data.result);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Фоновый расчёт завершился с ошибкой"));
    };
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

function changeMarkerLeft(start: Date) {
  if (start < octoberPeriod().start) return NAME_WIDTH;
  if (start >= octoberPeriod().end) return NAME_WIDTH + 31 * DAY_WIDTH;
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
  const day = Number(date.slice(-2));
  return type === "D" ? `${day} октября, день` : `${day} октября, ночь`;
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
  const [schedule, setSchedule] = useState<Shift[]>(() => createOctober2026Schedule());
  const [previewSchedule, setPreviewSchedule] = useState<Shift[] | null>(null);
  const [options, setOptions] = useState<ScheduleOption[]>([]);
  const [selectedOptionKey, setSelectedOptionKey] = useState("");
  const [expandedOptionKey, setExpandedOptionKey] = useState("");
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
  const days = useMemo(() => Array.from({ length: 31 }, (_, index) => index + 1), []);
  const displaySchedule = previewSchedule ?? schedule;
  const hasAppliedChanges = useMemo(
    () => schedule.some((shift) => shift.employeeId !== shift.plannedEmployeeId),
    [schedule],
  );
  const activeAbsences = useMemo(
    () => mergeAbsences(...changeEvents.map((change) => change.absences)),
    [changeEvents],
  );
  const currentValidation = useMemo(
    () => validateSchedule({ schedule: displaySchedule, employees: EMPLOYEES, period: octoberPeriod(), absences: activeAbsences }),
    [activeAbsences, displaySchedule],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const persisted = JSON.parse(raw) as Partial<PersistedSchedule>;
        if ([1, 2, 3].includes(persisted.version ?? 0) && Array.isArray(persisted.schedule)) {
          const restored = persisted.schedule.map((shift) => ({
            ...shift,
            start: new Date(shift.start),
            end: new Date(shift.end),
          }));
          const datesAreValid = restored.every(
            (shift) => !Number.isNaN(shift.start.getTime()) && !Number.isNaN(shift.end.getTime()),
          );
          if (datesAreValid) {
            setSchedule(restored);
            let restoredEvents = (persisted.changeEvents ?? []).flatMap((change) => {
              if (!Array.isArray(change.beforeSchedule)) return [];
              const beforeSchedule = change.beforeSchedule.map((shift) => ({
                ...shift,
                start: new Date(shift.start),
                end: new Date(shift.end),
              }));
              const start = new Date(change.start);
              const appliedAt = new Date(change.appliedAt);
              const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(appliedAt.getTime()) && beforeSchedule.every((shift) => !Number.isNaN(shift.start.getTime()) && !Number.isNaN(shift.end.getTime()));
              if (!valid) return [];
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
              const original = createOctober2026Schedule();
              const originalById = new Map(original.map((shift) => [shift.id, shift]));
              const legacyChanges = restored
                .filter((shift) => shift.start >= octoberPeriod().start && shift.start < octoberPeriod().end)
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
            setChangeEvents(restoredEvents);
            const persistedCount = persisted.version === 1 && restoredEvents.length ? 1 : Number.isInteger(persisted.historyCount) ? persisted.historyCount! : 0;
            setHistoryCount(Math.max(persistedCount, ...restoredEvents.map((change) => change.id), 0));
          }
        }
      }
    } catch {
      // Повреждённые локальные данные не должны мешать открыть исходный график.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const persisted: PersistedSchedule = {
      version: 3,
      historyCount,
      schedule: schedule.map((shift) => ({
        ...shift,
        start: shift.start.toISOString(),
        end: shift.end.toISOString(),
      })),
      changeEvents: changeEvents.map((change) => ({
        ...change,
        start: change.start.toISOString(),
        appliedAt: change.appliedAt.toISOString(),
        absences: change.absences.map((absence) => ({
          ...absence,
          start: absence.start.toISOString(),
          end: absence.end.toISOString(),
        })),
        beforeSchedule: change.beforeSchedule.map((shift) => ({
          ...shift,
          start: shift.start.toISOString(),
          end: shift.end.toISOString(),
        })),
      })),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // График продолжит работать в текущей вкладке, даже если хранилище браузера недоступно.
    }
  }, [changeEvents, historyCount, schedule, storageReady]);

  useEffect(() => {
    if (!resetConfirmOpen && rollbackConfirmId === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setResetConfirmOpen(false);
        setRollbackConfirmId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [resetConfirmOpen, rollbackConfirmId]);

  function openWorkflow(shift: ShiftSelection, nextWorkflow: Exclude<Workflow, null>) {
    setSelectedShift(shift);
    setWorkflow(nextWorkflow);
    setScope("shift");
    setReplacement("");
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
    setCalculationError("");
    setPreviewSchedule(null);
    setPendingChange(null);
    const target = schedule.find((item) => item.id === shiftIdFor(shift.startDay, shift.kind));
    if (target) {
      setCustomStart(target.start.toISOString().slice(0, 16));
      setCustomEnd(target.end.toISOString().slice(0, 16));
    }
  }

  function closeWorkflow() {
    if (calculating) return;
    setWorkflow(null);
    setOptions([]);
    setSelectedOptionKey("");
    setExpandedOptionKey("");
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
    setCustomStart("2026-10-01T00:00");
    setCustomEnd("2026-10-02T00:00");
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
          day: { type: "integer", minimum: 1, maximum: 31 },
          shiftType: { type: "string", enum: ["day", "night"] },
        },
        required: ["employeeName", "day", "shiftType"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const value = input as { employeeName?: string; day?: number; shiftType?: string };
        const person = PEOPLE.find((item) => item === value.employeeName);
        if (!person || !Number.isInteger(value.day) || !value.day || value.day < 1 || value.day > 31 || (value.shiftType !== "day" && value.shiftType !== "night")) throw new Error("Некорректные параметры смены");
        const engineShift = schedule.find((shift) => shift.id === shiftIdFor(value.day!, value.shiftType as ShiftKind));
        if (!engineShift || employeeNameById[engineShift.employeeId] !== person) throw new Error("Сотрудник не назначен на эту смену");
        openWorkflow({ person, kind: value.shiftType as ShiftKind, startDay: value.day }, "remove");
        return { status: "opened", employeeName: person, day: value.day, shiftType: value.shiftType };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [schedule]);

  function renderShiftSegment(person: Person, kind: ShiftKind, startDay: number, segment: "left" | "center" | "right") {
    const shift = { person, kind, startDay } satisfies ShiftSelection;
    const longLabel = kind === "day" ? `${startDay} октября, 08:00–20:00` : nightLabel(startDay);
    const scheduleShift = displaySchedule.find((item) => item.id === shiftIdFor(startDay, kind));
    const changed = Boolean(scheduleShift && scheduleShift.employeeId !== scheduleShift.plannedEmployeeId);
    const highlightedByChange = Boolean(scheduleShift && selectedChangeId !== null && changeEvents.find((change) => change.id === selectedChangeId)?.changes.some((change) => change.shiftId === scheduleShift.id));
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn("shift-segment", kind === "day" ? "shift-day" : "shift-night", segment === "left" && "segment-left", segment === "right" && "segment-right", changed && "shift-changed", highlightedByChange && "shift-history-highlighted")} aria-label={`${person}. ${kind === "day" ? "Дневная" : "Ночная"} смена: ${longLabel}`} title={longLabel}>
            <span>{kind === "day" ? "Д" : "Н"}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 rounded-xl p-2 shadow-xl">
          <DropdownMenuLabel className="px-2 pb-2 pt-1">
            <span className="block text-[13px] text-slate-500">{kind === "day" ? "Дневная смена" : "Ночная смена"}</span>
            <span className="mt-0.5 block text-sm font-semibold text-slate-900">{person}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="rounded-lg py-2.5" variant="destructive" onSelect={() => openWorkflow(shift, "remove")}><UserX />Убрать</DropdownMenuItem>
          <DropdownMenuItem className="rounded-lg py-2.5" onSelect={() => openWorkflow(shift, "replace")}><UserRoundCog />Заменить</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  async function calculateOptions() {
    if (calculating) return;
    const employeeId = selectedShift ? employeeIdByName[selectedShift.person] : selectedEmployee ? employeeIdByName[selectedEmployee] : "";
    let target = selectedShift ? schedule.find((shift) => shift.id === shiftIdFor(selectedShift.startDay, selectedShift.kind)) : undefined;
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

    try {
      const result = await runScheduleWorker({
        schedule,
        employees: EMPLOYEES,
        period: octoberPeriod(),
        absences: mergeAbsences(activeAbsences, [absence]),
        recalculationStart: target.start,
        requiredAssignments,
        maxExtraChanges: 2,
        maxOptions: 3,
      });

      if (!result.found) {
        setOptions([]);
        setCalculationError(result.reason);
        setPreviewSchedule(null);
        return;
      }
      setOptions(result.options);
      setSelectedOptionKey(result.recommendedKey);
      setPreviewSchedule(result.options[0].schedule);
    } catch (error) {
      setOptions([]);
      setPreviewSchedule(null);
      setCalculationError(error instanceof Error ? error.message : "Не удалось рассчитать варианты");
    } finally {
      setCalculating(false);
    }
  }

  function chooseOption(option: ScheduleOption) {
    setSelectedOptionKey(option.key);
    setPreviewSchedule(option.schedule);
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
    setSchedule(option.schedule.map(({ baseEmployeeId: _baseEmployeeId, ...shift }) => shift));
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

  function resetToOriginalSchedule() {
    setSchedule(createOctober2026Schedule());
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

      sheet.getCell("R3").value = "График мониторинга — Октябрь 2026";
      for (const day of days) {
        const firstColumn = 2 + (day - 1) * 3;
        const calendarDate = new Date(Date.UTC(2026, 9, day));
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
        for (const day of days) {
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
        writeShiftMarker(scheduleById.get(shiftIdFor(day - 1, "night")), firstColumn, nightShiftStyle);
        writeShiftMarker(scheduleById.get(shiftIdFor(day, "day")), firstColumn + 1, dayShiftStyle);
        writeShiftMarker(scheduleById.get(shiftIdFor(day, "night")), firstColumn + 2, nightShiftStyle);
      }

      sheet.getCell("C13").value = "Д3";
      sheet.getCell("D13").value = "Н2";
      sheet.getCell("E13").value = "пар выходных";
      sheet.getCell("I13").value = "рабочих ч.";
      const period = octoberPeriod();
      for (const [index, person] of PEOPLE.entries()) {
        const employeeId = employeeIdByName[person];
        const row = 14 + index;
        const stats = personStats(person, displaySchedule);
        let nightHalves = 0;
        let workedHours = 0;
        for (const shift of displaySchedule) {
          if (shift.employeeId !== employeeId) continue;
          if (shift.type === "N") {
            for (const day of days) {
              if (scheduleById.get(shiftIdFor(day - 1, "night"))?.id === shift.id) nightHalves += 1;
              if (scheduleById.get(shiftIdFor(day, "night"))?.id === shift.id) nightHalves += 1;
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
      link.download = "График_мониторинга_октябрь_2026.xlsx";
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

  const gridStyle = { gridTemplateColumns: `${NAME_WIDTH}px repeat(31, ${DAY_WIDTH}px)` };
  const selectedStats = selectedEmployee ? personStats(selectedEmployee, displaySchedule) : null;
  const selectedChange = selectedChangeId === null ? null : changeEvents.find((change) => change.id === selectedChangeId) ?? null;
  const changeMarkers = useMemo(() => {
    const previousPositions: number[] = [];
    return changeEvents.map((change) => {
      const left = changeMarkerLeft(change.start);
      const lane = previousPositions.filter((position) => Math.abs(position - left) < 112).length % 2;
      previousPositions.push(left);
      return { change, left, lane };
    });
  }, [changeEvents]);

  return (
    <TooltipProvider>
      <div className="app-shell">
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
            <div className="topbar-heading"><h1>График работы</h1><span className={cn("coverage-status", !currentValidation.valid && "coverage-error")}><span className="status-dot" />{previewSchedule ? "Предпросмотр варианта" : currentValidation.valid ? "Все требования выполнены" : `${currentValidation.issues.length} нарушений`}</span></div>
            <div className="topbar-actions">
              <Button variant="outline" size="icon" className="coming-icon-button" aria-disabled="true" aria-label="Предыдущий месяц — будет позже" title="Будет позже"><ChevronLeft /></Button>
              <button type="button" className="month-button month-button-coming" aria-disabled="true" title="Выбор месяца будет позже"><CalendarDays />Октябрь 2026<small>Будет позже</small></button>
              <Button variant="outline" size="icon" className="coming-icon-button" aria-disabled="true" aria-label="Следующий месяц — будет позже" title="Будет позже"><ChevronRight /></Button>
              <Button variant="outline" className="reset-schedule-button" onClick={() => setResetConfirmOpen(true)} disabled={!hasAppliedChanges} title={hasAppliedChanges ? "Отменить все применённые перестановки" : "График уже соответствует исходному"}><RotateCcw /><span>Вернуть исходный</span></Button>
              <Button className="export-button" onClick={exportExcel} disabled={exporting}><Download />{exporting ? "Готовим Excel…" : "Скачать Excel"}</Button>
              <button type="button" className="profile-button coming-icon-button" aria-disabled="true" aria-label="Профиль пользователя — будет позже" title="Будет позже">А</button>
            </div>
          </header>

          <div className="content-area">
            <section className="schedule-card" aria-labelledby="schedule-title">
              <div className="schedule-toolbar">
                <div><h2 id="schedule-title">Расписание</h2><p>Дневная смена 08:00–20:00 · ночная смена 20:00–08:00</p></div>
                <div className="toolbar-right">
                  {focusPerson && <button className="focus-chip" onClick={() => setFocusPerson(null)}>Показан {focusPerson}<span>Сбросить</span></button>}
                  <div className="legend" aria-label="Обозначения смен"><span><Sun />День</span><span><Moon />Ночь</span></div>
                </div>
              </div>

              <div className="schedule-scroll" tabIndex={0} aria-label="График за октябрь 2026">
                <div className={cn("schedule-grid", changeMarkers.length > 0 && "schedule-grid-with-markers")} style={gridStyle}>
                  {changeMarkers.length > 0 && <div className="change-markers-layer" aria-label="Применённые изменения">
                    {changeMarkers.map(({ change, left, lane }) => <div className={cn("change-marker", selectedChangeId === change.id && "change-marker-active")} style={{ left }} key={change.id}>
                      <button type="button" className="change-marker-label" style={{ top: 4 + lane * 24 }} onClick={() => setSelectedChangeId(change.id)}>Изменение {change.id}</button>
                      <span className="change-marker-line" />
                    </div>)}
                  </div>}
                  <div className="sticky-name header-name"><span>Сотрудники</span><span className="header-count">4</span></div>
                  {days.map((day) => { const info = dayInfo(day); return <div key={`date-${day}`} className={cn("date-header", info.weekend && "weekend-header")}><strong>{day}</strong><span>{info.weekday}</span></div>; })}

                  <div className="sticky-name time-name"><Clock3 />Время</div>
                  {days.map((day) => { const info = dayInfo(day); return <div key={`time-${day}`} className={cn("time-cell", info.weekend && "weekend-cell")}><span>00–08</span><span>08–20</span><span>20–24</span></div>; })}

                  {PEOPLE.map((person, personIndex) => {
                    const isFocusedOut = Boolean(focusPerson && focusPerson !== person);
                    const isHighlighted = hoveredPerson === person || focusPerson === person;
                    return [
                      <button key={`${person}-name`} type="button" className={cn("sticky-name employee-name", isHighlighted && "employee-highlighted", isFocusedOut && "row-muted")} onMouseEnter={() => setHoveredPerson(person)} onMouseLeave={() => setHoveredPerson(null)} onFocus={() => setHoveredPerson(person)} onBlur={() => setHoveredPerson(null)} onClick={() => { setSelectedEmployee(person); setEmployeeOpen(true); }}>
                        <span className={`employee-avatar avatar-${personIndex + 1}`}>{personIndex + 1}</span><span>{person}</span><ChevronRight className="employee-chevron" />
                      </button>,
                      ...days.map((day) => {
                        const info = dayInfo(day);
                        const leftShift = displaySchedule.find((shift) => shift.id === shiftIdFor(day - 1, "night"));
                        const dayShift = displaySchedule.find((shift) => shift.id === shiftIdFor(day, "day"));
                        const nightShift = displaySchedule.find((shift) => shift.id === shiftIdFor(day, "night"));
                        const leftOwner = leftShift ? employeeNameById[leftShift.employeeId] : null;
                        const dayOwner = dayShift ? employeeNameById[dayShift.employeeId] : null;
                        const nightOwner = nightShift ? employeeNameById[nightShift.employeeId] : null;
                        return <div key={`${person}-${day}`} className={cn("schedule-cell", info.weekend && "weekend-cell", isHighlighted && "cell-highlighted", isFocusedOut && "row-muted")} onMouseEnter={() => setHoveredPerson(person)} onMouseLeave={() => setHoveredPerson(null)}>
                          <div className="segment-slot left-slot">{leftOwner === person && renderShiftSegment(person, "night", day - 1, "left")}</div>
                          <div className="segment-slot center-slot">{dayOwner === person && renderShiftSegment(person, "day", day, "center")}</div>
                          <div className="segment-slot right-slot">{nightOwner === person && renderShiftSegment(person, "night", day, "right")}</div>
                        </div>;
                      }),
                    ];
                  })}

                  <div className="sticky-name add-employee-row" aria-disabled="true"><span className="add-icon"><Plus /></span><span>Добавить сотрудника</span><small>Будет позже</small></div>
                  {days.map((day) => <div key={`add-${day}`} className="add-row-cell" />)}
                </div>
              </div>

              <div className="schedule-footer"><span><Menu />Для действий нажмите на нужную смену</span><span>Таблица прокручивается по горизонтали</span></div>
            </section>

            <section className="summary-grid" aria-label="Сводка графика">
              <article className="summary-card"><span className="summary-icon blue"><CheckCircle2 /></span><div><strong>62 из 62</strong><span>смены закрыты</span></div></article>
              <article className="summary-card"><span className="summary-icon cyan"><Clock3 /></span><div><strong>12 часов</strong><span>продолжительность смены</span></div></article>
              <article className="summary-card"><span className="summary-icon violet"><Users /></span><div><strong>4 сотрудника</strong><span>в текущем графике</span></div></article>
              <article className="summary-card"><span className="summary-icon green"><ShieldCheck /></span><div><strong>{currentValidation.valid ? "Без нарушений" : currentValidation.issues.length}</strong><span>обязательные правила</span></div></article>
            </section>
          </div>
        </main>

        <Sheet open={employeeOpen} onOpenChange={setEmployeeOpen}>
          <SheetContent className="employee-sheet sm:max-w-[430px]">
            {selectedEmployee && selectedStats && <>
              <SheetHeader className="sheet-header-custom"><div className="sheet-avatar"><UserRound /></div><SheetTitle className="text-xl">{selectedEmployee}</SheetTitle><SheetDescription>Показатели за октябрь 2026</SheetDescription></SheetHeader>
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

        <Sheet open={Boolean(selectedChange)} onOpenChange={(open) => { if (!open) { setSelectedChangeId(null); setRollbackConfirmId(null); } }}>
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
                {rollbackConfirmId === selectedChange.id && <div className="rollback-inline-confirm"><strong>Подтвердите откат</strong>График вернётся к состоянию до изменения {selectedChange.id}.{changeEvents.some((change) => change.id > selectedChange.id) ? " Более поздние изменения также будут отменены." : ""}</div>}
              </div>
              <SheetFooter className="sheet-footer-custom">{rollbackConfirmId === selectedChange.id ? <><Button variant="outline" onClick={() => setRollbackConfirmId(null)}>Отмена</Button><Button variant="destructive" onClick={() => rollbackChange(selectedChange.id)}><RotateCcw />Подтвердить откат</Button></> : <Button variant="destructive" onClick={() => setRollbackConfirmId(selectedChange.id)}><RotateCcw />Откатить изменение</Button>}</SheetFooter>
            </>}
          </SheetContent>
        </Sheet>

        <Sheet open={workflow !== null} onOpenChange={(open) => !open && closeWorkflow()}>
          <SheetContent className="workflow-sheet sm:max-w-[480px]">
            <SheetHeader className="sheet-header-custom">
              <SheetTitle className="text-xl">{calculating ? "Расчёт вариантов" : options.length ? "Варианты графика" : workflow === "remove" ? "Убрать сотрудника со смены" : "Заменить сотрудника"}</SheetTitle>
              <SheetDescription>{selectedShift ? `${selectedShift.person} · ${shiftLabel(selectedShift)}` : `${selectedEmployee ?? "Сотрудник"} · укажите период`}</SheetDescription>
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
                            {option.metrics.changes.map((change) => <div className="change-line" key={change.shiftId}><span>{changeDateLabel(change.shiftId)}</span><strong>{employeeNameById[change.fromEmployeeId]} → {employeeNameById[change.toEmployeeId]}</strong></div>)}
                            <h4>Влияние на сотрудников</h4>
                            <div className="employee-impact-list">
                              {affectedPeople.map((person) => {
                                const employeeId = employeeIdByName[person];
                                const before = personStats(person, schedule);
                                const after = personStats(person, option.schedule);
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
                                      <div><span>Рабочие часы</span><strong>{before.hours} → {after.hours}</strong><small>за октябрь</small></div>
                                      <div><span>Часы полных выходных</span><strong>{before.fullOffHours} → {after.fullOffHours}</strong><small className={fullOffDelta > 0 ? "rest-increase" : fullOffDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(fullOffDelta)} · {before.fullOffDays} → {after.fullOffDays} дней</small></div>
                                      <div><span>Все свободные часы</span><strong>{before.restHours} → {after.restHours}</strong><small className={restDelta > 0 ? "rest-increase" : restDelta < 0 ? "rest-decrease" : "no-change"}>{signedHours(restDelta)}</small></div>
                                      <div><span>День / ночь</span><strong>{before.dayCount}/{before.nightCount} → {after.dayCount}/{after.nightCount}</strong><small>количество смен</small></div>
                                      <div><span>Всего смен</span><strong>{before.total} → {after.total}</strong><small>с началом в октябре</small></div>
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
                    {[["shift", "Только выбранная смена", shiftLabel(selectedShift)], ["block", "До конца рабочего блока", "Выбранная и следующие смены блока"], ["week", "7 календарных дней", "Начиная с выбранной даты"], ["custom", "Другой период", "Указать начало и окончание"]].map(([value, title, description]) => <label key={value} className={cn("scope-option", scope === value && "scope-option-active")}><RadioGroupItem value={value} /><span><strong>{title}</strong><small>{description}</small></span></label>)}
                  </RadioGroup></div>}
                  {(!selectedShift || scope === "custom") && <div className={cn("custom-period", !selectedShift && "custom-period-standalone")}><label>Начало<input type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>Окончание<input type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
                  <div className="form-section"><h3>Причина</h3><Select value={reason} onValueChange={setReason}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="absence">Неявка</SelectItem><SelectItem value="sickday">Sick day</SelectItem><SelectItem value="medical">Больничный</SelectItem><SelectItem value="vacation">Отпуск</SelectItem><SelectItem value="other">Другое</SelectItem></SelectContent></Select></div>
                </>
              ) : (
                <div className="form-section"><h3>Кто выйдет на смену</h3><Select value={replacement} onValueChange={setReplacement}><SelectTrigger className="w-full"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger><SelectContent>{PEOPLE.filter((person) => person !== selectedShift?.person).map((person) => <SelectItem value={person} key={person}>{person}</SelectItem>)}</SelectContent></Select><div className="replacement-note">Система проверит выбранную замену и при необходимости предложит перестановки до конца месяца.</div></div>
              )}
            </div>

            <SheetFooter className="sheet-footer-custom">
              {calculating ? <><Button variant="outline" disabled>Отмена</Button><Button className="calculate-button" disabled><Loader2 className="animate-spin" aria-hidden="true" />Идёт расчёт…</Button></> : options.length ? <><Button variant="outline" onClick={() => { setOptions([]); setPreviewSchedule(null); }}>Назад</Button><Button className="calculate-button" onClick={applySelectedOption}>Применить вариант</Button></> : <><Button variant="outline" onClick={closeWorkflow}>Отмена</Button>{!calculationError && <Button className="calculate-button" onClick={calculateOptions} disabled={workflow === "replace" && !replacement}>{workflow === "remove" ? "Рассчитать варианты" : "Проверить замену"}</Button>}</>}
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {resetConfirmOpen && (
          <div className="reset-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setResetConfirmOpen(false)}>
            <section className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-dialog-title" aria-describedby="reset-dialog-description">
              <span className="reset-dialog-icon"><TriangleAlert /></span>
              <h2 id="reset-dialog-title">Вернуть исходный график?</h2>
              <p id="reset-dialog-description">Все применённые перестановки за октябрь будут отменены. График вернётся к первоначальному состоянию.</p>
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
