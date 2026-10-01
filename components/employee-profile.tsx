"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Employee } from "@/lib/schedule/types";

export type EmployeeMonthEntry = { key: string; label: string; year: number; status: string; isTest: boolean; hours: number; total: number };

export function EmployeeProfile({ employee, months, currentMonthLabel, overview, onBack, onOpenMonth, onEdit }: {
  employee: Employee;
  months: EmployeeMonthEntry[];
  currentMonthLabel: string;
  overview: ReactNode;
  onBack: () => void;
  onOpenMonth: (key: string) => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "months">("overview");
  const groups = [...new Set(months.map((month) => month.year))];
  return <section className="staff-profile-card">
    <div className="staff-profile-heading"><Button variant="ghost" onClick={onBack}><ChevronLeft />Сотрудники</Button><Button variant="outline" onClick={onEdit}><Pencil />Редактировать</Button></div>
    <div className="staff-profile-identity"><span className="staff-profile-avatar"><UserRound /></span><div><h2>{employee.name}</h2><span className={`staff-status ${employee.active ? "staff-working" : "staff-dismissed"}`}>{employee.archivedAt ? "В архиве" : employee.active ? "Работает" : "Уволен"}</span>{employee.isTest && <span className="staff-test-badge">Тестовый</span>}</div></div>
    <div className="staff-profile-tabs" role="tablist" aria-label="Карточка сотрудника"><button role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>Обзор</button><button role="tab" aria-selected={tab === "months"} onClick={() => setTab("months")}>Месяцы <small>{months.length}</small></button></div>
    {tab === "overview" ? <div className="staff-profile-overview" role="tabpanel"><div className="staff-profile-info"><div><span>Начало работы</span><strong>{employee.startDate ? new Intl.DateTimeFormat("ru", { timeZone: "UTC" }).format(new Date(`${employee.startDate}T00:00:00Z`)) : "Начало не задано"}</strong></div><div><span>Окончание работы</span><strong>{employee.endDateTime?.replace("T", " ") ?? "Не задано"}</strong></div><div><span>Ставка оплаты</span><strong>{employee.hourlyRate === undefined ? "Не задана" : `${employee.hourlyRate.toLocaleString("ru")} ₽/ч`}</strong></div><div><span>Постоянный ID</span><strong className="staff-profile-id">{employee.id}</strong></div></div><div className="staff-profile-month-heading"><h3>{currentMonthLabel}</h3><span>Текущий месяц</span></div>{overview}</div> : <div className="staff-profile-months" role="tabpanel">{groups.map((year) => <section key={year}><h3>{year}</h3><div className="staff-month-list">{months.filter((month) => month.year === year).map((month) => <button key={month.key} onClick={() => onOpenMonth(month.key)}><CalendarDays /><span><strong>{month.label}</strong><small>{month.isTest ? "Тестовый · " : ""}{month.status}</small></span><span className="staff-month-numbers">{month.total} смен · {month.hours} ч</span><ChevronRight /></button>)}</div></section>)}{!months.length && <p className="staff-empty">Нет сохранённых месяцев участия</p>}</div>}
  </section>;
}
