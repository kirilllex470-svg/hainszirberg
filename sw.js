// Слушаем событие PUSH, которое прилетает от серверов уведомлений Google/Apple
self.addEventListener('push', (event) => {
    let payload = { title: 'Новое сообщение', body: 'Вам пришло сообщение', room: '' };
    
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            payload.body = event.data.text();
        }
    }

    const options = {
        body: payload.body,
        icon: '/uploads/icon.png',
        badge: '/uploads/icon.png',
        vibrate:,
        tag: 'chat-notification',
        data: { room: payload.room }
    };

    // Отображаем системное уведомление прямо в шторку смартфона
    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

// Клик по уведомлению в шторке разворачивает приложение
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
