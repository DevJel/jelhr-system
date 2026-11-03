const json = (data, status = 200) => new Response(JSON.stringify(data), {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      let database = "unavailable";
      try { await env.DB.prepare("SELECT 1 AS ok").first(); database = "connected"; } catch {}
      return json({ service:"JelHR System API", status:database==="connected"?"ok":"degraded", database, mode:"foundation", timestamp:new Date().toISOString() });
    }
    if (url.pathname.startsWith("/api/")) return json({error:"Not implemented",message:"This endpoint is reserved for the authenticated HR API. No employee records are exposed by the public demo."},404);
    return env.ASSETS.fetch(request);
  }
};