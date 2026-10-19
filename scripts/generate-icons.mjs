// Generates app icons from the official Sogasho brand kit (brand/logo/icons).
// Run with: npm run icons
//  - src/app/favicon.ico            16/32/48 px, PNG-in-ICO
//  - public/brand/icons/so-icon-maskable-512.png   logo on white with the
//    maskable safe zone (brand rule: logo only on white or black, never stretched)
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const iconDir = path.join(root, "brand", "logo", "icons");

async function buildIco(sizes) {
  const images = await Promise.all(
    sizes.map((size) => readFile(path.join(iconDir, `so-icon-${size}.png`)))
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + 16 * images.length;
  images.forEach((data, i) => {
    const size = sizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  });
  return Buffer.concat([header, ...entries, ...images]);
}

async function buildMaskable() {
  const canvas = 512;
  const logo = 340; // stays inside the 80% maskable safe circle
  const mark = await sharp(path.join(iconDir, "so-icon-512.png"))
    .resize(logo, logo, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer();
  return sharp({
    create: { width: canvas, height: canvas, channels: 4, background: "#FFFFFF" },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

await writeFile(path.join(root, "src", "app", "favicon.ico"), await buildIco([16, 32, 48]));
await writeFile(
  path.join(root, "public", "brand", "icons", "so-icon-maskable-512.png"),
  await buildMaskable()
);
console.log("Icons generated: src/app/favicon.ico, public/brand/icons/so-icon-maskable-512.png");
