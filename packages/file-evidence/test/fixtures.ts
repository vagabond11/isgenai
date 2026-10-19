// Hand-built fixtures, independent of the library's decoder.
import { deflateSync } from "node:zlib";

const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A valid 20x20 solid-colour RGB PNG with no text chunks. */
export function plainPng(color: [number, number, number] = [0x18, 0x7b, 0xcd], size = 20) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2; // 8-bit truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, () => Buffer.from(color)))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

/** Insert a text chunk before IEND. */
export function withPngText(png: Buffer, key: string, value: string, type = "tEXt", compress = false) {
  const text = Buffer.from(value);
  const payload = type === "zTXt" ? Buffer.concat([Buffer.from([0]), deflateSync(text)])
    : type === "iTXt" ? Buffer.concat([Buffer.from([compress ? 1 : 0, 0, 0, 0]), compress ? deflateSync(text) : text]) : text;
  return Buffer.concat([png.subarray(0, png.length - 12), chunk(type, Buffer.concat([Buffer.from(`${key}\0`), payload])), png.subarray(-12)]);
}

export const parameters = "A red kite over a quiet beach, soft evening light\nNegative prompt: blur, text\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42, Model: beach-model-v1";

/** A minimal EXIF (TIFF) block holding only a UserComment, as AUTOMATIC1111 writes for JPEG/WebP. */
export function userCommentExif(value: string, encoding: "ascii" | "utf16be" | "utf16le" = "utf16be", littleEndian = false) {
  const text = encoding === "ascii" ? Buffer.from(value, "ascii") : Buffer.from(value, "utf16le");
  if (encoding === "utf16be") text.swap16();
  const payload = Buffer.concat([Buffer.from(encoding === "ascii" ? "ASCII\0\0\0" : "UNICODE\0"), text]);
  const tiff = Buffer.alloc(44 + payload.length);
  const u16 = (value: number, at: number) => littleEndian ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at);
  const u32 = (value: number, at: number) => littleEndian ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at);
  tiff.write(littleEndian ? "II" : "MM", 0); u16(42, 2); u32(8, 4);
  u16(1, 8); u16(0x8769, 10); u16(4, 12); u32(1, 14); u32(26, 18);
  u16(1, 26); u16(0x9286, 28); u16(7, 30); u32(payload.length, 32); u32(44, 36);
  payload.copy(tiff, 44);
  return Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
}
