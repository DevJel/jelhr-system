import { HttpError } from "./http.js";
import * as v from "./validate.js";

export const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"];
export const STAGE_LABELS = { applied: "Submitted", screening: "Pending review", interview: "Interviewing", offer: "Offer", hired: "Onboarded", rejected: "Rejected", withdrawn: "Withdrawn" };
export const WORK_MODES = ["onsite", "hybrid", "remote"];
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "temporary"];

export function readJob(b, partial = false) {
  const out = {};
  const req = !partial;
  if (req || b.title !== undefined) out.title = v.text(b.title, "Job title", { required: true, max: 120 });
  if (b.department !== undefined) out.department = v.optionalText(b.department, "Department", 80);
  if (b.location !== undefined) out.location = v.optionalText(b.location, "Location", 120);
  if (b.employmentType !== undefined) out.employment_type = v.oneOf(b.employmentType, EMPLOYMENT_TYPES, "Employment type");
  if (b.workMode !== undefined) out.work_mode = v.oneOf(b.workMode, WORK_MODES, "Work mode");
  if (b.summary !== undefined) out.summary = v.optionalText(b.summary, "Summary", 300);
  if (req || b.description !== undefined) out.description = v.text(b.description, "Description", { required: true, max: 20000 });
  if (b.requirements !== undefined) out.requirements = v.optionalText(b.requirements, "Requirements", 8000);
  if (b.salaryMin !== undefined) out.salary_min = b.salaryMin === "" || b.salaryMin === null ? null : v.int(b.salaryMin, "Minimum salary", { min: 0, max: 1e8 });
  if (b.salaryMax !== undefined) out.salary_max = b.salaryMax === "" || b.salaryMax === null ? null : v.int(b.salaryMax, "Maximum salary", { min: 0, max: 1e8 });
  if (b.salaryCurrency !== undefined) { const c = b.salaryCurrency ? String(b.salaryCurrency).toUpperCase() : null; if (c && !/^[A-Z]{3}$/.test(c)) throw new HttpError(400, "Currency must be a 3-letter code like MYR"); out.salary_currency = c; }
  if (b.showSalary !== undefined) out.show_salary = b.showSalary ? 1 : 0;
  if (b.closesAt !== undefined) out.closes_at = v.date(b.closesAt, "Closing date");
  if (out.salary_min != null && out.salary_max != null && out.salary_min > out.salary_max) throw new HttpError(400, "Minimum salary is higher than maximum");
  return out;
}

export const publicJob = j => ({
  id: j.id, title: j.title, department: j.department, location: j.location, employmentType: j.employment_type, workMode: j.work_mode,
  summary: j.summary, description: j.description, requirements: j.requirements, closesAt: j.closes_at, publishedAt: j.published_at,
  salary: j.show_salary && (j.salary_min || j.salary_max) ? { min: j.salary_min, max: j.salary_max, currency: j.salary_currency } : null
});
