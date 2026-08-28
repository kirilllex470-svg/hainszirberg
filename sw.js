let lastCount = 0;
let user = "";
let room = "";

// Принимаем данные от главной страницы, когда пользователь переключает чат
self.addEventListener('message', (event) => {
    if (event.data.type === 'SET_USER') {
        user = event.data.user;
        room = event.data.room;
    }
});

// Фоновый таймер: опрашивает сервер даже при свернутом браузере
setInterval(() => {
    if (!user || !room) return;
    fetch(`/api/messages?room=${room}`)
        .then(res => res.json())
        .then(data => {
            if (lastCount === 0) {
                lastCount = data.length;
                return;
            }
            if (data.length > lastCount) {
                let newMsgs = data.slice(lastCount);
                newMsgs.forEach(msg => {
                    if (msg.sender.toLowerCase() !== user.toLowerCase()) {
                        let text = msg.text;
                        if (msg.type === 'audio') text = "🎙️ Голосовое сообщение";
                        if (msg.type === 'video') text = "🎥 Видео-кружок";
                        if (msg.type === 'file') text = "📎 Отправил файл";
                        
                        // Показываем уведомление в шторку телефона
                        self.registration.showNotification(`Новое от ${msg.sender}`, {
                            body: text,
                            vibrate:, // Исправлено: добавлена вибрация телефона
                            data: { room: room }
                        });
                    }
                });
                lastCount = data.length;
            }
        })
        .catch(err => console.log("Ошибка фонового опроса:", err));
}, 3000);

// Клик по уведомлению в шторке разворачивает вкладку с чатом
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) return clientList[0].focus();
            return clients.openWindow('/');
        })
    );
});
