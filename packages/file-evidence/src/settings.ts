export type SavedSettings = {
  seed?: string; steps?: number; sampler?: string; scheduler?: string;
  cfg_scale?: number; width?: number; height?: number; denoise?: number;
};
export const savedSettingKeys = ["seed", "steps", "sampler", "scheduler", "cfg_scale", "width", "height", "denoise"] as const;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 200 && !/[\0\r\n]/.test(value) ? value.trim() : undefined;
}
function number(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))) return;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}
function integer(value: unknown) {
  const result = number(value);
  return result !== undefined && Number.isSafeInteger(result) && result > 0 ? result : undefined;
}
function seed(value: unknown) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return;
  const string = typeof value === "number" ? String(value) : value;
  return typeof string === "string" && /^-?\d{1,20}$/.test(string) ? string : undefined;
}

/** Only explicitly stored values; never fill absent parameters with model defaults. */
export function readSavedSettings(values: Record<string, unknown>): SavedSettings | undefined {
  const denoise = number(values.denoise);
  const result: SavedSettings = {
    seed: seed(values.seed), steps: integer(values.steps), sampler: text(values.sampler), scheduler: text(values.scheduler),
    cfg_scale: number(values.cfg_scale), width: integer(values.width), height: integer(values.height),
    denoise: denoise !== undefined && denoise >= 0 && denoise <= 1 ? denoise : undefined,
  };
  for (const key of savedSettingKeys) if (result[key] === undefined) delete result[key];
  return Object.keys(result).length ? result : undefined;
}

/** Split comma-separated infotext without treating quoted commas as new fields. */
export function automatic1111Fields(value: string) {
  const fields = new Map<string, string[]>();
  let start = 0; let quoted = false;
  const parts: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (quoted && value[index] === "\\") { index++; continue; }
    if (value[index] === '"') quoted = !quoted;
    if (!quoted && value[index] === ",") { parts.push(value.slice(start, index)); start = index + 1; }
    if (parts.length > 256) return new Map<string, string[]>();
  }
  if (quoted) return fields;
  parts.push(value.slice(start));
  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon < 1) continue;
    const key = part.slice(0, colon).trim();
    let content = part.slice(colon + 1).trim();
    if (content.startsWith('"')) { try { content = JSON.parse(content); } catch { continue; } }
    if (typeof content !== "string") continue;
    fields.set(key, [...(fields.get(key) ?? []), content]);
  }
  return fields;
}

export function singleField(fields: Map<string, string[]>, key: string) {
  const values = fields.get(key);
  return values?.length === 1 ? values[0] : undefined;
}

export function mergeSavedSettings(records: Array<SavedSettings | undefined>): SavedSettings | undefined {
  const result: Record<string, unknown> = {};
  for (const key of savedSettingKeys) {
    const values = records.map(record => record?.[key]).filter(value => value !== undefined);
    if (values.length && new Set(values).size === 1) result[key] = values[0];
  }
  return readSavedSettings(result);
}
