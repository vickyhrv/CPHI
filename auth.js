'use strict';

const crypto = require('crypto');
const users = require('./lib/users');

const SESSION_COOKIE = 'cphi_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((part) => {
      const i = part.indexOf('=');
      if (i === -1) return null;
      return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
    }).filter(Boolean)
  );
}

function findUser(username, password) {
  return users.verifyLogin(username, password);
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
}

function sessionCookie(token, req) {
  const secure = req?.secure || req?.headers['x-forwarded-proto'] === 'https';
  const secureFlag = secure ? '; Secure' : '';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

function clearSessionCookie(req) {
  const secure = req?.secure || req?.headers['x-forwarded-proto'] === 'https';
  const secureFlag = secure ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}

const PUBLIC_PATHS = new Set([
  '/login.html',
  '/login.css',
  '/login.js',
  '/hrv-logo.png',
  '/hrv-parrots.png',
  '/hrv.png',
]);

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = session;
  next();
}

function authGate(req, res, next) {
  const { path: pathname } = req;

  if (pathname.startsWith('/api/auth')) return next();
  if (pathname === '/api/health') return next();
  if (isPublicPath(pathname)) return next();

  const session = getSession(req);

  if (pathname.startsWith('/api/')) {
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.user = session;
    return next();
  }

  const protectedAppPaths = ['/', '/index.html', '/app.js', '/styles.css'];
  if (protectedAppPaths.includes(pathname) && !session) {
    if (pathname === '/' || pathname === '/index.html') {
      return res.redirect(302, '/login.html');
    }
    return res.status(401).send('Unauthorized');
  }

  if (session) req.user = session;
  next();
}

module.exports = {
  USERS_FILE: users.USERS_FILE,
  findUser,
  createSession,
  getSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  authGate,
  isPublicPath,
};
