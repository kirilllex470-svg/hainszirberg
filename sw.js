let lastCount = 0;
let user = "";
let room = "";

self.addEventListener('message', (event) => {
    if (event.data.type === 'SET_USER') {
        user = event.data.user;
        room = event.data.room;
        // Сбрасываем счетчик при смене чата, чтобы не получить лавину старых уведомлений
        lastCount = 0; 
    }
});

setInterval(() => {
    // Если пользователь не выбран или чат не активен — не опрашиваем
    if (!user || !room) return;

    fetch(`/api/messages?room=${room}`)
        .then(res => res.json())
        .then(data => {
            // Первая инициализация: просто запоминаем количество сообщений
            if (lastCount === 0) {
                lastCount = data.length;
                return;
            }

            // Если сообщений стало больше, чем было
            if (data.length > lastCount) {
                // Берем только новые сообщения
                let newMsgs = data.slice(lastCount);
                
                newMsgs.forEach(msg => {
                    // Уведомляем, только если отправитель — НЕ мы сами
                    if (msg.sender.toLowerCase() !== user.toLowerCase()) {
                        let text = msg.text;
                        if (msg.type === 'audio') text = "🎙️ Голосовое сообщение";
                        if (msg.type === 'video') text = "🎥 Видео-кружок";
                        if (msg.type === 'file') text = "📎 Отправил файл";

                        // ПОКАЗЫВАЕМ УВЕДОМЛЕНИЕ
                        self.registration.showNotification(`Новое от ${msg.sender}`, {
                            body: text,
                            icon: '/uploads/icon.png', // Убедитесь, что такой файл есть, или удалите эту строку
                            vibrate: [200, 100, 200],  // Исправлено: добавлены цифры вибрации
                            tag: 'chat-msg',           // Чтобы уведомления не дублировались
                            data: { room: room }
                        });
                    }
                });
                
                // Обновляем счетчик
                lastCount = data.length;
            }
        })
        .catch(err => console.log("SW Error:", err));
}, 3000); // Опрос раз в 3 секунды

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Если вкладка открыта — переключаемся на неё
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) return client.focus();
            }
            // Если закрыта — открываем новую
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
