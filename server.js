const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const FRIENDS_FILE = path.join(__dirname, 'friends.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json'); 
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

function readJSON(filePath, defaultVal = {}) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) { console.error("Ошибка чтения JSON:", e); }
    return defaultVal;
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { console.error("Ошибка записи JSON:", e); }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

let usersDB = readJSON(USERS_FILE, {});
let roomsDB = readJSON(HISTORY_FILE, {});
let friendsDB = readJSON(FRIENDS_FILE, {});
let groupsDB = readJSON(GROUPS_FILE, {});
let requestsDB = readJSON(REQUESTS_FILE, {}); 

const db = {
    lastRead: {}
};

const server = http.createServer((req, res) => {
    const sendJSON = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
    };

    // 1. Авторизация и регистрация
    if (req.url === '/api/auth' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                if (!username || !password) {
                    return sendJSON(400, { success: false, message: "Пустые поля!" });
                }
                const userKey = username.toLowerCase().trim();
                const hashedPassword = hashPassword(password);

                if (usersDB[userKey]) {
                    if (usersDB[userKey].password === hashedPassword) {
                        return sendJSON(200, { success: true });
                    } else {
                        return sendJSON(200, { success: false, message: "Неверный пароль!" });
                    }
                } else {
                    usersDB[userKey] = { username, password: hashedPassword };
                    writeJSON(USERS_FILE, usersDB);
                    return sendJSON(200, { success: true });
                }
            } catch (e) { sendJSON(400, { message: 'Bad Request' }); }
        });
        return;
    }
    // 2. Получение списка чатов и входящих заявок
    if (req.url.startsWith('/api/friends/get') && req.method === 'GET') {
        try {
            const host = req.headers.host || 'localhost';
            const myUrl = new URL(req.url, `http://${host}`);
            const user = myUrl.searchParams.get('user');
            
            if (!user) {
                return sendJSON(200, { requests: [], friends: [] });
            }

            const myLowerName = user.toLowerCase().trim();
            const myFriends = friendsDB[myLowerName] || [];
            const myReads = db.lastRead[myLowerName] || {};
            
            const myRequests = Object.keys(requestsDB)
                .map(id => ({ id, ...requestsDB[id] }))
                .filter(reqObj => reqObj.to.toLowerCase() === myLowerName && reqObj.status === 'pending');

            const listData = myFriends.map(friendName => {
                const friendLower = friendName.toLowerCase().trim();
                const roomId = [myLowerName, friendLower].sort().join('_');
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

            return sendJSON(200, { requests: myRequests, friends: listData });
        } catch (e) { return sendJSON(500, { message: "Ошибка сервера" }); }
    }

    // 3. Отправка запроса в друзья
    if (req.url === '/api/friends/request' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { from, to } = JSON.parse(body);
                if (!from || !to) return sendJSON(400, { success: false, message: "Неполные данные!" });

                const fromKey = from.toLowerCase().trim();
                const targetKey = to.toLowerCase().trim();

                if (fromKey === targetKey) return sendJSON(200, { success: false, message: "Нельзя добавить себя!" });
                if (!usersDB[targetKey]) return sendJSON(200, { success: false, message: "Пользователь не найден!" });

                const alreadyRequested = Object.values(requestsDB).some(r => 
                    (r.from.toLowerCase() === fromKey && r.to.toLowerCase() === targetKey) ||
                    (r.from.toLowerCase() === targetKey && r.to.toLowerCase() === fromKey)
                );

                if (alreadyRequested) {
                    return sendJSON(200, { success: false, message: "Запрос уже отправлен или вы уже друзья!" });
                }

                const requestId = `req_${crypto.randomBytes(6).toString('hex')}`;
                requestsDB[requestId] = { from, to, status: 'pending', timestamp: Date.now() };
                writeJSON(REQUESTS_FILE, requestsDB);

                return sendJSON(200, { success: true, requestId });
            } catch (e) { res.writeHead(400); res.end('Bad Request'); }
        });
        return;
    }

    // 3.1 Принятие запроса в друзья
    if (req.url === '/api/friends/accept' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { user, requestId } = JSON.parse(body);
                const request = requestsDB[requestId];

                if (request && request.to.toLowerCase() === user.toLowerCase()) {
                    const user1 = request.from;
                    const user2 = request.to;
                    const key1 = user1.toLowerCase();
                    const key2 = user2.toLowerCase();

                    if (!friendsDB[key1]) friendsDB[key1] = [];
                    if (!friendsDB[key2]) friendsDB[key2] = [];

                    if (!friendsDB[key1].includes(user2)) friendsDB[key1].push(user2);
                    if (!friendsDB[key2].includes(user1)) friendsDB[key2].push(user1);

                    delete requestsDB[requestId];
                    writeJSON(REQUESTS_FILE, requestsDB); 
                    writeJSON(FRIENDS_FILE, friendsDB);

                    res.writeHead(200); 
                    return res.end('OK'); 
                } 
                res.writeHead(400); res.end('Bad Request'); 
            } catch (e) { res.writeHead(400); res.end('Bad Request'); } 
        }); 
        return; 
    }

    // 3.2 Отмена запроса в друзьях
    if (req.url === '/api/friends/decline' && req.method === 'POST') { 
        let body = ''; 
        req.on('data', chunk => body += chunk.toString()); 
        req.on('end', () => { 
            try { 
                const { user, requestId } = JSON.parse(body); 
                const request = requestsDB[requestId];
                if (request && request.to.toLowerCase() === user.toLowerCase()) { 
                    delete requestsDB[requestId]; 
                    writeJSON(REQUESTS_FILE, requestsDB); 
                    res.writeHead(200); 
                    return res.end('OK'); 
                } 
                res.writeHead(400); res.end('Bad Request'); 
            } catch (e) { res.writeHead(400); res.end('Bad Request'); } 
        }); 
        return; 
    }

    // 3.3 Удаление друга из контактов
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
                    return sendJSON(200, { success: true, groupId });
                } 
                res.writeHead(400); res.end('Bad Request'); 
            } catch (e) { res.writeHead(400); res.end('Bad Request'); } 
        }); 
        return; 
    }
    // 4. История сообщений
    if (req.url.startsWith('/api/messages') && req.method === 'GET') { 
        try {
            const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`); 
            const room = myUrl.searchParams.get('room'); 
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }); 
            if (room && roomsDB[room]) {
                return res.end(JSON.stringify(roomsDB[room])); 
            }
            return res.end(JSON.stringify([])); 
        } catch(e) { res.writeHead(400); res.end('Bad Request'); }
        return;
    }

    // 4.5 Прочтение сообщений
    if (req.url === '/api/messages/read' && req.method === 'POST') { 
        let body = ''; 
        req.on('data', chunk => body += chunk.toString()); 
        req.on('end', () => { 
            try { 
                const { user, room } = JSON.parse(body); 
                if (user && room) { 
                    const uLower = user.toLowerCase(); 
                    if (!db.lastRead[uLower]) db.lastRead[uLower] = {}; 
                    db.lastRead[uLower][room] = Date.now(); 
                } 
                res.writeHead(200); return res.end('OK'); 
            } catch (e) { res.writeHead(400); res.end('Bad Request'); } 
        }); 
        return; 
    }

    // 4.7 Удаление сообщений
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

    // 4.9 Удаление групповой конференции
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

    // 5. Прием FormData
    if (req.url === '/api/send' && req.method === 'POST') { 
        const contentType = req.headers['content-type']; 
        if (!contentType || !contentType.includes('multipart/form-data')) { 
            res.writeHead(400); return res.end('Ожидался FormData'); 
        }
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/); 
        const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null; 
        if (!boundary) { res.writeHead(400); return res.end('Граница не найдена'); }
        
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
            res.writeHead(400); res.end('Неполные данные'); 
        }); 
        return; 
    }

    // 6. Раздача медиафайлов
    if (req.url.startsWith('/uploads/')) {
        const safeUrl = path.normalize(req.url).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(UPLOADS_DIR, path.basename(safeUrl));
        
        fs.readFile(filePath, (err, data) => { 
            if (err) { res.writeHead(404); return res.end('Файл не найден'); } 
            let contentType = 'application/octet-stream'; 
            const ext = path.extname(filePath).toLowerCase(); 
            if (ext === '.mp4') contentType = 'video/mp4'; 
            else if (ext === '.webm') contentType = req.url.includes('audio') ? 'audio/webm' : 'video/webm'; 
            else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'; 
            else if (ext === '.png') contentType = 'image/png'; 
            else if (ext === '.gif') contentType = 'image/gif'; 
            else if (ext === '.pdf') contentType = 'application/pdf'; 
            
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'max-age=86400', 'Accept-Ranges': 'bytes' }); 
            res.end(data); 
        }); 
        return; 
    }

    // 7. Главная страница
    if (req.url === '/' || req.url === '/index.html') { 
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => { 
            if (err) { res.writeHead(500); return res.end('Внутренняя ошибка'); } 
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); 
            res.end(data); 
        }); 
        return; 
    } 
    res.writeHead(404); res.end('Не найдено'); 
});

const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => { 
    console.log(`Сервер мессенджера запущен на порту ${PORT}`); 
});
