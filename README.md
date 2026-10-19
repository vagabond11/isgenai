# isGenAI: browser extension and file-evidence reader

Open-source parts of [isGenAI](https://isgenai.com), a free tool that shows the evidence behind "is this AI?" questions: Content Credentials (C2PA), platform AI labels and the generation records that image tools save inside files.

This repository contains:

| Folder | What it is |
| --- | --- |
| [`extension/`](extension) | The [isGenAI browser extension](https://isgenai.com/browser-extension) (Manifest V3) for Chrome, Edge and Opera. |
| [`packages/file-evidence/`](packages/file-evidence) | `@isgenai/file-evidence`, a small TypeScript library that reads saved generation records from PNG files. No network, no runtime dependencies. |

## Install

### Browser extension

- **Chrome:** install from the [Chrome Web Store](https://chromewebstore.google.com/detail/pgcnmndbnkkgifmopgnefnlebklnfbbb).
- **Edge:** open the same Chrome Web Store page, choose **Allow extensions from other stores**, then **Add to Chrome**.
- **Opera:** install Opera's Chrome-extension add-on, then use the Chrome Web Store page. Opera has no side panel, so the extension opens the same panel in a small window instead.
- **From source:** open `chrome://extensions` (or `edge://extensions`, `opera://extensions`), turn on Developer mode, click **Load unpacked** and select the [`extension/`](extension) folder.

More details: https://isgenai.com/browser-extension

### Library

The library is not yet published to npm. Build it from this repository:

```sh
git clone https://github.com/vagabond11/isgenai.git
cd isgenai/packages/file-evidence
npm install
npm test
npm run build   # emits dist/ (ES modules + type declarations)
```

Node.js 18 or later.

## Usage

### Extension

- Right-click any image and choose **Check image with isGenAI**, or click the toolbar icon and **Check this page**.
- The result panel shows what was found (Content Credentials, saved records, labels) and what that evidence can and cannot tell you.
- Checks are private by default. A public report link is created only if you turn on **Create a public report link**.
- The **AI-label feed filter** dims, hides or labels posts that carry a platform's own AI label (for example "Made with AI") on supported social sites. It reads the labels already on the page; it does not analyse pixels.

### Library

```ts
import { readFile } from "node:fs/promises";
import { extractSavedPrompt, hasSavedGenerationWorkflow, readPngText } from "@isgenai/file-evidence";

const png = await readFile("image.png");

const record = extractSavedPrompt(png);
if (record) {
  console.log(record.format);          // "automatic1111" | "comfyui" | "invokeai" | "novelai"
  console.log(record.prompt);          // the saved positive prompt
  console.log(record.negative_prompt); // when stored
  console.log(record.recorded_model);  // when stored
  console.log(record.settings);        // { seed, steps, sampler, scheduler, cfg_scale, width, height, denoise } when stored
} else if (hasSavedGenerationWorkflow(png)) {
  console.log("A generation workflow is saved, but it holds more than one prompt or stage.");
} else {
  console.log("No supported saved record.");
}

// Raw access to selected text chunks (CRC-checked, size-limited):
const chunks = readPngText(png, ["parameters", "prompt", "workflow"]);
```

For JPEG or WebP files written by AUTOMATIC1111, pass the EXIF block (for example from your own EXIF extractor) as the second argument: `extractSavedPrompt(png, exifBuffer)`. Only the EXIF UserComment field is read.

Supported records:

| Generator | Where it is stored | What is read |
| --- | --- | --- |
| AUTOMATIC1111 (and compatible forks) | PNG `parameters` text chunk, or EXIF UserComment | Prompt, negative prompt, model name, seed, steps, sampler, scheduler, CFG, size, denoise |
| ComfyUI | PNG `prompt` (API graph) and `workflow` chunks | Prompt and negative prompt from the graph path that leads to the saved image, checkpoint name, sampler settings |
| InvokeAI | PNG `invokeai_metadata` chunk | Positive and negative prompt, model name, settings |
| NovelAI | PNG `Comment` chunk with `Software: NovelAI` | V3 and V4 prompt and negative prompt, settings |

All three PNG text chunk types (`tEXt`, `zTXt`, `iTXt`) are supported, and every chunk's CRC is checked.

## Honest limits

- **It reads records; it does not score pixels.** The library and the extension's file reading look for what a file says about itself. They do not run a classifier on image content, and they cannot tell you that an image without a record is human-made.
- **Records are easy to remove and easy to fake.** Most platforms strip metadata on upload, and anyone can write a text chunk by hand. A saved record is evidence of what a tool wrote, not proof of origin.
- **Ambiguity returns nothing.** If two sources disagree, a workflow has several prompts or stages, a chunk is corrupt or truncated, or a record is oversized, the library returns `undefined` rather than guessing.
- **The extension uses the isGenAI service.** Image and page checks send the image or page address to https://isgenai.com for analysis (Content Credentials, labels and other evidence). The feed filter runs locally on the page. See https://isgenai.com/privacy.

## Data and research

isGenAI publishes what it measures. The [platform metadata survival study](https://isgenai.com/research/platform-metadata-survival) tests which provenance records (C2PA manifests, EXIF, PNG text chunks) survive upload to major platforms, which is why a missing record usually says more about the platform than about the image.

## Links

- Website: https://isgenai.com
- Browser extension: https://isgenai.com/browser-extension
- Research: https://isgenai.com/research/platform-metadata-survival
- Security reports: https://isgenai.com/contact

## License

[MIT](LICENSE). Copyright (c) 2026 isGenAI.
