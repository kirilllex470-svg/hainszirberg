const http = require('http');
const fs = require('fs');
const path = require('path');

let messagesDatabase = [];

const server = http.createServer((req, res) => {
    // Разбираем URL и параметры (например, /?get=1)
    const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    // 1. Если клиент просит список сообщений (?get=1)
    if (myUrl.searchParams.has('get')) {
        res.writeHead(200, { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache'
        });
        return res.end(JSON.stringify(messagesDatabase));
    }

    // 2. Если клиент прислал новое сообщение (?send=текст)
    if (myUrl.searchParams.has('send')) {
        const msg = myUrl.searchParams.get('send');
        if (msg) {
            messagesDatabase.push(msg);
            if (messagesDatabase.length > 50) messagesDatabase.shift();
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('OK');
    }

    // 3. По умолчанию для любых других запросов отдаем файл интерфейса index.html
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading index.html');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    });
});

// Запуск на порту от Timeweb Cloud
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
