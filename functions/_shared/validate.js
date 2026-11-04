// Small input validators. All throw HttpError(400) with a user-facing message.
import { HttpError } from "./http.js";

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function text(value, field, { max = 200, min = 0, required = false } = {}) {
  const v = value === undefined || value === null ? "" : String(value).trim();
  if (required && !v) throw new HttpError(400, `${field} is required`);
  if (v.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`);
  if (v.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  return v;
}

export function optionalText(value, field, max = 200) {
  if (value === undefined) return undefined;
  const v = text(value, field, { max });
  return v === "" ? null : v;
}

export function email(value, field = "Email") {
  const v = text(value, field, { max: 254, required: true }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(400, `${field} is not a valid email address`);
  return v;
}

export function date(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const v = String(value);
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v + "T00:00:00Z"))) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  return v;
}

export function oneOf(value, allowed, field, { required = true } = {}) {
  if ((value === undefined || value === null || value === "") && !required) return null;
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(", ")}`);
  return value;
}

export function int(value, field, { min = 0, max = 1e9, fallback } = {}) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${field} is required`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`);
  return n;
}

export function id(value, field = "id") {
  const v = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new HttpError(400, `${field} is invalid`);
  return v;
}

export function timezone(value) {
  const tz = String(value || "");
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { throw new HttpError(400, "Timezone is not recognised"); }
  if (!tz || tz.length > 64) throw new HttpError(400, "Timezone is not recognised");
  return tz;
}
