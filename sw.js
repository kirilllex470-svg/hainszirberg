self.addEventListener('push', function(event) {
    if (event.data) {
        try {
            const data = event.data.json();
            const options = {
                body: data.body,
                icon: '/uploads/icon.png', // Сюда можно положить иконку чата, если она есть
                badge: '/uploads/badge.png',
                vibrate:, // Вибрация телефона при получении пуша
                data: {
                    room: data.room
                }
            };
            event.waitUntil(
                self.registration.showNotification(data.title, options)
            );
        } catch (e) {
            console.error("Ошибка разбора пуш-данных:", e);
        }
    }
});

// Клик по уведомлению на заблокированном экране открывает приложение
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            if (clientList.length > 0) {
                let client = clientList[0];
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
