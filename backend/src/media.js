import { Router } from 'express';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fail, wrap } from './util.js';

export const IMAGE_MIME_TYPE = 'image/webp';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const inputOptions = { limitInputPixels: 40_000_000, failOn: 'warning' };
export const validImageFilename = value => typeof value === 'string'
  && value.length <= 100 && /^[a-zA-Z0-9_-]+\.webp$/.test(value);
const isWebP = bytes => Buffer.isBuffer(bytes) && bytes.length >= 12
  && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';

// Decode the actual bytes, discard source metadata, and finish conversion before
// opening a SQL transaction or writing any permanent file.
export async function prepareImage({ buffer, originalname = 'image' }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('The file is not a valid image.', 422);
  if (buffer.length > MAX_UPLOAD_BYTES) throw fail('Each image must be 5 MB or smaller.', 413);
  let metadata;
  try { metadata = await sharp(buffer, inputOptions).metadata(); }
  catch { throw fail('The file is not a valid image.', 422); }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.pages > 1) {
    throw fail('Choose a non-animated JPEG, PNG or WebP image.', 422);
  }
  let result;
  try {
    result = await sharp(buffer, inputOptions).rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  } catch { throw fail('The file is not a valid image.', 422); }
  const filename = `${randomUUID()}.webp`;
  return {
    filename, url: `/uploads/${filename}`, original_name: String(originalname).slice(0, 200),
    size_bytes: result.data.length, width: result.info.width, height: result.info.height,
    mime_type: IMAGE_MIME_TYPE, content: result.data,
  };
}

async function cleanupFiles(filenames) {
  for (const filename of filenames) {
    try { await fs.unlink(filename); }
    catch (error) {
      if (error.code !== 'ENOENT') console.warn(JSON.stringify({ level: 'warn', message: 'Unused image file cleanup failed' }));
    }
  }
}

// The caller's save callback owns its SQL transaction, including all image rows
// and the audit record. Keep it around the whole transaction so a failed commit
// removes only this operation's new filesystem files. Database mode writes no files.
export async function persistPreparedUploads(images, { storage = 'filesystem', directory, save }) {
  if (!['filesystem', 'database'].includes(storage)) throw new Error('Unsupported upload storage mode.');
  if (typeof save !== 'function') throw new TypeError('An upload save callback is required.');
  for (const image of images) {
    if (!validImageFilename(image.filename) || !isWebP(image.content)
      || image.size_bytes !== image.content.length || image.mime_type !== IMAGE_MIME_TYPE) {
      throw new TypeError('Expected a prepared WebP image.');
    }
  }
  const written = [];
  try {
    if (storage === 'filesystem') {
      if (typeof directory !== 'string' || !directory) throw new TypeError('An upload directory is required.');
      await fs.mkdir(directory, { recursive: true });
      for (const image of images) {
        const destination = path.join(directory, image.filename);
        const handle = await fs.open(destination, 'wx');
        written.push(destination);
        try { await handle.writeFile(image.content); }
        finally { await handle.close(); }
      }
    }
    return await save(images.map(image => ({
      ...image, storage, content: storage === 'database' ? image.content : null,
    })));
  } catch (error) {
    await cleanupFiles(written);
    throw error;
  }
}

export async function removeStoredUpload(record, directory) {
  if (!record || (record.storage ?? 'filesystem') !== 'filesystem') return false;
  if (!validImageFilename(record.filename)) throw new TypeError('Invalid stored image filename.');
  try { await fs.unlink(path.join(directory, record.filename)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function readStoredImage(record, directory) {
  if (!record || !validImageFilename(record.filename)
    || (record.mime_type ?? IMAGE_MIME_TYPE) !== IMAGE_MIME_TYPE) return null;
  let content;
  if (record.storage === 'database') content = record.content;
  else if ((record.storage ?? 'filesystem') === 'filesystem') {
    try { content = await fs.readFile(path.join(directory, record.filename)); }
    catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return null;
      throw error;
    }
  } else return null;
  return isWebP(content) ? content : null;
}

export const imageETag = content => `"${createHash('sha256').update(content).digest('hex')}"`;

export function createMediaRouter({ findUpload, directory }) {
  const router = Router();
  const missing = res => res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Image not found.');
  router.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  router.get('/:filename', wrap(async (req, res) => {
    if (!validImageFilename(req.params.filename)) return missing(res);
    const record = await findUpload(req.params.filename);
    const content = await readStoredImage(record, directory);
    if (!content) return missing(res);
    res.type(IMAGE_MIME_TYPE).set({
      'Cache-Control': 'public, max-age=2592000, immutable',
      ETag: imageETag(content),
    }).send(content);
  }));
  router.use((req, res) => missing(res));
  return router;
}
