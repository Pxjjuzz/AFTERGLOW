import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const png = await readFile(path.join(root, 'assets', 'icon.png'));

// Windows Vista and later accept a PNG payload inside an ICO container.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(1, 4); // one image

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // 256 px
entry.writeUInt8(0, 1); // 256 px
entry.writeUInt8(0, 2); // no palette
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

const output = Buffer.concat([header, entry, png]);
await writeFile(path.join(root, 'assets', 'icon.ico'), output);
console.log(`Wrote assets/icon.ico (${output.length} bytes)`);
