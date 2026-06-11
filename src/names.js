import path from 'node:path';
import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDatePattern(pattern, now) {
  return String(pattern || 'Y/m/d/')
    .replaceAll('Y', String(now.getUTCFullYear()))
    .replaceAll('m', pad(now.getUTCMonth() + 1))
    .replaceAll('d', pad(now.getUTCDate()))
    .replaceAll('H', pad(now.getUTCHours()))
    .replaceAll('i', pad(now.getUTCMinutes()))
    .replaceAll('s', pad(now.getUTCSeconds()))
    .replace(/^\/+/, '')
    .replace(/\/?$/, '/');
}

function cleanPrefix(prefix) {
  return String(prefix || '/i/').replace(/^\/+/, '').replace(/\/?$/, '/');
}

function safeSourceName(originalName) {
  return path
    .basename(originalName || 'file', path.extname(originalName || ''))
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 80);
}

function fileNameBody(originalName, settings, checksumSha256) {
  const now = new Date();
  switch (settings.imgName) {
    case 'date':
      return `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
    case 'unix':
      return String(Math.floor(now.getTime() / 1000));
    case 'uniqid':
      return `${now.getTime().toString(16)}${nanoid().slice(0, 4)}`;
    case 'source':
      return safeSourceName(originalName);
    case 'md5':
      return crypto.createHash('md5').update(checksumSha256).digest('hex');
    case 'sha1':
      return crypto.createHash('sha1').update(checksumSha256).digest('hex');
    case 'uuid':
    case 'guid':
      return crypto.randomUUID();
    case 'crc32':
    case 'snowflake':
    case 'default':
    default:
      return nanoid();
  }
}

export function objectKey(originalName, settings = {}, checksumSha256 = '') {
  const ext = path.extname(originalName || '').toLowerCase() || '.bin';
  const now = new Date();
  const prefix = cleanPrefix(settings.path);
  const datePath = formatDatePattern(settings.storagePath, now);
  return `${prefix}${datePath}${fileNameBody(originalName, settings, checksumSha256)}${ext}`;
}
