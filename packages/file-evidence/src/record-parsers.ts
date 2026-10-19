import { automatic1111Fields, singleField, readSavedSettings, mergeSavedSettings, type SavedSettings } from "./settings.js";

const MAX_METADATA = 1024 * 1024;
export const MAX_PROMPT_LENGTH = 16_000;

export type SavedPrompt = {
  prompt: string;
  negative_prompt?: string;
  recorded_model?: string;
  settings?: SavedSettings;
  format: "automatic1111" | "comfyui" | "invokeai" | "novelai";
};

function validText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= MAX_PROMPT_LENGTH && !value.includes("\0");
}

export function parseAutomatic1111(value: string): SavedPrompt | undefined {
  if (value.length > MAX_METADATA) return;
  const settings = /(?:^|\n)Steps:\s*\d+,\s*Sampler:/m.exec(value);
  if (!settings || settings.index === 0) return;
  const body = value.slice(0, settings.index);
  const negativeAt = body.indexOf("\nNegative prompt:");
  const prompt = (negativeAt >= 0 ? body.slice(0, negativeAt) : body).trim();
  const negative = negativeAt >= 0 ? body.slice(negativeAt + "\nNegative prompt:".length).trim() : undefined;
  if (!validText(prompt)) return;
  const fields = automatic1111Fields(value.slice(settings.index).trim());
  const model = singleField(fields, "Model");
  const dimensions = /^(\d+)x(\d+)$/.exec(singleField(fields, "Size") ?? "");
  const savedSettings = readSavedSettings({ seed: singleField(fields, "Seed"), steps: singleField(fields, "Steps"),
    sampler: singleField(fields, "Sampler"), scheduler: singleField(fields, "Schedule type"),
    cfg_scale: singleField(fields, "CFG scale"), width: dimensions?.[1], height: dimensions?.[2], denoise: singleField(fields, "Denoising strength") });
  return {
    format: "automatic1111", prompt,
    ...(validText(negative) ? { negative_prompt: negative } : {}),
    ...(model && model.length <= 200 ? { recorded_model: model } : {}),
    ...(savedSettings ? { settings: savedSettings } : {}),
  };
}

type Node = { class_type?: string; inputs?: Record<string, unknown> };
export function comfyGenerationGraph(value: string) {
  let graph: Record<string, Node>;
  try { graph = JSON.parse(value); } catch { return; }
  if (!graph || typeof graph !== "object" || Array.isArray(graph) || Object.keys(graph).length > 1000) return;
  const nodeAt = (id: string): Node | undefined => {
    const node = Object.hasOwn(graph, id) ? graph[id] : undefined;
    return node && typeof node === "object" && !Array.isArray(node) ? node : undefined;
  };
  const linkId = (link: unknown) => Array.isArray(link) && link.length === 2 &&
    ["string", "number"].includes(typeof link[0]) && Number.isInteger(link[1]) ? String(link[0]) : undefined;
  const samplers = new Set<string>();
  const visited = new Set<string>();
  function walk(id: string, depth = 0) {
    if (depth > 32 || visited.has(id)) return;
    visited.add(id);
    const node = nodeAt(id);
    const sampler = ["KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"].includes(node?.class_type ?? "");
    if (sampler) samplers.add(id);
    // Follow the actual saved image/latent path, not unrelated nodes or fields.
    const fields = sampler ? ["latent_image"] : ({ SaveImage: ["images"], PreviewImage: ["images"],
      VAEDecode: ["samples"], VAEDecodeTiled: ["samples"], ImageScale: ["image"], ImageScaleBy: ["image"] } as Record<string, string[]>)[node?.class_type ?? ""] ?? [];
    for (const field of fields) {
      const input = node?.inputs?.[field];
      const linked = linkId(input);
      if (linked !== undefined && (input as unknown[])[1] === 0) walk(linked, depth + 1);
    }
  }
  const outputs = Object.keys(graph).filter((id) => ["SaveImage", "PreviewImage"].includes(nodeAt(id)?.class_type ?? ""));
  if (!outputs.length) return;
  outputs.forEach((id) => walk(id));
  if (!samplers.size) return;
  return { samplers, nodeAt, linkId };
}

function parseComfyUi(value: string): SavedPrompt | undefined {
  const graph = comfyGenerationGraph(value);
  if (!graph) return;
  const { samplers, nodeAt, linkId } = graph;
  if (samplers.size !== 1) return; // Multiple stages need reconstruction, not a guessed original.
  let sampler = nodeAt([...samplers][0]);
  const inputs = sampler?.inputs;
  const savedSettings = readSavedSettings({ seed: inputs?.seed ?? inputs?.noise_seed, steps: inputs?.steps,
    sampler: inputs?.sampler_name, scheduler: inputs?.scheduler, cfg_scale: inputs?.cfg, denoise: inputs?.denoise });
  if (sampler?.class_type === "SamplerCustomAdvanced") {
    const guiderId = linkId(sampler.inputs?.guider);
    const guider = guiderId !== undefined ? nodeAt(guiderId) : undefined;
    if (!guider || !["BasicGuider", "CFGGuider"].includes(guider.class_type ?? "")) return;
    sampler = { ...guider, inputs: { ...guider.inputs,
      positive: guider.class_type === "BasicGuider" ? guider.inputs?.conditioning : guider.inputs?.positive } };
  }
  function conditioningText(link: unknown, visited = new Set<string>()): string | undefined {
    const id = linkId(link);
    if (id === undefined || visited.has(id) || visited.size >= 16 || (link as unknown[])[1] !== 0) return;
    visited.add(id);
    const node = nodeAt(id);
    if (node?.class_type === "CLIPTextEncode" && validText(node.inputs?.text)) return node.inputs.text;
    if (node?.class_type === "CLIPTextEncodeFlux" && validText(node.inputs?.clip_l) &&
        validText(node.inputs?.t5xxl) && node.inputs.clip_l.trim() === node.inputs.t5xxl.trim()) return node.inputs.t5xxl;
    // FluxGuidance changes guidance strength, not the linked prompt text.
    if (node?.class_type === "FluxGuidance") return conditioningText(node.inputs?.conditioning, visited);
  }
  const positive = conditioningText(sampler?.inputs?.positive);
  if (!positive) return;
  const negative = conditioningText(sampler?.inputs?.negative);
  const modelId = linkId(sampler?.inputs?.model);
  const model = modelId !== undefined ? nodeAt(modelId) : undefined;
  const name = model?.class_type === "CheckpointLoaderSimple" ? model.inputs?.ckpt_name : undefined;
  return {
    format: "comfyui", prompt: positive.trim(),
    ...(negative ? { negative_prompt: negative.trim() } : {}),
    ...(typeof name === "string" && name.length <= 200 ? { recorded_model: name } : {}),
    ...(savedSettings ? { settings: savedSettings } : {}),
  };
}

// InvokeAI's named PNG record is distinct from arbitrary image comments.
// Require a complete generation-parameter subset, not a product-name mention.
export function invokeGenerationRecord(value: string): Record<string, unknown> | undefined {
  if (value.length > MAX_METADATA) return;
  let record: Record<string, unknown>;
  try { record = JSON.parse(value); } catch { return; }
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).length > 200) return;
  if (typeof record.app_version !== "string" || record.app_version.length > 80 ||
      !/^\d+\.\d+\.\d+[-+.\w]*$/.test(record.app_version)) return;
  const mode = record.generation_mode;
  if (typeof mode !== "string" || !/^(?:(?:sdxl|flux|flux2|sd3|cogview4|z_image|ernie_image|ideogram4|qwen_image|anima|krea2|wan)_)?(?:txt2img|img2img|inpaint|outpaint)$/.test(mode)) return;
  for (const field of ["steps", "width", "height"]) {
    const number = record[field];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) return;
  }
  if (typeof record.seed !== "number" || !Number.isSafeInteger(record.seed) || record.seed < 0) return;
  return record;
}

function parseInvokeAi(record: Record<string, unknown>): SavedPrompt | undefined {
  if (!validText(record.positive_prompt)) return;
  const prompt = record.positive_prompt.trim();
  const savedSettings = readSavedSettings(record);
  const negative = record.negative_prompt;
  if (negative !== undefined && negative !== null && negative !== "" && !validText(negative)) return;
  // SDXL can use two different instructions. Do not silently drop the style input.
  for (const [field, expected] of [["positive_style_prompt", prompt], ["negative_style_prompt", typeof negative === "string" ? negative.trim() : ""]]) {
    const style = record[field];
    if (style !== undefined && style !== null && style !== "" && (!validText(style) || style.trim() !== expected)) return;
  }
  const model = record.model;
  const name = model && typeof model === "object" && !Array.isArray(model) ? (model as Record<string, unknown>).name : undefined;
  return { format: "invokeai", prompt,
    ...(validText(negative) ? { negative_prompt: negative.trim() } : {}),
    ...(validText(name) && name.length <= 200 ? { recorded_model: name } : {}),
    ...(savedSettings ? { settings: savedSettings } : {}) };
}

// NovelAI writes Software "NovelAI" plus a JSON Comment record. V4 also stores the
// caption separately; character captions mean several prompts, so no single one.
export function parseNovelAi(comment: string, software: string | undefined): SavedPrompt | undefined {
  if (software?.trim() !== "NovelAI" || comment.length > MAX_METADATA) return;
  let record: Record<string, unknown>;
  try { record = JSON.parse(comment); } catch { return; }
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).length > 200) return;
  const caption = (value: unknown) => {
    const inner = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).caption : undefined;
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) return { present: false } as const;
    const fields = inner as Record<string, unknown>;
    const characters = fields.char_captions;
    if (characters !== undefined && (!Array.isArray(characters) || characters.length)) return { present: true, multiple: true } as const;
    return { present: true, multiple: false, text: validText(fields.base_caption) ? fields.base_caption.trim() : undefined } as const;
  };
  const positive = caption(record.v4_prompt), negative = caption(record.v4_negative_prompt);
  if (positive.present && positive.multiple) return;
  const legacy = validText(record.prompt) ? record.prompt.trim() : undefined;
  const v4 = positive.present ? positive.text : undefined;
  if (legacy && v4 && legacy !== v4) return;
  const prompt = v4 ?? legacy;
  if (!prompt) return;
  const legacyNegative = validText(record.uc) ? record.uc.trim() : undefined;
  const v4Negative = negative.present && !negative.multiple ? negative.text : undefined;
  if (legacyNegative && v4Negative && legacyNegative !== v4Negative) return;
  const negativeText = v4Negative ?? legacyNegative;
  const savedSettings = readSavedSettings({ seed: record.seed, steps: record.steps, sampler: record.sampler,
    scheduler: record.noise_schedule, cfg_scale: record.scale, width: record.width, height: record.height,
    denoise: typeof record.strength === "number" ? record.strength : undefined });
  return { format: "novelai", prompt,
    ...(negativeText ? { negative_prompt: negativeText } : {}),
    ...(savedSettings ? { settings: savedSettings } : {}) };
}

export function extractSavedRecords(entries: Map<string, string>, comments: string[] = []): SavedPrompt | undefined {
  const a1111 = entries.get("parameters");
  const comfy = entries.get("prompt");
  const first = a1111 ? parseAutomatic1111(a1111) : undefined;
  const second = comfy ? parseComfyUi(comfy) : undefined;
  const invoke = entries.get("invokeai_metadata");
  const record = invoke ? invokeGenerationRecord(invoke) : undefined;
  const third = record ? parseInvokeAi(record) : undefined;
  if (record && !third) return; // A partial/multi-prompt record cannot establish one saved instruction.
  const comment = entries.get("Comment");
  const fourth = comment ? parseNovelAi(comment, entries.get("Software")) : undefined;
  const candidates = [first, second, third, fourth, ...comments.map(parseAutomatic1111)]
    .filter((item): item is SavedPrompt => Boolean(item));
  // Conflicting sources or encodings cannot establish one saved instruction.
  if (new Set(candidates.map(item => JSON.stringify([item.prompt, item.negative_prompt, item.recorded_model]))).size > 1) return;
  const candidate = candidates[0];
  if (!candidate) return;
  const settings = mergeSavedSettings(candidates.map(item => item.settings));
  const prompt = { ...candidate };
  delete prompt.settings;
  return { ...prompt, ...(settings ? { settings } : {}) };
}
