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
// Generated from contracts/auth-flow-v1.json. Do not edit.
export type AuthFlowInput = {
  encrypted_payload: string;
  service_consent?: true;
  privacy_consent?: true;
  handoff_id?: string;
};
// Generated from contracts/auth-session-v1.json. Do not edit.
export type AuthSessionInput = {
  flow_id: string;
  issuer: string;
  client_id: string;
  subject: string;
  email: string;
  email_verified: true;
  session_hash: string;
  encrypted_payload: string;
  registration_consents?: Record<string, unknown>;
};
