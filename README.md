# Учёт прописки — полноценный сайт с бэкендом

Node.js + Express + JSON-хранилище (файловая БД).  
Данные хранятся на сервере, доступны с любого устройства после входа.

## Быстрый старт (на своём компьютере)

```bash
cd propiska-app
npm install
npm start
```

Открой в браузере: **http://localhost:3000**

При первом запуске создай администратора.

## Что есть

- Авторизация (JWT)
- Роли: администратор и обычные пользователи
- Хозяева и мигранты
- Архив
- Статистика
- Импорт / экспорт
- Тёмная тема
- Адреса Казахстана (области и районы)

Данные каждого пользователя изолированы (как в оригинале).

## Выложить в онлайн (бесплатно)

### Вариант 1 — Railway (рекомендую)

1. Зарегистрируйся на https://railway.app
2. New Project → Deploy from GitHub (или Upload)
3. Если через GitHub — загрузи эту папку в репозиторий
4. Railway сам определит Node.js
5. Start Command: `node server.js`
6. После деплоя получишь ссылку вида `https://xxx.up.railway.app`

### Вариант 2 — Render

1. https://render.com → New → Web Service
2. Подключи репозиторий или загрузи файлы
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Environment: Node

### Вариант 3 — Свой VPS (Timeweb, Beget, Selectel и т.д.)

```bash
# на сервере
git clone ... или загрузить файлы
cd propiska-app
npm install
npm start
```

Лучше поставить PM2:
```bash
npm install -g pm2
pm2 start server.js --name propiska
pm2 save
```

## Важные переменные окружения

- `PORT` — порт (по умолчанию 3000)
- `JWT_SECRET` — секрет для токенов (обязательно поменяй в продакшене!)

Пример:
```
JWT_SECRET=мой_очень_длинный_секретный_ключ_2026
```

## Структура

```
propiska-app/
  server.js      — основной сервер
  db.js          — работа с данными
  auth.js        — авторизация
  public/
    index.html   — интерфейс
  data/
    db.json      — файл базы (создаётся автоматически)
  package.json
```

## Безопасность

- Пароли хранятся в хеше (bcrypt)
- Токен живёт 30 дней
- Данные пользователей разделены по `user_id`
