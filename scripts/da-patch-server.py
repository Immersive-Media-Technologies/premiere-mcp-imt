#!/usr/bin/env python3
# Deep Artisan (20.09): one-off patch of src/server.ts — categorize modules, factor
# invokeTool, register the pr_catalog/pr_do facade. Kept for re-applying after an
# upstream merge; idempotent (checks its markers).
import re, sys, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
p = 'src/server.ts'; s = open(p).read()
if 'buildFacade' in s:
    print('already patched'); sys.exit(0)

s = s.replace('''import { getTelemetry, type Telemetry } from "./telemetry.js";''',
'''import { getTelemetry, type Telemetry } from "./telemetry.js";
// Deep Artisan (20.09): pr_catalog/pr_do facade over the catalog (PR_MCP_FACADE=1)
import { buildFacade, categorize, facadeEnabled } from "./da/facade.js";''', 1)

cats = {
 'getDiscoveryTools':'discovery','getProjectTools':'project','getMediaTools':'media','getSequenceTools':'sequence',
 'getTimelineTools':'timeline','getEffectsTools':'effects','getTransitionsTools':'transitions','getAudioTools':'audio',
 'getTextTools':'text','getMogrtAuthoringTools':'mogrt','getMogrtStudioTools':'mogrt','getRenderHandoffTools':'after_effects',
 'getMarkerTools':'markers','getTrackTools':'tracks','getPlayheadTools':'playhead','getMetadataTools':'metadata',
 'getExportTools':'export','getMediaAnalysisTools':'media_analysis','getInterchangeAnalysisTools':'interchange',
 'getAdvancedTools':'advanced','getKeyframeTools':'keyframes','getScriptingTools':'scripting','getInspectionTools':'inspection',
 'getSelectionTools':'selection','getClipboardTools':'clipboard','getSourceMonitorTools':'source_monitor',
 'getTrackTargetingTools':'track_targeting','getUtilityTools':'utility','getWorkspaceTools':'workspace','getCaptionTools':'captions',
 'getPlaybackTools':'playback','getProjectManagerTools':'project_manager','getEditPlanTools':'edit_plans','getSpotWorkflowTools':'workflows',
 'getAvSettingsTools':'av_settings','getRecoveryTools':'recovery','getProjectIntakeTools':'intake','getDialogueAnalysisTools':'dialogue',
 'getWorkflowRecipeTools':'workflows','getTimelineQaTools':'timeline_qa','getCrossAppWorkflowTools':'workflows','getSpeakerLayoutTools':'workflows',
 'getRhythmPlanTools':'edit_plans','getShortsIntelligenceTools':'shorts','getCaptionAuthoringTools':'captions','getReactionShortsTools':'shorts',
 'getTranscriptWordEditTools':'transcript','getPlatformDeliveryTools':'delivery','getEditorRequestTools':'workflows','getReviewPlanTools':'edit_plans',
 'getProjectContextTools':'context','getEditorialContextPackTools':'context','getFilmEditorialTools':'edit_plans','getEditorialPlanTools':'edit_plans',
 'getCompetitorGapTools':'advanced','getMediaWatchTools':'media',
}
n = 0
for fn, cat in cats.items():
    pat = re.compile(r'\.\.\.' + fn + r'\(([^()]*(?:\([^()]*\))?[^()]*)\)')
    s, k = pat.subn(lambda m: f'...categorize("{cat}", {fn}({m.group(1)}))', s)
    n += k
s = s.replace('...(uxpBridge ? getUxpTools(uxpBridge) : {}),', '...(uxpBridge ? categorize("uxp", getUxpTools(uxpBridge)) : {}),')
a = '''  Object.assign(
    tools,
    getHealthTools(bridgeOptions, capabilities, () => tools, {
      telemetry,
      uxpBridge,
      toolPacks,
    }),
  );'''
b = '''  Object.assign(
    tools,
    categorize("health", getHealthTools(bridgeOptions, capabilities, () => tools, {
      telemetry,
      uxpBridge,
      toolPacks,
    })),
  );'''
assert a in s; s = s.replace(a, b)
print('categorized', n)

a = '''  // Register each tool with the MCP server
  let authorityWithheld = 0;
  let packWithheld = 0;
  for (const [name, tool] of Object.entries(toolModules)) {'''
start = s.index('''      async (args: unknown) => {
        const startedAt = Date.now();''')
end = s.index('''    );
  }

  if (authorityWithheld > 0) {''')
body = s[start:end]
# body = "      async (args: unknown) => {\n ... \n      },\n"
inner = body[len('      async (args: unknown) => {\n'):]
inner = inner[:inner.rstrip().rfind('},')]  # drop closing "},"
b = '''  // Deep Artisan: the result formatting is shared by the per-tool registration and the
  // pr_do facade, so both return identical structuredContent / image blocks / isError.
  const invokeTool = async (
    name: string,
    guardedHandler: (args: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>,
    args: unknown,
  ) => {
''' + inner + '''  };

  if (facadeEnabled()) {
    // Only permitted tools are reachable through pr_do; tool packs do not apply — the
    // facade IS the context optimisation.
    const permitted: Record<string, (typeof toolModules)[string]> = {};
    for (const [name, tool] of Object.entries(toolModules)) {
      if (isToolPermitted(name, capabilities)) permitted[name] = tool;
    }
    const guarded = new Map<string, ReturnType<typeof guardToolHandler>>();
    const invoke = (name: string, args: Record<string, unknown>) => {
      let h = guarded.get(name);
      if (!h) {
        h = guardToolHandler(name, permitted[name].handler, capabilities);
        guarded.set(name, h);
      }
      return invokeTool(name, h, args);
    };
    for (const spec of buildFacade(permitted, invoke)) {
      server.registerTool(
        spec.name,
        {
          description: spec.description,
          inputSchema: jsonSchemaToInputSchema(spec.parameters),
        },
        async (args: unknown) => spec.run((args ?? {}) as Record<string, unknown>),
      );
    }
    debugLog(`Facade: ${Object.keys(permitted).length} operations behind pr_catalog/pr_do`);
  }

  // Register each tool with the MCP server
  let authorityWithheld = 0;
  let packWithheld = 0;
  for (const [name, tool] of facadeEnabled() ? [] : Object.entries(toolModules)) {'''
assert a in s
s = s[:start] + '      async (args: unknown) => invokeTool(name, guardedHandler, args),\n' + s[end:]
s = s.replace(a, b, 1)
open(p, 'w').write(s); print('ok')
