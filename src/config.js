import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((value) => ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()));

const schema = z.object({
  nodeEnv: z.string().default('development'),
  publicBaseUrl: z.string().url().optional(),
  databaseUrl: z.string().default('file:./data/easyimage.db'),
  databaseAuthToken: z.string().optional(),
  jwtSecret: z.string().min(8).default('change-this-long-random-secret'),
  adminUser: z.string().default('admin'),
  adminPassword: z.string().default('change-me'),
  maxFileSizeMb: z.coerce.number().int().positive().default(10),
  maxFilesPerRequest: z.coerce.number().int().positive().default(30),
  allowAnonymousUpload: boolish.default('true'),
  allowedExtensions: z.string().default('jpg,jpeg,png,gif,bmp,webp,ico,jfif,tif,tiff,svg'),
  s3Region: z.string().default('auto'),
  s3Endpoint: z.string().default(''),
  s3ForcePathStyle: boolish.default('false'),
  s3AccessKeyId: z.string().default(''),
  s3SecretAccessKey: z.string().default(''),
  s3BucketNormal: z.string().default(''),
  s3BucketSuspicious: z.string().default(''),
  s3PublicBaseUrl: z.string().default(''),
  s3SuspiciousPublicBaseUrl: z.string().default('')
});

export const config = schema.parse({
  nodeEnv: process.env.NODE_ENV,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  databaseUrl: process.env.DATABASE_URL,
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN,
  jwtSecret: process.env.JWT_SECRET,
  adminUser: process.env.ADMIN_USER,
  adminPassword: process.env.ADMIN_PASSWORD,
  maxFileSizeMb: process.env.MAX_FILE_SIZE_MB,
  maxFilesPerRequest: process.env.MAX_FILES_PER_REQUEST,
  allowAnonymousUpload: process.env.ALLOW_ANONYMOUS_UPLOAD,
  allowedExtensions: process.env.ALLOWED_EXTENSIONS,
  s3Region: process.env.S3_REGION,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE,
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  s3BucketNormal: process.env.S3_BUCKET_NORMAL,
  s3BucketSuspicious: process.env.S3_BUCKET_SUSPICIOUS,
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
  s3SuspiciousPublicBaseUrl: process.env.S3_SUSPICIOUS_PUBLIC_BASE_URL
});

export const allowedExtensions = new Set(
  config.allowedExtensions
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

export const defaultStorageSettings = {
  normal: {
    region: process.env.S3_NORMAL_REGION || config.s3Region,
    endpoint: process.env.S3_NORMAL_ENDPOINT || config.s3Endpoint,
    forcePathStyle: ['1', 'true', 'yes', 'on'].includes(String(process.env.S3_NORMAL_FORCE_PATH_STYLE ?? config.s3ForcePathStyle).toLowerCase()),
    accessKeyId: process.env.S3_NORMAL_ACCESS_KEY_ID || config.s3AccessKeyId,
    secretAccessKey: process.env.S3_NORMAL_SECRET_ACCESS_KEY || config.s3SecretAccessKey,
    bucket: process.env.S3_NORMAL_BUCKET || config.s3BucketNormal,
    publicBaseUrl: process.env.S3_NORMAL_PUBLIC_BASE_URL || config.s3PublicBaseUrl
  },
  suspicious: {
    region: process.env.S3_SUSPICIOUS_REGION || config.s3Region,
    endpoint: process.env.S3_SUSPICIOUS_ENDPOINT || config.s3Endpoint,
    forcePathStyle: ['1', 'true', 'yes', 'on'].includes(String(process.env.S3_SUSPICIOUS_FORCE_PATH_STYLE ?? config.s3ForcePathStyle).toLowerCase()),
    accessKeyId: process.env.S3_SUSPICIOUS_ACCESS_KEY_ID || config.s3AccessKeyId,
    secretAccessKey: process.env.S3_SUSPICIOUS_SECRET_ACCESS_KEY || config.s3SecretAccessKey,
    bucket: process.env.S3_SUSPICIOUS_BUCKET || config.s3BucketSuspicious,
    publicBaseUrl: process.env.S3_SUSPICIOUS_PUBLIC_BASE_URL || config.s3SuspiciousPublicBaseUrl
  }
};

export const defaultApiSettings = {
  nsfwjsUrl: process.env.NSFWJS_URL || '',
  nsfwThreshold: Number(process.env.NSFWJS_THRESHOLD || 0.6)
};

export const defaultUploadSettings = {
  path: process.env.UPLOAD_PATH || '/i/',
  storagePath: process.env.UPLOAD_STORAGE_PATH || 'Y/m/d/',
  extensions: config.allowedExtensions,
  imgName: 'default',
  imgConvert: '',
  chunks: 0,
  maxUploadFiles: config.maxFilesPerRequest,
  maxSize: config.maxFileSizeMb * 1024 * 1024
};
