const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Пути к файлам баз данных JSON
const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const FRIENDS_FILE = path.join(__dirname, 'friends.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json'); // Новая БД для заявок
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Проверка и создание папки для медиафайлов
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

// Универсальные функции чтения и записи файлов
function readJSON(filePath, defaultVal = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) { 
        console.error("Ошибка чтения JSON:", e); 
    }
    return defaultVal;
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { 
        console.error("Ошибка записи JSON:", e); 
    }
}
// Загрузка баз данных в оперативную память при старте
let usersDB = readJSON(USERS_FILE, {});
let roomsDB = readJSON(HISTORY_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});
let groupsDB = readJSON(GROUPS_FILE, {});
let requestsDB = readJSON(REQUESTS_FILE, {}); // Структура: { "username": ["from_user1", "from_user2"] }

const db = {
    lastRead: {} // Хранение времени последнего прочтения комнат { "username": { "room_id": timestamp } }
};

const server = http.createServer((req, res) => {
    // 1. Авторизация и регистрация пользователей
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
                    // Регистрация нового пользователя
                    usersDB[userKey] = { username, password };
                    writeJSON(USERS_FILE, usersDB);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                }
            } catch (e) { 
                res.writeHead(400); 
                res.end('Bad Request'); 
            }
        });
        return;
    }
    // 2. Получение списка чатов (Личные + Конференции) со счётчиками
    if (req.url.startsWith('/api/friends/get') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const user = myUrl.searchParams.get('user');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        
        if (user) {
            const myLowerName = user.toLowerCase();
            const myFriends = friendsDB[myLowerName] || [];
            const myReads = db.lastRead[myLowerName] || {};
            
            const listData = myFriends.map(friendName => {
                const friendLower = friendName.toLowerCase();
                const sortedRoom = [myLowerName, friendLower].sort();
                const roomId = `${sortedRoom}_${sortedRoom}`;
                const roomMessages = roomsDB[roomId] || [];
                
                let lastMsgText = "Нет сообщений";
                let lastMsgTime = "";
                let unreadCount = 0;
                const myLastReadTime = myReads[roomId] || 0;
                
                if (roomMessages.length > 0) {
                    const lastMsg = roomMessages[roomMessages.length - 1];
                    if (lastMsg.type === 'audio') lastMsgText = "🎙️ Голосовое сообщение";
                    else if (lastMsg.type === 'video') lastMsgText = "🎥 Видео-кружок";
                    else if (lastMsg.type === 'file') lastMsgText = "📎 Файл / Документ";
                    else lastMsgText = lastMsg.text;
                    lastMsgTime = lastMsg.time || "";
                    
                    roomMessages.forEach(msg => {
                        if (msg.sender.toLowerCase() !== myLowerName && (msg.timestamp || 0) > myLastReadTime) {
                            unreadCount++;
                        }
                    });
                }
                return { name: friendName, lastMessage: lastMsgText, time: lastMsgTime, unread: unreadCount, isGroup: false };
            });

            Object.keys(groupsDB).forEach(groupId => {
                const group = groupsDB[groupId];
                const isParticipant = group.members.some(m => m.toLowerCase() === myLowerName);
                
                if (isParticipant) {
                    const roomMessages = roomsDB[groupId] || [];
                    let lastMsgText = "Нет сообщений";
                    let lastMsgTime = "";
                    let unreadCount = 0;
                    const myLastReadTime = myReads[groupId] || 0;

                    if (roomMessages.length > 0) {
                        const lastMsg = roomMessages[roomMessages.length - 1];
                        if (lastMsg.type === 'audio') lastMsgText = `🎙️ ${lastMsg.sender}: Голосовое`;
                        else if (lastMsg.type === 'video') lastMsgText = `🎥 ${lastMsg.sender}: Кружок`;
                        else if (lastMsg.type === 'file') lastMsgText = `📎 ${lastMsg.sender}: Файл`;
                        else lastMsgText = `${lastMsg.sender}: ${lastMsg.text}`;
                        lastMsgTime = lastMsg.time || "";

                        roomMessages.forEach(msg => {
                            if (msg.sender.toLowerCase() !== myLowerName && (msg.timestamp || 0) > myLastReadTime) {
                                unreadCount++;
                            }
                        });
                    }
                    listData.push({ id: groupId, name: group.name, lastMessage: lastMsgText, time: lastMsgTime, unread: unreadCount, isGroup: true });
                }
            });
            return res.end(JSON.stringify(listData));
        }
        return res.end(JSON.stringify([]));
    }
    // 3. Отправка запроса в друзья с проверкой существования пользователя
    if (req.url === '/api/friends/request/send' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { from, to } = JSON.parse(body);
                if (!from || !to) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "Неполные данные" }));
                }
                const targetKey = to.toLowerCase();
                const fromKey = from.toLowerCase();

                // Проверяем, существует ли целевой пользователь в базе данных
                if (!usersDB[targetKey]) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "Пользователь не найден!" }));
                }

                if (!requestsDB[targetKey]) requestsDB[targetKey] = [];
                
                // Проверяем, не отправлен ли запрос ранее
                if (!requestsDB[targetKey].includes(from)) {
                    requestsDB[targetKey].push(from);
                    writeJSON(REQUESTS_FILE, requestsDB);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400); res.end('Bad Request');
            }
        });
        return;
    }

    // 3.1 Получение списка входящих заявок в друзья для пользователя
    if (req.url.startsWith('/api/friends/requests') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const user = myUrl.searchParams.get('user');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        if (user) {
            const list = requestsDB[user.toLowerCase()] || [];
            return res.end(JSON.stringify(list));
        }
        return res.end(JSON.stringify([]));
    }
    // 3.2 Ответ на запрос в друзья (accept / decline)
    if (req.url === '/api/friends/request/respond' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { user, from, action } = JSON.parse(body);
                if (user && from && action) {
                    const myLower = user.toLowerCase();
                    const fromLower = from.toLowerCase();

                    // Удаляем запрос из списка входящих
                    if (requestsDB[myLower]) {
                        requestsDB[myLower] = requestsDB[myLower].filter(name => name.toLowerCase() !== fromLower);
                        writeJSON(REQUESTS_FILE, requestsDB);
                    }

                    if (action === 'accept') {
                        // Получаем настоящие имена пользователей из бд (для сохранения регистра)
                        const trueMyName = usersDB[myLower] ? usersDB[myLower].username : user;
                        const trueFromName = usersDB[fromLower] ? usersDB[fromLower].username : from;

                        // Добавляем друга мне
                        if (!friendsDB[myLower]) friendsDB[myLower] = [];
                        if (!friendsDB[myLower].includes(trueFromName)) {
                            friendsDB[myLower].push(trueFromName);
                        }

                        // Добавляем меня другу взаимно
                        if (!friendsDB[fromLower]) friendsDB[fromLower] = [];
                        if (!friendsDB[fromLower].includes(trueMyName)) {
                            friendsDB[fromLower].push(trueMyName);
                        }

                        writeJSON(FRIENDS_FILE, friendsDB);
                    }
                    res.writeHead(200); return res.end('OK');
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 3.3 Прямое сохранение списка друзей (оставляем для обратной совместимости)
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

    // 3.5 Создание конференции
    if (req.url === '/api/groups/create' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { creator, groupName, members } = JSON.parse(body);
                if (creator && groupName && Array.isArray(members)) {
                    const groupId = `group_${crypto.randomBytes(6).toString('hex')}`;
                    if (!members.map(m => m.toLowerCase()).includes(creator.toLowerCase())) {
                        members.push(creator);
                    }
                    groupsDB[groupId] = { name: groupName, members: members, creator: creator };
                    writeJSON(GROUPS_FILE, groupsDB);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, groupId }));
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }
    // 4.7 Удаление сообщения из истории чата
    if (req.url === '/api/messages/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { room, messageId } = JSON.parse(body);
                if (room && messageId && roomsDB[room]) {
                    roomsDB[room] = roomsDB[room].filter(msg => msg.id !== messageId);
                    writeJSON(HISTORY_FILE, roomsDB);
                    res.writeHead(200); return res.end('OK');
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 4.9 Полное удаление групповой конференции для всех участников
    if (req.url === '/api/groups/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { groupId } = JSON.parse(body);
                if (groupId && groupsDB[groupId]) {
                    delete groupsDB[groupId];
                    writeJSON(GROUPS_FILE, groupsDB);
                    if (roomsDB[groupId]) {
                        delete roomsDB[groupId];
                        writeJSON(HISTORY_FILE, roomsDB);
                    }
                    res.writeHead(200); return res.end('OK');
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 4.10 Получение истории сообщений для комнаты (Исправление отсутствовавшего роута)
    if (req.url.startsWith('/api/messages') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const room = myUrl.searchParams.get('room');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        if (room) {
            const messages = roomsDB[room] || [];
            return res.end(JSON.stringify(messages));
        }
        return res.end(JSON.stringify([]));
    }
    // 4.11 Отметка сообщений в чате как прочитанных
    if (req.url === '/api/messages/read' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { user, room } = JSON.parse(body);
                if (user && room) {
                    const myLower = user.toLowerCase();
                    if (!db.lastRead[myLower]) db.lastRead[myLower] = {};
                    db.lastRead[myLower][room] = Date.now();
                    res.writeHead(200); return res.end('OK');
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 5. FormData Прием (С ПОДДЕРЖКОЙ ПЕРЕСЫЛКИ И МЕДИА)
    if (req.url === '/api/send' && req.method === 'POST') {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            res.writeHead(400); return res.end('Ожидался FormData');
        }
        
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
        const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
        if (!boundary) { res.writeHead(400); return res.end('Не найден boundary'); }

        let chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const bufferStr = buffer.toString('binary');
            const parts = bufferStr.split('--' + boundary);
            let fields = {};
            let fileBuffer = null;
            let fileExt = 'bin';
            let originalFileName = '';

            for (let part of parts) {
                if (part.includes('Content-Disposition: form-data;')) {
                    const matchName = part.match(/name="([^"]+)"/);
                    if (!matchName) continue;
                    const name = matchName[1];

                    if (part.includes('filename="')) {
                        const originalNameMatch = part.match(/filename="([^"]+)"/);
                        if (originalNameMatch) {
                            originalFileName = originalNameMatch[1];
                            if (originalFileName.includes('.')) {
                                const splitName = originalFileName.split('.');
                                fileExt = splitName[splitName.length - 1];
                            }
                        }
                        const headerEnd = part.indexOf('\r\n\r\n') + 4;
                        const fileContentBinary = part.substring(headerEnd, part.length - 2);
                        fileBuffer = Buffer.from(fileContentBinary, 'binary');
                    } else {
                        const headerEnd = part.indexOf('\r\n\r\n') + 4;
                        const value = part.substring(headerEnd, part.length - 2).trim();
                        fields[name] = Buffer.from(value, 'binary').toString('utf-8');
                    }
                }
            }
            const { sender, room, type, text, forwardedFrom } = fields;
            if (sender && room) {
                let finalContent = text || '';
                if ((type === 'audio' || type === 'video' || type === 'file') && fileBuffer && fileBuffer.length > 0) {
                    const fileName = `${type}_${crypto.randomBytes(8).toString('hex')}.${fileExt}`;
                    const filePath = path.join(UPLOADS_DIR, fileName);
                    fs.writeFileSync(filePath, fileBuffer);
                    if (type === 'file') {
                        finalContent = JSON.stringify({ path: `/uploads/${fileName}`, name: originalFileName });
                    } else {
                        finalContent = `/uploads/${fileName}`;
                    }
                }
                const now = new Date();
                const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                if (!roomsDB[room]) roomsDB[room] = [];
                roomsDB[room].push({ 
                    id: crypto.randomBytes(8).toString('hex'), 
                    sender, 
                    text: finalContent, 
                    type: type || 'text', 
                    time: timeStr, 
                    timestamp: Date.now(),
                    forwardedFrom: forwardedFrom || null
                });
                if (roomsDB[room].length > 150) roomsDB[room].shift();
                writeJSON(HISTORY_FILE, roomsDB);
                res.writeHead(200); return res.end('OK');
            }
            res.writeHead(400); res.end('Incomplete data');
        });
        return;
    }
    // 6. Раздача медиафайлов из папки uploads
    if (req.url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, req.url);
        fs.readFile(filePath, (err, data) => {
            if (err) { 
                res.writeHead(404); 
                return res.end('File Not Found'); 
            }
            let contentType = 'application/octet-stream';
            const ext = path.extname(req.url).toLowerCase();
            if (ext === '.mp4') contentType = 'video/mp4';
            else if (ext === '.webm') contentType = req.url.includes('audio') ? 'audio/webm' : 'video/webm';
            else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
            else if (ext === '.png') contentType = 'image/png';
            else if (ext === '.gif') contentType = 'image/gif';
            else if (ext === '.pdf') contentType = 'application/pdf';
            
            res.writeHead(200, { 
                'Content-Type': contentType, 
                'Cache-Control': 'max-age=86400', 
                'Accept-Ranges': 'bytes' 
            });
            res.end(data);
        });
        return;
    }
    // 7. Главная страница приложения
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) { 
                res.writeHead(500); 
                return res.end('Internal Error'); 
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }
    
    // Ответ по умолчанию для неизвестных маршрутов
    res.writeHead(404); 
    res.end('Not Found');
});

// Запуск сервера на порту из переменных окружения или 3000 по умолчанию
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { 
    console.log(`Сервер запущен на порту ${PORT}`); 
});
