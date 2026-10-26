// Deep Artisan fork (20.09.2026): telemetry stub. The upstream file sends tool names, outcomes
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
