// Read only EXIF UserComment, never generic descriptions or arbitrary binary text.
// AUTOMATIC1111 stores JPEG/WebP settings here using piexif's UTF-16BE encoding.
export function exifUserComments(exif: Buffer | undefined): string[] {
  if (!exif || exif.length > 1024 * 1024) return [];
  const tiff = exif.subarray(exif.subarray(0, 6).equals(Buffer.from("Exif\0\0")) ? 6 : 0);
  if (tiff.length < 8) return [];
  const order = tiff.toString("ascii", 0, 2);
  if (order !== "II" && order !== "MM") return [];
  const u16 = (at: number) => order === "II" ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at);
  const u32 = (at: number) => order === "II" ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at);
  if (u16(2) !== 42) return [];
  try {
    function field(offset: number, tag: number): number | undefined {
      if (offset < 8 || offset + 2 > tiff.length) return;
      const count = u16(offset);
      if (count > 512 || offset + 2 + count * 12 + 4 > tiff.length) return;
      let found: number | undefined;
      for (let i = 0; i < count; i++) {
        const at = offset + 2 + i * 12;
        if (u16(at) !== tag) continue;
        if (found !== undefined) return; // Duplicate tags are ambiguous.
        found = at;
      }
      return found;
    }
    const pointer = field(u32(4), 0x8769);
    if (pointer === undefined || u16(pointer + 2) !== 4 || u32(pointer + 4) !== 1) return [];
    const comment = field(u32(pointer + 8), 0x9286);
    if (comment === undefined || ![1, 7].includes(u16(comment + 2))) return [];
    const size = u32(comment + 4), start = u32(comment + 8);
    if (size <= 8 || size > 128 * 1024 || start < 8 || start + size > tiff.length) return [];
    const bytes = tiff.subarray(start, start + size);
    const prefix = bytes.subarray(0, 8);
    const body = bytes.subarray(8);
    if (prefix.equals(Buffer.from("ASCII\0\0\0"))) {
      if (body.some(byte => byte > 127)) return [];
      return [body.toString("ascii").replace(/\0+$/, "")];
    }
    if (!prefix.equals(Buffer.from("UNICODE\0")) || body.length % 2) return [];
    const bom = body.readUInt16BE(0);
    const encodings = bom === 0xfeff ? ["utf-16be"] : bom === 0xfffe ? ["utf-16le"] : ["utf-16be", "utf-16le"];
    return [...new Set(encodings.flatMap(encoding => {
      try { return [new TextDecoder(encoding, { fatal: true }).decode(body).replace(/\0+$/, "")]; }
      catch { return []; } // A wrong byte-order candidate must not erase the valid decoding.
    }))];
  } catch { return []; }
}
