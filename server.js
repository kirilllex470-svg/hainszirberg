const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

// НАЙДИТЕ И ЗАМЕНИТЕ ЭТИ СТРОКИ В НАЧАЛЕ server.js:
const DATA_DIR = '/data'; // Путь к нашему вечному диску на Render

// Если мы запускаем код на компьютере для теста, диска /data нет, используем текущую папку
const storagePath = fs.existsSync(DATA_DIR) ? DATA_DIR : __dirname;

const USERS_FILE = path.join(storagePath, 'users.json');
const HISTORY_FILE = path.join(storagePath, 'history.json');
const FRIENDS_FILE = path.join(storagePath, 'friends.json');
const GROUPS_FILE = path.join(storagePath, 'groups.json');
const REQUESTS_FILE = path.join(storagePath, 'requests.json'); 
const SUBSCRIPTIONS_FILE = path.join(storagePath, 'subscriptions.json'); 
const UPLOADS_DIR = path.join(storagePath, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

function readJSON(filePath, defaultVal = {}) {
    try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } 
    catch (e) { console.error("Ошибка чтения JSON:", e); }
    return defaultVal;
}

function writeJSON(filePath, data) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8'); } 
    catch (e) { console.error("Ошибка записи JSON:", e); }
}

// Сюда один раз вставляются сгенерированные ключи:
const vapidKeys = {
    publicKey: "BHuADoeSNqgu-DNYLbYvSs35USMYUUoAccEojQEXqTOjK5Kc_Bp2CbQQjGJ2cH0z5BacrHV2qj6t91aBwfQBMPk",
    privateKey: "SUQne7ZD3q4kIlaQxVOjyBKr4YMklQIX9vhXGvOwjkc"
};

webpush.setVapidDetails(
    'mailto:admin@darknetzone.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

let usersDB = readJSON(USERS_FILE, {});
let roomsDB = readJSON(HISTORY_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});
let groupsDB = readJSON(GROUPS_FILE, {});
let requestsDB = readJSON(REQUESTS_FILE, {});
let subscriptionsDB = readJSON(SUBSCRIPTIONS_FILE, {});
const db = { lastRead: {} };
const server = http.createServer((req, res) => {
    // Раздача Сервис-Воркера для шторки телефона с правильным заголовком Service-Worker-Allowed
    if (req.url === '/sw.js') {
        fs.readFile(path.join(__dirname, 'sw.js'), (err, data) => {
            if (err) { res.writeHead(404); return res.end('SW Not Found'); }
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Service-Worker-Allowed': '/' });
            res.end(data);
        });
        return;
    }

    if (req.url === '/api/push/subscribe' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { user, subscription } = JSON.parse(body);
                if (user && subscription) {
                    const userKey = user.toLowerCase();
                    if (!subscriptionsDB[userKey]) subscriptionsDB[userKey] = [];
                    
                    const exists = subscriptionsDB[userKey].some(s => s.endpoint === subscription.endpoint);
                    if (!exists) {
                        subscriptionsDB[userKey].push(subscription);
                        writeJSON(SUBSCRIPTIONS_FILE, subscriptionsDB);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

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
                    else lastMsgText = lastMsg.text || "";
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
                if (group.members.some(m => m.toLowerCase() === myLowerName)) {
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
                if (!usersDB[targetKey]) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "Пользователь не найден!" }));
                }
                if (!requestsDB[targetKey]) requestsDB[targetKey] = [];
                if (!requestsDB[targetKey].includes(from)) {
                    requestsDB[targetKey].push(from);
                    writeJSON(REQUESTS_FILE, requestsDB);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    if (req.url.startsWith('/api/friends/requests') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const user = myUrl.searchParams.get('user');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        if (user) return res.end(JSON.stringify(requestsDB[user.toLowerCase()] || []));
        return res.end(JSON.stringify([]));
    }

    if (req.url === '/api/friends/request/respond' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { user, from, action } = JSON.parse(body);
                if (user && from && action) {
                    const myLower = user.toLowerCase();
                    const fromLower = from.toLowerCase();

                    if (requestsDB[myLower]) {
                        requestsDB[myLower] = requestsDB[myLower].filter(name => name.toLowerCase() !== fromLower);
                        writeJSON(REQUESTS_FILE, requestsDB);
                    }

                    if (action === 'accept') {
                        const trueMyName = usersDB[myLower] ? usersDB[myLower].username : user;
                        const trueFromName = usersDB[fromLower] ? usersDB[fromLower].username : from;

                        if (!friendsDB[myLower]) friendsDB[myLower] = [];
                        if (!friendsDB[myLower].includes(trueFromName)) friendsDB[myLower].push(trueFromName);

                        if (!friendsDB[fromLower]) friendsDB[fromLower] = [];
                        if (!friendsDB[fromLower].includes(trueMyName)) friendsDB[fromLower].push(trueMyName);

                        writeJSON(FRIENDS_FILE, friendsDB);
                    }
                    res.writeHead(200); return res.end('OK');
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

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
    if (req.url === '/api/groups/create' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { creator, groupName, members } = JSON.parse(body);
                if (creator && groupName && Array.isArray(members)) {
                    const groupId = `group_${crypto.randomBytes(6).toString('hex')}`;
                    if (!members.map(m => m.toLowerCase()).includes(creator.toLowerCase())) members.push(creator);
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

    if (req.url === '/api/groups/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { groupId } = JSON.parse(body);
                if (groupId && groupsDB[groupId]) {
                    delete groupsDB[groupId];
                    writeJSON(GROUPS_FILE, groupsDB);
                    if (roomsDB[groupId]) { delete roomsDB[groupId]; writeJSON(HISTORY_FILE, roomsDB); }
                    res.writeHead(200); return res.end('OK');
                }
                res.writeHead(400); res.end('Bad Request');
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    if (req.url.startsWith('/api/messages') && req.method === 'GET') {
        const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const room = myUrl.searchParams.get('room');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        if (room) return res.end(JSON.stringify(roomsDB[room] || []));
        return res.end(JSON.stringify([]));
    }

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
    // ФУНКЦИЯ ТРИГГЕРА: Рассылает системные пуши на зарегистрированные телефоны участников
    function triggerPushNotifications(room, sender, text, type) {
        let targetUsers = [];
        
        // 1. Если это конференция, пушим всем участникам
        if (groupsDB[room]) {
            targetUsers = groupsDB[room].members.map(m => m.toLowerCase());
        } else {
            // 2. Если личный чат, парсим имена из ID комнаты
            const names = room.split('_');
            if (names.length > 0) {
                // Извлекаем имена из названия комнаты (сортированный массив по логике клиента)
                // Пример строки комнаты: user1,user2_user1,user2
                const cleanNames = names[0].split(',');
                targetUsers = cleanNames.map(n => n.toLowerCase());
            }
        }

        // Форматируем красивый текст для шторки в зависимости от типа сообщения
        let cleanText = text || '';
        if (type === 'audio') cleanText = "🎙️ Голосовое сообщение";
        if (type === 'video') cleanText = "🎥 Видео-кружок";
        if (type === 'file') cleanText = "📎 Отправил файл";

        const pushPayload = JSON.stringify({
            title: `Новое от ${sender}`,
            body: cleanText,
            room: room
        });

        // 3. Отправляем пуш-запросы всем, кроме самого отправителя
        targetUsers.forEach(userKey => {
            if (userKey !== sender.toLowerCase() && subscriptionsDB[userKey]) {
                // Фильтруем просроченные/удаленные токены на лету
                subscriptionsDB[userKey] = subscriptionsDB[userKey].filter(sub => {
                    webpush.sendNotification(sub, pushPayload)
                        .catch(err => {
                            // Если пуш-сервер (Google/Apple) говорит, что токен умер (410 или 404), удаляем его из БД
                            if (err.statusCode === 410 || err.statusCode === 404) {
                                return false; 
                            }
                            console.error("Ошибка отправки пуша:", err.message);
                        });
                    return true;
                });
            }
        });
        writeJSON(SUBSCRIPTIONS_FILE, subscriptionsDB);
    }
    if (req.url === '/api/send' && req.method === 'POST') {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            res.writeHead(400); return res.end('Ожидался FormData');
        }

        // 1. Получаем boundary (границу) из заголовка
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
        const boundaryStr = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
        if (!boundaryStr) { res.writeHead(400); return res.end('Не найден boundary'); }

        const boundary = Buffer.from('--' + boundaryStr);
        
        let chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            
            // 2. Парсим буфер вручную, не превращая его в строку (чтобы не сломать видео)
            let fields = {};
            let fileBuffer = null;
            let fileExt = 'bin';
            let originalFileName = '';
            
            let start = 0;
            let end = buffer.indexOf(boundary, start);
            
            while (end !== -1) {
                // Вырезаем кусок между границами
                const part = buffer.subarray(start, end);
                
                // Пропускаем границы и CRLF (\r\n)
                // Структура обычно: \r\nHeaders\r\n\r\nBody\r\n
                // Поэтому ищем двойной перенос строки \r\n\r\n
                const doubleCRLF = Buffer.from('\r\n\r\n');
                const headerEndIndex = part.indexOf(doubleCRLF);
                
                if (headerEndIndex !== -1) {
                    const headerBuf = part.subarray(0, headerEndIndex);
                    // Заголовки можно безопасно превратить в строку
                    const headerStr = headerBuf.toString('utf-8');
                    
                    // Само тело файла/поля начинается после \r\n\r\n
                    let bodyStart = headerEndIndex + 4; 
                    // И заканчивается за 2 байта до конца (там \r\n перед следующей границей)
                    let bodyEnd = part.length - 2;
                    
                    if (bodyEnd > bodyStart) {
                        // Если это поле name="sender" и т.д.
                        if (headerStr.includes('name="')) {
                            const nameMatch = headerStr.match(/name="([^"]+)"/);
                            if (nameMatch) {
                                const name = nameMatch[1];
                                
                                // Если это ФАЙЛ
                                if (headerStr.includes('filename="')) {
                                    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
                                    if (filenameMatch) {
                                        originalFileName = filenameMatch[1];
                                        if (originalFileName.includes('.')) {
                                            fileExt = originalFileName.split('.').pop();
                                        }
                                        fileBuffer = part.subarray(bodyStart, bodyEnd);
                                    }
                                } else {
                                    // Обычное текстовое поле
                                    const value = part.subarray(bodyStart, bodyEnd).toString('utf-8');
                                    fields[name] = value; // .trim() убрали, чтобы не ломать данные
                                }
                            }
                        }
                    }
                }
                
                start = end + boundary.length;
                end = buffer.indexOf(boundary, start);
            }

            // 3. Сохранение (код остается прежним, но теперь данные чистые)
            const { sender, room, type, text, forwardedFrom, quoteId, quoteText, quoteSender } = fields;
            if (sender && room) {
                let finalContent = text || '';
                
                // Если пришел файл (проверяем буфер)
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
                    forwardedFrom: forwardedFrom || null,
                    quoteId: quoteId || null,
                    quoteText: quoteText || null,
                    quoteSender: quoteSender || null
                });
                if (roomsDB[room].length > 150) roomsDB[room].shift();
                writeJSON(HISTORY_FILE, roomsDB);

                try {
                    triggerPushNotifications(room, sender, finalContent, type || 'text');
                } catch(e) { console.error(e); }

                res.writeHead(200); return res.end('OK');
            }
            res.writeHead(400); res.end('Incomplete data');
        });
        return;
    }



    // ЗАМЕНИТЕ ЭТОТ БЛОК В КОНЦЕ server.js:
    if (req.url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, req.url);
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); return res.end('File Not Found'); }
            
            let contentType = 'application/octet-stream';
            const ext = path.extname(req.url).toLowerCase();
            
            // Жестко прописываем Андроид кодеки, чтобы Chrome сразу понимал что играть
            if (ext === '.mp4') contentType = 'video/mp4';
            else if (ext === '.webm') {
                // Если файл содержит слово audio, отдаем как аудио-вебм, иначе как видео-вебм
                contentType = req.url.includes('audio') ? 'audio/webm;codecs=opus' : 'video/webm;codecs=vp8,opus';
            }
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
