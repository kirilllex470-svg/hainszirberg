const http = require('http');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const FRIENDS_FILE = path.join(__dirname, 'friends.json');

function readJSON(filePath, defaultVal = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) { console.error("Ошибка парсинга файла: " + filePath, e); }
    return defaultVal;
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { console.error("Ошибка записи файла: " + filePath, e); }
}

let usersDB = readJSON(USERS_FILE, {});
let roomsDB = readJSON(HISTORY_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});

const server = http.createServer((req, res) => {
    // 1. Авторизация и регистрация
    if (req.url === '/api/auth' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                if (!username || !password) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "Пустые поля!" }));
                }
                const userKey = username.toLowerCase();
                if (usersDB[userKey]) {
                    if (usersDB[userKey].password === password) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: "Неверный пароль!" }));
                    }
                } else {
                    usersDB[userKey] = { username, password };
                    writeJSON(USERS_FILE, usersDB);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                }
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 2. Получение списка друзей
    if (req.url.startsWith('/api/friends/get') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const user = myUrl.searchParams.get('user');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        if (user && friendsDB[user.toLowerCase()]) {
            return res.end(JSON.stringify(friendsDB[user.toLowerCase()]));
        }
        return res.end(JSON.stringify([]));
    }

    // 3. Сохранение списка друзей
    if (req.url === '/api/friends/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { user, friends } = JSON.parse(body);
                if (user && Array.isArray(friends)) {
                    friendsDB[user.toLowerCase()] = friends;
                    writeJSON(FRIENDS_FILE, friendsDB);
                }
                res.writeHead(200); return res.end('OK');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 4. Отдача истории переписки
    if (req.url.startsWith('/api/messages') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const room = myUrl.searchParams.get('room');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        if (room && roomsDB[room]) return res.end(JSON.stringify(roomsDB[room]));
        return res.end(JSON.stringify([]));
    }

    // 5. Прием нового сообщения (включая голосовые и видео-кружки в Base64)
    if (req.url === '/api/send' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { sender, room, text, type } = JSON.parse(body);
                if (sender && room && text) {
                    const now = new Date();
                    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    if (!roomsDB[room]) roomsDB[room] = [];
                    roomsDB[room].push({ sender, text, type: type || 'text', time: timeStr });
                    if (roomsDB[room].length > 150) roomsDB[room].shift();
                    writeJSON(HISTORY_FILE, roomsDB);
                }
                res.writeHead(200); return res.end('OK');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 6. Главная страница
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) { res.writeHead(500); return res.end('Internal Error'); }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }
    res.writeHead(404); res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Сервер WhatsApp запущен на порту ${PORT}`); });
