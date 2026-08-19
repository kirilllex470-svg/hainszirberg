const http = require('http');
const fs = require('fs');
const path = require('path');

// Хранилище сообщений в оперативной памяти сервера
let messagesDatabase = [];

const server = http.createServer((req, res) => {
    
    // 1. Маршрут GET /api/messages — отдает историю сообщений в формате JSON
    if (req.url === '/api/messages' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(messagesDatabase));
    }

    // 2. Маршрут POST /api/send — принимает новое сообщение
    if (req.url === '/api/send' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.message) {
                    messagesDatabase.push(data.message);
                    // Ограничиваем массив последними 50 сообщениями, чтобы не переполнять память
                    if (messagesDatabase.length > 50) {
                        messagesDatabase.shift();
                    }
                }
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            } catch (e) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
        return;
    }

    // 3. Главный маршрут — отдает файл интерфейса index.html
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                return res.end('Error loading index.html');
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // 4. Для всех остальных запросов отдаем 404
    res.writeHead(404);
    res.end('Not Found');
});

// Запуск сервера на порту хостинга
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер мессенджера успешно запущен на порту ${PORT}`);
});
