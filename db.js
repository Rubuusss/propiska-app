const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'db.json');

const defaultData = {
  users: [],
  hosts: [],
  people: [],
  nextUserId: 1,
  nextHostId: 1,
  nextPersonId: 1
};

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('DB load error:', e.message);
  }
  return JSON.parse(JSON.stringify(defaultData));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

let data = load();

const db = {
  get() { return data; },
  save() { save(data); },
  // Users
  findUserByLogin(login) {
    return data.users.find(u => u.login === login);
  },
  findUserById(id) {
    return data.users.find(u => u.id === id);
  },
  createUser({ login, pass, role }) {
    const user = { id: data.nextUserId++, login, pass, role, created_at: new Date().toISOString() };
    data.users.push(user);
    save(data);
    return user;
  },
  updateUser(id, fields) {
    const u = data.users.find(x => x.id === id);
    if (!u) return null;
    Object.assign(u, fields);
    save(data);
    return u;
  },
  deleteUser(id) {
    data.users = data.users.filter(u => u.id !== id);
    data.hosts = data.hosts.filter(h => h.user_id !== id);
    data.people = data.people.filter(p => p.user_id !== id);
    save(data);
  },
  getUsers() {
    return data.users.map(u => ({ id: u.id, login: u.login, role: u.role, created_at: u.created_at }));
  },
  // Hosts
  getHosts(userId) {
    return data.hosts.filter(h => h.user_id === userId);
  },
  findHost(userId, id) {
    return data.hosts.find(h => h.id === id && h.user_id === userId);
  },
  findHostByFio(userId, fio) {
    return data.hosts.find(h => h.user_id === userId && h.fio === fio);
  },
  createHost(userId, fields) {
    const host = { id: data.nextHostId++, user_id: userId, ...fields };
    data.hosts.push(host);
    save(data);
    return host;
  },
  updateHost(userId, id, fields) {
    const h = data.hosts.find(x => x.id === id && x.user_id === userId);
    if (!h) return null;
    const oldFio = h.fio;
    Object.assign(h, fields);
    if (oldFio !== h.fio) {
      data.people.forEach(p => {
        if (p.user_id === userId && p.host === oldFio) p.host = h.fio;
      });
    }
    save(data);
    return h;
  },
  deleteHost(userId, id) {
    const h = data.hosts.find(x => x.id === id && x.user_id === userId);
    if (!h) return false;
    data.people = data.people.filter(p => !(p.user_id === userId && p.host === h.fio));
    data.hosts = data.hosts.filter(x => x.id !== id);
    save(data);
    return true;
  },
  // People
  getPeople(userId, archived = false) {
    return data.people.filter(p => p.user_id === userId && !!p.archived === archived);
  },
  findPerson(userId, id) {
    return data.people.find(p => p.id === id && p.user_id === userId);
  },
  createPerson(userId, fields) {
    const person = { id: data.nextPersonId++, user_id: userId, archived: false, ...fields };
    data.people.unshift(person);
    save(data);
    return person;
  },
  updatePerson(userId, id, fields) {
    const p = data.people.find(x => x.id === id && x.user_id === userId);
    if (!p) return null;
    Object.assign(p, fields);
    save(data);
    return p;
  },
  setArchived(userId, id, archived) {
    const p = data.people.find(x => x.id === id && x.user_id === userId);
    if (!p) return null;
    p.archived = archived;
    save(data);
    return p;
  },
  deletePerson(userId, id) {
    const before = data.people.length;
    data.people = data.people.filter(p => !(p.id === id && p.user_id === userId));
    if (data.people.length < before) {
      save(data);
      return true;
    }
    return false;
  },
  replaceAll(userId, hosts, people) {
    data.hosts = data.hosts.filter(h => h.user_id !== userId);
    data.people = data.people.filter(p => p.user_id !== userId);
    (hosts || []).forEach(h => {
      data.hosts.push({ id: data.nextHostId++, user_id: userId, ...h });
    });
    (people || []).forEach(p => {
      data.people.push({ id: data.nextPersonId++, user_id: userId, archived: !!p.archived, ...p });
    });
    save(data);
  }
};

module.exports = db;
