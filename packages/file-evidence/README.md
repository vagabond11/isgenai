# @isgenai/file-evidence

Read saved AI image generation records from PNG text chunks: AUTOMATIC1111 `parameters`, ComfyUI `prompt` and `workflow` graphs, InvokeAI `invokeai_metadata` and NovelAI `Comment` records. Every text chunk is CRC-checked and size-limited. No network access and no runtime dependencies.

Part of [isGenAI](https://isgenai.com). See the [repository README](../../README.md) for usage, supported formats and limits.

```ts
import { extractSavedPrompt } from "@isgenai/file-evidence";
const record = extractSavedPrompt(pngBuffer); // SavedPrompt | undefined
```

It reads what a file says about itself. It does not analyse pixels, and the absence of a record says nothing about whether an image is AI-generated.

```sh
npm install && npm test && npm run build
```

MIT License. Copyright (c) 2026 isGenAI.
