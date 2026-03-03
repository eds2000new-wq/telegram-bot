const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

// ==================== КОНФИГУРАЦИЯ ====================
const config = {
    botToken: process.env.BOT_TOKEN,
    channelId: process.env.CHANNEL_ID,
    adminGroupId: process.env.ADMIN_GROUP_ID ? parseInt(process.env.ADMIN_GROUP_ID) : null,
    port: process.env.PORT || 3000
};

// Проверка наличия токена
if (!config.botToken) {
    console.error('❌ Ошибка: BOT_TOKEN не указан в .env файле');
    process.exit(1);
}

if (!config.channelId) {
    console.error('❌ Ошибка: CHANNEL_ID не указан в .env файле');
    process.exit(1);
}

if (!config.adminGroupId) {
    console.error('❌ Ошибка: ADMIN_GROUP_ID не указан в .env файле');
    process.exit(1);
}

// ==================== ИНИЦИАЛИЗАЦИЯ БОТА ====================
const bot = new TelegramBot(config.botToken, { polling: true });
console.log('✅ Бот запущен в режиме polling');

// ==================== ХРАНЕНИЕ ДАННЫХ ====================
const userChats = new Map(); // userId -> { chatId, userName }
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

// ==================== ФУНКЦИЯ ДЛЯ ОТПРАВКИ ПОСТОВ В КАНАЛ ====================

/**
 * Отправляет пост в канал с кнопкой "Связаться с админом"
 * @param {string} text - Текст поста
 * @param {string} photoUrl - URL фото (опционально)
 */
async function sendChannelPost(text, photoUrl = null) {
    try {
        const keyboard = {
            inline_keyboard: [[
                { 
                    text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", 
                    url: `https://t.me/${bot.options.username}?start=help`
                }
            ]]
        };

        if (photoUrl) {
            // Если есть фото, отправляем с фото
            await bot.sendPhoto(config.channelId, photoUrl, {
                caption: text,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else {
            // Если только текст
            await bot.sendMessage(config.channelId, text, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }
        
        console.log('✅ Пост успешно отправлен в канал');
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки поста в канал:', error.message);
        return false;
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

// ==================== ОБРАБОТЧИКИ КОМАНД ====================

/**
 * Команда /start - пользователь начал диалог с ботом
 */
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    const startParam = match[1] || '';
    
    console.log(`👤 Пользователь ${userName} (${userId}) начал диалог с ботом, param: ${startParam}`);
    
    // Сохраняем информацию о пользователе
    userChats.set(userId, {
        chatId: chatId,
        userName: userName
    });
    
    // Отправляем приветствие
    await bot.sendMessage(chatId, 
        `👋 Здравствуйте, ${userName}!\n\n` +
        `Напишите ваш вопрос, и администратор ответит вам в ближайшее время.`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: "✏️ Написать сообщение", callback_data: "new_message" }
                ]]
            }
        }
    );
});

/**
 * Обработка callback-кнопок
 */
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId = query.from.id;
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

/**
 * Обработка обычных сообщений от пользователей
 */
bot.on('message', async (msg) => {
    // Игнорируем команды
    if (msg.text && msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    
    // Если сообщение из группы админов
    if (chatId === config.adminGroupId) {
        // Обработка ответов админов
        if (!msg.reply_to_message) return;
        
        const originalMsgId = msg.reply_to_message.message_id;
        const userData = adminReplies.get(originalMsgId);
        
        if (!userData) {
            console.log('⚠️ Неизвестное исходное сообщение');
            return;
        }
        
        if (!isAdmin(msg.from.id)) {
            await bot.sendMessage(chatId, '❌ У вас нет прав для ответа пользователям.', {
                reply_to_message_id: msg.message_id
            });
            return;
        }
        
        // Отправляем ответ пользователю
        try {
            if (msg.text) {
                await bot.sendMessage(userData.userId, 
                    `📝 <b>Ответ от администратора:</b>\n\n${msg.text}`, {
                    parse_mode: 'HTML'
                });
            } else if (msg.photo || msg.video || msg.document) {
                await bot.copyMessage(userData.userId, chatId, msg.message_id);
                if (msg.caption) {
                    await bot.sendMessage(userData.userId, 
                        `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}`, {
                        parse_mode: 'HTML'
                    });
                }
            }
            
            await bot.sendMessage(chatId, '✅ Ответ отправлен пользователю.', {
                reply_to_message_id: msg.message_id
            });
            
        } catch (error) {
            console.error('❌ Ошибка отправки ответа:', error.message);
            await bot.sendMessage(chatId, '❌ Не удалось отправить ответ. Возможно, пользователь заблокировал бота.', {
                reply_to_message_id: msg.message_id
            });
        }
        
        return;
    }
    
    // Если сообщение от обычного пользователя (не админа)
    console.log(`💬 Пользователь ${userName} (${userId}) отправил сообщение: "${msg.text || 'медиа'}"`);
    
    // Сохраняем информацию о пользователе
    userChats.set(userId, {
        chatId: chatId,
        userName: userName
    });
    
    // Формируем информацию о пользователе для админов
    const userInfo = msg.from.username ? `@${msg.from.username}` : `ID: ${userId}`;
    
    // Создаём сообщение для админов
    let adminMessage = `📩 <b>Новое сообщение от пользователя</b>\n\n` +
        `👤 <b>Имя:</b> ${userName}\n` +
        `🔗 <b>Ссылка:</b> ${userInfo}\n\n`;
    
    if (msg.text) {
        adminMessage += `💬 <b>Сообщение:</b>\n${msg.text}`;
    } else if (msg.photo) {
        adminMessage += `📸 <b>Фото</b> (с подписью: ${msg.caption || 'без подписи'})`;
    } else if (msg.video) {
        adminMessage += `🎥 <b>Видео</b> (с подписью: ${msg.caption || 'без подписи'})`;
    } else if (msg.document) {
        adminMessage += `📎 <b>Документ</b> (${msg.document.file_name})`;
    } else {
        adminMessage += `📎 <b>Медиафайл</b>`;
    }
    
    // Отправляем админам
    try {
        const sentMsg = await bot.sendMessage(config.adminGroupId, adminMessage, {
            parse_mode: 'HTML'
        });
        
        // Сохраняем связь для ответа
        adminReplies.set(sentMsg.message_id, {
            userId: userId,
            userName: userName
        });
        
        // Если есть медиа, пересылаем его отдельно
        if (msg.photo || msg.video || msg.document) {
            await bot.copyMessage(config.adminGroupId, chatId, msg.message_id);
        }
        
        // Подтверждение пользователю
        await bot.sendMessage(chatId, 
            '✅ Ваше сообщение отправлено администратору. Ожидайте ответа.');
        
    } catch (error) {
        console.error('❌ Ошибка пересылки админам:', error.message);
        await bot.sendMessage(chatId, 
            '❌ Не удалось отправить сообщение. Попробуйте позже.');
    }
});

// ==================== API ДЛЯ ОТПРАВКИ ПОСТОВ ====================
const app = express();
app.use(express.json());

app.post('/send-post', async (req, res) => {
    try {
        const { text, photoUrl } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }
        
        const result = await sendChannelPost(text, photoUrl);
        
        if (result) {
            res.json({ success: true, message: 'Post sent to channel' });
        } else {
            res.status(500).json({ error: 'Failed to send post' });
        }
    } catch (error) {
        console.error('❌ API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        admins: Array.from(adminIds),
        adminCount: adminIds.size,
        activeUsers: userChats.size
    });
});

// Запуск сервера
app.listen(config.port, async () => {
    console.log(`🌐 API сервер запущен на порту ${config.port}`);
    console.log(`📢 POST /send-post - для отправки постов в канал`);
    
    // Загружаем админов из группы
    await loadAdminsFromGroup();
    
    console.log(`🤖 Бот готов к работе!`);
    console.log(`📢 Канал ID: ${config.channelId}`);
    console.log(`👥 Группа админов ID: ${config.adminGroupId}`);
});

// ==================== ПЕРИОДИЧЕСКОЕ ОБНОВЛЕНИЕ АДМИНОВ ====================
setInterval(async () => {
    console.log('🔄 Периодическое обновление списка админов...');
    await loadAdminsFromGroup();
}, 60 * 60 * 1000); // Каждый час

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
