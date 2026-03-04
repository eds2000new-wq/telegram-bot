const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

// ==================== КОНФИГУРАЦИЯ ====================
const config = {
    botToken: process.env.SUPPORT_BOT_TOKEN,
    adminGroupId: process.env.ADMIN_GROUP_ID ? parseInt(process.env.ADMIN_GROUP_ID) : null,
    channelLink: process.env.CHANNEL_LINK || 'https://t.me/testkafe',
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
const userChats = new Map(); // userId -> { chatId, userName, source }
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

// ==================== ОБРАБОТЧИК КОМАНДЫ /start ====================
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = formatUserName(msg.from);
    const startParam = match[1] || ''; // Параметр после /start
    
    console.log(`👤 Пользователь ${userName} (${userId}) запустил бота с параметром: "${startParam}"`);
    
    // Сохраняем информацию о пользователе
    userChats.set(userId, {
        chatId: chatId,
        userName: userName,
        firstContact: new Date().toISOString(),
        source: startParam || 'direct'
    });
    
    // ===== РАЗНЫЕ СЦЕНАРИИ В ЗАВИСИМОСТИ ОТ ПАРАМЕТРА =====
    
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
    
    if (data === 'check_sub') {
        console.log(`🔍 Пользователь ${userName} (${userId}) проверяет подписку`);
        // Здесь логика проверки подписки
        await bot.sendMessage(chatId, '✅ Проверка подписки... (функция в разработке)');
        
    } else if (data === 'contact_admin') {
        console.log(`📞 Пользователь ${userName} (${userId}) запросил связь с админом`);
        await bot.sendMessage(chatId, '📝 Напишите ваш вопрос, я передам администратору.');
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
        adminCount: adminIds.size
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
    console.log(`👥 Группа админов ID: ${config.adminGroupId}`);
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
