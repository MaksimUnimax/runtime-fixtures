// Generated from contracts/foundation-probe-v1.json. Do not edit.
export type FoundationProbeInput = {
  probe_id: string;
  kind: "foundation-v1";
};
// Generated from contracts/lead-intake-v1.json. Do not edit.
export type LeadIntakeInput = {
  request_id: string;
  email: string;
  service_consent: true;
  marketing_consent?: boolean;
  attribution?: Record<string, unknown>;
};
// Generated from contracts/lead-confirm-v1.json. Do not edit.
export type LeadConfirmInput = {
  lead_id: string;
  token: string;
};
