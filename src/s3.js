import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function joinUrl(base, key) {
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

function createS3(target) {
  ensureTargetReady(target, 'S3');
  return new S3Client({
    region: target.region,
    endpoint: target.endpoint,
    forcePathStyle: target.forcePathStyle,
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey
    }
  });
}

function bucketUrl(bucket, key, target) {
  const endpoint = target.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (target.forcePathStyle) {
    return `${target.endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
  }
  return `https://${bucket}.${endpoint}/${key}`;
}

function ensureTargetReady(target, label) {
  const missing = [
    ['endpoint', 'S3 Endpoint'],
    ['accessKeyId', 'Access Key ID'],
    ['secretAccessKey', 'Secret Access Key'],
    ['bucket', 'Bucket']
  ].filter(([key]) => !target[key]);

  if (missing.length) {
    throw new Error(`${label} 配置未完成：${missing.map(([, item]) => item).join('、')}`);
  }
}

export function ensureStorageReady(settings) {
  ensureTargetReady(settings.normal, '正常文件 S3');
  ensureTargetReady(settings.suspicious, '可疑文件 S3');
}

export function resolveBucket(bucketType, settings) {
  const target = bucketType === 'suspicious' ? settings.suspicious : settings.normal;
  return {
    bucketType,
    target,
    bucketName: target.bucket,
    publicBaseUrl: target.publicBaseUrl
  };
}

export async function putObject({ target, bucketName, key, body, contentType, metadata }) {
  await createS3(target).send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata
    })
  );
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getObject({ target, bucketName, key }) {
  const response = await createS3(target).send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    })
  );
  return {
    body: await streamToBuffer(response.Body),
    contentType: response.ContentType || 'application/octet-stream',
    metadata: response.Metadata || {}
  };
}

export async function deleteObject({ target, bucketName, key }) {
  await createS3(target).send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key
    })
  );
}

export function publicUrlFor(bucket, key) {
  if (bucket.publicBaseUrl) return joinUrl(bucket.publicBaseUrl, key);
  return bucketUrl(bucket.bucketName, key, bucket.target);
}
