import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { config, defaultApiSettings, defaultStorageSettings, defaultUploadSettings } from './config.js';

let client;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nsfwProviders = ['none', 'nsfwjs', 'sightengine'];

function localDatabasePath() {
  if (!config.databaseUrl.startsWith('file:')) return null;
  const dbPath = config.databaseUrl.replace(/^file:/, '');
  return resolve(projectRoot, dbPath);
}

function databaseUrlForClient() {
  const absolute = localDatabasePath();
  if (!absolute) return config.databaseUrl;
  return `file:${absolute.replace(/\\/g, '/')}`;
}

async function ensureLocalDbDir() {
  const absolute = localDatabasePath();
  if (!absolute) return;
  await mkdir(dirname(absolute), { recursive: true });
}

export async function initDb() {
  await ensureLocalDbDir();
  client ||= createClient({
    url: databaseUrlForClient(),
    authToken: config.databaseAuthToken || undefined
  });
  await client.batch([
    `CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      object_key TEXT NOT NULL,
      bucket_type TEXT NOT NULL,
      bucket_name TEXT NOT NULL,
      public_url TEXT,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      uploader_ip TEXT,
      token_id INTEGER,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_files_status ON files(status)`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    )`
  ]);
  await seedDefaultSettings();
}

function db() {
  if (!client) {
    throw new Error('Database is not initialized');
  }
  return client;
}

async function seedDefaultSettings() {
  const auth = await db().execute({
    sql: 'SELECT key FROM settings WHERE key = ?',
    args: ['auth']
  });
  if (!auth.rows.length) {
    const hash = config.adminPassword.startsWith('$2')
      ? config.adminPassword
      : await bcrypt.hash(config.adminPassword, 10);
    await setSetting('auth', { username: config.adminUser, passwordHash: hash });
  }

  const storage = await db().execute({
    sql: 'SELECT key FROM settings WHERE key = ?',
    args: ['storage.s3']
  });
  if (!storage.rows.length) {
    await setSetting('storage.s3', defaultStorageSettings);
  }

  const api = await db().execute({
    sql: 'SELECT key FROM settings WHERE key = ?',
    args: ['api']
  });
  if (!api.rows.length) {
    await setSetting('api', defaultApiSettings);
  }

  const upload = await db().execute({
    sql: 'SELECT key FROM settings WHERE key = ?',
    args: ['upload']
  });
  if (!upload.rows.length) {
    await setSetting('upload', defaultUploadSettings);
  }
}

function normalizeStorageSettings(settings) {
  if (settings?.normal && settings?.suspicious) {
    return {
      normal: { ...defaultStorageSettings.normal, ...settings.normal },
      suspicious: { ...defaultStorageSettings.suspicious, ...settings.suspicious }
    };
  }

  const flat = settings || {};
  return {
    normal: {
      ...defaultStorageSettings.normal,
      region: flat.region ?? defaultStorageSettings.normal.region,
      endpoint: flat.endpoint ?? defaultStorageSettings.normal.endpoint,
      forcePathStyle: Boolean(flat.forcePathStyle ?? defaultStorageSettings.normal.forcePathStyle),
      accessKeyId: flat.accessKeyId ?? defaultStorageSettings.normal.accessKeyId,
      secretAccessKey: flat.secretAccessKey ?? defaultStorageSettings.normal.secretAccessKey,
      bucket: flat.bucketNormal ?? defaultStorageSettings.normal.bucket,
      publicBaseUrl: flat.publicBaseUrl ?? defaultStorageSettings.normal.publicBaseUrl
    },
    suspicious: {
      ...defaultStorageSettings.suspicious,
      region: flat.region ?? defaultStorageSettings.suspicious.region,
      endpoint: flat.endpoint ?? defaultStorageSettings.suspicious.endpoint,
      forcePathStyle: Boolean(flat.forcePathStyle ?? defaultStorageSettings.suspicious.forcePathStyle),
      accessKeyId: flat.accessKeyId ?? defaultStorageSettings.suspicious.accessKeyId,
      secretAccessKey: flat.secretAccessKey ?? defaultStorageSettings.suspicious.secretAccessKey,
      bucket: flat.bucketSuspicious ?? defaultStorageSettings.suspicious.bucket,
      publicBaseUrl: flat.suspiciousPublicBaseUrl ?? defaultStorageSettings.suspicious.publicBaseUrl
    }
  };
}

export async function getSetting(key, fallback = null) {
  const result = await db().execute({
    sql: 'SELECT value FROM settings WHERE key = ?',
    args: [key]
  });
  if (!result.rows.length) return fallback;
  return JSON.parse(result.rows[0].value);
}

export async function setSetting(key, value) {
  await db().execute({
    sql: `INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, JSON.stringify(value), new Date().toISOString()]
  });
}

export async function getStorageSettings() {
  const saved = await getSetting('storage.s3', defaultStorageSettings);
  return normalizeStorageSettings(saved);
}

export async function updateStorageSettings(input) {
  const current = await getStorageSettings();
  const next = {
    normal: {
      ...current.normal,
      ...input.normal,
      forcePathStyle: Boolean(input.normal?.forcePathStyle)
    },
    suspicious: {
      ...current.suspicious,
      ...input.suspicious,
      forcePathStyle: Boolean(input.suspicious?.forcePathStyle)
    }
  };
  if (!input.normal?.secretAccessKey) {
    next.normal.secretAccessKey = current.normal.secretAccessKey;
  }
  if (!input.suspicious?.secretAccessKey) {
    next.suspicious.secretAccessKey = current.suspicious.secretAccessKey;
  }
  await setSetting('storage.s3', next);
  return next;
}

export async function getApiSettings() {
  const saved = await getSetting('api', defaultApiSettings);
  const nsfwProvider = nsfwProviders.includes(saved?.nsfwProvider)
    ? saved.nsfwProvider
    : defaultApiSettings.nsfwProvider;
  return {
    ...defaultApiSettings,
    ...saved,
    nsfwProvider,
    nsfwThreshold: Number(saved?.nsfwThreshold ?? defaultApiSettings.nsfwThreshold),
    sightengineThreshold: Number(saved?.sightengineThreshold ?? defaultApiSettings.sightengineThreshold)
  };
}

export async function updateApiSettings(input) {
  const current = await getApiSettings();
  const nsfwProvider = nsfwProviders.includes(input.nsfwProvider)
    ? input.nsfwProvider
    : current.nsfwProvider;
  const next = {
    nsfwProvider,
    nsfwjsUrl: String(input.nsfwjsUrl || '').trim(),
    nsfwThreshold: Number(input.nsfwThreshold ?? defaultApiSettings.nsfwThreshold),
    sightengineApiUser: String(input.sightengineApiUser || '').trim(),
    sightengineApiSecret: input.sightengineApiSecret
      ? String(input.sightengineApiSecret)
      : current.sightengineApiSecret,
    sightengineThreshold: Number(input.sightengineThreshold ?? defaultApiSettings.sightengineThreshold)
  };
  await setSetting('api', next);
  return next;
}

export async function getUploadSettings() {
  const saved = await getSetting('upload', defaultUploadSettings);
  return {
    ...defaultUploadSettings,
    ...saved,
    chunks: Number(saved?.chunks ?? defaultUploadSettings.chunks),
    maxUploadFiles: Number(saved?.maxUploadFiles ?? defaultUploadSettings.maxUploadFiles),
    maxSize: Number(saved?.maxSize ?? defaultUploadSettings.maxSize)
  };
}

export async function updateUploadSettings(input) {
  const next = {
    path: String(input.path || defaultUploadSettings.path).trim(),
    storagePath: String(input.storagePath || defaultUploadSettings.storagePath).trim(),
    extensions: String(input.extensions || defaultUploadSettings.extensions).trim(),
    imgName: String(input.imgName || defaultUploadSettings.imgName).trim(),
    imgConvert: String(input.imgConvert || '').trim(),
    chunks: Number(input.chunks || 0),
    maxUploadFiles: Number(input.maxUploadFiles || defaultUploadSettings.maxUploadFiles),
    maxSize: Number(input.maxSize || defaultUploadSettings.maxSize)
  };
  await setSetting('upload', next);
  return next;
}

export async function getAuthSettings() {
  return await getSetting('auth', { username: config.adminUser, passwordHash: '' });
}

export async function updateAuthSettings(input) {
  const current = await getAuthSettings();
  const username = String(input.username || '').trim();
  if (!username) throw Object.assign(new Error('用户名不能为空'), { status: 400 });

  let passwordHash = current.passwordHash;
  if (input.newPassword) {
    if (input.newPassword.length < 4) throw Object.assign(new Error('新密码至少 4 个字符'), { status: 400 });
    passwordHash = await bcrypt.hash(input.newPassword, 10);
  }

  const next = { username, passwordHash };
  await setSetting('auth', next);
  return { username };
}

export async function createFileRecord(record) {
  await db().execute({
    sql: `INSERT INTO files (
      id, original_name, object_key, bucket_type, bucket_name, public_url,
      mime_type, size, checksum_sha256, status, reason, uploader_ip, token_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      record.id,
      record.originalName,
      record.objectKey,
      record.bucketType,
      record.bucketName,
      record.publicUrl,
      record.mimeType,
      record.size,
      record.checksumSha256,
      record.status,
      record.reason,
      record.uploaderIp,
      record.tokenId ?? null,
      record.createdAt
    ]
  });
}

export async function listFiles({ limit = 20, offset = 0, status } = {}) {
  const args = [];
  let where = 'deleted_at IS NULL';
  if (status) {
    where += ' AND status = ?';
    args.push(status);
  }
  const countResult = await db().execute({
    sql: `SELECT COUNT(*) AS total FROM files WHERE ${where}`,
    args
  });
  args.push(limit, offset);
  const result = await db().execute({
    sql: `SELECT * FROM files WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    args
  });
  return { rows: result.rows, total: Number(countResult.rows[0]?.total || 0) };
}

export async function getFile(id) {
  const result = await db().execute({
    sql: 'SELECT * FROM files WHERE id = ? AND deleted_at IS NULL',
    args: [id]
  });
  return result.rows[0] || null;
}

export async function markDeleted(id) {
  await db().execute({
    sql: 'UPDATE files SET deleted_at = ? WHERE id = ?',
    args: [new Date().toISOString(), id]
  });
}

export async function markReviewed(record) {
  await db().execute({
    sql: `UPDATE files
      SET bucket_type = ?, bucket_name = ?, public_url = ?, status = ?, reason = ?
      WHERE id = ? AND deleted_at IS NULL`,
    args: [
      record.bucketType,
      record.bucketName,
      record.publicUrl,
      'active',
      record.reason,
      record.id
    ]
  });
}

export async function stats() {
  const result = await db().execute(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'suspicious' THEN 1 ELSE 0 END) AS suspicious,
      COALESCE(SUM(size), 0) AS bytes
    FROM files
    WHERE deleted_at IS NULL
  `);
  return result.rows[0];
}

/* ── API Tokens ── */

export async function listTokens() {
  const result = await db().execute('SELECT * FROM api_tokens ORDER BY created_at DESC');
  return result.rows;
}

export async function createToken(name) {
  const token = Array.from({ length: 32 }, () =>
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 62)]
  ).join('');
  const now = new Date().toISOString();
  await db().execute({
    sql: 'INSERT INTO api_tokens (name, token, created_at) VALUES (?, ?, ?)',
    args: [name, token, now]
  });
  return { name, token, created_at: now };
}

export async function deleteToken(id) {
  await db().execute({ sql: 'DELETE FROM api_tokens WHERE id = ?', args: [id] });
}

export async function validateToken(tokenStr) {
  const result = await db().execute({
    sql: 'SELECT id, name FROM api_tokens WHERE token = ?',
    args: [tokenStr]
  });
  return result.rows[0] || null;
}

export async function markTokenUsed(id) {
  await db().execute({
    sql: 'UPDATE api_tokens SET last_used_at = ? WHERE id = ?',
    args: [new Date().toISOString(), id]
  });
}
