import { respond } from "../../_shared/http.js";
import { authenticate, HR_READ } from "../../_shared/auth.js";

export async function onRequestGet(context) {
  const user = await authenticate(context, [...HR_READ, "manager"]);
  const { env } = context;
  const org = user.organization_id;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [status, offboarding, signatures, onboarding, hours, applicants, comms] = await Promise.all([
    env.DB.prepare("SELECT employment_status AS status, COUNT(*) AS n FROM employees WHERE organization_id=? GROUP BY employment_status").bind(org).all(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM offboarding_cases WHERE organization_id=? GROUP BY status").bind(org).all(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM signature_requests WHERE organization_id=? GROUP BY status").bind(org).all(),
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done FROM onboarding_tasks WHERE organization_id=?").bind(org).first(),
    env.DB.prepare("SELECT COALESCE(SUM((julianday(COALESCE(ended_at, ?)) - julianday(started_at)) * 24 * 60 - break_minutes), 0) AS minutes FROM time_entries WHERE organization_id=? AND started_at>=?").bind(new Date().toISOString(), org, weekAgo).first(),
    env.DB.prepare("SELECT stage, COUNT(*) AS n FROM applicants WHERE organization_id=? GROUP BY stage").bind(org).all(),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(sent_count),0) AS sent FROM communications WHERE organization_id=? AND created_at>=?").bind(org, weekAgo).first()
  ]);
  const map = r => Object.fromEntries((r.results || []).map(x => [x.status ?? x.stage, x.n]));
  return respond({
    employees: map(status),
    offboarding: map(offboarding),
    signatures: map(signatures),
    onboarding: { total: onboarding.total || 0, done: onboarding.done || 0 },
    hoursLast7Days: Math.round((hours.minutes || 0) / 6) / 10,
    applicants: map(applicants),
    communicationsLast7Days: { messages: comms.n || 0, emailsSent: comms.sent || 0 }
  });
}
