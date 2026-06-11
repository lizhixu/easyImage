import crypto from 'node:crypto';
import path from 'node:path';
import { lookup as mimeLookup } from 'mime-types';

const svgDangerPattern = /<script[\s\S]*?<\/script|href\s*=|on[a-z]+\s*=/i;

function extensionOf(name) {
  return path.extname(name || '').replace('.', '').toLowerCase();
}

function isLikelyImageMime(mimeType) {
  return mimeType.startsWith('image/');
}

function detectMime(file) {
  return file.mimetype || mimeLookup(file.originalname) || 'application/octet-stream';
}

function allowedExtensionSet(uploadSettings) {
  return new Set(
    String(uploadSettings.extensions || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function classifyUpload(file, uploadSettings) {
  const ext = extensionOf(file.originalname);
  const mimeType = detectMime(file);
  const reasons = [];
  const allowedExtensions = allowedExtensionSet(uploadSettings);

  if (!allowedExtensions.has(ext)) reasons.push('扩展名不在白名单');
  if (!isLikelyImageMime(mimeType)) reasons.push('MIME 不是图片');

  if (ext === 'svg' || mimeType === 'image/svg+xml') {
    const text = file.buffer.toString('utf8', 0, Math.min(file.buffer.length, 1024 * 1024));
    if (svgDangerPattern.test(text)) reasons.push('SVG 包含可执行或外链风险');
  }

  return {
    ext,
    mimeType,
    checksumSha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    status: reasons.length ? 'suspicious' : 'active',
    reason: reasons.join('；') || null
  };
}
