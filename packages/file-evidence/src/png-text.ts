import { inflateSync } from "node:zlib";
import { exifUserComments } from "./exif.js";
import { extractSavedRecords, comfyGenerationGraph, invokeGenerationRecord, type SavedPrompt } from "./record-parsers.js";

const MAX_METADATA = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// PNG CRCs prevent corrupt text chunks from being presented as saved instructions.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Read selected PNG text chunks (tEXt, zTXt, iTXt). Any CRC, structure or size failure returns an empty map. */
export function readPngText(buffer: Buffer, keys = ["parameters", "prompt", "invokeai_metadata", "Comment", "Software"], strictUtf8 = false): Map<string, string> {
  const entries = new Map<string, string>();
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
      buffer.toString("ascii", 12, 16) !== "IHDR" || buffer.readUInt32BE(8) !== 13) return entries;
  let remaining = MAX_METADATA;
  let count = 0;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) return new Map();
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (type === "IEND") return length === 0 ? entries : new Map();
    if (["tEXt", "zTXt", "iTXt"].includes(type)) {
      if (++count > 64 || length > MAX_METADATA || remaining <= 0) return new Map();
      if (crc32(buffer.subarray(offset + 4, end)) !== buffer.readUInt32BE(end)) return new Map();
      const chunk = buffer.subarray(offset + 8, end);
      const separator = chunk.indexOf(0);
      if (separator < 1 || separator > 79) return new Map();
      const key = chunk.toString("latin1", 0, separator);
      // Ignore unrelated text; never guess from generic comments or image descriptions.
      if (keys.includes(key)) {
        let payload = chunk.subarray(separator + 1);
        let compressed = false;
        if (type === "zTXt") {
          if (payload[0] !== 0) return new Map();
          payload = payload.subarray(1);
          compressed = true;
        } else if (type === "iTXt") {
          if (payload.length < 4 || ![0, 1].includes(payload[0]) || payload[1] !== 0) return new Map();
          compressed = payload[0] === 1;
          const languageEnd = payload.indexOf(0, 2);
          const translatedEnd = languageEnd >= 0 ? payload.indexOf(0, languageEnd + 1) : -1;
          if (translatedEnd < 0) return new Map();
          payload = payload.subarray(translatedEnd + 1);
        }
        try {
          const bytes = compressed ? inflateSync(payload, { maxOutputLength: remaining }) : payload;
          remaining -= bytes.length;
          if (remaining < 0 || entries.has(key)) return new Map();
          entries.set(key, strictUtf8 ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : bytes.toString("utf8"));
        } catch { return new Map(); }
      }
    }
    offset = end + 4;
  }
  return new Map(); // Truncated PNG: do not trust a partial record.
}

/** Inert ComfyUI records; separate from identifying a single saved prompt. */
export function savedWorkflowText(buffer: Buffer) {
  return readPngText(buffer, ["workflow", "prompt"], true);
}

/** Return the single saved generation record in a PNG (plus optional EXIF), or undefined when absent or ambiguous. */
export function extractSavedPrompt(buffer: Buffer, exif?: Buffer): SavedPrompt | undefined {
  return extractSavedRecords(readPngText(buffer), exifUserComments(exif));
}

// Some workflows use multiple prompts, reference images or several stages.
// Their saved generation graph is still useful even without one recoverable prompt.
export function hasSavedGenerationWorkflow(buffer: Buffer) {
  const entries = readPngText(buffer);
  const graph = entries.get("prompt");
  const invoke = entries.get("invokeai_metadata");
  return Boolean((graph && comfyGenerationGraph(graph)) || (invoke && invokeGenerationRecord(invoke)));
}
