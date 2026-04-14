require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildMembers
  ]
});

// Отслеживание сообщений от интеграций пользователей
const userIntegrationMessages = new Map(); // botId -> { count, timestamp, messages: [] }
const SPAM_THRESHOLD = 5; // Количество сообщений
const TIME_WINDOW = 10000; // За 10 секунд
const TIMEOUT_DURATION = 60000; // 1 минута

client.once('ready', () => {
  console.log(`Бот запущен как ${client.user.tag}`);
  console.log('Мониторинг интеграций активен...');
});

client.on('messageCreate', async (message) => {
  try {
    // Игнорируем системные сообщения
    if (message.system) return;
    
    // Игнорируем сообщения НЕ от ботов
    if (!message.author.bot) return;
    
    // Игнорируем нашего бота и других системных ботов
    if (message.author.id === client.user.id) return;
    
    console.log(`Сообщение от бота: ${message.author.tag} (${message.author.id})`);
    
    // Отслеживаем по ID бота
    const botId = message.author.id;
    const now = Date.now();
    
    // Получаем данные о сообщениях бота
    let botData = userIntegrationMessages.get(botId);
    
    if (!botData) {
      botData = { count: 1, timestamp: now, messages: [message] };
      userIntegrationMessages.set(botId, botData);
      console.log('Первое сообщение от этого бота');
      return;
    }
    
    // Проверяем временное окно
    if (now - botData.timestamp > TIME_WINDOW) {
      botData.count = 1;
      botData.timestamp = now;
      botData.messages = [message];
      userIntegrationMessages.set(botId, botData);
      console.log('Сброс счетчика - прошло много времени');
      return;
    }
    
    // Увеличиваем счетчик и добавляем сообщение
    botData.count++;
    botData.messages.push(message);
    console.log(`Счетчик для бота ${message.author.tag}: ${botData.count}/${SPAM_THRESHOLD}`);
    
    // Проверяем превышение лимита
    if (botData.count >= SPAM_THRESHOLD) {
      console.log('СПАМ ОБНАРУЖЕН! Удаляем все сообщения...');
      
      // Удаляем ВСЕ сообщения от этого бота
      for (const msg of botData.messages) {
        await msg.delete().catch(console.error);
      }
      
      // Пытаемся найти кто использует этого бота через interaction
      let userId = null;
      if (message.interaction) {
        userId = message.interaction.user.id;
      }
      
      // Отправляем лог
      const logChannelId = process.env.LOG_CHANNEL_ID;
      const logChannel = await client.channels.fetch(logChannelId);
      
      if (logChannel) {
        let logMessage = `🚨 **Обнаружен спам от бота**
          
**Бот:** ${message.author.tag} (${message.author.id})
**Действие:** Сообщение удалено
**Причина:** Отправка ${botData.count} сообщений за ${TIME_WINDOW / 1000} секунд
**Канал:** <#${message.channel.id}>
**Время:** <t:${Math.floor(now / 1000)}:F>`;

        if (userId) {
          const member = await message.guild.members.fetch(userId).catch(() => null);
          if (member && !member.permissions.has(PermissionFlagsBits.Administrator)) {
            await member.timeout(TIMEOUT_DURATION, 'Спам через бота').catch(console.error);
            logMessage += `\n**Пользователь получил таймаут:** <@${userId}>`;
          }
        }
        
        await logChannel.send({ content: logMessage });
      }
      
      console.log(`Спам от бота ${message.author.tag} обнаружен и обработан`);
      
      // Сброс счетчика
      userIntegrationMessages.delete(botId);
    }
  } catch (error) {
    console.error('Ошибка при обработке сообщения:', error);
  }
});

// Очистка старых записей каждые 30 секунд
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of userIntegrationMessages.entries()) {
    if (now - data.timestamp > TIME_WINDOW * 2) {
      userIntegrationMessages.delete(userId);
    }
  }
}, 30000);

client.login(process.env.DISCORD_TOKEN);
