import { z } from "zod";

/** Device identity labels allow normal Unicode, never controls or bidi directives. */
export const DeviceLabelV1Schema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\p{Cc}\p{Bidi_Control}]+$/u);
