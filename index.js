const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

// ==================== КОНФИГУРАЦИЯ ====================
const config = {
    botToken: process.env.BOT_TOKEN,
    channelName: process.env.CHANNEL_NAME,      // например: @testkafe
    channelId: process.env.CHANNEL_ID,          // или числовой ID: -1001234567890
    secretLink: process.env.SECRET_LINK || 'https://example.com/bonus',
    port: process.env.PORT || 3000,
    webhookUrl: process.env.WEBHOOK_URL || null
};

// Проверка наличия токена
if (!config.botToken) {
    console.error('❌ Ошибка: BOT_TOKEN не указан в .env файле');
    process.exit(1);
}

if (!config.channelName && !config.channelId) {
    console.error('❌ Ошибка: Укажите CHANNEL_NAME или CHANNEL_ID в .env файле');
    process.exit(1);
}

// ==================== ИНИЦИАЛИЗАЦИЯ БОТА ====================
let bot;
bot = new TelegramBot(config.botToken, { polling: true });
console.log('✅ Бот запущен в режиме polling');

// ==================== ХРАНЕНИЕ ДАННЫХ ====================
const userStates = new Map(); // userId -> { status, attempts }

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
 * Проверяет, подписан ли пользователь на канал
 */
async function checkSubscription(userId) {
    try {
        const chatId = config.channelId || config.channelName;
        
        const chatMember = await bot.getChatMember(chatId, userId);
        
        const subscribed = ['creator', 'administrator', 'member', 'restricted'].includes(chatMember.status);
        
        console.log(`📊 Проверка пользователя ${userId}: статус ${chatMember.status} -> ${subscribed ? '✅ подписан' : '❌ не подписан'}`);
        
        return subscribed;
    } catch (error) {
        console.error('❌ Ошибка проверки подписки:', error.message);
        
        if (error.message.includes('chat not found')) {
            console.error('⚠️ Канал не найден. Проверьте CHANNEL_NAME или CHANNEL_ID');
        } else if (error.message.includes('bot is not a member')) {
            console.error('⚠️ Бот не добавлен в канал как администратор');
        } else if (error.message.includes('Forbidden')) {
            console.error('⚠️ У бота недостаточно прав');
        }
        
        return false;
    }
}

/**
 * Отправляет или редактирует сообщение с клавиатурой
 */
async function sendOrEditMessage(chatId, messageId, text, keyboard) {
    try {
        if (messageId) {
            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
        } else {
            await bot.sendMessage(chatId, text, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
        }
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки сообщения:', error.message);
        return false;
    }
}

// ==================== КЛАВИАТУРЫ ====================

function getMainKeyboard() {
    return {
        inline_keyboard: [[
            { text: "✅ ПРОВЕРИТЬ ПОДПИСКУ", callback_data: "check_sub" }
        ]]
    };
}

function getRetryKeyboard() {
    return {
        inline_keyboard: [[
            { text: "🔄 ПРОВЕРИТЬ СНОВА", callback_data: "check_sub" }
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
    
    // Сохраняем состояние пользователя
    userStates.set(userId, { status: 'started', attempts: 0 });
    
    // Приветственное сообщение
    const welcomeText = `👋 Привет, ${userName}!\n\n` +
        `Для получения бонуса нужно подписаться на канал ${config.channelName || 'наш канал'}.\n\n` +
        `👇 Нажми кнопку после подписки, чтобы проверить.`;
    
    await sendOrEditMessage(chatId, null, welcomeText, getMainKeyboard());
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
    
    // Отвечаем на callback, чтобы убрать "часики" на кнопке
    await bot.answerCallbackQuery(query.id);
    
    if (data === 'check_sub') {
        console.log(`🔍 Пользователь ${userName} (${userId}) проверяет подписку`);
        
        // Получаем или создаем состояние пользователя
        let userState = userStates.get(userId) || { attempts: 0 };
        userState.attempts++;
        userStates.set(userId, userState);
        
        // Проверяем подписку
        const isSubscribed = await checkSubscription(userId);
        
        if (isSubscribed) {
            // Пользователь подписан - выдаём бонус
            const successText = `🎉 Отлично, ${userName}! Вы подписаны на канал.\n\n` +
                `Ваш бонус: ${config.secretLink}`;
            
            await sendOrEditMessage(chatId, messageId, successText, { inline_keyboard: [] });
            
            // Обновляем состояние
            userState.status = 'subscribed';
            userState.subscribedAt = new Date().toISOString();
            
            console.log(`✅ Пользователь ${userId} получил бонус`);
        } else {
            // Пользователь не подписан
            const failText = `❌ ${userName}, вы не подписаны на канал.\n\n` +
                `Подпишитесь: ${config.channelName || 'канал'} и нажмите кнопку снова.`;
            
            await sendOrEditMessage(chatId, messageId, failText, getRetryKeyboard());
            
            console.log(`❌ Пользователь ${userId} не подписан (попытка ${userState.attempts})`);
        }
    }
});

// ==================== ПРОСТОЙ ВЕБ-СЕРВЕР ДЛЯ ХОСТИНГА ====================
const app = express();

app.get('/', (req, res) => {
    res.send('🤖 Telegram Bot is running!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(config.port, () => {
    console.log(`🌐 Веб-сервер запущен на порту ${config.port}`);
    console.log(`🤖 Бот готов к работе!`);
    console.log(`📢 Канал для проверки: ${config.channelName || config.channelId}`);
});

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
