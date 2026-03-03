const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

// ==================== КОНФИГУРАЦИЯ ====================
const config = {
    botToken: process.env.BOT_TOKEN,
    channelName: process.env.CHANNEL_NAME,
    secretLink: process.env.SECRET_LINK || 'https://example.com/bonus',
    port: process.env.PORT || 3000,
    adminGroupId: process.env.ADMIN_GROUP_ID ? parseInt(process.env.ADMIN_GROUP_ID) : null,
    adminGroupTopicId: process.env.ADMIN_GROUP_TOPIC_ID ? parseInt(process.env.ADMIN_GROUP_TOPIC_ID) : null
};

// Проверка наличия токена
if (!config.botToken) {
    console.error('❌ Ошибка: BOT_TOKEN не указан в .env файле');
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
const userStates = new Map(); // userId -> { status, attempts }
const adminReplies = new Map(); // adminMessageId -> { userId, originalChatId }
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
        
        // Если есть тема для новых обращений, создаём её
        if (config.adminGroupTopicId) {
            console.log(`📌 Используется тема ID: ${config.adminGroupTopicId}`);
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки админов из группы:', error.message);
        console.log('⚠️ Убедитесь, что бот добавлен в группу как администратор');
    }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

/**
 * Форматирует имя пользователя
 */
function formatUserName(from) {
    const firstName = from.first_name || '';
    const lastName = from.last_name || '';
    return (firstName + ' ' + lastName).trim() || 'Пользователь';
}

/**
 * Проверяет, является ли пользователь админом
 */
function isAdmin(userId) {
    return adminIds.has(userId);
}

/**
 * Проверяет, подписан ли пользователь на канал
 */
async function checkSubscription(userId) {
    try {
        const chatMember = await bot.getChatMember(config.channelName, userId);
        
        const subscribed = ['creator', 'administrator', 'member', 'restricted'].includes(chatMember.status);
        
        console.log(`📊 Проверка пользователя ${userId}: статус ${chatMember.status} -> ${subscribed ? '✅ подписан' : '❌ не подписан'}`);
        
        return subscribed;
    } catch (error) {
        console.error('❌ Ошибка проверки подписки:', error.message);
        
        if (error.message.includes('chat not found')) {
            console.error('⚠️ Канал не найден. Проверьте CHANNEL_NAME');
        } else if (error.message.includes('bot is not a member')) {
            console.error('⚠️ Бот не добавлен в канал как администратор');
        }
        
        return false;
    }
}

/**
 * Отправляет сообщение (с поддержкой тем, если указаны)
 */
async function sendMessage(chatId, text, options = {}) {
    const messageOptions = { parse_mode: 'HTML', ...options };
    
    // Если есть тема и это группа админов, добавляем параметр
    if (chatId === config.adminGroupId && config.adminGroupTopicId) {
        messageOptions.message_thread_id = config.adminGroupTopicId;
    }
    
    return await bot.sendMessage(chatId, text, messageOptions);
}

// ==================== КЛАВИАТУРЫ ====================

function getMainKeyboard() {
    return {
        inline_keyboard: [[
            { text: "✅ ПРОВЕРИТЬ ПОДПИСКУ", callback_data: "check_sub" },
            { text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", callback_data: "contact_admin" }
        ]]
    };
}

function getRetryKeyboard() {
    return {
        inline_keyboard: [[
            { text: "🔄 ПРОВЕРИТЬ СНОВА", callback_data: "check_sub" },
            { text: "📞 СВЯЗАТЬСЯ С АДМИНОМ", callback_data: "contact_admin" }
        ]]
    };
}

// ==================== ОБРАБОТЧИКИ КОМАНД ====================

/**
 * Команда /start
 */
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    
    console.log(`👤 Пользователь ${userName} (${userId}) запустил бота`);
    
    userStates.set(userId, { status: 'started', attempts: 0 });
    
    const welcomeText = `👋 Привет, ${userName}!\n\n` +
        `Для получения бонуса нужно подписаться на канал ${config.channelName}.\n\n` +
        `👇 Нажми кнопку после подписки, чтобы проверить.\n\n` +
        `📞 Если нужна помощь, нажми "СВЯЗАТЬСЯ С АДМИНОМ".`;
    
    await bot.sendMessage(chatId, welcomeText, {
        reply_markup: getMainKeyboard(),
        parse_mode: 'HTML'
    });
});

/**
 * Обработка callback-кнопок
 */
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId = query.from.id;
    const userName = formatUserName(query.from);
    const data = query.data;
    
    await bot.answerCallbackQuery(query.id);
    
    if (data === 'check_sub') {
        console.log(`🔍 Пользователь ${userName} (${userId}) проверяет подписку`);
        
        let userState = userStates.get(userId) || { attempts: 0 };
        userState.attempts++;
        userStates.set(userId, userState);
        
        const isSubscribed = await checkSubscription(userId);
        
        if (isSubscribed) {
            const successText = `🎉 Отлично, ${userName}! Вы подписаны на канал.\n\n` +
                `Ваш бонус: ${config.secretLink}`;
            
            await bot.editMessageText(successText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            });
            
            userState.status = 'subscribed';
            console.log(`✅ Пользователь ${userId} получил бонус`);
        } else {
            const failText = `❌ ${userName}, вы не подписаны на канал.\n\n` +
                `Подпишитесь: ${config.channelName} и нажмите кнопку снова.`;
            
            await bot.editMessageText(failText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: getRetryKeyboard(),
                parse_mode: 'HTML'
            });
            
            console.log(`❌ Пользователь ${userId} не подписан (попытка ${userState.attempts})`);
        }
    } else if (data === 'contact_admin') {
        console.log(`📞 Пользователь ${userName} (${userId}) запросил связь с админом`);
        
        // Обновляем сообщение
        await bot.editMessageText(
            `✅ Ваш запрос отправлен администратору. Ожидайте ответа.`, 
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            }
        );
        
        // Отправляем уведомление админам
        const userInfo = await bot.getChat(userId);
        const userLink = userInfo.username ? `@${userInfo.username}` : `ID: ${userId}`;
        
        const adminAlert = `📞 <b>Запрос на связь</b>\n\n` +
            `👤 <b>Пользователь:</b> ${userName}\n` +
            `🔗 <b>Ссылка:</b> ${userLink}\n\n` +
            `✏️ Напишите ответ на это сообщение, чтобы связаться с пользователем.`;
        
        const sentMsg = await sendMessage(config.adminGroupId, adminAlert);
        
        // Сохраняем связь для ответа
        adminReplies.set(sentMsg.message_id, {
            userId: userId,
            userName: userName
        });
    }
});

/**
 * Обработка обычных сообщений
 */
bot.on('message', async (msg) => {
    // Игнорируем команды
    if (msg.text && msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    
    // Если сообщение из группы админов
    if (chatId === config.adminGroupId) {
        // Проверяем, является ли это ответом на сообщение
        if (!msg.reply_to_message) {
            return;
        }
        
        const originalMsgId = msg.reply_to_message.message_id;
        const userData = adminReplies.get(originalMsgId);
        
        if (!userData) {
            console.log('⚠️ Неизвестное исходное сообщение');
            return;
        }
        
        // Проверяем, является ли отправитель админом
        if (!isAdmin(msg.from.id)) {
            console.log(`⛔ Пользователь ${msg.from.id} не является админом`);
            await sendMessage(chatId, '❌ У вас нет прав для ответа пользователям.', {
                reply_to_message_id: msg.message_id
            });
            return;
        }
        
        // Отправляем ответ пользователю
        const { userId: targetUserId, userName: targetUserName } = userData;
        
        try {
            if (msg.text) {
                await bot.sendMessage(targetUserId, 
                    `📝 <b>Ответ от администратора:</b>\n\n${msg.text}`, {
                    parse_mode: 'HTML'
                });
            } else if (msg.photo || msg.video || msg.document) {
                await bot.copyMessage(targetUserId, chatId, msg.message_id);
                if (msg.caption) {
                    await bot.sendMessage(targetUserId, 
                        `📝 <b>Ответ от администратора:</b>\n\n${msg.caption}`, {
                        parse_mode: 'HTML'
                    });
                }
            }
            
            console.log(`✅ Ответ админа отправлен пользователю ${targetUserName}`);
            
            // Подтверждение админу
            await sendMessage(chatId, '✅ Ответ отправлен пользователю.', {
                reply_to_message_id: msg.message_id
            });
            
        } catch (error) {
            console.error('❌ Ошибка отправки ответа:', error.message);
            await sendMessage(chatId, '❌ Не удалось отправить ответ. Возможно, пользователь заблокировал бота.', {
                reply_to_message_id: msg.message_id
            });
        }
        
        return;
    }
    
    // Если сообщение от обычного пользователя
    console.log(`💬 Пользователь ${userName} (${userId}) отправил сообщение: "${msg.text || 'медиа'}"`);
    
    // Пересылаем админам
    try {
        const userInfo = await bot.getChat(userId);
        const userLink = userInfo.username ? `@${userInfo.username}` : `ID: ${userId}`;
        
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
        } else {
            adminMessage += `📎 <b>Медиафайл</b>`;
        }
        
        const sentMsg = await sendMessage(config.adminGroupId, adminMessage);
        
        // Сохраняем связь для ответа
        adminReplies.set(sentMsg.message_id, {
            userId: userId,
            userName: userName
        });
        
        // Если есть медиа, пересылаем его отдельно
        if (msg.photo || msg.video || msg.document || msg.voice || msg.audio) {
            await bot.copyMessage(config.adminGroupId, userId, msg.message_id);
        }
        
        // Подтверждение пользователю
        await bot.sendMessage(chatId, 
            '✅ Ваше сообщение отправлено администратору. Ожидайте ответа.');
        
    } catch (error) {
        console.error('❌ Ошибка пересылки админам:', error.message);
        await bot.sendMessage(chatId, 
            '❌ Не удалось отправить сообщение. Попробуйте позже или нажмите кнопку "СВЯЗАТЬСЯ С АДМИНОМ".');
    }
});

// ==================== ПРОСТОЙ ВЕБ-СЕРВЕР ====================
const app = express();

app.get('/', (req, res) => {
    res.send('🤖 Telegram Bot is running!');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        admins: Array.from(adminIds),
        adminCount: adminIds.size
    });
});

// Запуск сервера
app.listen(config.port, async () => {
    console.log(`🌐 Веб-сервер запущен на порту ${config.port}`);
    
    // Загружаем админов из группы
    await loadAdminsFromGroup();
    
    console.log(`🤖 Бот готов к работе!`);
    console.log(`📢 Канал для проверки: ${config.channelName}`);
    console.log(`👥 Группа админов ID: ${config.adminGroupId}`);
    console.log(`📌 Тема для обращений: ${config.adminGroupTopicId || 'не используется'}`);
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
