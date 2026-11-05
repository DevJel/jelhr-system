import { onRequestGet as getCase, onRequestPatch as updateCase } from "../../offboarding/[id].js";
import { sanitizeBffResponse } from "../../../_shared/bff.js";

export async function onRequestGet(context) { return sanitizeBffResponse(await getCase(context)); }
export async function onRequestPatch(context) { return sanitizeBffResponse(await updateCase(context)); }
