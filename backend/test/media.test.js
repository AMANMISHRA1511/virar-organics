import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import express from 'express';
import sharp from 'sharp';
import {
  prepareImage, persistPreparedUploads, removeStoredUpload, readStoredImage,
  createMediaRouter, imageETag, MAX_UPLOAD_BYTES,
} from '../src/media.js';

const pixels = (width = 24, height = 16) => sharp({
  create: { width, height, channels: 3, background: { r: 40, g: 130, b: 65 } },
});
const prepared = async () => prepareImage({ buffer: await pixels().png().toBuffer(), originalname: 'fixture.png' });
async function temporary(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'virar-media-test-'));
  try { await fn(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function publicServer(records, directory, fn) {
  const lookedUp = [];
  const app = express();
  app.use('/uploads', createMediaRouter({ directory, findUpload: async filename => {
    lookedUp.push(filename); return records.get(filename);
  } }));
  app.use((req, res) => res.type('html').send('<html>SPA fallback</html>'));
  app.use((error, req, res, next) => res.status(500).json({ error: 'Unexpected media error' }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`, lookedUp); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('JPEG, PNG and WebP inputs decode to actual small WebP buffers and unchanged public URL shape', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const image = await prepareImage({ buffer: await pixels()[format]().toBuffer(), originalname: `fixture.${format}` });
    const metadata = await sharp(image.content).metadata();
    assert.equal(metadata.format, 'webp');
    assert.deepEqual([metadata.width, metadata.height], [24, 16]);
    assert.equal(image.size_bytes, image.content.length);
    assert.equal(image.mime_type, 'image/webp');
    assert.match(image.filename, /^[0-9a-f-]{36}\.webp$/);
    assert.equal(image.url, `/uploads/${image.filename}`);
    assert.equal(image.original_name, `fixture.${format}`);
  }
});

test('Image conversion rotates EXIF orientation, bounds dimensions and strips original metadata', async () => {
  const buffer = await pixels(2400, 1200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const image = await prepareImage({ buffer, originalname: 'oriented.jpg' });
  const metadata = await sharp(image.content).metadata();
  assert.deepEqual([image.width, image.height], [900, 1800]);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
});

test('Invalid, unsupported, truncated and oversized image input is rejected before persistence', async () => {
  const png = await pixels().png().toBuffer();
  for (const buffer of [Buffer.alloc(0), Buffer.from('not an image'), png.subarray(0, 30),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')]) {
    await assert.rejects(prepareImage({ buffer, originalname: 'pretend.png' }), { status: 422 });
  }
  await assert.rejects(prepareImage({ buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1) }), { status: 413 });
});

test('Animated WebP is rejected even though a single-frame WebP is accepted', async () => {
  const raw = Buffer.alloc(16 * 32 * 3);
  raw.fill(255, 0, 16 * 16 * 3);
  const buffer = await sharp(raw, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(buffer).metadata()).pages, 2);
  await assert.rejects(prepareImage({ buffer, originalname: 'animation.webp' }), { status: 422 });
});

test('Database mode passes exact WebP bytes to the transactional callback without creating files', () => temporary(async directory => {
  const blocker = path.join(directory, 'not-a-directory');
  await fs.writeFile(blocker, 'preserve');
  const image = await prepared();
  const result = await persistPreparedUploads([image], {
    storage: 'database', directory: path.join(blocker, 'cannot-write-here'),
    save: async assets => {
      assert.equal(assets.length, 1);
      assert.equal(assets[0].storage, 'database');
      assert.deepEqual(assets[0].content, image.content);
      assert.equal(assets[0].size_bytes, image.content.length);
      return 'committed';
    },
  });
  assert.equal(result, 'committed');
  assert.deepEqual(await fs.readdir(directory), ['not-a-directory']);
}));

test('A database transaction failure propagates without a filesystem side effect', () => temporary(async directory => {
  const failure = new Error('Synthetic transaction rollback');
  await assert.rejects(persistPreparedUploads([await prepared()], {
    storage: 'database', directory,
    save: async () => { throw failure; },
  }), error => error === failure);
  assert.deepEqual(await fs.readdir(directory), []);
}));

test('Filesystem remains the default and stores bytes outside SQL content', () => temporary(async directory => {
  const image = await prepared();
  let record;
  await persistPreparedUploads([image], { directory, save: async assets => { [record] = assets; } });
  assert.equal(record.storage, 'filesystem');
  assert.equal(record.content, null);
  assert.deepEqual(await fs.readFile(path.join(directory, image.filename)), image.content);
  assert.deepEqual(await readStoredImage(record, directory), image.content);
}));

test('Filesystem SQL rollback removes all new files and preserves unrelated existing files', () => temporary(async directory => {
  const images = [await prepared(), await prepared()];
  await fs.writeFile(path.join(directory, 'keep.txt'), 'original');
  await assert.rejects(persistPreparedUploads(images, {
    storage: 'filesystem', directory,
    save: async () => {
      for (const image of images) assert.deepEqual(await fs.readFile(path.join(directory, image.filename)), image.content);
      throw new Error('Synthetic audit or commit failure');
    },
  }), /Synthetic audit or commit failure/);
  assert.deepEqual(await fs.readdir(directory), ['keep.txt']);
  assert.equal(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8'), 'original');
}));

test('A filename collision never overwrites or deletes the existing file', () => temporary(async directory => {
  const first = await prepared(), collision = await prepared();
  const original = Buffer.from('Existing independent file');
  await fs.writeFile(path.join(directory, collision.filename), original);
  let saves = 0;
  await assert.rejects(persistPreparedUploads([first, collision], {
    directory, save: async () => { saves++; },
  }), { code: 'EEXIST' });
  assert.equal(saves, 0);
  assert.deepEqual(await fs.readdir(directory), [collision.filename]);
  assert.deepEqual(await fs.readFile(path.join(directory, collision.filename)), original);
}));

test('Deletion unlinks only filesystem records, including legacy records, and tolerates missing files', () => temporary(async directory => {
  const image = await prepared(), filename = path.join(directory, image.filename);
  await fs.writeFile(filename, image.content);
  assert.equal(await removeStoredUpload({ ...image, storage: 'database' }, directory), false);
  assert.deepEqual(await fs.readFile(filename), image.content);
  assert.equal(await removeStoredUpload(image, directory), true);
  assert.equal(await removeStoredUpload({ ...image, storage: 'filesystem' }, directory), false);
}));

test('Public database images support exact bytes, HEAD, strong ETag, immutable caching and conditional requests', () => temporary(async directory => {
  const image = { ...await prepared(), storage: 'database' };
  await publicServer(new Map([[image.filename, image]]), directory, async base => {
    const response = await fetch(base + image.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=2592000, immutable');
    assert.equal(response.headers.get('etag'), imageETag(image.content));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.content);
    const head = await fetch(base + image.url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), image.content.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const unchanged = await fetch(base + image.url, { cache: 'no-cache', headers: { 'If-None-Match': `W/${imageETag(image.content)}` } });
    assert.equal(unchanged.status, 304);
    assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  });
}));

test('The same public route serves filesystem records, while missing or corrupt data returns a real 404', () => temporary(async directory => {
  const image = { ...await prepared(), storage: 'filesystem', content: null };
  const bytes = (await prepared()).content;
  await fs.writeFile(path.join(directory, image.filename), bytes);
  const records = new Map([
    [image.filename, image],
    ['missing.webp', { ...image, filename: 'missing.webp' }],
    ['corrupt.webp', { ...image, filename: 'corrupt.webp', storage: 'database', content: Buffer.from('<html>not an image</html>') }],
  ]);
  await publicServer(records, directory, async base => {
    const existing = await fetch(base + image.url);
    assert.equal(existing.status, 200);
    assert.deepEqual(Buffer.from(await existing.arrayBuffer()), bytes);
    for (const filename of ['unknown.webp', 'missing.webp', 'corrupt.webp']) {
      const response = await fetch(`${base}/uploads/${filename}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(await response.text(), 'Image not found.');
    }
  });
}));

test('Traversal and unsupported paths cannot look up a record or reach the SPA fallback', () => temporary(async directory => {
  await publicServer(new Map(), directory, async (base, lookedUp) => {
    for (const suffix of ['%2e%2e%2fsecret.webp', '.env', 'image.svg', 'nested/image.webp', 'a'.repeat(101) + '.webp']) {
      const response = await fetch(`${base}/uploads/${suffix}`);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), 'Image not found.');
    }
    assert.deepEqual(lookedUp, []);
  });
  const image = await prepared();
  await assert.rejects(persistPreparedUploads([{ ...image, filename: '../escape.webp' }], {
    directory, save: async () => assert.fail('Invalid filename reached persistence'),
  }), /prepared WebP/);
}));
