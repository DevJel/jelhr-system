import { respond } from "../_shared/http.js";

// Catch-all so unknown API paths return JSON instead of the static 404 page.
export async function onRequest() {
  return respond({ error: "Not found" }, 404);
}
