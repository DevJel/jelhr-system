export async function onRequestGet({ env }) {
  let database = "unavailable";
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    database = "connected";
  } catch {
    return Response.json({ service: "JelHR System", status: "degraded", database }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
  return Response.json({
    service: "JelHR System",
    status: "ok",
    database,
    mode: "interactive-demo",
    timestamp: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}
