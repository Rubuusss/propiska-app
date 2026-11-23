const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { hashPassword, checkPassword, signToken, authMiddleware, adminOnly } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== helpers =====
function addMonths(d, m) {
  if (!d) return null;
  const x = new Date(d + 'T12:00:00');
  x.setMonth(x.getMonth() + m);
  return x.toISOString().slice(0, 10);
}
function addDays(d, n) {
  if (!d) return null;
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}
function daysLeft(end) {
  if (!end) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round((new Date(end + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
  return diff < 0 ? 0 : diff;
}
function occupiesSlot(p) {
  // Архив тоже занимает место — слот освобождается только после удаления
  // или когда срок регистрации уже истёк.
  if (p.work_start) {
    const regEnd = addMonths(p.work_start, p.term || 3);
    const left = daysLeft(regEnd);
    if (left != null && left <= 0) return false;
  }
  return true;
}
function enrichPerson(p) {
  const departure = p.arrival ? addDays(p.arrival, 29) : null;
  const reg_end = p.work_start ? addMonths(p.work_start, p.term || 3) : null;
  const days_left = reg_end ? daysLeft(reg_end) : null;
  const out = { ...p, from: p.from_whom || p.from || '', departure, reg_end, days_left, archived: !!p.archived };
  // Не отдаём base64 файла в списках — только метаданные
  if (out.rvp_file) {
    out.rvp_file = {
      name: out.rvp_file.name,
      type: out.rvp_file.type,
      size: out.rvp_file.size,
      uploaded_at: out.rvp_file.uploaded_at,
      has_file: true
    };
  }
  return out;
}

// ========== AUTH ==========
app.get('/api/auth/status', (req, res) => {
  res.json({ hasUsers: db.get().users.length > 0 });
});

app.post('/api/auth/setup', (req, res) => {
  if (db.get().users.length > 0) {
    return res.status(400).json({ error: 'Администратор уже создан' });
  }
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });

  const user = db.createUser({ login: login.trim(), pass: hashPassword(password), role: 'admin' });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, login: user.login, role: user.role } });
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Заполните все поля' });

  const user = db.findUserByLogin(login.trim());
  if (!user || !checkPassword(password, user.pass)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, login: user.login, role: user.role } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ========== USERS ==========
app.get('/api/users', authMiddleware, adminOnly, (req, res) => {
  res.json(db.getUsers());
});

app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  if (db.findUserByLogin(login.trim())) return res.status(400).json({ error: 'Такой логин уже есть' });

  const user = db.createUser({ login: login.trim(), pass: hashPassword(password), role: 'user' });
  res.json({ id: user.id, login: user.login, role: user.role });
});

app.put('/api/users/:id/password', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  // Админ может менять любой пароль, обычный пользователь — только свой
  if (req.user.role !== 'admin' && req.user.id !== id) {
    return res.status(403).json({ error: 'Можно менять только свой пароль' });
  }
  const user = db.findUserById(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  db.updateUser(id, { pass: hashPassword(password) });
  res.json({ ok: true });
});

app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  const user = db.findUserById(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') {
    const admins = db.get().users.filter(u => u.role === 'admin');
    if (admins.length <= 1) return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
  }
  db.deleteUser(id);
  res.json({ ok: true });
});

// ========== HOSTS ==========
app.get('/api/hosts', authMiddleware, (req, res) => {
  const hosts = db.getHosts(req.user.id);
  // Считаем и активных, и архивных — архив занимает место
  const people = db.getPeople(req.user.id, false).concat(db.getPeople(req.user.id, true));

  const result = hosts.map(h => {
    const list = people.filter(p => p.host === h.fio);
    const active = list.filter(occupiesSlot).length;
    return {
      id: h.id,
      fio: h.fio,
      limit: h.limit_count || h.limit || 5,
      phone: h.phone || '',
      email: h.email || '',
      region: h.region || '',
      district: h.district || '',
      locality: h.locality || '',
      street: h.street || '',
      house: h.house || '',
      apt: h.apt || '',
      iin: h.iin || '',
      doc_type: h.doc_type || '',
      doc_number: h.doc_number || '',
      doc_issuer: h.doc_issuer || '',
      doc_date: h.doc_date || null,
      note: h.note || '',
      current: active,
      free: Math.max(0, (h.limit_count || h.limit || 5) - active)
    };
  });
  res.json(result);
});

app.post('/api/hosts', authMiddleware, (req, res) => {
  const d = req.body;
  if (!d.fio || !d.fio.trim()) return res.status(400).json({ error: 'Укажите ФИО' });
  if (db.findHostByFio(req.user.id, d.fio.trim())) {
    return res.status(400).json({ error: 'Такой хозяин уже есть' });
  }
  const host = db.createHost(req.user.id, {
    fio: d.fio.trim(),
    limit_count: parseInt(d.limit) || 5,
    phone: d.phone || '',
    email: d.email || '',
    region: d.region || '',
    district: d.district || '',
    locality: d.locality || '',
    street: d.street || '',
    house: d.house || '',
    apt: d.apt || '',
    iin: d.iin || '',
    doc_type: d.doc_type || '',
    doc_number: d.doc_number || '',
    doc_issuer: d.doc_issuer || '',
    doc_date: d.doc_date || null,
    note: d.note || ''
  });
  res.json({ id: host.id, fio: host.fio });
});

app.put('/api/hosts/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const h = db.findHost(req.user.id, id);
  if (!h) return res.status(404).json({ error: 'Хозяин не найден' });
  const d = req.body;
  if (!d.fio || !d.fio.trim()) return res.status(400).json({ error: 'Укажите ФИО' });

  db.updateHost(req.user.id, id, {
    fio: d.fio.trim(),
    limit_count: parseInt(d.limit) || 5,
    phone: d.phone || '',
    email: d.email || '',
    region: d.region || '',
    district: d.district || '',
    locality: d.locality || '',
    street: d.street || '',
    house: d.house || '',
    apt: d.apt || '',
    iin: d.iin || '',
    doc_type: d.doc_type || '',
    doc_number: d.doc_number || '',
    doc_issuer: d.doc_issuer || '',
    doc_date: d.doc_date || null,
    note: d.note || ''
  });
  res.json({ ok: true });
});

app.delete('/api/hosts/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.deleteHost(req.user.id, id)) return res.status(404).json({ error: 'Хозяин не найден' });
  res.json({ ok: true });
});

// ========== PEOPLE ==========
app.get('/api/people', authMiddleware, (req, res) => {
  const archived = req.query.archived === '1';
  const rows = db.getPeople(req.user.id, archived);

  // Нумерация внутри хозяина
  const byHost = {};
  rows.forEach(p => {
    if (!byHost[p.host]) byHost[p.host] = [];
    byHost[p.host].push(p);
  });
  Object.keys(byHost).forEach(h => {
    byHost[h].sort((a, b) => a.id - b.id).forEach((p, i) => { p.num = i + 1; });
  });

  res.json(rows.map(enrichPerson));
});

app.post('/api/people', authMiddleware, (req, res) => {
  const d = req.body;
  if (!d.fio || !d.fio.trim()) return res.status(400).json({ error: 'Укажите ФИО' });
  if (!d.host) return res.status(400).json({ error: 'Выберите хозяина' });

  const person = db.createPerson(req.user.id, {
    host: d.host,
    fio: d.fio.trim(),
    iin: d.iin || '',
    from_whom: d.from || '',
    arrival: d.arrival || null,
    work_start: d.work_start || null,
    term: parseInt(d.term) || 3,
    status: d.status || 'Ожидает',
    email: d.email || '',
    phone: d.phone || '',
    region: d.region || '',
    district: d.district || '',
    locality: d.locality || '',
    street: d.street || '',
    house: d.house || '',
    apt: d.apt || '',
    doc_type: d.doc_type || '',
    doc_number: d.doc_number || '',
    doc_issuer: d.doc_issuer || '',
    doc_date: d.doc_date || null,
    note: d.note || ''
  });
  res.json(enrichPerson(person));
});

app.put('/api/people/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const p = db.findPerson(req.user.id, id);
  if (!p) return res.status(404).json({ error: 'Запись не найдена' });
  const d = req.body;
  if (!d.fio || !d.fio.trim()) return res.status(400).json({ error: 'Укажите ФИО' });
  if (!d.host) return res.status(400).json({ error: 'Выберите хозяина' });

  const updated = db.updatePerson(req.user.id, id, {
    host: d.host,
    fio: d.fio.trim(),
    iin: d.iin || '',
    from_whom: d.from || '',
    arrival: d.arrival || null,
    work_start: d.work_start || null,
    term: parseInt(d.term) || 3,
    status: d.status || 'Ожидает',
    email: d.email || '',
    phone: d.phone || '',
    region: d.region || '',
    district: d.district || '',
    locality: d.locality || '',
    street: d.street || '',
    house: d.house || '',
    apt: d.apt || '',
    doc_type: d.doc_type || '',
    doc_number: d.doc_number || '',
    doc_issuer: d.doc_issuer || '',
    doc_date: d.doc_date || null,
    note: d.note || ''
  });
  res.json(enrichPerson(updated));
});

app.post('/api/people/:id/archive', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.setArchived(req.user.id, id, true)) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ ok: true });
});

app.post('/api/people/:id/restore', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.setArchived(req.user.id, id, false)) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ ok: true });
});

app.delete('/api/people/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.deletePerson(req.user.id, id)) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ ok: true });
});

// Скачать / посмотреть файл РВП
app.get('/api/people/:id/rvp', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const p = db.findPerson(req.user.id, id);
  if (!p || !p.rvp_file || !p.rvp_file.data) return res.status(404).json({ error: 'Файл не найден' });
  res.json({ name: p.rvp_file.name, type: p.rvp_file.type, data: p.rvp_file.data });
});

// Загрузка файла «Разрешение на временное проживание» (PDF / картинка, до ~2.5 МБ)
app.put('/api/people/:id/rvp', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const p = db.findPerson(req.user.id, id);
  if (!p) return res.status(404).json({ error: 'Запись не найдена' });
  const { name, type, data } = req.body || {};
  if (!data) {
    // удаление файла
    db.updatePerson(req.user.id, id, { rvp_file: null });
    return res.json({ ok: true });
  }
  if (!name || !type || typeof data !== 'string') {
    return res.status(400).json({ error: 'Неверный формат файла' });
  }
  // base64 size check (~2.5 MB decoded)
  const approxBytes = Math.ceil(data.length * 0.75);
  if (approxBytes > 2.5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Файл слишком большой (макс. 2.5 МБ)' });
  }
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(type) && !type.startsWith('image/')) {
    return res.status(400).json({ error: 'Разрешены только PDF и изображения' });
  }
  db.updatePerson(req.user.id, id, {
    rvp_file: { name: String(name).slice(0, 200), type, data, size: approxBytes, uploaded_at: new Date().toISOString() }
  });
  res.json({ ok: true, name, type, size: approxBytes });
});

// ========== STATS ==========
app.get('/api/stats', authMiddleware, (req, res) => {
  const hosts = db.getHosts(req.user.id);
  const people = db.getPeople(req.user.id, false);
  const archivedPeople = db.getPeople(req.user.id, true);
  const allPeople = db.get().people.filter(p => p.user_id === req.user.id);

  // Свободные места: учитываем и архив (архив занимает слот)
  const occupying = people.concat(archivedPeople).filter(occupiesSlot);
  const totalSlots = hosts.reduce((s, h) => s + (h.limit_count || h.limit || 5), 0);
  const used = occupying.length;
  const free = Math.max(0, totalSlots - used);
  // Мигранты — ВСЕ (основной список + архив, в т.ч. с истёкшим сроком)
  const allMigrants = people.concat(archivedPeople);
  const migrantsCount = allMigrants.length;
  const migrantsActive = people.filter(occupiesSlot).length;
  const migrantsInactive = migrantsCount - migrantsActive;

  const today = new Date().toISOString().slice(0, 10);
  const past = allPeople.filter(p => {
    if (p.archived || p.status === 'Готово' || !p.arrival) return false;
    const dep = addDays(p.arrival, 29);
    return dep && dep < today;
  }).length;

  const freeSoon = people.filter(p => {
    if (!p.work_start) return false;
    const regEnd = addMonths(p.work_start, p.term || 3);
    const left = daysLeft(regEnd);
    return left != null && left > 0 && left <= 30;
  }).length;

  res.json({ hosts: hosts.length, migrants: migrantsCount, migrantsActive, migrantsInactive, free, freeSoon, past });
});

// ========== IMPORT ==========
app.post('/api/import', authMiddleware, (req, res) => {
  const { hosts, people, mode } = req.body;
  if (!Array.isArray(hosts) && !Array.isArray(people)) {
    return res.status(400).json({ error: 'Неверный формат' });
  }

  if (mode === 'replace') {
    db.replaceAll(req.user.id, [], []);
  }

  const existingHosts = db.getHosts(req.user.id).map(h => h.fio);
  (hosts || []).forEach(h => {
    if (!h.fio) return;
    if (!existingHosts.includes(h.fio) && !db.findHostByFio(req.user.id, h.fio)) {
      db.createHost(req.user.id, {
        fio: h.fio,
        limit_count: h.limit || 5,
        phone: h.phone || '',
        email: h.email || '',
        region: h.region || '',
        district: h.district || '',
        locality: h.locality || '',
        street: h.street || '',
        house: h.house || '',
        apt: h.apt || '',
        iin: h.iin || '',
        doc_type: h.doc_type || '',
        doc_number: h.doc_number || '',
        doc_issuer: h.doc_issuer || '',
        doc_date: h.doc_date || null,
        note: h.note || ''
      });
      existingHosts.push(h.fio);
    }
  });

  let imported = 0;
  (people || []).forEach(p => {
    if (!p.fio || !p.host) return;
    if (!db.findHostByFio(req.user.id, p.host)) {
      db.createHost(req.user.id, { fio: p.host, limit_count: 5 });
    }
    db.createPerson(req.user.id, {
      host: p.host,
      fio: p.fio,
      iin: p.iin || '',
      from_whom: p.from || p.from_whom || '',
      arrival: p.arrival || null,
      work_start: p.work_start || null,
      term: p.term || 3,
      status: p.status || 'Ожидает',
      email: p.email || '',
      phone: p.phone || '',
      region: p.region || '',
      district: p.district || '',
      locality: p.locality || '',
      street: p.street || '',
      house: p.house || '',
      apt: p.apt || '',
      doc_type: p.doc_type || '',
      doc_number: p.doc_number || '',
      doc_issuer: p.doc_issuer || '',
      doc_date: p.doc_date || null,
      note: p.note || '',
      archived: !!p.archived
    });
    imported++;
  });

  res.json({ ok: true, imported });
});

// Frontend fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Учёт прописки запущен на порту', PORT);
});
