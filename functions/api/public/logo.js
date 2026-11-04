import { readFile } from "../../_shared/files.js";
import { careersOrg } from "../../_shared/public.js";

export async function onRequestGet({ request, env }) {
  try {
    const { org, settings } = await careersOrg(env, request);
    const f = settings.branding?.logoFileId ? await env.DB.prepare("SELECT * FROM stored_files WHERE id=? AND organization_id=?").bind(settings.branding.logoFileId, org.id).first() : null;
    if (!f || !/^image\//.test(f.content_type)) return new Response("Not found", { status: 404 });
    return new Response(await readFile(env, f), { headers: { "Content-Type": f.content_type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
