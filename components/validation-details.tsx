import { countLabel, describeValidationIssue, type IssueGroup } from "@/lib/schedule/validation-report";
import type { Employee, Shift } from "@/lib/schedule/types";

export function ValidationDetails({ groups, employees, schedule }: { groups: IssueGroup[]; employees: Employee[]; schedule: Shift[] }) {
  return <div className="validation-groups">{(["error", "warning"] as const).map((severity) => {
    const selected = groups.filter((group) => group.severity === severity);
    return selected.length > 0 && <section key={severity} className={`validation-section validation-${severity}`}>
      <h3>{severity === "error" ? "Мешают закреплению" : "Можно закрепить с подтверждением"}</h3>
      {selected.map((group) => <details className="validation-group" key={group.code} open>
        <summary><strong>{group.title}</strong><span>{countLabel(group.issues.length, ["случай", "случая", "случаев"])}</span></summary>
        <ul>{group.issues.map((item, index) => <li key={index}>{describeValidationIssue(item, employees, schedule)}</li>)}</ul>
      </details>)}
    </section>;
  })}</div>;
}
