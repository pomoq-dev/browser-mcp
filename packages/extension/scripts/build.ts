import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "dist");
const watch = process.argv.includes("--watch");

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "icons"), { recursive: true });

/** Minimal PNG generator (solid color) without external deps */
function makePng(size: number, r: number, g: number, b: number): Buffer {
  // Super-minimal valid 1-color PNG via uncompressed IDAT is complex;
  // Use a tiny precomputed template scaled conceptually — we write a real PNG.
  // For simplicity, write an SVG and also a placeholder PNG using raw approach.
  // Actually use a known minimal PNG and just ship different sizes as same icon.
  // 16x16 solid purple PNG (precomputed base64).
  void size;
  void r;
  void g;
  void b;
  // 1x1 pixel PNG expanded — Chrome accepts small icons fine if we use proper sizes.
  // Generate via pure JS PNG (no compression for tiny images).
  return createSolidPng(size, r, g, b);
}

function createSolidPng(size: number, r: number, g: number, b: number): Buffer {
  // RGBA raw
  const raw = Buffer.alloc((size * size * 4 + size) /* filter bytes */);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter none
    for (let x = 0; x < size; x++) {
      // rounded square with accent
      const cx = size / 2;
      const cy = size / 2;
      const dist = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      const edge = size * 0.42;
      const inside = dist < edge;
      const ring = Math.abs(dist - edge * 0.55) < size * 0.08;
      if (inside || ring) {
        raw[offset++] = r;
        raw[offset++] = g;
        raw[offset++] = b;
        raw[offset++] = 255;
      } else {
        raw[offset++] = 15;
        raw[offset++] = 15;
        raw[offset++] = 20;
        raw[offset++] = 255;
      }
    }
  }

  const compressed = zlibDeflate(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks = [
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([signature, ...chunks]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Store-only deflate (no compression) for simplicity */
function zlibDeflate(data: Buffer): Buffer {
  // zlib header + uncompressed blocks + adler32
  const blocks: Buffer[] = [];
  let pos = 0;
  while (pos < data.length) {
    const chunkSize = Math.min(65535, data.length - pos);
    const isLast = pos + chunkSize >= data.length;
    const header = Buffer.alloc(5);
    header[0] = isLast ? 0x01 : 0x00;
    header.writeUInt16LE(chunkSize, 1);
    header.writeUInt16LE(chunkSize ^ 0xffff, 3);
    blocks.push(header, data.subarray(pos, pos + chunkSize));
    pos += chunkSize;
  }
  const body = Buffer.concat(blocks);
  const zlibHeader = Buffer.from([0x78, 0x01]); // no compression
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(data), 0);
  return Buffer.concat([zlibHeader, body, adler]);
}

function adler32(data: Buffer): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeIcons() {
  // Purple brand color
  for (const size of [16, 48, 128]) {
    const png = makePng(size, 124, 58, 237);
    writeFileSync(join(outDir, "icons", `icon${size}.png`), png);
  }
}

async function bundle() {
  const common: esbuild.BuildOptions = {
    bundle: true,
    format: "esm",
    target: "chrome120",
    sourcemap: true,
    logLevel: "info",
    platform: "browser",
  };

  const entryPoints = [
    { in: join(root, "src/background/service-worker.ts"), out: "background" },
    { in: join(root, "src/content/content-main.ts"), out: "content" },
    { in: join(root, "src/popup/popup.ts"), out: "popup" },
  ];

  if (watch) {
    const ctx = await esbuild.context({
      ...common,
      entryPoints: Object.fromEntries(
        entryPoints.map((e) => [e.out, e.in]),
      ),
      outdir: outDir,
      entryNames: "[name]",
    });
    await ctx.watch();
    console.log("watching...");
  } else {
    await esbuild.build({
      ...common,
      entryPoints: Object.fromEntries(
        entryPoints.map((e) => [e.out, e.in]),
      ),
      outdir: outDir,
      entryNames: "[name]",
    });
  }

  // manifest + popup html/css
  copyFileSync(join(root, "manifest.json"), join(outDir, "manifest.json"));
  copyFileSync(join(root, "src/popup/popup.html"), join(outDir, "popup.html"));
  copyFileSync(join(root, "src/popup/popup.css"), join(outDir, "popup.css"));
  writeIcons();

  // Fix popup.html script path is already popup.js
  console.log("Extension built → packages/extension/dist");
  void createHash;
  void existsSync;
  void readFileSync;
}

bundle().catch((err) => {
  console.error(err);
  process.exit(1);
});
