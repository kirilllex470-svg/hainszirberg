const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// 1. Создаем HTTP-сервер для отдачи index.html
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                return res.end('Ошибка загрузки index.html');
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Не найдено');
    }
});

// 2. Создаем WebSocket-сервер БЕЗ привязки к порту (noServer: true)
const wss = new WebSocketServer({ noServer: true });

// Перехватываем событие перехода с HTTP на WebSockets (Handshake)
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    // Слушаем сокеты ТОЛЬКО на пути /ws
    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy(); // Закрываем соединение, если путь не /ws
    }
});

wss.on('connection', (ws) => {
    console.log('Новый пользователь подключился!');

    ws.on('message', (message) => {
        console.log(`Получено: ${message}`);
        wss.clients.forEach((client) => {
            if (client.readyState === 1) { 
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => console.log('Пользователь отключился.'));
});

// 3. Запускаем сервер на порту от хостинга
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
