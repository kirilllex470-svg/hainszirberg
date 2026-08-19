const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const FRIENDS_FILE = path.join(__dirname, 'friends.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) { fs.mkdirSync(UPLOADS_DIR); }

function readJSON(filePath, defaultVal = {}) {
    try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } 
    catch (e) { console.error("Ошибка чтения файла:", e); }
    return defaultVal;
}

function writeJSON(filePath, data) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8'); } 
    catch (e) { console.error("Ошибка записи файла:", e); }
}

let usersDB = readJSON(USERS_FILE, {});
let roomsDB = readJSON(HISTORY_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});

const server = http.createServer((req, res) => {
    // 1. Авторизация
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
        if (user && friendsDB[user.toLowerCase()]) return res.end(JSON.stringify(friendsDB[user.toLowerCase()]));
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

    // 5. Оптимизированный прием FormData (Текст/Аудио/Видео) под ограничения Render
    if (req.url === '/api/send' && req.method === 'POST') {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            res.writeHead(400); return res.end('Ожидался FormData');
        }

        const boundary = contentType.split('boundary=')[1];
        let chunks = [];

        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const bufferStr = buffer.toString('binary');
            const parts = bufferStr.split('--' + boundary);

            let fields = {};
            let fileBuffer = null;
            let fileExt = 'webm';

            for (let part of parts) {
                if (part.includes('Content-Disposition: form-data;')) {
                    const matchName = part.match(/name="([^"]+)"/);
                    if (!matchName) continue;
                    const name = matchName[1];

                    if (part.includes('filename="')) {
                        // Это медиафайл
                        const fileMatch = part.match(/Content-Type:\s*([^\s\r\n]+)/);
                        const mime = fileMatch ? fileMatch[1] : '';
                        if (mime.includes('mp4')) fileExt = 'mp4';
                        else if (mime.includes('ogg')) fileExt = 'ogg';

                        // Вырезаем чистый бинарник файла из потока FormData
                        const headerEnd = part.indexOf('\r\n\r\n') + 4;
                        const fileContentBinary = part.substring(headerEnd, part.length - 2);
                        fileBuffer = Buffer.from(fileContentBinary, 'binary');
                    } else {
                        // Это обычное текстовое поле
                        const headerEnd = part.indexOf('\r\n\r\n') + 4;
                        const value = part.substring(headerEnd, part.length - 2).trim();
                        fields[name] = Buffer.from(value, 'binary').toString('utf-8');
                    }
                }
            }

            const { sender, room, type, text } = fields;
            if (sender && room) {
                let finalContent = text || '';

                if ((type === 'audio' || type === 'video') && fileBuffer && fileBuffer.length > 0) {
                    const fileName = `${type}_${crypto.randomBytes(8).toString('hex')}.${fileExt}`;
                    const filePath = path.join(UPLOADS_DIR, fileName);
                    fs.writeFileSync(filePath, fileBuffer);
                    finalContent = `/uploads/${fileName}`;
                }

                const now = new Date();
                const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                if (!roomsDB[room]) roomsDB[room] = [];
                
                roomsDB[room].push({ sender, text: finalContent, type: type || 'text', time: timeStr });
                if (roomsDB[room].length > 150) roomsDB[room].shift();
                
                writeJSON(HISTORY_FILE, roomsDB);
                res.writeHead(200); return res.end('OK');
            }
            res.writeHead(400); res.end('Incomplete data');
        });
        return;
    }

    // 6. Стриминговая раздача сохраненных файлов медиа
    if (req.url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, req.url);
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); return res.end('File Not Found'); }
            
            let contentType = 'application/octet-stream';
            if (req.url.endsWith('.mp4')) contentType = 'video/mp4';
            else if (req.url.endsWith('.webm')) contentType = req.url.includes('audio') ? 'audio/webm' : 'video/webm';
            
            res.writeHead(200, { 
                'Content-Type': contentType, 
                'Cache-Control': 'max-age=86400',
                'Accept-Ranges': 'bytes'
            });
            res.end(data);
        });
        return;
    }

    // 7. Главная страница
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
server.listen(PORT, () => { console.log(`Сервер запущен под Render на порту ${PORT}`); });
