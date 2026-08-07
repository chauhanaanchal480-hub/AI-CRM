import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const compressibleExtension = /\.(?:css|html|js|json|svg|txt|xml)$/i;

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(location));
    else if (compressibleExtension.test(entry.name) && !/\.(?:br|gz)$/i.test(entry.name)) files.push(location);
  }
  return files;
}

for (const file of await collect(outputDirectory)) {
  if ((await stat(file)).size === 0) continue;
  await pipeline(
    createReadStream(file),
    createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
    createWriteStream(`${file}.br`, { mode: 0o644 }),
  );
  await pipeline(
    createReadStream(file),
    createGzip({ level: 9 }),
    createWriteStream(`${file}.gz`, { mode: 0o644 }),
  );
}
