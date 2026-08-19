const http = require('http');
const fs = require('fs');
const path = require('path');

// Пути к файлам-хранилищам на диске инстанса Render
const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// Вспомогательные функции для чтения и записи JSON баз данных
function readJSON(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) { console.error("Ошибка парсинга файла: " + filePath, e); }
    return filePath === USERS_FILE ? {} : [];
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { console.error("Ошибка записи файла: " + filePath, e); }
}

// Загружаем актуальные базы из файлов при старте
let usersDB = readJSON(USERS_FILE);
let messagesDB = readJSON(HISTORY_FILE);

const server = http.createServer((req, res) => {
    
    // 1. Авторизация / Регистрация пользователей
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
                    // Если пользователь существует, проверяем пароль
                    if (usersDB[userKey].password === password) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: "Неверный пароль для этого имени!" }));
                    }
                } else {
                    // Если пользователя нет, регистрируем его автоматически
                    usersDB[userKey] = { username, password };
                    writeJSON(USERS_FILE, usersDB);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                }
            } catch (e) {
                res.writeHead(400); res.end('Bad Request');
            }
        });
        return;
    }

    // 2. Отдача истории переписки
    if (req.url === '/api/messages' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(JSON.stringify(messagesDB));
    }

    // 3. Получение нового сообщения
    if (req.url === '/api/send' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { sender, text } = JSON.parse(body);
                if (sender && text) {
                    // Генерируем текущее время в формате HH:MM
                    const now = new Date();
                    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

                    messagesDB.push({ sender, text, time: timeStr });

                    // Храним в файле последние 150 сообщений
                    if (messagesDB.length > 150) messagesDB.shift();

                    writeJSON(HISTORY_FILE, messagesDB);
                }
                res.writeHead(200); return res.end('OK');
            } catch (e) {
                res.writeHead(400); res.end('Bad Request');
            }
        });
        return;
    }

    // 4. Отдача статической HTML страницы интерфейса
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500); return res.end('Internal Error');
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    res.writeHead(404); res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер WhatsApp запущен на портах ${PORT}`);
});
