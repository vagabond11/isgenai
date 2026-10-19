import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSavedPrompt, hasSavedGenerationWorkflow, readPngText, savedWorkflowText } from "../src/index.js";
import { parameters, plainPng, userCommentExif, withPngText } from "./fixtures.js";

const png = plainPng();
const savedPng = withPngText(png, "parameters", parameters);

const graph = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "A blue sailboat" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "bad anatomy, blur" } },
  "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "example.safetensors" } },
  "4": { class_type: "KSampler", inputs: { positive: ["1", 0], negative: ["2", 0], model: ["3", 0], seed: 7, steps: 25, cfg: 6.5, sampler_name: "euler", scheduler: "normal", denoise: 1 } },
  "5": { class_type: "VAEDecode", inputs: { samples: ["4", 0] } },
  "6": { class_type: "SaveImage", inputs: { images: ["5", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "Unused instruction" } },
};

test("AUTOMATIC1111 parameters in tEXt, zTXt and iTXt", () => {
  for (const type of ["tEXt", "zTXt", "iTXt"]) {
    const result = extractSavedPrompt(withPngText(png, "parameters", parameters, type, true));
    assert.equal(result?.format, "automatic1111");
    assert.equal(result?.prompt, "A red kite over a quiet beach, soft evening light");
    assert.equal(result?.negative_prompt, "blur, text");
    assert.equal(result?.recorded_model, "beach-model-v1");
    assert.deepEqual(result?.settings, { seed: "42", steps: 20, sampler: "Euler", cfg_scale: 7 });
  }
});

test("ComfyUI prompt graph follows the saved image path only", () => {
  const result = extractSavedPrompt(withPngText(png, "prompt", JSON.stringify(graph)));
  assert.equal(result?.format, "comfyui");
  assert.equal(result?.prompt, "A blue sailboat");
  assert.equal(result?.negative_prompt, "bad anatomy, blur");
  assert.equal(result?.recorded_model, "example.safetensors");
  assert.equal(result?.settings?.steps, 25);
  assert.equal(hasSavedGenerationWorkflow(withPngText(png, "prompt", JSON.stringify(graph))), true);
});

test("cyclic, generic or conflicting records are rejected", () => {
  const cyclic = structuredClone(graph);
  cyclic["4"].inputs.positive = ["4", 0];
  assert.equal(extractSavedPrompt(withPngText(png, "prompt", JSON.stringify(cyclic))), undefined);
  assert.equal(extractSavedPrompt(withPngText(png, "prompt", '{"prompt":"invented generic key"}')), undefined);
  // An AUTOMATIC1111 record and a different ComfyUI record cannot establish one instruction.
  assert.equal(extractSavedPrompt(withPngText(savedPng, "prompt", JSON.stringify(graph))), undefined);
});

test("oversized, corrupt and truncated files are rejected", () => {
  assert.equal(extractSavedPrompt(withPngText(png, "parameters", "x".repeat(2 * 1024 * 1024), "zTXt")), undefined);
  const corrupt = Buffer.from(savedPng);
  corrupt[corrupt.length - 13] ^= 1; // flips a CRC byte of the text chunk
  assert.equal(extractSavedPrompt(corrupt), undefined);
  assert.equal(readPngText(corrupt).size, 0);
  assert.equal(extractSavedPrompt(savedPng.subarray(0, savedPng.length - 12)), undefined);
  assert.equal(extractSavedPrompt(png), undefined);
  assert.equal(extractSavedPrompt(Buffer.from("not an image")), undefined);
});

test("InvokeAI metadata", () => {
  const record = { app_version: "5.4.2", generation_mode: "sdxl_txt2img", positive_prompt: "A lighthouse in fog",
    negative_prompt: "blurry", steps: 30, width: 1024, height: 1024, seed: 99, cfg_scale: 5, model: { name: "sdxl-base" } };
  const result = extractSavedPrompt(withPngText(png, "invokeai_metadata", JSON.stringify(record)));
  assert.equal(result?.format, "invokeai");
  assert.equal(result?.prompt, "A lighthouse in fog");
  assert.equal(result?.negative_prompt, "blurry");
  assert.equal(result?.recorded_model, "sdxl-base");
  assert.equal(hasSavedGenerationWorkflow(withPngText(png, "invokeai_metadata", JSON.stringify(record))), true);
  // A different SDXL style prompt means two instructions: no single prompt is returned.
  assert.equal(extractSavedPrompt(withPngText(png, "invokeai_metadata", JSON.stringify({ ...record, positive_style_prompt: "other" }))), undefined);
  // A product-name mention without generation parameters is not a record.
  assert.equal(extractSavedPrompt(withPngText(png, "invokeai_metadata", JSON.stringify({ app_version: "5.4.2", positive_prompt: "x" }))), undefined);
});

test("EXIF UserComment with AUTOMATIC1111 infotext", () => {
  for (const [encoding, little] of [["utf16be", false], ["utf16le", true], ["ascii", false]] as const) {
    const result = extractSavedPrompt(png, userCommentExif(parameters, encoding, little));
    assert.equal(result?.prompt, "A red kite over a quiet beach, soft evening light");
  }
});

test("ComfyUI workflow text is readable without a single prompt", () => {
  const workflow = withPngText(withPngText(png, "workflow", '{"nodes":[]}'), "prompt", JSON.stringify(graph));
  const entries = savedWorkflowText(workflow);
  assert.equal(entries.get("workflow"), '{"nodes":[]}');
  assert.ok(entries.get("prompt")?.includes("KSampler"));
});
