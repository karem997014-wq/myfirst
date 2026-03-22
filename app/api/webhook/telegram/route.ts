import { Bot, InlineKeyboard } from 'grammy';
import { db, ProxyData } from '@/lib/db';

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '';

const i18n = {
  ar: {
    forceJoinText: (channel: string) => `عذراً عزيزي، يجب عليك الاشتراك في قناتنا أولاً للحصول على البروكسيات السريعة.\n\nالقناة: ${channel}`,
    forceJoinButton: '📢 اشترك في القناة أولاً',
    noProxies: 'عذراً، لا توجد بروكسيات متاحة حالياً. جاري فحص بروكسيات جديدة، يرجى المحاولة بعد قليل.',
    successMessage: '✅ تم فحص هذا البروكسي قبل ثوانٍ وهو يعمل بسرعة 100%\n\n',
    proxyLine: (index: number, speed: number) => `⚡️ **بروكسي ${index}** (السرعة: ${speed}ms)`,
    connectBtn: (index: number) => `🚀 اتصال بالبروكسي ${index}`,
    refreshBtn: '🔄 تحديث البروكسيات',
    shareText: '\nشارك البوت مع أصدقائك!',
    updatedSuccess: 'تم تحديث البروكسيات بنجاح!',
    noNewProxies: 'لا توجد بروكسيات جديدة حالياً.'
  },
  en: {
    forceJoinText: (channel: string) => `Sorry, you must join our channel first to get fast proxies.\n\nChannel: ${channel}`,
    forceJoinButton: '📢 Join Channel First',
    noProxies: 'Sorry, no proxies available right now. We are scanning for new ones, please try again later.',
    successMessage: '✅ This proxy was checked seconds ago and works at 100% speed\n\n',
    proxyLine: (index: number, speed: number) => `⚡️ **Proxy ${index}** (Speed: ${speed}ms)`,
    connectBtn: (index: number) => `🚀 Connect to Proxy ${index}`,
    refreshBtn: '🔄 Refresh Proxies',
    shareText: '\nShare the bot with your friends!',
    updatedSuccess: 'Proxies updated successfully!',
    noNewProxies: 'No new proxies available at the moment.'
  }
};

function getLang(languageCode: string | undefined) {
  return languageCode?.startsWith('ar') ? i18n.ar : i18n.en;
}

// Bot instance (بدون webhook)
let bot: Bot | null = null;
function getBot() {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
    bot = new Bot(token);
  }
  return bot;
}

// ✅ POST handler يدوي - يرد فوراً ويعالج في الخلفية
export async function POST(req: Request) {
  const update = await req.json();
  
  // ✅ رد فوري لتيليجرام (خلال 60ms)
  const response = new Response('OK', { status: 200 });
  
  // ✅ المعالجة في الخلفية (fire and forget)
  processUpdate(update).catch(console.error);
  
  return response;
}

// ✅ معالجة async منفصلة
async function processUpdate(update: any) {
  const bot = getBot();
  const message = update.message;
  const callbackQuery = update.callback_query;
  
  try {
    if (message?.text === '/start') {
      await handleStart(bot, message);
    } else if (callbackQuery?.data === 'refresh_proxies') {
      await handleRefresh(bot, callbackQuery);
    }
  } catch (error) {
    console.error('Process error:', error);
  }
}

async function handleStart(bot: Bot, message: any) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const langCode = message.from.language_code;
  const lang = getLang(langCode);
  
  // رسالة التحميل
  await bot.api.sendMessage(chatId, '⏳ جاري التحميل...');
  
  try {
    // التحقق من الاشتراك
    if (REQUIRED_CHANNEL && !REQUIRED_CHANNEL.includes('your_channel')) {
      try {
        const member = await bot.api.getChatMember(REQUIRED_CHANNEL, userId);
        if (['left', 'kicked'].includes(member.status)) {
          const keyboard = new InlineKeyboard().url(
            lang.forceJoinButton,
            `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`
          );
          await bot.api.sendMessage(chatId, lang.forceJoinText(REQUIRED_CHANNEL), {
            reply_markup: keyboard
          });
          return;
        }
      } catch (e) {
        console.log('Channel check failed:', e);
      }
    }
    
    // جلب البروكسيات
    const proxies = await db.getTopProxies(3);
    
    if (proxies.length === 0) {
      await bot.api.sendMessage(chatId, lang.noProxies);
      return;
    }
    
    // بناء الرسالة
    let text = lang.successMessage;
    const keyboard = new InlineKeyboard();
    
    proxies.forEach((proxy, index) => {
      const num = index + 1;
      text += `${lang.proxyLine(num, proxy.speed)}\n`;
      keyboard.url(lang.connectBtn(num), proxy.link).row();
    });
    
    text += lang.shareText;
    keyboard.text(lang.refreshBtn, 'refresh_proxies');
    
    await bot.api.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
  } catch (error) {
    console.error('Start error:', error);
    await bot.api.sendMessage(chatId, '❌ حدث خطأ، يرجى المحاولة لاحقاً');
  }
}

async function handleRefresh(bot: Bot, callbackQuery: any) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const langCode = callbackQuery.from.language_code;
  const lang = getLang(langCode);
  
  // الرد على callback
  await bot.api.answerCallbackQuery(callbackQuery.id, { text: '⏳...' });
  
  try {
    const proxies = await db.getTopProxies(3);
    
    if (proxies.length === 0) {
      await bot.api.editMessageText(chatId, messageId, lang.noProxies);
      return;
    }
    
    let text = lang.successMessage;
    const keyboard = new InlineKeyboard();
    
    proxies.forEach((proxy, index) => {
      const num = index + 1;
      text += `${lang.proxyLine(num, proxy.speed)}\n`;
      keyboard.url(lang.connectBtn(num), proxy.link).row();
    });
    
    text += lang.shareText;
    keyboard.text(lang.refreshBtn, 'refresh_proxies');
    
    await bot.api.editMessageText(chatId, messageId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
    await bot.api.answerCallbackQuery(callbackQuery.id, { text: lang.updatedSuccess });
    
  } catch (error) {
    console.error('Refresh error:', error);
    await bot.api.answerCallbackQuery(callbackQuery.id, { text: '❌ خطأ', show_alert: true });
  }
}

export async function GET() {
  return Response.json({
    status: 'ok',
    botConfigured: !!process.env.TELEGRAM_BOT_TOKEN
  });
}
