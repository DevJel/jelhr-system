import { respond } from "../../_shared/http.js";
import { authenticate, HR_READ } from "../../_shared/auth.js";
import { requireFeature } from "../../_shared/features.js";
import { STAGE_LABELS } from "../../_shared/recruitment.js";

// Recruitment dashboard: pipeline counts, open jobs, upcoming interviews, recent applications, per-job funnel.
export async function onRequestGet(context) {
  const user = await authenticate(context, HR_READ);
  requireFeature(user, "recruitment");
  const { env } = context;
  const org = user.organization_id;
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString();
  const [stages, jobs, upcoming, recent, perJob, last30, sources] = await Promise.all([
    env.DB.prepare("SELECT stage, COUNT(*) AS n FROM applicants WHERE organization_id=? GROUP BY stage").bind(org).all(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM jobs WHERE organization_id=? GROUP BY status").bind(org).all(),
    env.DB.prepare("SELECT i.id, i.scheduled_at, i.mode, i.interviewer, a.id AS applicant_id, a.first_name || ' ' || a.last_name AS applicant_name, a.position FROM interviews i JOIN applicants a ON a.id=i.applicant_id WHERE i.organization_id=? AND i.status='scheduled' AND i.scheduled_at>=? ORDER BY i.scheduled_at LIMIT 6").bind(org, new Date(Date.now() - 3600000).toISOString()).all(),
    env.DB.prepare("SELECT a.id, a.first_name || ' ' || a.last_name AS name, a.position, a.stage, a.created_at, a.source FROM applicants a WHERE a.organization_id=? ORDER BY a.created_at DESC LIMIT 8").bind(org).all(),
    env.DB.prepare("SELECT j.id, j.title, j.status, SUM(a.stage='applied') AS applied, SUM(a.stage='screening') AS screening, SUM(a.stage='interview') AS interview, SUM(a.stage='offer') AS offer, SUM(a.stage='hired') AS hired, SUM(a.stage='rejected') AS rejected, COUNT(a.id) AS total FROM jobs j LEFT JOIN applicants a ON a.job_id=j.id WHERE j.organization_id=? GROUP BY j.id ORDER BY j.status='open' DESC, total DESC LIMIT 12").bind(org).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM applicants WHERE organization_id=? AND created_at>=?").bind(org, monthAgo).first(),
    env.DB.prepare("SELECT COALESCE(source,'Unknown') AS source, COUNT(*) AS n FROM applicants WHERE organization_id=? GROUP BY source ORDER BY n DESC LIMIT 6").bind(org).all()
  ]);
  const s = Object.fromEntries((stages.results || []).map(r => [r.stage, r.n]));
  return respond({
    pipeline: { submitted: s.applied || 0, pending: (s.screening || 0) + (s.offer || 0), interviewed: s.interview || 0, rejected: (s.rejected || 0) + (s.withdrawn || 0), onboarded: s.hired || 0, offer: s.offer || 0, screening: s.screening || 0 },
    stages: s, stageLabels: STAGE_LABELS,
    jobs: Object.fromEntries((jobs.results || []).map(r => [r.status, r.n])),
    applicationsLast30Days: last30.n || 0,
    upcomingInterviews: upcoming.results || [], recentApplications: recent.results || [], perJob: perJob.results || [], sources: sources.results || []
  });
}
