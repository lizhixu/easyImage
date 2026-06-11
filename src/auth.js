import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { getAuthSettings } from './store.js';

const cookieName = 'easyimage_session';

export async function login(req, res) {
  const { username, password } = req.body || {};
  const auth = await getAuthSettings();

  if (username !== auth.username || !(await bcrypt.compare(password || '', auth.passwordHash))) {
    return res.status(401).json({ result: 'failed', code: 401, message: '用户名或密码错误' });
  }

  const token = jwt.sign({ sub: username, role: 'admin' }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  return res.json({ result: 'success', code: 200 });
}

export function logout(_req, res) {
  res.clearCookie(cookieName);
  return res.json({ result: 'success', code: 200 });
}

export function currentUser(req) {
  const token = req.cookies?.[cookieName];
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

export function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(401).json({ result: 'failed', code: 401, message: '需要管理员登录' });
  }
  req.user = user;
  return next();
}
