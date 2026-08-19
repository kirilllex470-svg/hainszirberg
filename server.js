const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// 1. Создаем обычный веб-сервер для загрузки интерфейса
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

// 2. Подключаем WebSocket сервер к нашему HTTP серверу
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Новый пользователь подключился!');

    // Слушаем сообщения от конкретного клиента
    ws.on('message', (message) => {
        console.log(`Получено: ${message}`);
        
        // Пересылаем сообщение ВСЕМ подключенным пользователям
        wss.clients.forEach((client) => {
            if (client.readyState === 1) { // 1 означает OPEN (активно)
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => console.log('Пользователь отключился.'));
});

// 3. Запускаем сервер на порту 3000
// Порт берется из настроек хостинга, либо 3000 для локального запуска
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
