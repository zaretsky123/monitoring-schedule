export type ShiftType = "D" | "N";

export type Employee = {
  id: string;
  name: string;
  active: boolean;
};

export type Shift = {
  id: string;
  type: ShiftType;
  start: Date;
  end: Date;
  employeeId: string;
  plannedEmployeeId: string;
  baseEmployeeId?: string;
};

export type Period = {
  year: number;
  month: number;
  start: Date;
  end: Date;
};

export type StoredScheduleStatus = "draft" | "published";

export type ScheduleLifecycleStatus = "draft" | "planned" | "active" | "completed";

export type Absence = {
  employeeId: string;
  start: Date;
  end: Date;
};

export type ValidationIssue = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type ShiftChange = {
  shiftId: string;
  type: ShiftType;
  fromEmployeeId: string;
  toEmployeeId: string;
};

export type EmployeeMetrics = {
  planned: number;
  resulting: number;
  delta: number;
  offPairs: number;
  blocks: { length: number; shiftIds: string[] }[];
};

export type ScheduleOption = {
  key: string;
  schedule: Shift[];
  metrics: {
    changes: ShiftChange[];
    changedCount: number;
    affectedEmployeeCount: number;
    hours: Record<string, EmployeeMetrics>;
    maxPositiveOverload: number;
    loadSpread: number;
    totalLoadDeviation: number;
    changeSpanHours: number;
  };
};

export type GenerationMode = "pattern" | "optimal";

export type GeneratedScheduleOption = {
  key: string;
  mode: GenerationMode;
  schedule: Shift[];
  metrics: {
    patternMatches: number;
    patternTotal: number;
    workHours: Record<string, number>;
    dayShifts: Record<string, number>;
    nightShifts: Record<string, number>;
    loadSpreadHours: number;
  };
};
