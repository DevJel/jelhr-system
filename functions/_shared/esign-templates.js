// Built-in e-signature templates. Plain text only; placeholders use {{dot.path}}.
// These are neutral starting points, not legal advice. Have counsel review the wording
// for each jurisdiction before relying on it.
export const TEMPLATES = [
  {
    id: "separation-acknowledgement",
    title: "Separation acknowledgement",
    category: "offboarding",
    description: "Employee confirms the last working day and the separation process.",
    body: `Employee: {{employee.fullName}} ({{employee.number}})
Position: {{employee.jobTitle}}, {{employee.department}}
Organization: {{organization.name}}

I acknowledge that my employment with {{organization.name}} ends with a last working day of {{case.lastWorkingDay}}.

I understand that:
1. Access to company systems, accounts and premises will be removed at the effective time arranged by the company.
2. Final pay and any outstanding amounts will be handled under my contract, company policy and applicable law.
3. Company property in my possession must be returned on or before my last working day.

Signing this acknowledgement confirms that I have received and read this notice. It does not waive any right I have under my contract or the law.`
  },
  {
    id: "asset-return",
    title: "Company property return acknowledgement",
    category: "offboarding",
    description: "Employee confirms the company property returned at exit.",
    body: `Employee: {{employee.fullName}} ({{employee.number}})
Organization: {{organization.name}}
Date: {{today}}

I confirm that I have returned the following company property:
{{assets}}

I confirm that I have not kept copies of company confidential information on personal devices or accounts, except where the company has agreed in writing.`
  },
  {
    id: "confidentiality-reminder",
    title: "Continuing confidentiality obligations",
    category: "offboarding",
    description: "Reminder that confidentiality obligations continue after employment.",
    body: `Employee: {{employee.fullName}} ({{employee.number}})
Organization: {{organization.name}}

I acknowledge that the confidentiality obligations in my employment contract and company policies continue after my employment ends, to the extent the contract and applicable law provide.

I will not use or disclose confidential information of {{organization.name}}, its customers or its employees, except where the law permits or requires it.`
  },
  {
    id: "policy-acknowledgement",
    title: "Policy acknowledgement",
    category: "general",
    description: "Employee confirms they have read a company policy.",
    body: `Employee: {{employee.fullName}} ({{employee.number}})
Organization: {{organization.name}}
Date: {{today}}

I confirm that I have received, read and understood the policy described below, and that I may ask People Operations any questions about it.

Policy: [name and version of the policy]`
  },
  {
    id: "custom",
    title: "Custom document",
    category: "general",
    description: "Write your own document text.",
    body: ""
  }
];

export const templateById = id => TEMPLATES.find(t => t.id === id);

export function renderTemplate(body, data) {
  return String(body).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), data);
    return value == null || value === "" ? "[not provided]" : String(value);
  });
}

export const CONSENT_TEXT =
  "I agree to sign this document electronically. I understand that my electronic signature, together with the date, time and the document fingerprint shown, is intended to have the same effect as my handwritten signature, and that I may ask for a paper copy.";
