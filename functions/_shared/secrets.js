// Read a secret that may be a plain Pages/Workers secret (string) or a Cloudflare
// Secrets Store binding (object with an async get()). Secrets Store bindings are
// available to Workers; Pages projects use plain encrypted secrets.
export async function secret(env, name) {
  const value = env?.[name];
  if (value && typeof value === "object" && typeof value.get === "function") {
    try { return await value.get(); } catch { return undefined; }
  }
  return value ?? undefined;
}
