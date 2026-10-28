// IMT fork: telemetry stub. The upstream file sends tool names, outcomes
// and durations to PostHog (posthog-node); this server sends nothing anywhere. The interface
// is kept intact so that server.ts / tools/health.ts merge cleanly with upstream.

export type TelemetryProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface Telemetry {
  readonly enabled: boolean;
  capture(event: string, properties?: TelemetryProperties): void;
  shutdown(): Promise<void>;
}

/** Error names are mutable and may contain host data; never transmit them raw. */
export function telemetryErrorType(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  return ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError"].includes(error.name)
    ? error.name
    : "Error";
}

/**
 * Activation telemetry is deliberately narrower than operational tool
 * telemetry. Emit it only after the read-only connection check has confirmed
 * the selected bridge, an open project, and an active sequence. This avoids
 * treating attempts or incomplete diagnostics as activation, and never sends
 * prompts, paths, project/media names, arguments, results, tokens, IP
 * addresses, or person profiles.
 */
export function captureActivationEvent(
  _telemetry: Telemetry,
  _properties: { backend: "cep" | "uxp" },
): void {
  // no-op
}

const disabledTelemetry: Telemetry = {
  enabled: false,
  capture: () => {},
  shutdown: async () => {},
};

export function getTelemetry(): Telemetry {
  return disabledTelemetry;
}
