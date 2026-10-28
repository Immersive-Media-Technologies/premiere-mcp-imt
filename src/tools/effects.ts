import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

// Warp Stabilizer "Method" list, in Premiere's item order (index = value).
const STABILIZER_METHODS = ["Position", "Position, Scale, Rotation", "Perspective", "Subspace Warp"] as const;

export function getEffectsTools(bridgeOptions: BridgeOptions) {
  return {
    apply_effect: {
      description: "Apply a video effect to a clip. Uses QE DOM catalog lookup, with an exact-name QE probe when Premiere's catalog enumeration is empty.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to apply the effect to",
          },
          effect_name: {
            type: "string",
            description: "Name of the effect (e.g., 'Gaussian Blur', 'Lumetri Color')",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          // Find the effect in QE
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeTrack = result.trackType === "video" 
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          
          if (!qeTrack) return __error("QE track not found");
          
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("QE clip not found");
          
          // Premiere 26 can expose direct by-name lookup while returning an
          // empty QE catalog. Probe the requested name (English or in the UI
          // language) before consulting the catalog.
          var found = __qeLookup("video", effectName);
          var lookupSource = "qe.byName";
          if (!found) {
            var effectCatalog = __getQeEffectCatalog("video");
            if (effectCatalog.ok) {
              var effects = effectCatalog.effects;
              for (var i = 0; i < effects.numItems; i++) {
                if (__nameIn(effects[i].name, effectName)) {
                  found = { item: effects[i], name: String(effects[i].name), requested: effectName };
                  lookupSource = "qe.catalog";
                  break;
                }
              }
            }
            if (!found) return __error("Effect not found: " + effectName + ". Names follow Premiere's UI language; English names are translated automatically." + (effectCatalog.ok ? "" : " " + effectCatalog.error));
          }
          var componentsBefore = result.clip.components.numItems;
          var addResult = qeClip.addVideoEffect(found.item);
          var refreshed = __findClip("${escapeForExtendScript(args.node_id)}");
          var componentsAfter = refreshed ? refreshed.clip.components.numItems : componentsBefore;
          if (addResult === false || componentsAfter <= componentsBefore) return __error("Premiere did not add '" + found.name + "' to the clip");
          return __result({ applied: true, effect: found.name, requested: effectName, lookupSource: lookupSource, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_audio_effect: {
      description: "Apply an audio effect to a clip. Uses QE catalog lookup, with an exact-name QE probe when enumeration is empty.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Name of the audio effect",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeTrack = qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE audio track not found");
          
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("QE clip not found");
          
          var found = __qeLookup("audio", effectName);
          var lookupSource = "qe.byName";
          if (!found) {
            var effectCatalog = __getQeEffectCatalog("audio");
            if (effectCatalog.ok) {
              var effects = effectCatalog.effects;
              for (var i = 0; i < effects.numItems; i++) {
                if (__nameIn(effects[i].name, effectName)) {
                  found = { item: effects[i], name: String(effects[i].name), requested: effectName };
                  lookupSource = "qe.catalog";
                  break;
                }
              }
            }
            if (!found) return __error("Audio effect not found: " + effectName + ". Names follow Premiere's UI language; English names are translated automatically." + (effectCatalog.ok ? "" : " " + effectCatalog.error));
          }
          var componentsBefore = result.clip.components.numItems;
          var addResult = qeClip.addAudioEffect(found.item);
          var refreshed = __findClip("${escapeForExtendScript(args.node_id)}");
          var componentsAfter = refreshed ? refreshed.clip.components.numItems : componentsBefore;
          if (addResult === false || componentsAfter <= componentsBefore) return __error("Premiere did not add '" + found.name + "' to the clip");
          return __result({ applied: true, effect: found.name, requested: effectName, lookupSource: lookupSource });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_effect: {
      description: "Remove an effect from a clip by its index or name. Returns a capability error when the host cannot remove an individual component.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_index: {
            type: "number",
            minimum: 0,
            description: "Index of the effect to remove (0-based). Use get_clip_properties to see effects list.",
          },
          effect_name: {
            type: "string",
            description: "Name of the effect to remove (alternative to effect_index)",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; effect_index?: number; effect_name?: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          // Component.remove() is not present on every CEP Component object in
          // Premiere 26.x (notably Essential Sound's Amplify component). QE only
          // exposes an all-effects removal, which is not a safe fallback here.
          function removeComponent(component, effectName) {
            try {
              if (!component || typeof component.remove !== "function") {
                return {
                  removed: false,
                  error: "Premiere does not expose Component.remove() for '" + effectName + "'. The effect was not removed. No safe targeted QE fallback exists; remove it manually in Effect Controls."
                };
              }
              component.remove();
              return { removed: true };
            } catch (e) {
              return {
                removed: false,
                error: "Premiere could not remove '" + effectName + "': " + e.toString() + ". The effect may still be present; inspect Effect Controls."
              };
            }
          }

          ${args.effect_index !== undefined ? `
          if (${args.effect_index} < 0 || ${args.effect_index} >= clip.components.numItems) return __error("Effect index out of range");
          var component = clip.components[${args.effect_index}];
          var effectName = component.displayName;
          var removal = removeComponent(component, effectName);
          if (!removal.removed) return __error(removal.error);
          return __result({ removed: true, effect: effectName });
          ` : `
          var effectName = "${escapeForExtendScript(args.effect_name || "")}";
          var component = null;
          for (var i = clip.components.numItems - 1; i >= 0; i--) {
            if (__compIs(clip.components[i], effectName)) {
              component = clip.components[i];
              break;
            }
          }
          if (!component) return __error("Effect not found: " + effectName);
          var removal = removeComponent(component, effectName);
          if (!removal.removed) return __error(removal.error);
          return __result({ removed: true, effect: effectName });
          `}
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_effects: {
      description: "List available video effects in Premiere Pro. Uses the full QE catalog when exposed; otherwise returns a verified, explicitly partial set of common effects resolved by exact name.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var list = [];
          var effectCatalog = __getQeEffectCatalog("video");
          if (effectCatalog.ok) {
            var effects = effectCatalog.effects;
            for (var i = 0; i < effects.numItems; i++) {
              list.push({ name: effects[i].name, index: i, source: "qe.catalog" });
            }
            return __result(list);
          }

          // Keep this bounded and label every result as partial. It is a
          // usability fallback, not a claim that these are all installed
          // effects or that their localized display names are exhaustive.
          var commonNames = ["Transform", "Gaussian Blur", "Lumetri Color", "Crop", "Warp Stabilizer", "Tint", "Brightness & Contrast", "Ultra Key"];
          for (var probeIndex = 0; probeIndex < commonNames.length; probeIndex++) {
            var candidate = __qeLookup("video", commonNames[probeIndex]);
            if (candidate) list.push({ name: candidate.name, englishName: commonNames[probeIndex], index: null, source: "qe.byName.partial" });
          }
          if (list.length === 0) return __error(effectCatalog.error + " Direct lookup did not resolve any bounded fallback effects.");
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_audio_effects: {
      description: "List all available audio effects in Premiere Pro. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var effectCatalog = __getQeEffectCatalog("audio");
          var list = [];
          if (effectCatalog.ok) {
            var effects = effectCatalog.effects;
            for (var i = 0; i < effects.numItems; i++) {
              list.push({ name: effects[i].name, index: i, source: "qe.catalog" });
            }
            return __result(list);
          }
          // Bounded, explicitly partial fallback (see list_available_effects).
          var commonNames = ["Amplify", "Parametric Equalizer", "DeEsser", "DeHummer", "Hard Limiter", "Dynamics", "Studio Reverb", "Delay", "Multiband Compressor", "Pitch Shifter", "Highpass", "Lowpass", "Notch Filter", "Bass", "Treble", "Fill Left with Right", "Fill Right with Left", "Swap Channels", "Channel Volume"];
          for (var probeIndex = 0; probeIndex < commonNames.length; probeIndex++) {
            var candidate = __qeLookup("audio", commonNames[probeIndex]);
            if (candidate) list.push({ name: candidate.name, englishName: commonNames[probeIndex], index: null, source: "qe.byName.partial" });
          }
          if (list.length === 0) return __error(effectCatalog.error + " Direct lookup did not resolve any bounded fallback audio effects.");
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    color_correct: {
      description: "Apply basic color correction to a clip using Lumetri Color",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          exposure: { type: "number", description: "Exposure adjustment (-4.0 to 4.0)" },
          contrast: { type: "number", description: "Contrast adjustment (-100 to 100)" },
          highlights: { type: "number", description: "Highlights adjustment (-100 to 100)" },
          shadows: { type: "number", description: "Shadows adjustment (-100 to 100)" },
          whites: { type: "number", description: "Whites adjustment (-100 to 100)" },
          blacks: { type: "number", description: "Blacks adjustment (-100 to 100)" },
          temperature: { type: "number", description: "Color temperature adjustment" },
          tint: { type: "number", description: "Tint adjustment" },
          saturation: { type: "number", description: "Saturation (0-200, 100 = normal)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        exposure?: number;
        contrast?: number;
        highlights?: number;
        shadows?: number;
        whites?: number;
        blacks?: number;
        temperature?: number;
        tint?: number;
        saturation?: number;
      }) => {
        // Lumetri repeats display names across sub-sections (Basic Correction, Creative,
        // HSL Secondary, ...) and not every match is writable, so each setValue is
        // guarded and the first writable match per control wins.
        const controls: Array<{ key: string; label: string; value: number }> = (
          [
            { key: "exposure", label: "Exposure", value: args.exposure },
            { key: "contrast", label: "Contrast", value: args.contrast },
            { key: "highlights", label: "Highlights", value: args.highlights },
            { key: "shadows", label: "Shadows", value: args.shadows },
            { key: "whites", label: "Whites", value: args.whites },
            { key: "blacks", label: "Blacks", value: args.blacks },
            { key: "temperature", label: "Temperature", value: args.temperature },
            { key: "tint", label: "Tint", value: args.tint },
            { key: "saturation", label: "Saturation", value: args.saturation },
          ] as Array<{ key: string; label: string; value: number | undefined }>
        ).filter((c): c is { key: string; label: string; value: number } => c.value !== undefined);

        const setters = controls
          .map(
            (c) => `
              if (!taken.${c.key} && __nameIn(name, "${c.label}")) {
                try {
                  prop.setValue(${c.value}, true);
                  taken.${c.key} = true;
                  changes.${c.key} = ${c.value};
                } catch(e) {
                  errors.${c.key} = e.toString();
                }
              }`
          )
          .join("");

        // First apply Lumetri Color effect, then set its properties
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          // Apply Lumetri Color if not already present
          var clip = result.clip;
          var lumetriAdded = false;
          if (!__findComp(clip, "Lumetri Color")) {
            if (result.trackType !== "video") return __error("Lumetri Color needs a video clip");
            var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
            var qeClip = qeTrack ? __findQeClipByDomClip(qeTrack, clip) : null;
            if (!qeClip) return __error("QE clip not found");
            var lumetri = __qeLookup("video", "Lumetri Color");
            if (!lumetri) return __error("Lumetri Color is not available in this Premiere");
            qeClip.addVideoEffect(lumetri.item);
            var refreshed = __findClip("${escapeForExtendScript(args.node_id)}");
            if (refreshed) clip = refreshed.clip;
            if (!__findComp(clip, "Lumetri Color")) return __error("Premiere did not add Lumetri Color to the clip");
            lumetriAdded = true;
          }
          
          // A single unsettable property must not abort the script with "Invalid
          // parameter" and lose every other change, so each write is guarded.
          // The taken map is a separate set of flags rather than a truthiness check on
          // changes: 0 is a legitimate value (saturation 0 is a valid full desaturate),
          // and a falsy check would re-fire it on every later sub-section that repeats
          // the same display name.
          var changes = {};
          var errors = {};
          var taken = {};

          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (!__compIs(comp, "Lumetri Color")) continue;
            for (var p = 0; p < comp.properties.numItems; p++) {
              var prop = comp.properties[p];
              var name = prop.displayName;
              ${setters}
            }
            break;
          }

          var requested = ${JSON.stringify(controls.map((c) => c.key))};
          var missing = [];
          var applied = 0;
          for (var r = 0; r < requested.length; r++) {
            if (changes.hasOwnProperty(requested[r])) applied++;
            else if (!errors.hasOwnProperty(requested[r])) missing.push(requested[r]);
          }
          if (requested.length > 0 && applied === 0) {
            return __error("No Lumetri Color control was changed" + (missing.length ? " (not found: " + missing.join(", ") + ")" : "") + (lumetriAdded ? "; Lumetri Color was added to the clip" : ""));
          }
          return __result({ colorCorrected: applied > 0, lumetriAdded: lumetriAdded, clipName: clip.name, changes: changes, errors: errors, notFound: missing });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_lut: {
      description: "Apply a LUT file to a clip via Lumetri Color",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          lut_path: {
            type: "string",
            description: "Full path to the .cube or .3dl LUT file",
          },
        },
        required: ["node_id", "lut_path"],
      },
      handler: async (args: { node_id: string; lut_path: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          
          // Find or apply Lumetri Color
          var lumetriComp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (__compIs(clip.components[i], "Lumetri Color")) {
              lumetriComp = clip.components[i];
              break;
            }
          }
          
          var lumetriAdded = false;
          if (!lumetriComp) {
            if (result.trackType !== "video") return __error("Lumetri Color needs a video clip");
            var qeSeq = qe.project.getActiveSequence();
            var qeTrack = qeSeq ? qeSeq.getVideoTrackAt(result.trackIndex) : null;
            var qeClip = qeTrack ? __findQeClipByDomClip(qeTrack, clip) : null;
            if (!qeClip) return __error("QE clip not found");
            var lumetri = __qeLookup("video", "Lumetri Color");
            if (!lumetri) return __error("Lumetri Color is not available in this Premiere");
            qeClip.addVideoEffect(lumetri.item);
            var refreshed = __findClip("${escapeForExtendScript(args.node_id)}");
            if (refreshed) clip = refreshed.clip;
            lumetriComp = __findComp(clip, "Lumetri Color");
            lumetriAdded = !!lumetriComp;
          }
          
          if (!lumetriComp) return __error("Could not apply Lumetri Color effect");
          
          // Input LUT is a list parameter; Premiere 26 rejects a file path for it
          // ("Illegal Parameter type"), so a LUT file only counts as applied when
          // the parameter reads back the path.
          var lutPath = "${escapeForExtendScript(args.lut_path)}";
          var lutProp = __findProp(lumetriComp, "Input LUT");
          if (!lutProp) return __error("Lumetri Color has no Input LUT parameter on this Premiere" + (lumetriAdded ? "; Lumetri Color was added to the clip" : ""));
          var setError = "";
          try { lutProp.setValue(lutPath, true); } catch (eSet) { setError = eSet.toString(); }
          var readback = null;
          try { readback = lutProp.getValue(); } catch (eRead) {}
          if (setError || String(readback) !== lutPath) {
            return __error("Premiere's scripting API cannot load a LUT file into Lumetri Color's Input LUT" + (setError ? " (" + setError + ")" : "") + ". " + (lumetriAdded ? "Lumetri Color was added to the clip. " : "") + "Choose the file in Lumetri Color > Basic Correction > Input LUT > Browse.");
          }
          return __result({ lutApplied: true, lumetriAdded: lumetriAdded, clipName: clip.name, lutPath: lutPath });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    inspect_stabilizer_status: {
      description: "Read Warp Stabilizer presence, exposed status properties, and conservative analysis state for one clip or every video clip in the active sequence. Read-only: unknown or localized host values remain unknown rather than being reported as solved.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          node_id: { type: "string", description: "Optional clip node ID. Omit to inspect every video clip in the active sequence." },
        },
      },
      handler: async (args: { node_id?: string }) => {
        const nodeId = args.node_id ? escapeForExtendScript(args.node_id) : "";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var requestedNodeId = "${nodeId}";
          var clips = [];
          if (requestedNodeId) {
            var found = __findClip(requestedNodeId);
            if (!found || found.trackType !== "video") return __error("Video clip not found: " + requestedNodeId);
            clips.push({ clip: found.clip, trackIndex: found.trackIndex, clipIndex: found.clipIndex });
          } else {
            for (var trackIndex = 0; trackIndex < seq.videoTracks.numTracks; trackIndex++) {
              var track = seq.videoTracks[trackIndex];
              for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex++) {
                clips.push({ clip: track.clips[clipIndex], trackIndex: trackIndex, clipIndex: clipIndex });
              }
            }
          }
          function primitiveValue(value) {
            if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
            return String(value);
          }
          var results = [];
          for (var clipCursor = 0; clipCursor < clips.length; clipCursor++) {
            var entry = clips[clipCursor];
            var stabilizer = null;
            for (var componentIndex = 0; componentIndex < entry.clip.components.numItems; componentIndex++) {
              var component = entry.clip.components[componentIndex];
              var componentName = String(component.displayName || "");
              var matchName = String(component.matchName || "");
              var identity = (componentName + " " + matchName).toLowerCase();
              if (__compIs(component, "Warp Stabilizer") || identity.indexOf("warp stabilizer") >= 0 || identity.indexOf("warp stabiliser") >= 0) {
                stabilizer = component;
                break;
              }
            }
            if (!stabilizer) continue;
            var properties = [];
            var stateEvidence = [];
            for (var propertyIndex = 0; propertyIndex < stabilizer.properties.numItems; propertyIndex++) {
              var property = stabilizer.properties[propertyIndex];
              var propertyName = String(property.displayName || "");
              var propertyValue = null;
              var readable = true;
              try { propertyValue = primitiveValue(property.getValue()); } catch (readError) { readable = false; }
              properties.push({ name: propertyName, value: propertyValue, readable: readable });
              var stateName = propertyName.toLowerCase();
              if (__nameIn(propertyName, "Result") || stateName.indexOf("status") >= 0 || stateName.indexOf("result") >= 0 || stateName.indexOf("analy") >= 0) {
                stateEvidence.push({ name: propertyName, value: propertyValue, readable: readable });
              }
            }
            var analysisStatus = "unknown";
            for (var evidenceIndex = 0; evidenceIndex < stateEvidence.length; evidenceIndex++) {
              var text = String(stateEvidence[evidenceIndex].value).toLowerCase();
              if (text.indexOf("not analy") >= 0 || text.indexOf("unanaly") >= 0) analysisStatus = "not_analyzed";
              else if (text.indexOf("analyzing") >= 0 || text.indexOf("analysing") >= 0 || text.indexOf("progress") >= 0) analysisStatus = "analyzing";
              else if (text.indexOf("stabilized") >= 0 || text.indexOf("stabilised") >= 0 || text.indexOf("complete") >= 0 || text.indexOf("solved") >= 0) analysisStatus = "analyzed";
            }
            results.push({
              nodeId: String(entry.clip.nodeId), clipName: String(entry.clip.name),
              trackIndex: entry.trackIndex, clipIndex: entry.clipIndex,
              componentName: String(stabilizer.displayName || "Warp Stabilizer"),
              analysisStatus: analysisStatus, stateEvidence: stateEvidence, properties: properties
            });
          }
          return __result({
            inspectedClipCount: clips.length,
            stabilizerClipCount: results.length,
            clips: results,
            verificationScope: "Read-only host property inspection. analysisStatus is conservative and remains unknown when Premiere exposes numeric, localized, absent, or unreadable state values; unknown is not proof of a completed solve."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    stabilize_clip: {
      description: "Apply the Warp Stabilizer effect to a clip for video stabilization. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to stabilize",
          },
          smoothness: {
            type: "number",
            description: "Stabilization smoothness percentage (default: 50). Higher = smoother but more cropping.",
          },
          method: {
            type: "string",
            enum: ["Subspace Warp", "Position", "Position, Scale, Rotation", "Perspective"],
            description: "Stabilization method (default: 'Subspace Warp')",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; smoothness?: number; method?: string }) => {
        if (args.method !== undefined && !STABILIZER_METHODS.includes(args.method as (typeof STABILIZER_METHODS)[number])) {
          return { success: false, error: `method must be one of: ${STABILIZER_METHODS.join(", ")}` };
        }
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : null;
          if (!qeTrack) return __error("Warp Stabilizer can only be applied to video clips");
          
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("QE clip not found");
          
          // Find and apply Warp Stabilizer (English or UI-language name)
          var stabilizer = __qeLookup("video", "Warp Stabilizer");
          if (!stabilizer) return __error("Warp Stabilizer effect not found");
          var componentsBefore = result.clip.components.numItems;
          qeClip.addVideoEffect(stabilizer.item);
          var refreshed = __findClip("${escapeForExtendScript(args.node_id)}");
          var clip = refreshed ? refreshed.clip : result.clip;
          if (clip.components.numItems <= componentsBefore) return __error("Premiere did not add Warp Stabilizer to the clip");
          
          // Set properties if specified
          var changes = { stabilized: true };
          ${args.smoothness !== undefined || args.method !== undefined ? `
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (__compIs(comp, "Warp Stabilizer")) {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                ${args.smoothness !== undefined ? `
                if (__propIs(prop, "Smoothness", comp)) {
                  prop.setValue(${args.smoothness}, true);
                  changes.smoothness = ${args.smoothness};
                }` : ""}
                ${args.method !== undefined ? `
                if (__propIs(prop, "Method", comp)) {
                  // a list parameter: Premiere takes the item index, not its label
                  prop.setValue(${STABILIZER_METHODS.indexOf(args.method as (typeof STABILIZER_METHODS)[number])}, true);
                  changes.method = "${escapeForExtendScript(args.method)}";
                }` : ""}
              }
              break;
            }
          }
          ` : ""}
          
          return __result({ clipName: clip.name, info: "Warp Stabilizer applied. Analysis will begin automatically.", changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
