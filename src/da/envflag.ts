/**
 * Boolean environment flags. Claude Desktop extensions (.mcpb) pass `true`/`false`
 * from their settings, hand-written configs usually pass `1`/`0` — accept both.
 * Unset or empty → `fallback`; anything else that is not truthy → false.
 */
export function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}
