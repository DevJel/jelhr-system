import { onRequestGet as getEmployees, onRequestPost as createEmployee } from "../../employees/index.js";
import { sanitizeBffResponse } from "../../../_shared/bff.js";

export async function onRequestGet(context) { return sanitizeBffResponse(await getEmployees(context)); }
export async function onRequestPost(context) { return sanitizeBffResponse(await createEmployee(context)); }
