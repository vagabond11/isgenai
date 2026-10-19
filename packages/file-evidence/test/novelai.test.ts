import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSavedPrompt } from "../src/index.js";
import { plainPng, withPngText } from "./fixtures.js";

const v3 = { prompt: "1girl, lighthouse at dusk, watercolor", uc: "lowres, bad hands", steps: 28, scale: 5, seed: 1234567,
  sampler: "k_euler_ancestral", noise_schedule: "karras", width: 832, height: 1216 };
const v4 = { ...v3, v4_prompt: { caption: { base_caption: v3.prompt, char_captions: [] }, use_coords: false },
  v4_negative_prompt: { caption: { base_caption: v3.uc, char_captions: [] } } };

const png = plainPng();
const file = (record: object, software = "NovelAI") => withPngText(withPngText(png, "Software", software), "Comment", JSON.stringify(record));

test("NovelAI V3 and V4 Comment records", () => {
  for (const record of [v3, v4]) {
    const result = extractSavedPrompt(file(record));
    assert.equal(result?.format, "novelai");
    assert.equal(result?.prompt, v3.prompt);
    assert.equal(result?.negative_prompt, v3.uc);
    assert.deepEqual(result?.settings, { seed: "1234567", steps: 28, sampler: "k_euler_ancestral", scheduler: "karras", cfg_scale: 5, width: 832, height: 1216 });
  }
});

test("Comment records from other software or ambiguous records are not read", () => {
  // A Comment record alone, or from other software, is never read as a NovelAI prompt.
  assert.equal(extractSavedPrompt(withPngText(png, "Comment", JSON.stringify(v3))), undefined);
  assert.equal(extractSavedPrompt(file(v3, "Photoshop")), undefined);
  // Character captions mean several prompts; conflicting V3/V4 text is ambiguous.
  assert.equal(extractSavedPrompt(file({ ...v4, v4_prompt: { caption: { base_caption: v3.prompt, char_captions: [{ char_caption: "boy" }] } } })), undefined);
  assert.equal(extractSavedPrompt(file({ ...v4, prompt: "something else" })), undefined);
  assert.equal(extractSavedPrompt(file({ ...v3, prompt: "" })), undefined);
  assert.equal(extractSavedPrompt(withPngText(png, "Software", "NovelAI")), undefined);
});
