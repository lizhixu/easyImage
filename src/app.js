import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customAlphabet } from 'nanoid';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { currentUser, login, logout, requireAdmin } from './auth.js';
import { classifyUpload } from './classify.js';
import { objectKey } from './names.js';
import {
  createFileRecord,
  createToken,
  deleteToken,
  getApiSettings,
  getAuthSettings,
  getFile,
  getStorageSettings,
  getUploadSettings,
  initDb,
  listFiles,
  listTokens,
  markDeleted,
  markReviewed,
  markTokenUsed,
  stats,
  updateApiSettings,
  updateAuthSettings,
  updateUploadSettings,
  updateStorageSettings,
  validateToken
} from './store.js';
import sharp from 'sharp';
import { classifyNsfwUrl } from './nsfw.js';
import { deleteObject, ensureStorageReady, getObject, publicUrlFor, putObject, resolveBucket } from './s3.js';

const app = express();
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 16);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 200
  }
});

await initDb();

app.set('trust proxy', true);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const user = currentUser(req);
  res.json({ authenticated: Boolean(user), user: user?.sub || null });
});

app.get(['/admin', '/admin/:section'], (_req, res) => {
  res.sendFile(join(publicDir, 'admin.html'));
});

app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);

app.get('/api/settings/auth', requireAdmin, async (_req, res, next) => {
  try {
    const auth = await getAuthSettings();
    res.json({ result: 'success', code: 200, settings: { username: auth.username } });
  } catch (error) { next(error); }
});

app.put('/api/settings/auth', requireAdmin, async (req, res, next) => {
  try {
    const auth = await getAuthSettings();
    if (!req.body.currentPassword || !(await bcrypt.compare(req.body.currentPassword, auth.passwordHash))) {
      return res.status(400).json({ result: 'failed', code: 400, message: '当前密码不正确' });
    }
    const settings = await updateAuthSettings({ username: req.body.username, newPassword: req.body.newPassword });
    res.json({ result: 'success', code: 200, settings });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ result: 'failed', code: error.status, message: error.message });
    next(error);
  }
});

/* ── API Token Management ── */

app.get('/api/tokens', requireAdmin, async (_req, res, next) => {
  try {
    const tokens = await listTokens();
    res.json({ result: 'success', code: 200, tokens });
  } catch (error) { next(error); }
});

app.post('/api/tokens', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ result: 'failed', code: 400, message: '请输入 Token 名称' });
    const token = await createToken(name);
    res.json({ result: 'success', code: 200, token });
  } catch (error) { next(error); }
});

app.delete('/api/tokens/:id', requireAdmin, async (req, res, next) => {
  try {
    await deleteToken(Number(req.params.id));
    res.json({ result: 'success', code: 200 });
  } catch (error) { next(error); }
});

/* ── External Upload API ── */

app.post('/api/upload/token', upload.single('image'), async (req, res, next) => {
  try {
    const tokenStr = String(req.body?.token || '').trim();
    if (!tokenStr) return res.status(401).json({ result: 'failed', code: 401, message: '缺少 Token' });
    const tokenInfo = await validateToken(tokenStr);
    if (!tokenInfo) return res.status(401).json({ result: 'failed', code: 401, message: 'Token 无效' });

    if (!req.file) return res.status(400).json({ result: 'failed', code: 204, message: '没有选择上传的文件' });

    const fakeFile = {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      buffer: req.file.buffer,
      size: req.file.size
    };

    const uploaded = await processFiles([fakeFile], req.ip, tokenInfo.id);
    const result = uploaded[0];

    // Record token usage
    if (result.code === 200 || result.code === 202) {
      await markTokenUsed(tokenInfo.id);
    }

    return res.json({
      result: result.result,
      code: result.code,
      url: result.url,
      srcName: result.srcName,
      thumb: result.thumb || result.url,
      del: result.del
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ result: 'failed', code: error.status, message: error.message });
    next(error);
  }
});

app.get('/api/settings/storage', requireAdmin, async (_req, res, next) => {
  try {
    const settings = await getStorageSettings();
    res.json({
      result: 'success',
      code: 200,
      settings: {
        ...settings,
        normal: {
          ...settings.normal,
          secretAccessKey: '',
          hasSecretAccessKey: Boolean(settings.normal.secretAccessKey)
        },
        suspicious: {
          ...settings.suspicious,
          secretAccessKey: '',
          hasSecretAccessKey: Boolean(settings.suspicious.secretAccessKey)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings/storage', requireAdmin, async (req, res, next) => {
  try {
    const settings = await updateStorageSettings({
      normal: {
        region: String(req.body.normal?.region || 'auto').trim(),
        endpoint: String(req.body.normal?.endpoint || '').trim(),
        forcePathStyle: Boolean(req.body.normal?.forcePathStyle),
        accessKeyId: String(req.body.normal?.accessKeyId || '').trim(),
        secretAccessKey: String(req.body.normal?.secretAccessKey || ''),
        bucket: String(req.body.normal?.bucket || '').trim(),
        publicBaseUrl: String(req.body.normal?.publicBaseUrl || '').trim()
      },
      suspicious: {
        region: String(req.body.suspicious?.region || 'auto').trim(),
        endpoint: String(req.body.suspicious?.endpoint || '').trim(),
        forcePathStyle: Boolean(req.body.suspicious?.forcePathStyle),
        accessKeyId: String(req.body.suspicious?.accessKeyId || '').trim(),
        secretAccessKey: String(req.body.suspicious?.secretAccessKey || ''),
        bucket: String(req.body.suspicious?.bucket || '').trim(),
        publicBaseUrl: String(req.body.suspicious?.publicBaseUrl || '').trim()
      }
    });
    res.json({
      result: 'success',
      code: 200,
      settings: {
        ...settings,
        normal: {
          ...settings.normal,
          secretAccessKey: '',
          hasSecretAccessKey: Boolean(settings.normal.secretAccessKey)
        },
        suspicious: {
          ...settings.suspicious,
          secretAccessKey: '',
          hasSecretAccessKey: Boolean(settings.suspicious.secretAccessKey)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/settings/api', requireAdmin, async (_req, res, next) => {
  try {
    res.json({ result: 'success', code: 200, settings: await getApiSettings() });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings/api', requireAdmin, async (req, res, next) => {
  try {
    const settings = await updateApiSettings({
      nsfwjsUrl: req.body.nsfwjsUrl,
      nsfwThreshold: req.body.nsfwThreshold
    });
    res.json({ result: 'success', code: 200, settings });
  } catch (error) {
    next(error);
  }
});

app.get('/api/upload/config', async (_req, res, next) => {
  try {
    const s = await getUploadSettings();
    res.json({ result: 'success', chunks: s.chunks, maxUploadFiles: s.maxUploadFiles, maxSize: s.maxSize });
  } catch (error) { next(error); }
});

app.get('/api/settings/upload', requireAdmin, async (_req, res, next) => {
  try {
    res.json({ result: 'success', code: 200, settings: await getUploadSettings() });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings/upload', requireAdmin, async (req, res, next) => {
  try {
    const settings = await updateUploadSettings(req.body || {});
    res.json({ result: 'success', code: 200, settings });
  } catch (error) {
    next(error);
  }
});

async function processFiles(files, uploaderIp, tokenId = null) {
  const storageSettings = await getStorageSettings();
  const apiSettings = await getApiSettings();
  const uploadSettings = await getUploadSettings();
  ensureStorageReady(storageSettings);

  if (files.length > uploadSettings.maxUploadFiles) {
    throw Object.assign(new Error(`单次最多上传 ${uploadSettings.maxUploadFiles} 个文件`), { status: 400 });
  }

  const uploaded = [];
  for (const file of files) {
    if (file.size > uploadSettings.maxSize) {
      throw Object.assign(new Error(`单文件不能超过 ${Math.round(uploadSettings.maxSize / 1024 / 1024)}MB`), { status: 413 });
    }

    const classified = classifyUpload(file, uploadSettings);
    let bucketType = classified.status === 'suspicious' ? 'suspicious' : 'normal';
    let bucket = resolveBucket(bucketType, storageSettings);
    let key = objectKey(file.originalname, uploadSettings, classified.checksumSha256);

    if (uploadSettings.imgConvert && classified.mimeType.startsWith('image/')) {
      try {
        const fmt = uploadSettings.imgConvert;
        const opts = fmt === 'gif' || fmt === 'webp' ? { animated: true } : {};
        const converted = await sharp(file.buffer, opts).toFormat(fmt);
        file.buffer = Buffer.from(converted.data);
        file.size = file.buffer.length;
        classified.mimeType = `image/${fmt === 'jpeg' ? 'jpeg' : fmt}`;
        key = key.replace(/\.[^.]+$/, `.${fmt === 'jpeg' ? 'jpg' : fmt}`);
      } catch (err) {
        console.error('图片格式转换失败:', err.message);
      }
    }

    let publicUrl = publicUrlFor(bucket, key);
    const fileId = id();
    const createdAt = new Date().toISOString();
    const metadata = { original: encodeURIComponent(file.originalname), status: classified.status };

    if (classified.status === 'active' && apiSettings.nsfwjsUrl && classified.mimeType.startsWith('image/')) {
      await putObject({ target: bucket.target, bucketName: bucket.bucketName, key, body: file.buffer, contentType: classified.mimeType, metadata });
      let nsfw;
      try { nsfw = await classifyNsfwUrl(publicUrl, apiSettings); } catch (e) { nsfw = { suspicious: true, reason: `NSFWJS 检测失败：${e.message}` }; }
      if (nsfw.suspicious) {
        await deleteObject({ target: bucket.target, bucketName: bucket.bucketName, key }).catch(() => {});
        bucketType = 'suspicious'; bucket = resolveBucket(bucketType, storageSettings); publicUrl = publicUrlFor(bucket, key);
        classified.status = 'suspicious'; classified.reason = nsfw.reason;
        await putObject({ target: bucket.target, bucketName: bucket.bucketName, key, body: file.buffer, contentType: classified.mimeType, metadata: { ...metadata, status: classified.status, reason: encodeURIComponent(classified.reason) } });
      }
    } else {
      await putObject({ target: bucket.target, bucketName: bucket.bucketName, key, body: file.buffer, contentType: classified.mimeType, metadata });
    }

    const record = { id: fileId, originalName: file.originalname, objectKey: key, bucketType: bucket.bucketType, bucketName: bucket.bucketName, publicUrl, mimeType: classified.mimeType, size: file.size, checksumSha256: classified.checksumSha256, status: classified.status, reason: classified.reason, uploaderIp, tokenId, createdAt };
    await createFileRecord(record);

    uploaded.push({ id: fileId, result: 'success', code: classified.status === 'suspicious' ? 202 : 200, status: classified.status, reason: classified.reason, url: publicUrl, srcName: file.originalname, thumb: publicUrl, del: `${config.publicBaseUrl || ''}/api/files/${fileId}` });
  }
  return uploaded;
}

app.post('/api/upload', upload.array('file', config.maxFilesPerRequest), async (req, res, next) => {
  try {
    if (!config.allowAnonymousUpload && !currentUser(req)) {
      return res.status(401).json({ result: 'failed', code: 401, message: '本站已开启登录上传' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ result: 'failed', code: 204, message: '没有选择上传的文件' });
    }
    const uploaded = await processFiles(req.files, req.ip);
    if (uploaded.length === 1) return res.json(uploaded[0]);
    return res.json({ result: 'success', code: 200, files: uploaded });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ result: 'failed', code: error.status, message: error.message });
    return next(error);
  }
});

/* ── Chunked Upload ── */

const chunkStore = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of chunkStore) { if (now - v.createdAt > 10 * 60 * 1000) chunkStore.delete(k); } }, 60 * 1000);

app.post('/api/upload/init', async (req, res) => {
  if (!config.allowAnonymousUpload && !currentUser(req)) return res.status(401).json({ result: 'failed', code: 401, message: '本站已开启登录上传' });
  const { filename, mimetype, totalChunks } = req.body || {};
  if (!filename || !totalChunks || totalChunks < 1) return res.status(400).json({ result: 'failed', code: 400, message: '缺少 filename 或 totalChunks' });
  const uploadId = id();
  chunkStore.set(uploadId, { chunks: new Map(), filename: String(filename), mimetype: String(mimetype || 'application/octet-stream'), totalChunks: Number(totalChunks), createdAt: Date.now() });
  res.json({ result: 'success', uploadId });
});

app.post('/api/upload/chunk', upload.single('chunk'), async (req, res) => {
  const { uploadId, index } = req.body || {};
  const entry = chunkStore.get(uploadId);
  if (!entry) return res.status(404).json({ result: 'failed', code: 404, message: '上传会话不存在或已过期' });
  if (!req.file) return res.status(400).json({ result: 'failed', code: 400, message: '缺少分片数据' });
  entry.chunks.set(Number(index), req.file.buffer);
  res.json({ result: 'success', received: entry.chunks.size, total: entry.totalChunks });
});

app.post('/api/upload/complete', async (req, res, next) => {
  try {
    if (!config.allowAnonymousUpload && !currentUser(req)) return res.status(401).json({ result: 'failed', code: 401, message: '本站已开启登录上传' });
    const { uploadId } = req.body || {};
    const entry = chunkStore.get(uploadId);
    if (!entry) return res.status(404).json({ result: 'failed', code: 404, message: '上传会话不存在或已过期' });
    if (entry.chunks.size < entry.totalChunks) return res.status(400).json({ result: 'failed', code: 400, message: `分片不完整：已收 ${entry.chunks.size}/${entry.totalChunks}` });
    chunkStore.delete(uploadId);
    const sorted = []; for (let i = 0; i < entry.totalChunks; i++) sorted.push(entry.chunks.get(i) || Buffer.alloc(0));
    const buffer = Buffer.concat(sorted);
    const file = { originalname: entry.filename, mimetype: entry.mimetype, buffer, size: buffer.length };
    const uploaded = await processFiles([file], req.ip);
    res.json(uploaded[0]);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ result: 'failed', code: error.status, message: error.message });
    return next(error);
  }
});

app.get('/api/files', async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20), 5), 100);
    const result = await listFiles({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      status: req.query.status || undefined
    });
    res.json({ result: 'success', code: 200, files: result.rows, page, pageSize, total: result.total });
  } catch (error) {
    next(error);
  }
});

app.get('/api/stats', async (_req, res, next) => {
  try {
    res.json({ result: 'success', code: 200, stats: await stats() });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/files/:id', requireAdmin, async (req, res, next) => {
  try {
    const file = await getFile(req.params.id);
    if (!file) return res.status(404).json({ result: 'failed', code: 404, message: '文件不存在' });
    const storageSettings = await getStorageSettings();
    const bucket = resolveBucket(file.bucket_type, storageSettings);
    await deleteObject({ target: bucket.target, bucketName: file.bucket_name, key: file.object_key });
    await markDeleted(req.params.id);
    return res.json({ result: 'success', code: 200 });
  } catch (error) {
    return next(error);
  }
});

async function approveFileById(fileId) {
  const file = await getFile(fileId);
  if (!file) return { id: fileId, ok: false, message: '文件不存在' };
  if (file.status !== 'suspicious') return { id: fileId, ok: false, message: '只有可疑文件需要审核' };

  const storageSettings = await getStorageSettings();
  ensureStorageReady(storageSettings);
  const from = resolveBucket('suspicious', storageSettings);
  const to = resolveBucket('normal', storageSettings);
  const object = await getObject({ target: from.target, bucketName: file.bucket_name, key: file.object_key });
  await putObject({
    target: to.target,
    bucketName: to.bucketName,
    key: file.object_key,
    body: object.body,
    contentType: object.contentType || file.mime_type,
    metadata: { ...object.metadata, status: 'active', reviewed: 'true' }
  });
  await deleteObject({ target: from.target, bucketName: file.bucket_name, key: file.object_key });
  const publicUrl = publicUrlFor(to, file.object_key);
  await markReviewed({
    id: file.id,
    bucketType: 'normal',
    bucketName: to.bucketName,
    publicUrl,
    reason: file.reason ? `人工审核通过；原原因：${file.reason}` : '人工审核通过'
  });
  return { id: fileId, ok: true };
}

app.post('/api/files/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const result = await approveFileById(req.params.id);
    if (!result.ok) return res.status(400).json({ result: 'failed', code: 400, message: result.message });
    return res.json({ result: 'success', code: 200 });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/files/batch/approve', requireAdmin, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const results = [];
    for (const fileId of ids) {
      results.push(await approveFileById(fileId));
    }
    res.json({ result: 'success', code: 200, results });
  } catch (error) {
    next(error);
  }
});

app.post('/api/files/batch/delete', requireAdmin, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const storageSettings = await getStorageSettings();
    const results = [];
    for (const fileId of ids) {
      const file = await getFile(fileId);
      if (!file) {
        results.push({ id: fileId, ok: false, message: '文件不存在' });
        continue;
      }
      const bucket = resolveBucket(file.bucket_type, storageSettings);
      await deleteObject({ target: bucket.target, bucketName: file.bucket_name, key: file.object_key });
      await markDeleted(fileId);
      results.push({ id: fileId, ok: true });
    }
    res.json({ result: 'success', code: 200, results });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ result: 'failed', code: 413, message: `单文件不能超过 ${config.maxFileSizeMb}MB` });
  }
  if (error?.message?.includes('配置未完成')) {
    return res.status(503).json({ result: 'failed', code: 503, message: error.message });
  }
  console.error(error);
  return res.status(500).json({ result: 'failed', code: 500, message: error.message || '服务器错误' });
});

export default app;
