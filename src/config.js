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

/* Use bracket notation to prevent esbuild from inlining process.env */
const e = process['env'];

export const config = schema.parse({
  nodeEnv: e['NODE_ENV'],
  publicBaseUrl: e['PUBLIC_BASE_URL'],
  databaseUrl: e['DATABASE_URL'],
  databaseAuthToken: e['DATABASE_AUTH_TOKEN'],
  jwtSecret: e['JWT_SECRET'],
  adminUser: e['ADMIN_USER'],
  adminPassword: e['ADMIN_PASSWORD'],
  maxFileSizeMb: e['MAX_FILE_SIZE_MB'],
  maxFilesPerRequest: e['MAX_FILES_PER_REQUEST'],
  allowAnonymousUpload: e['ALLOW_ANONYMOUS_UPLOAD'],
  allowedExtensions: e['ALLOWED_EXTENSIONS'],
  s3Region: e['S3_REGION'],
  s3Endpoint: e['S3_ENDPOINT'],
  s3ForcePathStyle: e['S3_FORCE_PATH_STYLE'],
  s3AccessKeyId: e['S3_ACCESS_KEY_ID'],
  s3SecretAccessKey: e['S3_SECRET_ACCESS_KEY'],
  s3BucketNormal: e['S3_BUCKET_NORMAL'],
  s3BucketSuspicious: e['S3_BUCKET_SUSPICIOUS'],
  s3PublicBaseUrl: e['S3_PUBLIC_BASE_URL'],
  s3SuspiciousPublicBaseUrl: e['S3_SUSPICIOUS_PUBLIC_BASE_URL']
});

export const allowedExtensions = new Set(
  config.allowedExtensions
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

export const defaultStorageSettings = {
  normal: {
    region: e['S3_NORMAL_REGION'] || config.s3Region,
    endpoint: e['S3_NORMAL_ENDPOINT'] || config.s3Endpoint,
    forcePathStyle: ['1', 'true', 'yes', 'on'].includes(String(e['S3_NORMAL_FORCE_PATH_STYLE'] ?? config.s3ForcePathStyle).toLowerCase()),
    accessKeyId: e['S3_NORMAL_ACCESS_KEY_ID'] || config.s3AccessKeyId,
    secretAccessKey: e['S3_NORMAL_SECRET_ACCESS_KEY'] || config.s3SecretAccessKey,
    bucket: e['S3_NORMAL_BUCKET'] || config.s3BucketNormal,
    publicBaseUrl: e['S3_NORMAL_PUBLIC_BASE_URL'] || config.s3PublicBaseUrl
  },
  suspicious: {
    region: e['S3_SUSPICIOUS_REGION'] || config.s3Region,
    endpoint: e['S3_SUSPICIOUS_ENDPOINT'] || config.s3Endpoint,
    forcePathStyle: ['1', 'true', 'yes', 'on'].includes(String(e['S3_SUSPICIOUS_FORCE_PATH_STYLE'] ?? config.s3ForcePathStyle).toLowerCase()),
    accessKeyId: e['S3_SUSPICIOUS_ACCESS_KEY_ID'] || config.s3AccessKeyId,
    secretAccessKey: e['S3_SUSPICIOUS_SECRET_ACCESS_KEY'] || config.s3SecretAccessKey,
    bucket: e['S3_SUSPICIOUS_BUCKET'] || config.s3BucketSuspicious,
    publicBaseUrl: e['S3_SUSPICIOUS_PUBLIC_BASE_URL'] || config.s3SuspiciousPublicBaseUrl
  }
};

export const defaultApiSettings = {
  nsfwjsUrl: e['NSFWJS_URL'] || '',
  nsfwThreshold: Number(e['NSFWJS_THRESHOLD'] || 0.6)
};

export const defaultUploadSettings = {
  path: e['UPLOAD_PATH'] || '/i/',
  storagePath: e['UPLOAD_STORAGE_PATH'] || 'Y/m/d/',
  extensions: config.allowedExtensions,
  imgName: 'default',
  imgConvert: '',
  chunks: 0,
  maxUploadFiles: config.maxFilesPerRequest,
  maxSize: config.maxFileSizeMb * 1024 * 1024
};
