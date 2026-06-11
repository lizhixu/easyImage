# Node EasyImage

基于 EasyImage 2.0 重新整理的 Node.js 图床，适合 Vercel / EdgeOne 等平台部署。

- 元数据使用 SQLite / Turso（`DATABASE_URL` 切换）
- 文件不落本地磁盘，直传 S3 兼容存储
- 支持正常 / 可疑双 Bucket
- 管理员账号落库，支持后台修改
- 外部 API Token 鉴权上传
- 精简 UI，无广告、水印

## 本地运行

```bash
cp .env.example .env
npm install
npm run dev
```

访问 `http://localhost:3000`。

首次启动时 `.env` 中的 `ADMIN_USER` / `ADMIN_PASSWORD` 会被 bcrypt 加密写入数据库。之后登录由数据库验证，可在后台「账号设置」修改。

## 快速配置

### 数据库

```env
# 本地 SQLite
DATABASE_URL=file:./data/easyimage.db

# Turso 远程
DATABASE_URL=libsql://your-db.turso.io
DATABASE_AUTH_TOKEN=your-token
```

### S3 存储

S3 配置在后台管理页填写，`.env` 仅作首次默认值：

```env
S3_ENDPOINT=
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET_NORMAL=
S3_BUCKET_SUSPICIOUS=
S3_PUBLIC_BASE_URL=
```

正常和可疑存储完全独立，可使用不同 Endpoint / Bucket / AK/SK。也可用 `S3_NORMAL_*` / `S3_SUSPICIOUS_*` 前缀分别指定。

### NSFW 检测

```env
NSFWJS_URL=http://127.0.0.1:3307/api/nsfw/classify
NSFWJS_THRESHOLD=0.6
```

上传合法图片时先写入正常存储生成可访问 URL，再调用 NSFWJS 接口。Porn / Hentai / Sexy 任一概率 ≥ 阈值则移入可疑存储。

### 其他配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JWT_SECRET` | `change-this...` | JWT 密钥，生产必须修改 |
| `PORT` | `3000` | 服务端口 |
| `ALLOW_ANONYMOUS_UPLOAD` | `true` | 是否允许匿名网页上传 |
| `MAX_FILE_SIZE_MB` | `10` | 单文件最大 MB |
| `MAX_FILES_PER_REQUEST` | `30` | 单次最多文件数 |

## API

### 网页上传

| 接口 | 鉴权 | 说明 |
|------|------|------|
| `POST /api/upload` | 取决于 `ALLOW_ANONYMOUS_UPLOAD` | 表单字段 `file`，支持多文件 |
| `POST /api/upload/init` | 同上 | 分片上传初始化 |
| `POST /api/upload/chunk` | — | 分片上传 |
| `POST /api/upload/complete` | 同上 | 分片合并 |

### 外部 Token 上传

兼容 EasyImage 2.0 原有 API 格式：

```
POST /api/upload/token
Content-Type: multipart/form-data

参数:
  image  - 文件
  token  - API Token（在后台生成）

返回:
{
  "result": "success",
  "code": 200,
  "url": "https://img.example.com/i/2024/01/01/xxx.jpg",
  "srcName": "photo.jpg",
  "thumb": "https://img.example.com/i/2024/01/01/xxx.jpg",
  "del": "https://yoursite/api/files/abc123"
}
```

Token 在后台「API Token」页面创建/删除。示例调用：

```bash
curl -X POST -F "image=@photo.jpg" -F "token=your_token" http://yoursite/api/upload/token
```

```python
import requests
r = requests.post('http://yoursite/api/upload/token',
    files={'image': open('photo.jpg', 'rb')},
    data={'token': 'your_token'})
print(r.json()['url'])
```

### 后台接口（需管理员）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 登录 |
| `/api/auth/logout` | POST | 退出 |
| `/api/session` | GET | 当前会话状态 |
| `/api/settings/storage` | GET/PUT | S3 存储配置 |
| `/api/settings/upload` | GET/PUT | 上传设置 |
| `/api/settings/api` | GET/PUT | NSFW 配置 |
| `/api/settings/auth` | GET/PUT | 账号设置 |
| `/api/tokens` | GET/POST | API Token 管理 |
| `/api/tokens/:id` | DELETE | 删除 Token |
| `/api/files` | GET | 文件列表 |
| `/api/files/:id` | DELETE | 删除文件 |
| `/api/files/:id/approve` | POST | 审核通过 |
| `/api/files/batch/approve` | POST | 批量审核 |
| `/api/files/batch/delete` | POST | 批量删除 |
| `/api/stats` | GET | 统计信息 |

## 部署

### Vercel

Root Directory 设为 `node-easyimage`，环境变量在 Vercel 项目设置配置。`vercel.json` 已转发 `/api/*`。

### EdgeOne Pages

构建根目录指向 `node-easyimage`，运行时 Node.js 20+，函数入口 `api/index.js`。

## 项目结构

```
node-easyimage/
├── api/index.js          # Serverless 入口
├── src/
│   ├── server.js         # 本地启动
│   ├── app.js            # Express 路由 & 中间件
│   ├── auth.js           # 登录/鉴权/JWT
│   ├── config.js         # 环境变量 Zod 校验
│   ├── store.js          # SQLite 数据层
│   ├── s3.js             # S3 存储操作
│   ├── classify.js       # 文件分类/过滤
│   ├── nsfw.js           # NSFW 检测
│   └── names.js          # 对象 Key 生成
├── public/
│   ├── index.html        # 首页（上传）
│   ├── admin.html        # 管理后台
│   ├── login.html        # 登录页
│   ├── app.js            # 首页逻辑
│   ├── admin.js          # 后台逻辑
│   ├── login.js          # 登录逻辑
│   ├── styles.css        # 全局样式
│   ├── logo.png          # Logo
│   └── favicon.ico       # 网站图标
├── package.json
├── vercel.json
└── README.md
```

## Code Review 记录

### 后端

| 项目 | 说明 |
|------|------|
| **密码安全** | 首次启动自动将 `.env` 明文密码 bcrypt 哈希写入 DB，后续读 DB |
| **文件校验** | `classify.js` 检查扩展名/MIME 白名单 + SVG 风险扫描 |
| **分片上传** | 内存 Map 存储，10 分钟过期，**重启丢失**（生产建议 Redis） |
| **错误处理** | 统一 `app.use(error)` 兜底，各路由 try-catch |
| **Token API** | `/api/upload/token` 独立于匿名上传开关，Token 鉴权独立 |

### 前端

| 项目 | 说明 |
|------|------|
| **状态管理** | 纯 DOM 操作，无框架依赖 |
| **Toast** | 固定 2.8s 显示，未做队列管理 |
| **加载状态** | 按钮禁用 + loading 文字，体验可用 |
| **表单校验** | 登录/账号修改均有客户端空值校验 |

### 待优化

| 优先级 | 项目 |
|--------|------|
| 中 | 分片上传改用持久化存储（文件/Redis） |
| 低 | Toast 消息队列 |
| 低 | API 限流（express-rate-limit） |
| 低 | 外部上传接口添加 CORS 头（如需要跨域） |
