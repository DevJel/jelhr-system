import { requireFeature } from "../../../_shared/features.js";
import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { authenticate, auditStatement, HR } from "../../../_shared/auth.js";
import { loadCase } from "./index.js";
import * as v from "../../../_shared/validate.js";

const ASSET_STATUSES = ["assigned", "returned", "lost", "written_off"];

async function openCase(context, user) {
  const c = await loadCase(context, user);
  if (["completed", "cancelled"].includes(c.status)) throw new HttpError(409, "This case is closed");
  return c;
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "offboarding");
  const { env, request } = context;
  const c = await openCase(context, user);
  const b = await readJson(request, 4096);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO employee_assets(id,organization_id,employee_id,case_id,asset_type,asset_tag,description,status,recorded_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(id, user.organization_id, c.employee_id, c.id, v.text(b.assetType, "Asset type", { required: true, max: 60 }), v.optionalText(b.assetTag, "Asset tag", 60) ?? null,
        v.optionalText(b.description, "Description", 300) ?? null, "assigned", user.id, new Date().toISOString()),
    await auditStatement(env, user, "offboarding.asset_added", "employee_asset", id, { caseId: c.id }, request)
  ]);
  return respond({ id }, 201);
}

export async function onRequestPatch(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "offboarding");
  const { env, request } = context;
  const c = await openCase(context, user);
  const b = await readJson(request, 4096);
  const asset = await env.DB.prepare("SELECT id FROM employee_assets WHERE id=? AND organization_id=? AND employee_id=?").bind(v.id(b.assetId, "assetId"), user.organization_id, c.employee_id).first();
  if (!asset) throw new HttpError(404, "Asset not found");
  const status = v.oneOf(b.status, ASSET_STATUSES, "Asset status");
  const note = b.conditionNote === undefined ? null : v.text(b.conditionNote, "Condition note", { max: 1000 });
  if (["lost", "written_off"].includes(status) && !note && b.conditionNote !== undefined) throw new HttpError(400, "Add a note explaining the loss or write-off");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE employee_assets SET status=?, condition_note=COALESCE(?, condition_note), returned_at=CASE WHEN ?='returned' THEN ? ELSE NULL END, case_id=?, recorded_by=?, updated_at=? WHERE id=?")
      .bind(status, note, status, now, c.id, user.id, now, asset.id),
    await auditStatement(env, user, "offboarding.asset_updated", "employee_asset", asset.id, { status }, request)
  ]);
  return respond({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "offboarding");
  const { env, request } = context;
  const c = await openCase(context, user);
  const assetId = v.id(new URL(request.url).searchParams.get("assetId"), "assetId");
  const asset = await env.DB.prepare("SELECT id FROM employee_assets WHERE id=? AND organization_id=? AND case_id=?").bind(assetId, user.organization_id, c.id).first();
  if (!asset) throw new HttpError(404, "Asset not found");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM employee_assets WHERE id=?").bind(asset.id),
    await auditStatement(env, user, "offboarding.asset_removed", "employee_asset", asset.id, { caseId: c.id }, request)
  ]);
  return respond({ ok: true });
}
