import { onRequestGet as listCases, onRequestPost as createCase } from "../../offboarding/index.js";
import { sanitizeBffResponse } from "../../../_shared/bff.js";

export async function onRequestGet(context) { return sanitizeBffResponse(await listCases(context)); }
export async function onRequestPost(context) { return sanitizeBffResponse(await createCase(context)); }
