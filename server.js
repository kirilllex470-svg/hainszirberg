// server.js (САМЫЙ ВЕРХ ФАЙЛА)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ВОТ ТЕПЕРЬ СОЗДАЕМ СЕРВЕР (СТРОГО ОДИН РАЗ НА ВЕСЬ ФАЙЛ)
const server = http.createServer();

// Дальше оставляем ваш старый код без изменений...
const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const FRIENDS_FILE = path.join(__dirname, 'friends.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json'); 
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Проверка и создание директории для медиафайлов
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Безопасные утилиты чтения/записи JSON с обработкой ошибок
function readJSON(filePath, defaultVal = {}) {
    try { 
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8')); 
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

// ... (подключение файлов JSON и объявление баз данных из Окон 1 и 2)

// Загрузка баз данных при старте
let usersDB = readJSON(USERS_FILE, {});
let roomsDB = readJSON(HISTORY_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});
let groupsDB = readJSON(GROUPS_FILE, {});
let requestsDB = readJSON(REQUESTS_FILE, {});

const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
let sessionsDB = readJSON(SESSIONS_FILE, { tokens: {}, lastRead: {} });

const clients = new Map();



// Простая функция генерации защищенных сессионных токенов
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Хелпер для разбора JSON-тела POST-запросов
function parseJsonBody(req, callback) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        try {
            callback(null, JSON.parse(body));
        } catch (e) {
            callback(e, null);
        }
    });
}

// Обработчик эндпоинта авторизации
function handleAuthRoute(req, res) {
    parseJsonBody(req, (err, data) => {
        if (err || !data || !data.username || !data.password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: "Пустые или некорректные поля!" }));
        }

        const { username, password } = data;
        const userKey = username.trim().toLowerCase();
        
        // Хешируем пароль с солью (имя пользователя) для безопасности в Darknet-контексте
        const hashedPassword = crypto.createHmac('sha256', userKey).update(password).digest('hex');

        if (usersDB[userKey]) {
            // Проверка пароля существующего аккаунта
            if (usersDB[userKey].password === hashedPassword) {
                const token = generateToken();
                sessionsDB.tokens[token] = usersDB[userKey].username;
                writeJSON(SESSIONS_FILE, sessionsDB);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, token, username: usersDB[userKey].username }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: "Неверный пароль!" }));
            }
        } else {
            // Регистрация нового аккаунта
            usersDB[userKey] = { username: username.trim(), password: hashedPassword };
            writeJSON(USERS_FILE, usersDB);

            const token = generateToken();
            sessionsDB.tokens[token] = usersDB[userKey].username;
            writeJSON(SESSIONS_FILE, sessionsDB);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, token, username: usersDB[userKey].username }));
        }
    });
}
// server.js (Часть 3: Валидация сессий, Контакты и Заявки)

// Функция валидации токена авторизации
function authenticateToken(req) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return null;
    return sessionsDB.tokens[token] || null; // Возвращает true-имя пользователя или null
}

// Запрос списка друзей и подсчет непрочитанных
// Замените эту функцию в server.js

function handleGetFriendsRoute(req, res, username) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    const myLower = username.toLowerCase();
    const myFriends = friendsDB[myLower] || [];
    const myReads = sessionsDB.lastRead[myLower] || {};
    const myIncomingRequests = requestsDB[myLower] || []; // Достаем входящие заявки
    const listData = [];

    // 1. Сначала пушим в список входящие заявки, чтобы фронтенд их отрендерил
    myIncomingRequests.forEach(fromUser => {
        listData.push({
            name: fromUser,
            lastMessage: "Хочет добавиться в друзья",
            time: "",
            unread: 0,
            isGroup: false,
            isRequest: true // Специальный флаг для фронтенда
        });
    });

    // 2. Пушим обычные приватные чаты с друзьями
    myFriends.forEach(friendName => {
        const friendLower = friendName.toLowerCase();
        const sortedRoom = [myLower, friendLower].sort();
        const roomId = `${sortedRoom}_${sortedRoom}`;
        const roomMessages = roomsDB[roomId] || [];
        
        let lastMsgText = "Нет сообщений";
        let lastMsgTime = "";
        let unreadCount = 0;
        const myLastReadTime = myReads[roomId] || 0;
        
        if (roomMessages.length > 0) {
            const lastMsg = roomMessages[roomMessages.length - 1];
            if (lastMsg.type === 'audio') lastMsgText = "🎙️ Голосовое";
            else if (lastMsg.type === 'video') lastMsgText = "🎥 Кружок";
            else if (lastMsg.type === 'file') lastMsgText = "📎 Файл";
            else lastMsgText = lastMsg.text || "";
            lastMsgTime = lastMsg.time || "";
            
            roomMessages.forEach(msg => {
                if (msg.sender.toLowerCase() !== myLower && (msg.timestamp || 0) > myLastReadTime) {
                    unreadCount++;
                }
            });
        }
        listData.push({ name: friendName, lastMessage: lastMsgText, time: lastMsgTime, unread: unreadCount, isGroup: false, isRequest: false });
    });

    // 3. Пушим конференции
    Object.keys(groupsDB).forEach(groupId => {
        const group = groupsDB[groupId];
        if (group.members.some(m => m.toLowerCase() === myLower)) {
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
                else lastMsgText = `${lastMsg.sender}: ${lastMsg.text || ""}`;
                lastMsgTime = lastMsg.time || "";

                roomMessages.forEach(msg => {
                    if (msg.sender.toLowerCase() !== myLower && (msg.timestamp || 0) > myLastReadTime) {
                        unreadCount++;
                    }
                });
            }
            listData.push({ id: groupId, name: group.name, lastMessage: lastMsgText, time: lastMsgTime, unread: unreadCount, isGroup: true, isRequest: false });
        }
    });

    return res.end(JSON.stringify(listData));
}


// Отправка запроса в друзья
function handleSendFriendRequestRoute(req, res, username) {
    parseJsonBody(req, (err, data) => {
        if (err || !data || !data.to) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: "Неполные данные" }));
        }
        const targetKey = data.to.trim().toLowerCase();
        if (!usersDB[targetKey]) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: "Пользователь не найден!" }));
        }
        if (targetKey === username.toLowerCase()) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: "Нельзя добавить самого себя" }));
        }
        if (!requestsDB[targetKey]) requestsDB[targetKey] = [];
        if (!requestsDB[targetKey].includes(username)) {
            requestsDB[targetKey].push(username);
            writeJSON(REQUESTS_FILE, requestsDB);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
    });
}
// server.js (Часть 4: Ответы на заявки, Группы и Конференции)

// Принятие/отклонение заявок в друзья
function handleRespondRequestRoute(req, res, username) {
    parseJsonBody(req, (err, data) => {
        if (err || !data || !data.from || !data.action) {
            res.writeHead(400); return res.end('Bad Request');
        }
        const myLower = username.toLowerCase();
        const fromLower = data.from.trim().toLowerCase();

        if (requestsDB[myLower]) {
            requestsDB[myLower] = requestsDB[myLower].filter(name => name.toLowerCase() !== fromLower);
            writeJSON(REQUESTS_FILE, requestsDB);
        }

        if (data.action === 'accept') {
            const trueMyName = usersDB[myLower] ? usersDB[myLower].username : username;
            const trueFromName = usersDB[fromLower] ? usersDB[fromLower].username : data.from;

            if (!friendsDB[myLower]) friendsDB[myLower] = [];
            if (!friendsDB[myLower].includes(trueFromName)) friendsDB[myLower].push(trueFromName);

            if (!friendsDB[fromLower]) friendsDB[fromLower] = [];
            if (!friendsDB[fromLower].includes(trueMyName)) friendsDB[fromLower].push(trueMyName);

            writeJSON(FRIENDS_FILE, friendsDB);
        }
        res.writeHead(200); return res.end('OK');
    });
}

// Сохранение отредактированного списка друзей (после удаления контакта)
function handleSaveFriendsRoute(req, res, username) {
    parseJsonBody(req, (err, data) => {
        if (err || !data || !Array.isArray(data.friends)) {
            res.writeHead(400); return res.end('Bad Request');
        }
        friendsDB[username.toLowerCase()] = data.friends;
        writeJSON(FRIENDS_FILE, friendsDB);
        res.writeHead(200); return res.end('OK');
    });
}

// Создание групповой конференции
function handleCreateGroupRoute(req, res, username) {
    parseJsonBody(req, (err, data) => {
        if (err || !data || !data.groupName || !Array.isArray(data.members)) {
            res.writeHead(400); return res.end('Bad Request');
        }
        const groupId = `group_${crypto.randomBytes(6).toString('hex')}`;
        const members = data.members.map(m => m.trim()).filter(m => m !== '');
        
        if (!members.map(m => m.toLowerCase()).includes(username.toLowerCase())) {
            members.push(username);
        }
        
        groupsDB[groupId] = { name: data.groupName.trim(), members: members, creator: username };
        writeJSON(GROUPS_FILE, groupsDB);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, groupId }));
    });
}

// Удаление конференции для всех участников
function handleDeleteGroupRoute(req, res, username) {
    parseJsonBody(req, (err, data) => {
        if (err || !data || !data.groupId || !groupsDB[data.groupId]) {
            res.writeHead(400); return res.end('Bad Request');
        }
        
        delete groupsDB[data.groupId];
        writeJSON(GROUPS_FILE, groupsDB);
        
        if (roomsDB[data.groupId]) {
            delete roomsDB[data.groupId];
            writeJSON(HISTORY_FILE, roomsDB);
        }
        res.writeHead(200); return res.end('OK');
    });
}
// server.js (Часть 5: Безопасный Multipart-парсер и Защита статики)

// Потоковый разбор multipart данных без перевода бинарников в UTF-8 строку
function parseMultipartFormData(req, res, callback) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
        return callback(new Error('Ожидался FormData'), null);
    }
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
    if (!boundary) return callback(new Error('Не найден boundary'), null);

    let chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const boundaryBuf = Buffer.from('--' + boundary);
        let parts = [];
        let start = 0;

        // Побайтовый поиск границ multipart-блоков
        while (start < buffer.length) {
            let idx = buffer.indexOf(boundaryBuf, start);
            if (idx === -1) break;
            if (start !== 0) parts.push(buffer.subarray(start, idx));
            start = idx + boundaryBuf.length;
        }

        let fields = {};
        let fileData = null;

        for (let part of parts) {
            if (part.length < 4) continue;
            let headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
            if (headerEnd === -1) continue;

            let headerStr = part.subarray(0, headerEnd).toString('utf-8');
            let body = part.subarray(headerEnd + 4, part.length - 2); // Срезаем \r\n в конце

            let nameMatch = headerStr.match(/name="([^"]+)"/);
            if (!nameMatch) continue;
            let fieldName = nameMatch[1];

            if (headerStr.includes('filename="')) {
                let filenameMatch = headerStr.match(/filename="([^"]+)"/);
                let originalName = filenameMatch ? filenameMatch[1] : 'file.bin';
                let ext = path.extname(originalName).replace('.', '') || 'bin';
                fileData = { buffer: body, ext, originalName };
            } else {
                fields[fieldName] = body.toString('utf-8').trim();
            }
        }
        callback(null, { fields, file: fileData });
    });
}

// Защищенная от Path Traversal отдача медиафайлов
function handleServeMedia(req, res) {
    // Декодируем и очищаем путь от попыток выхода из папки с помощью относительных переходов
    const safeUrl = decodeURIComponent(req.url).replace(/\.\./g, '');
    const filePath = path.join(__dirname, safeUrl);

    // Гарантируем, что запрашиваемый файл находится строго внутри директории uploads
    if (!filePath.startsWith(UPLOADS_DIR)) {
        res.writeHead(403); return res.end('Access Denied');
    }

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('File Not Found'); }
        let contentType = 'application/octet-stream';
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.mp4') contentType = 'video/mp4';
        else if (ext === '.webm') contentType = req.url.includes('audio') ? 'audio/webm' : 'video/webm';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.pdf') contentType = 'application/pdf';

        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'max-age=86400' });
        res.end(data);
    });
}
// server.js (Часть 6: Отправка сообщений, HTTP Роутер и WebSocket)

// Хелпер отправки сообщений (как обычных, так и медиа-файлов)
function handleSendMessageRoute(req, res, username) {
    parseMultipartFormData(req, res, (err, result) => {
        if (err || !result || !result.fields.room) {
            res.writeHead(400); return res.end('Incomplete data');
        }
        const { fields, file } = result;
        const { room, type, text, forwardedFrom, parentMsgId, parentMsgText, parentMsgSender } = fields;
        let finalContent = text || '';

        if ((type === 'audio' || type === 'video' || type === 'file') && file && file.buffer.length > 0) {
            const fileName = `${type}_${crypto.randomBytes(8).toString('hex')}.${file.ext}`;
            const filePath = path.join(UPLOADS_DIR, fileName);
            fs.writeFileSync(filePath, file.buffer);
            
            if (type === 'file') {
                finalContent = JSON.stringify({ path: `/uploads/${fileName}`, name: file.originalName });
            } else {
                finalContent = `/uploads/${fileName}`;
            }
        }

        const now = new Date();
        const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const newMsg = {
            id: crypto.randomBytes(8).toString('hex'),
            sender: username,
            text: finalContent,
            type: type || 'text',
            time: timeStr,
            timestamp: Date.now(),
            forwardedFrom: forwardedFrom || null,
            parent: parentMsgId ? { id: parentMsgId, text: parentMsgText, sender: parentMsgSender } : null
        };

        if (!roomsDB[room]) roomsDB[room] = [];
        roomsDB[room].push(newMsg);
        if (roomsDB[room].length > 250) roomsDB[room].shift();
        writeJSON(HISTORY_FILE, roomsDB);

        // Мгновенная рассылка уведомлений через WebSocket
        broadcastToRoom(room, { action: 'newMessage', room, message: newMsg });

        res.writeHead(200); return res.end('OK');
    });
}

// Поиск и доставка обновлений всем активным участникам текущей комнаты
function broadcastToRoom(room, data) {
    const payload = JSON.stringify(data);
    if (room.startsWith('group_')) {
        const group = groupsDB[room];
        if (group) {
            group.members.forEach(member => {
                const ws = clients.get(member.toLowerCase());
                if (ws && ws.readyState === 1) ws.send(payload);
            });
        }
    } else {
        const parts = room.split('_');
        if (parts.length > 0) {
            const user1 = parts[0];
            const ws1 = clients.get(user1);
            if (ws1 && ws1.readyState === 1) ws1.send(payload);
            
            if (parts[1] && parts[0] !== parts[1]) {
                const ws2 = clients.get(parts[1]);
                if (ws2 && ws2.readyState === 1) ws2.send(payload);
            }
        }
    }
}

// Точка входа для WebSocket рукопожатий (Простейшая реализация на чистом Node.js)
server.on('upgrade', (request, socket, head) => {
    const myUrl = new URL(request.url, `http://${request.headers.host}`);
    const token = myUrl.searchParams.get('token');
    const user = sessionsDB.tokens[token];

    if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    // Отправляем стандартные заголовки для переключения протокола на WebSocket
    const key = request.headers['sec-websocket-key'];
    const acceptKey = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                 'Upgrade: websocket\r\n' +
                 'Connection: Upgrade\r\n' +
                 `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);

    const userKey = user.toLowerCase();
    
    // Фейковый минималистичный парсер фреймов WebSocket для поддержания коннекта
    const clientSocket = {
        readyState: 1,
        send: (msg) => {
            try {
                const dataBuf = Buffer.from(msg, 'utf-8');
                const len = dataBuf.length;
                let frame;
                if (len <= 125) {
                    frame = Buffer.alloc(2 + len);
                    frame[0] = 0x81; frame[1] = len;
                    dataBuf.copy(frame, 2);
                } else if (len < 65536) {
                    frame = Buffer.alloc(4 + len);
                    frame[0] = 0x81; frame[1] = 126;
                    frame.writeUInt16BE(len, 2);
                    dataBuf.copy(frame, 4);
                } else {
                    frame = Buffer.alloc(10 + len);
                    frame[0] = 0x81; frame[1] = 127;
                    frame.writeBigUInt64BE(BigInt(len), 2);
                    dataBuf.copy(frame, 10);
                }
                socket.write(frame);
            } catch(e) {}
        }
    };

    clients.set(userKey, clientSocket);
    socket.on('close', () => { clients.delete(userKey); });
    socket.on('error', () => { clients.delete(userKey); });
});

// Основной HTTP Диспетчер роутов
server.on('request', (req, res) => {
    if (req.url === '/api/auth' && req.method === 'POST') return handleAuthRoute(req, res);
    if (req.url.startsWith('/uploads/')) return handleServeMedia(req, res);
    
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) { res.writeHead(500); return res.end('Internal Error'); }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // Проверка защищенных маршрутов API
    const username = authenticateToken(req);
    if (!username) {
        res.writeHead(401); return res.end('Unauthorized');
    }

    if (req.url.startsWith('/api/friends/get') && req.method === 'GET') return handleGetFriendsRoute(req, res, username);
    if (req.url === '/api/friends/request/send' && req.method === 'POST') return handleSendFriendRequestRoute(req, res, username);
    if (req.url === '/api/friends/request/respond' && req.method === 'POST') return handleRespondRequestRoute(req, res, username);
    if (req.url === '/api/friends/save' && req.method === 'POST') return handleSaveFriendsRoute(req, res, username);
    if (req.url === '/api/groups/create' && req.method === 'POST') return handleCreateGroupRoute(req, res, username);
    if (req.url === '/api/groups/delete' && req.method === 'POST') return handleDeleteGroupRoute(req, res, username);
    
    if (req.url.startsWith('/api/messages') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host}`);
        const room = myUrl.searchParams.get('room');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(roomsDB[room] || []));
    }

    if (req.url === '/api/messages/delete' && req.method === 'POST') {
        parseJsonBody(req, (err, data) => {
            const { room, messageId } = data;
            if (room && messageId && roomsDB[room]) {
                roomsDB[room] = roomsDB[room].filter(msg => msg.id !== messageId);
                writeJSON(HISTORY_FILE, roomsDB);
                broadcastToRoom(room, { action: 'deleteMessage', room, messageId });
                res.writeHead(200); return res.end('OK');
            }
            res.writeHead(400); res.end('Bad Request');
        });
        return;
    }

    if (req.url === '/api/messages/read' && req.method === 'POST') {
        parseJsonBody(req, (err, data) => {
            const { room } = data;
            if (room) {
                const myLower = username.toLowerCase();
                if (!sessionsDB.lastRead[myLower]) sessionsDB.lastRead[myLower] = {};
                sessionsDB.lastRead[myLower][room] = Date.now();
                writeJSON(SESSIONS_FILE, sessionsDB);
                res.writeHead(200); return res.end('OK');
            }
            res.writeHead(400); res.end('Bad Request');
        });
        return;
    }

    if (req.url === '/api/send' && req.method === 'POST') return handleSendMessageRoute(req, res, username);

    res.writeHead(404); res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Сервер полностью запущен на порту ${PORT}`); });
