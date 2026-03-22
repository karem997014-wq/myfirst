import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';

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

function getLang(ctx: Context) {
  const code = ctx.from?.language_code || 'ar';
  return code.startsWith('ar') ? i18n.ar : i18n.en;
}

let botInstance: Bot | null = null;

function getBot(): Bot {
  if (!botInstance) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set!');
    
    botInstance = new Bot(token);
    setupHandlers(botInstance);
  }
  return botInstance;
}

function setupHandlers(bot: Bot) {
  // ✅ استخدام return بدلاً من await للردود
  bot.command('start', (ctx) => {
    const lang = getLang(ctx);
    
    // ✅ return الـ Promise مباشرة (لا await داخلي)
    return handleStart(ctx, lang);
  });

  bot.callbackQuery('refresh_proxies', (ctx) => {
    const lang = getLang(ctx);
    return handleRefresh(ctx, lang);
  });
}

// ✅ معالجة منفصلة async
async function handleStart(ctx: Context, lang: typeof i18n.ar) {
  try {
    // الرد الفوري
    await ctx.reply('⏳ جاري التحميل...');

    // التحقق من الاشتراك
    if (REQUIRED_CHANNEL && !REQUIRED_CHANNEL.includes('your_channel')) {
      try {
        const chatMember = await ctx.api.getChatMember(REQUIRED_CHANNEL, ctx.from!.id);
        if (['left', 'kicked'].includes(chatMember.status)) {
          const keyboard = new InlineKeyboard().url(
            lang.forceJoinButton, 
            `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`
          );
          // ✅ return الـ Promise
          return ctx.editMessageText(lang.forceJoinText(REQUIRED_CHANNEL), {
            reply_markup: keyboard,
          });
        }
      } catch (error) {
        console.log('Force join check failed:', error);
      }
    }

    // جلب البروكسيات
    const proxies = await db.getTopProxies(3);
    
    if (proxies.length === 0) {
      return ctx.editMessageText(lang.noProxies);
    }

    let message = lang.successMessage;
    const keyboard = new InlineKeyboard();
    
    proxies.forEach((proxy, index) => {
      const num = index + 1;
      message += `${lang.proxyLine(num, proxy.speed)}\n`;
      keyboard.url(lang.connectBtn(num), proxy.link).row();
    });

    message += lang.shareText;
    keyboard.text(lang.refreshBtn, 'refresh_proxies');

    // ✅ return الـ Promise
    return ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('Error in start:', error);
    return ctx.editMessageText('❌ حدث خطأ، يرجى المحاولة لاحقاً');
  }
}

async function handleRefresh(ctx: Context, lang: typeof i18n.ar) {
  try {
    await ctx.answerCallbackQuery({ text: '⏳ جاري التحديث...' });
    
    const proxies = await db.getTopProxies(3);
    
    if (proxies.length === 0) {
      return ctx.editMessageText(lang.noProxies);
    }

    let message = lang.successMessage;
    const keyboard = new InlineKeyboard();

    proxies.forEach((proxy, index) => {
      const num = index + 1;
      message += `${lang.proxyLine(num, proxy.speed)}\n`;
      keyboard.url(lang.connectBtn(num), proxy.link).row();
    });

    message += lang.shareText;
    keyboard.text(lang.refreshBtn, 'refresh_proxies');

    return ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return ctx.answerCallbackQuery({ text: '❌ خطأ في التحديث', show_alert: true });
  }
}

// ✅ Handler بسيط - يترك Grammy يتولى الأمر
const POST = (req: Request): Promise<Response> => {
  console.log('📩 Webhook received:', new Date().toISOString());
  
  try {
    const bot = getBot();
    const handle = webhookCallback(bot, 'std/http');
    return handle(req);
  } catch (error) {
    console.error('❌ Webhook error:', error);
    // ✅ رد فوري حتى لو فشل
    return Promise.resolve(new Response('OK', { status: 200 }));
  }
};

const GET = (): Response => {
  return Response.json({ 
    status: 'ok', 
    botConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
    timestamp: new Date().toISOString()
  });
};

export { POST, GET };
