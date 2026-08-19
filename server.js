const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// Массив для хранения истории сообщений в памяти сервера
let dbMessages = [];

const server = http.createServer((req, res) => {
    // 1. Отдаем список сообщений для фонового обновления
    if (req.url === '/messages-list' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(dbMessages));
    }

    // 2. Принимаем сообщения через HTTP POST (если сокет заблокирован прокси-сервером)
    if (req.url === '/' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.message) {
                    dbMessages.push(data.message);
                    if(dbMessages.length > 100) dbMessages.shift(); // Храним только последние 100
                }
            } catch(e) {}
            res.writeHead(200);
            res.end('OK');
        });
        return;
    }

    // 3. Отдаем главный интерфейс index.html
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading index.html');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
