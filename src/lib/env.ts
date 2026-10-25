/**
 * The /api/tools endpoints proxy Qloo with our key, so they are open in
 * development and only in production when explicitly enabled.
 */
export function toolPlaygroundEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ITSGIVING_TOOL_PLAYGROUND === "1";
}
