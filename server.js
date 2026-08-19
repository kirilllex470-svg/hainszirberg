const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// 1. Обычный сервер для отдачи одной веб-страницы
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

// 2. Инициализируем Socket.IO поверх нашего HTTP сервера.
// Добавляем настройки CORS, чтобы облако не блокировало запросы.
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('Пользователь подключился через Socket.IO');

    // Слушаем событие 'chat message' от клиента
    socket.on('chat message', (msg) => {
        console.log(`Сообщение: ${msg}`);
        // Пересылаем сообщение абсолютно всем подключенным
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился');
    });
});

// 3. Запуск на порту от Timeweb
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер работает на порту ${PORT}`);
});
