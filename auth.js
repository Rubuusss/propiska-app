const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'propiska_secret_change_me_in_production_2026';
const JWT_EXPIRES = '30d';

function hashPassword(pass) {
  return bcrypt.hashSync(pass, 10);
}

function checkPassword(pass, hash) {
  return bcrypt.compareSync(pass, hash);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, login: user.login, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.findUserById(payload.id);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    req.user = { id: user.id, login: user.login, role: user.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Только для администратора' });
  }
  next();
}

module.exports = {
  hashPassword,
  checkPassword,
  signToken,
  authMiddleware,
  adminOnly
};
