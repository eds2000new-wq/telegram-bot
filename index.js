const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

// ==================== КОНФИГУРАЦИЯ ====================
const config = {
    botToken: process.env.SUPPORT_BOT_TOKEN,
    adminGroupId: process.env.ADMIN_GROUP_ID ? parseInt(process.env.ADMIN_GROUP_ID) : null,
    port: process.env.PORT || 3000,
    welcomeMessage: process.env.WELCOME_MESSAGE || '👋 Здравствуйте! Напишите ваш вопрос.'
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
// Связь между сообщениями в группе админов и пользователями
// adminMessageId -> { userId, userName, originalUserMessageId }
const adminReplies = new Map();

// Информация о пользователях
// userId -> { chatId, userName, lastMessage }
const userChats = new Map();

// Кэш ID админов (загружается из группы)
let adminIds = new Set();

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

// ==================== ОБРАБОТЧИК КОМАНДЫ /start ====================
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    const startParam = match[1] || '';
    
    console.log(`👤 Пользователь ${userName} (${userId}) начал диалог с ботом, param: ${startParam}`);
    
    // Сохраняем информацию о пользователе
    userChats.set(userId, {
        chatId: chatId,
        userName: userName,
        firstContact: new Date().toISOString()
    });
    
    // Отправляем приветствие
    await bot.sendMessage(chatId, config.welcomeMessage, {
        reply_markup: {
            inline_keyboard: [[
                { text: "✏️ Написать сообщение", callback_data: "new_message" }
            ]]
        }
    });
});

// ==================== ОБРАБОТКА КНОПОК ====================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    await bot.answerCallbackQuery(query.id);
    
    if (data === 'new_message') {
        await bot.editMessageText(
            '✏️ Напишите ваше сообщение. Я передам его администратору.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            }
        );
    }
});

// ==================== ОСНОВНОЙ ОБРАБОТЧИК СООБЩЕНИЙ ====================
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
            await bot.sendMessage(chatId, '❌ Не могу найти пользователя для этого сообщения.', {
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
        
        // ===== ОТПРАВКА ОТВЕТА ПОЛЬЗОВАТЕЛЮ =====
        try {
            if (msg.text) {
                await bot.sendMessage(targetUserId, 
                    `📝 <b>Ответ от администратора:</b>\n\n${msg.text}`, {
                    parse_mode: 'HTML'
                });
                console.log(`✅ Текстовый ответ отправлен пользователю ${targetUserId}`);
            }
            else if (msg.photo) {
                const photo = msg.photo[msg.photo.length - 1];
                await bot.sendPhoto(targetUserId, photo.file_id, {
                    caption: msg.caption ? `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}` : '📝 <b>Ответ от администратора</b>',
                    parse_mode: 'HTML'
                });
                console.log(`✅ Фото отправлено пользователю ${targetUserId}`);
            }
            else if (msg.video) {
                await bot.sendVideo(targetUserId, msg.video.file_id, {
                    caption: msg.caption ? `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}` : '📝 <b>Ответ от администратора</b>',
                    parse_mode: 'HTML'
                });
                console.log(`✅ Видео отправлено пользователю ${targetUserId}`);
            }
            else if (msg.document) {
                await bot.sendDocument(targetUserId, msg.document.file_id, {
                    caption: msg.caption ? `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}` : '📝 <b>Ответ от администратора</b>',
                    parse_mode: 'HTML'
                });
                console.log(`✅ Документ отправлен пользователю ${targetUserId}`);
            }
            
            // Подтверждение админу
            await bot.sendMessage(chatId, '✅ Ответ успешно отправлен пользователю.', {
                reply_to_message_id: msg.message_id
            });
            
        } catch (error) {
            console.error('❌ Ошибка отправки ответа:', error.message);
            
            let errorMessage = '❌ Не удалось отправить ответ.';
            if (error.message.includes('bot was blocked')) {
                errorMessage = '❌ Пользователь заблокировал бота.';
            } else if (error.message.includes('chat not found')) {
                errorMessage = '❌ Пользователь не найден.';
            }
            
            await bot.sendMessage(chatId, errorMessage, {
                reply_to_message_id: msg.message_id
            });
        }
        
        return;
    }
    
    // ===== ЕСЛИ СООБЩЕНИЕ ОТ ОБЫЧНОГО ПОЛЬЗОВАТЕЛЯ =====
    console.log(`💬 Пользователь ${userName} (${userId}) отправил: "${msg.text || 'медиа'}"`);
    
    // Сохраняем информацию о пользователе
    userChats.set(userId, {
        chatId: chatId,
        userName: userName,
        lastMessage: msg.text || 'media',
        lastMessageTime: new Date().toISOString()
    });
    
    // Формируем ссылку на пользователя
    const userLink = msg.from.username ? `@${msg.from.username}` : `ID: ${userId}`;
    
    // Создаём сообщение для админов
    let adminMessage = `📩 <b>Новое сообщение от пользователя</b>\n\n` +
        `👤 <b>Имя:</b> ${userName}\n` +
        `🔗 <b>Ссылка:</b> ${userLink}\n\n`;
    
    if (msg.text) {
        adminMessage += `💬 <b>Сообщение:</b>\n${msg.text}`;
    } else if (msg.photo) {
        adminMessage += `📸 <b>Фото</b>\n${msg.caption ? 'Подпись: ' + msg.caption : ''}`;
    } else if (msg.video) {
        adminMessage += `🎥 <b>Видео</b>\n${msg.caption ? 'Подпись: ' + msg.caption : ''}`;
    } else if (msg.document) {
        adminMessage += `📎 <b>Документ</b> (${msg.document.file_name})`;
    } else {
        adminMessage += `📎 <b>Медиафайл</b>`;
    }
    
    adminMessage += `\n\n<i>👇 Нажмите "Ответить" на это сообщение, чтобы написать пользователю.</i>`;
    
    // Отправляем админам
    try {
        const sentMsg = await bot.sendMessage(config.adminGroupId, adminMessage, {
            parse_mode: 'HTML'
        });
        
        // Сохраняем связь для ответа
        adminReplies.set(sentMsg.message_id, {
            userId: userId,
            userName: userName,
            timestamp: new Date().toISOString()
        });
        
        // Если есть медиа, пересылаем его отдельно
        if (msg.photo || msg.video || msg.document) {
            const mediaMsg = await bot.copyMessage(config.adminGroupId, chatId, msg.message_id);
            adminReplies.set(mediaMsg.message_id, {
                userId: userId,
                userName: userName,
                timestamp: new Date().toISOString()
            });
        }
        
        // Подтверждение пользователю
        await bot.sendMessage(chatId, '✅ Ваше сообщение отправлено администратору. Ожидайте ответа.');
        
    } catch (error) {
        console.error('❌ Ошибка пересылки админам:', error.message);
        await bot.sendMessage(chatId, '❌ Не удалось отправить сообщение. Попробуйте позже.');
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
    console.log(`📢 Ссылка для кнопки: https://t.me/${botInfo.username}?start=help`);
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
        if (new Date(data.timestamp).getTime() < oneDayAgo) {
            adminReplies.delete(msgId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) console.log(`🧹 Очищено ${cleaned} устаревших записей`);
}, 60 * 60 * 1000);

// ==================== ОБРАБОТКА ЗАВЕРШЕНИЯ ====================
process.on('SIGINT', () => {
    console.log('🛑 Останавливаем бота...');
    bot.stopPolling();
    process.exit();
});

process.on('SIGTERM', () => {
    console.log('🛑 Останавливаем бота...');
    bot.stopPolling();
    process.exit();
});
