const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

// ==================== КОНФИГУРАЦИЯ ====================
const config = {
    botToken: process.env.SUPPORT_BOT_TOKEN,
    adminGroupId: process.env.ADMIN_GROUP_ID ? parseInt(process.env.ADMIN_GROUP_ID) : null,
    channelName: process.env.CHANNEL_NAME || '@testkafe',
    channelLink: process.env.CHANNEL_LINK || 'https://t.me/testkafe',
    secretLink: process.env.SECRET_LINK || 'https://example.com/bonus',
    port: process.env.PORT || 3000
};

// Проверка наличия токена
if (!config.botToken) {
    console.error('❌ Ошибка: SUPPORT_BOT_TOKEN не указан в .env файле');
    process.exit(1);
}

if (!config.adminGroupId) {
    console.error('❌ Ошибка: ADMIN_GROUP_ID не указан в .env файле');
    process.exit(1);
}

// ==================== ИНИЦИАЛИЗАЦИЯ БОТА ====================
const bot = new TelegramBot(config.botToken, { polling: true });
console.log('✅ Бот поддержки запущен в режиме polling');

// ==================== ХРАНЕНИЕ ДАННЫХ ====================
const userChats = new Map(); // userId -> { chatId, userName, waitingForMessage }
const adminReplies = new Map(); // adminMessageId -> userId
let adminIds = new Set(); // Кэш ID админов

// ==================== ЗАГРУЗКА АДМИНОВ ИЗ ГРУППЫ ====================
async function loadAdminsFromGroup() {
    try {
        const admins = await bot.getChatAdministrators(config.adminGroupId);
        adminIds.clear();
        
        admins.forEach(admin => {
            if (!admin.user.is_bot) {
                adminIds.add(admin.user.id);
                console.log(`✅ Админ загружен: ${admin.user.first_name} (ID: ${admin.user.id})`);
            }
        });
        
        console.log(`👥 Всего админов в группе: ${adminIds.size}`);
    } catch (error) {
        console.error('❌ Ошибка загрузки админов из группы:', error.message);
        console.log('⚠️ Убедитесь, что бот добавлен в группу как администратор');
    }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function formatUserName(from) {
    const firstName = from.first_name || '';
    const lastName = from.last_name || '';
    return (firstName + ' ' + lastName).trim() || 'Пользователь';
}

function isAdmin(userId) {
    return adminIds.has(userId);
}

// ==================== ПРОВЕРКА ПОДПИСКИ НА КАНАЛ ====================
async function checkSubscription(userId) {
    try {
        const chatMember = await bot.getChatMember(config.channelName, userId);
        
        // Статусы подписки:
        // - creator: создатель канала
        // - administrator: администратор
        // - member: обычный подписчик
        // - restricted: ограниченный пользователь (тоже считается подписанным)
        
        const subscribed = ['creator', 'administrator', 'member', 'restricted'].includes(chatMember.status);
        
        console.log(`📊 Проверка пользователя ${userId}: статус ${chatMember.status} -> ${subscribed ? '✅ подписан' : '❌ не подписан'}`);
        
        return subscribed;
        
    } catch (error) {
        console.error('❌ Ошибка при проверке подписки:', error.message);
        
        if (error.message.includes('chat not found')) {
            console.error('⚠️ Канал не найден. Проверьте CHANNEL_NAME в настройках');
        } else if (error.message.includes('bot is not a member')) {
            console.error('⚠️ Бот не добавлен в канал как администратор');
        } else if (error.message.includes('Forbidden')) {
            console.error('⚠️ У бота недостаточно прав для проверки подписки');
        }
        
        return false;
    }
}

// ==================== ОБРАБОТЧИК КОМАНДЫ /start ====================
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    const startParam = match[1] || '';
    
    console.log(`👤 Пользователь ${userName} (${userId}) запустил бота с параметром: "${startParam}"`);
    
    // Сохраняем информацию о пользователе
    userChats.set(userId, {
        chatId: chatId,
        userName: userName,
        firstContact: new Date().toISOString(),
        source: startParam || 'direct',
        waitingForMessage: false
    });
    
    // СЦЕНАРИЙ 1: Пришли по QR-коду (параметр qr или channel)
    if (startParam === 'qr' || startParam === 'channel' || startParam === 'help') {
        await bot.sendMessage(chatId, 
            `👋 <b>Добро пожаловать!</b>\n\n` +
            `Вы перешли по QR-коду из нашего канала. Вот как получить бонус:\n\n` +
            `1️⃣ <b>Подпишитесь на канал</b> 👇 (кнопка ниже)\n` +
            `2️⃣ <b>Вернитесь в этот чат</b>\n` +
            `3️⃣ <b>Нажмите "ПРОВЕРИТЬ ПОДПИСКУ"</b>\n\n` +
            `После проверки вы получите эксклюзивный бонус! 🎁`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "📢 ПЕРЕЙТИ В КАНАЛ", url: config.channelLink }
                        ],
                        [
                            { text: "✅ ПРОВЕРИТЬ ПОДПИСКУ", callback_data: "check_sub" },
                            { text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", callback_data: "contact_admin" }
                        ]
                    ]
                }
            }
        );
    }
    
    // СЦЕНАРИЙ 2: Пришли по приглашению от друга (параметр invite)
    else if (startParam === 'invite' || startParam === 'friend') {
        await bot.sendMessage(chatId,
            `👋 <b>Привет!</b>\n\n` +
            `Вас пригласили в наш канал. Здесь мы публикуем акции и новости.\n\n` +
            `👇 Подпишитесь и получайте бонусы!`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "📢 ПОДПИСАТЬСЯ", url: config.channelLink }
                        ],
                        [
                            { text: "✅ ПРОВЕРИТЬ ПОДПИСКУ", callback_data: "check_sub" }
                        ]
                    ]
                }
            }
        );
    }
    
    // СЦЕНАРИЙ 3: Обычный старт (без параметра)
    else {
        await bot.sendMessage(chatId,
            `👋 <b>Здравствуйте, ${userName}!</b>\n\n` +
            `Это официальный бот канала. Здесь вы можете:\n` +
            `• ✅ Проверить подписку и получить бонус\n` +
            `• 📞 Связаться с администратором\n\n` +
            `👇 Выберите действие:`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ ПРОВЕРИТЬ ПОДПИСКУ", callback_data: "check_sub" },
                            { text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", callback_data: "contact_admin" }
                        ]
                    ]
                }
            }
        );
    }
});

// ==================== ОБРАБОТКА CALLBACK-КНОПОК ====================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId = query.from.id;
    const userName = formatUserName(query.from);
    const data = query.data;
    
    await bot.answerCallbackQuery(query.id);
    
    // ===== ПРОВЕРКА ПОДПИСКИ =====
    if (data === 'check_sub') {
        console.log(`🔍 Пользователь ${userName} (${userId}) проверяет подписку`);
        
        await bot.editMessageText('🔄 Проверяю вашу подписку...', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
        
        try {
            const isSubscribed = await checkSubscription(userId);
            
            if (isSubscribed) {
                await bot.editMessageText(
                    `🎉 <b>Отлично, ${userName}!</b>\n\n` +
                    `Вы подписаны на канал.\n\n` +
                    `Ваш бонус: ${config.secretLink}`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML'
                    }
                );
                
                console.log(`✅ Пользователь ${userId} получил бонус`);
                
            } else {
                await bot.editMessageText(
                    `❌ <b>${userName}, вы не подписаны на канал</b>\n\n` +
                    `Чтобы получить бонус:\n` +
                    `1️⃣ Нажмите кнопку "📢 ПЕРЕЙТИ В КАНАЛ" ниже\n` +
                    `2️⃣ Подпишитесь\n` +
                    `3️⃣ Вернитесь и нажмите "🔄 ПРОВЕРИТЬ СНОВА"`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "📢 ПЕРЕЙТИ В КАНАЛ", url: config.channelLink }
                                ],
                                [
                                    { text: "🔄 ПРОВЕРИТЬ СНОВА", callback_data: "check_sub" },
                                    { text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", callback_data: "contact_admin" }
                                ]
                            ]
                        }
                    }
                );
            }
        } catch (error) {
            console.error('❌ Ошибка проверки подписки:', error);
            await bot.editMessageText(
                '❌ Произошла ошибка при проверке. Попробуйте позже.',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML'
                }
            );
        }
    }
    
    // ===== СВЯЗЬ С АДМИНОМ =====
    else if (data === 'contact_admin') {
        console.log(`📞 Пользователь ${userName} (${userId}) запросил связь с админом`);
        
        // Устанавливаем флаг, что пользователь хочет написать сообщение
        const userData = userChats.get(userId) || {};
        userChats.set(userId, {
            ...userData,
            waitingForMessage: true,
            chatId: chatId,
            userName: userName
        });
        
        await bot.editMessageText(
            `📝 <b>Напишите ваш вопрос</b>\n\n` +
            `Я передам его администратору. Вы можете отправить текст, фото или видео.`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "❌ ОТМЕНА", callback_data: "cancel_message" }
                    ]]
                }
            }
        );
    }
    
    // ===== ОТМЕНА СООБЩЕНИЯ =====
    else if (data === 'cancel_message') {
        const userData = userChats.get(userId);
        if (userData) {
            userData.waitingForMessage = false;
            userChats.set(userId, userData);
        }
        
        await bot.editMessageText(
            `❌ Отправка сообщения отменена.\n\n` +
            `Вы можете снова нажать кнопку "СВЯЗАТЬСЯ С АДМИНОМ", если передумаете.`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ ПРОВЕРИТЬ ПОДПИСКУ", callback_data: "check_sub" },
                            { text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", callback_data: "contact_admin" }
                        ]
                    ]
                }
            }
        );
    }
});

// ==================== ОБРАБОТКА СООБЩЕНИЙ ОТ ПОЛЬЗОВАТЕЛЕЙ ====================
bot.on('message', async (msg) => {
    // Игнорируем команды
    if (msg.text && msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    
    // ===== ЕСЛИ СООБЩЕНИЕ ИЗ ГРУППЫ АДМИНОВ =====
    if (chatId === config.adminGroupId) {
        // Проверяем, является ли это ответом на другое сообщение
        if (!msg.reply_to_message) {
            console.log('⚠️ Сообщение от админа без reply, игнорируем');
            return;
        }
        
        const originalMsgId = msg.reply_to_message.message_id;
        const userData = adminReplies.get(originalMsgId);
        
        if (!userData) {
            console.log('⚠️ Неизвестное исходное сообщение, ID:', originalMsgId);
            await bot.sendMessage(chatId, '❌ Не могу найти пользователя для этого сообщения. Возможно, данные устарели.', {
                reply_to_message_id: msg.message_id
            });
            return;
        }
        
        // Проверяем, является ли отправитель админом
        if (!isAdmin(msg.from.id)) {
            console.log(`⛔ Пользователь ${msg.from.id} не является админом`);
            await bot.sendMessage(chatId, '❌ У вас нет прав для ответа пользователям.', {
                reply_to_message_id: msg.message_id
            });
            return;
        }
        
        // Получаем данные пользователя
        const { userId: targetUserId, userName: targetUserName } = userData;
        
        console.log(`📨 Админ ${msg.from.first_name} отвечает пользователю ${targetUserName} (${targetUserId})`);
        
        // Отправляем ответ пользователю
        try {
            if (msg.text) {
                await bot.sendMessage(targetUserId, 
                    `📝 <b>Ответ от администратора:</b>\n\n${msg.text}`, {
                    parse_mode: 'HTML'
                });
            } else if (msg.photo) {
                const photo = msg.photo[msg.photo.length - 1];
                await bot.sendPhoto(targetUserId, photo.file_id, {
                    caption: msg.caption ? `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}` : '📝 <b>Ответ от администратора</b>',
                    parse_mode: 'HTML'
                });
            } else if (msg.video) {
                await bot.sendVideo(targetUserId, msg.video.file_id, {
                    caption: msg.caption ? `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}` : '📝 <b>Ответ от администратора</b>',
                    parse_mode: 'HTML'
                });
            } else if (msg.document) {
                await bot.sendDocument(targetUserId, msg.document.file_id, {
                    caption: msg.caption ? `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}` : '📝 <b>Ответ от администратора</b>',
                    parse_mode: 'HTML'
                });
            } else if (msg.voice) {
                await bot.sendVoice(targetUserId, msg.voice.file_id, {
                    caption: '📝 <b>Ответ от администратора</b>',
                    parse_mode: 'HTML'
                });
            }
            
            await bot.sendMessage(chatId, '✅ Ответ отправлен пользователю.', {
                reply_to_message_id: msg.message_id
            });
            
        } catch (error) {
            console.error('❌ Ошибка отправки ответа:', error.message);
            
            let errorMessage = '❌ Не удалось отправить ответ.';
            if (error.message.includes('bot was blocked')) {
                errorMessage = '❌ Пользователь заблокировал бота.';
            } else if (error.message.includes('chat not found')) {
                errorMessage = '❌ Пользователь не найден (возможно, удалил чат).';
            }
            
            await bot.sendMessage(chatId, errorMessage, {
                reply_to_message_id: msg.message_id
            });
        }
        
        return;
    }
    
    // ===== ЕСЛИ СООБЩЕНИЕ ОТ ОБЫЧНОГО ПОЛЬЗОВАТЕЛЯ =====
    
    // Проверяем, ожидает ли бот сообщение от этого пользователя
    const userData = userChats.get(userId);
    
    if (userData && userData.waitingForMessage) {
        // Пользователь хочет отправить сообщение админу
        console.log(`💬 Пользователь ${userName} (${userId}) отправляет сообщение админу: "${msg.text || 'медиа'}"`);
        
        // Сбрасываем флаг ожидания
        userData.waitingForMessage = false;
        userChats.set(userId, userData);
        
        // Формируем информацию о пользователе для админов
        const userLink = msg.from.username ? `@${msg.from.username}` : `ID: ${userId}`;
        
        // Создаём сообщение для админов
        let adminMessage = `📩 <b>Новое сообщение от пользователя</b>\n\n` +
            `👤 <b>Имя:</b> ${userName}\n` +
            `🔗 <b>Ссылка:</b> ${userLink}\n\n`;
        
        if (msg.text) {
            adminMessage += `💬 <b>Сообщение:</b>\n${msg.text}`;
        } else if (msg.photo) {
            adminMessage += `📸 <b>Фото</b> (с подписью: ${msg.caption || 'без подписи'})`;
        } else if (msg.video) {
            adminMessage += `🎥 <b>Видео</b> (с подписью: ${msg.caption || 'без подписи'})`;
        } else if (msg.document) {
            adminMessage += `📎 <b>Документ</b> (${msg.document.file_name})`;
        } else if (msg.voice) {
            adminMessage += `🎤 <b>Голосовое сообщение</b>`;
        } else {
            adminMessage += `📎 <b>Медиафайл</b>`;
        }
        
        adminMessage += `\n\n<i>👇 Нажмите "Ответить" на это сообщение, чтобы написать пользователю.</i>`;
        
        try {
            // Отправляем админам
            const sentMsg = await bot.sendMessage(config.adminGroupId, adminMessage, {
                parse_mode: 'HTML'
            });
            
            // Сохраняем связь для ответа
            adminReplies.set(sentMsg.message_id, {
                userId: userId,
                userName: userName
            });
            
            // Если есть медиа, пересылаем его отдельно
            if (msg.photo || msg.video || msg.document || msg.voice) {
                const mediaMsg = await bot.copyMessage(config.adminGroupId, chatId, msg.message_id);
                adminReplies.set(mediaMsg.message_id, {
                    userId: userId,
                    userName: userName
                });
            }
            
            // Подтверждение пользователю
            await bot.sendMessage(chatId, 
                '✅ Ваше сообщение отправлено администратору. Ожидайте ответа.');
            
        } catch (error) {
            console.error('❌ Ошибка пересылки админам:', error.message);
            await bot.sendMessage(chatId, 
                '❌ Не удалось отправить сообщение. Попробуйте позже.');
        }
        
    } else {
        // Пользователь просто что-то пишет, но не нажимал кнопку
        // Игнорируем или предлагаем нажать кнопку
        if (msg.text && !msg.text.startsWith('/')) {
            await bot.sendMessage(chatId, 
                `❓ Чтобы связаться с администратором, нажмите кнопку "📞 СВЯЗАТЬСЯ С АДМИНОМ".`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", callback_data: "contact_admin" }
                        ]]
                    }
                }
            );
        }
    }
});

// ==================== ПРОСТОЙ ВЕБ-СЕРВЕР ====================
const app = express();

app.get('/', (req, res) => {
    res.send('🤖 Support Bot is running!');
});

app.get('/stats', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        admins: Array.from(adminIds),
        adminCount: adminIds.size,
        activeUsers: userChats.size,
        pendingReplies: adminReplies.size
    });
});

// Запуск сервера
app.listen(config.port, async () => {
    console.log(`🌐 Веб-сервер запущен на порту ${config.port}`);
    
    // Загружаем админов из группы
    await loadAdminsFromGroup();
    
    const botInfo = await bot.getMe();
    console.log(`🤖 Бот @${botInfo.username} готов к работе!`);
    console.log(`📢 Ссылка для QR-кода: https://t.me/${botInfo.username}?start=qr`);
    console.log(`📢 Ссылка для приглашений: https://t.me/${botInfo.username}?start=invite`);
    console.log(`📢 Канал для проверки: ${config.channelName}`);
    console.log(`👥 Группа админов ID: ${config.adminGroupId}`);
});

// ==================== ПЕРИОДИЧЕСКАЯ ОЧИСТКА ====================
setInterval(async () => {
    console.log('🔄 Обновление списка админов...');
    await loadAdminsFromGroup();
    
    // Очистка старых записей (старше 24 часов)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let cleaned = 0;
    
    for (const [msgId, data] of adminReplies.entries()) {
        if (data.timestamp && new Date(data.timestamp).getTime() < oneDayAgo) {
            adminReplies.delete(msgId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) console.log(`🧹 Очищено ${cleaned} устаревших записей`);
}, 60 * 60 * 1000);

// ==================== ОБРАБОТКА ЗАВЕРШЕНИЯ ====================
process.on('SIGINT', () => {
    console.log('🛑 Получен сигнал завершения, останавливаем бота...');
    bot.stopPolling();
    process.exit();
});

process.on('SIGTERM', () => {
    console.log('🛑 Получен сигнал завершения, останавливаем бота...');
    bot.stopPolling();
    process.exit();
});
