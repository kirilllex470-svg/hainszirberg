// sw.js - Исправленная версия

self.addEventListener('push', (event) => {
    let payload = { title: 'Новое сообщение', body: 'Проверьте чат', room: '' };
    
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            payload.body = event.data.text();
        }
    }

    const options = {
        body: payload.body,
        icon: '/uploads/icon.png', // Убедитесь, что иконка есть, или удалите строку
        // Исправленная вибрация (была ошибка):
        vibrate: [200, 100, 200, 100, 200], 
        // Мы убрали 'tag', чтобы сообщения не схлопывались в одно
        data: { room: payload.room }
    };

    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Если вкладка уже открыта — фокусируемся на ней
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) return client.focus();
            }
            // Если нет — открываем новую
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
