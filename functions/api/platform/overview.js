import { respond } from "../../_shared/http.js";
import { requireSuperAdmin, superCreds } from "../../_shared/platform.js";
import { emailStatus } from "../../_shared/email.js";
import { aiStatus } from "../../_shared/ai.js";

// Super admin dashboard: platform-wide totals, health of each tenant and configuration status.
export async function onRequestGet(context) {
  await requireSuperAdmin(context);
  const { env } = context;
  const now = new Date().toISOString(), d30 = new Date(Date.now() - 30 * 864e5).toISOString(), d1 = new Date(Date.now() - 864e5).toISOString();
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const [orgs, users, emps, sessions, apps, ai, mail, sigs, perOrg, audit] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM organizations GROUP BY status").all(),
    q("SELECT COUNT(*) AS n, SUM(status='invited') AS invited FROM users"),
    q("SELECT COUNT(*) AS n FROM employees WHERE employment_status<>'terminated'"),
    q("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at>? AND last_seen_at>?", now, d1),
    q("SELECT COUNT(*) AS n FROM applicants WHERE created_at>=?", d30),
    q("SELECT COUNT(*) AS n FROM ai_usage WHERE created_at>=?", d30),
    q("SELECT COALESCE(SUM(sent_count),0) AS n FROM communications WHERE created_at>=?", d30),
    q("SELECT COUNT(*) AS n FROM signature_requests WHERE signed_at>=?", d30),
    env.DB.prepare(`SELECT o.id, o.name, o.slug, o.status, o.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.organization_id=o.id) AS users,
        (SELECT COUNT(*) FROM employees e WHERE e.organization_id=o.id AND e.employment_status<>'terminated') AS employees,
        (SELECT COUNT(*) FROM jobs j WHERE j.organization_id=o.id AND j.status='open') AS open_jobs,
        (SELECT COUNT(*) FROM ai_usage a WHERE a.organization_id=o.id AND a.created_at>=?) AS ai_30d,
        (SELECT MAX(s.last_seen_at) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.organization_id=o.id) AS last_active
      FROM organizations o ORDER BY o.created_at DESC LIMIT 50`).bind(d30).all(),
    env.DB.prepare("SELECT actor_email, action, organization_id, created_at FROM platform_audit ORDER BY created_at DESC LIMIT 12").all()
  ]);
  const creds = await superCreds(env);
  return respond({
    organizations: Object.fromEntries((orgs.results || []).map(r => [r.status, r.n])),
    totals: { users: users.n || 0, invited: users.invited || 0, employees: emps.n || 0, activeSessions24h: sessions.n || 0, applications30d: apps.n || 0, aiRequests30d: ai.n || 0, emails30d: mail.n || 0, signatures30d: sigs.n || 0 },
    perOrg: perOrg.results || [], audit: audit.results || [],
    config: {
      jwt: Boolean(env.JELHR_JWT_SECRET?.length >= 32), superAdminTotp: Boolean(creds.totp), encryptionKey: Boolean(env.JELHR_ENCRYPTION_KEY),
      email: emailStatus(env), ai: aiStatus(env), files: env.FILES ? "r2" : "d1", vectorize: Boolean(env.VECTORIZE), turnstile: Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY)
    }
  });
}
