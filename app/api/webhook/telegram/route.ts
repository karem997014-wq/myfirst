import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '';

// ✅ Localization
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

// ✅ Lazy initialization - البوت يُنشأ عند أول استخدام
let botInstance: Bot | null = null;

function getBot(): Bot {
  if (!botInstance) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set!');
    }
    
    botInstance = new Bot(token);
    setupHandlers(botInstance);
  }
  return botInstance;
}

function setupHandlers(bot: Bot) {
  bot.command('start', async (ctx) => {
    const lang = getLang(ctx);

    // التحقق من الاشتراك بالقناة
    if (REQUIRED_CHANNEL && REQUIRED_CHANNEL !== '@your_channel_username') {
      try {
        const chatMember = await ctx.api.getChatMember(REQUIRED_CHANNEL, ctx.from!.id);
        if (['left', 'kicked'].includes(chatMember.status)) {
          const keyboard = new InlineKeyboard().url(
            lang.forceJoinButton, 
            `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`
          );
          return ctx.reply(lang.forceJoinText(REQUIRED_CHANNEL), {
            reply_markup: keyboard,
          });
        }
      } catch (error) {
        console.error("Error checking chat member:", error);
      }
    }

    // جلب البروكسيات
    try {
      const proxies = await db.getTopProxies(3);

      if (proxies.length === 0) {
        return ctx.reply(lang.noProxies);
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

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error('Database error:', error);
      return ctx.reply('❌ Error fetching proxies');
    }
  });

  bot.callbackQuery('refresh_proxies', async (ctx) => {
    const lang = getLang(ctx);
    
    try {
      const proxies = await db.getTopProxies(3);
      
      if (proxies.length === 0) {
        return ctx.answerCallbackQuery({ text: lang.noNewProxies, show_alert: true });
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

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }).catch(() => {});

      await ctx.answerCallbackQuery({ text: lang.updatedSuccess });
    } catch (error) {
      console.error('Refresh error:', error);
      await ctx.answerCallbackQuery({ text: '❌ Error', show_alert: true });
    }
  });
}

// ✅ Handler ديناميكي - يُنشأ عند كل طلب
export async function POST(req: Request) {
  try {
    const bot = getBot();
    const handler = webhookCallback(bot, 'std/http');
    return handler(req);
  } catch (error) {
    console.error('Bot error:', error);
    return Response.json({ error: 'Bot not configured' }, { status: 500 });
  }
}

// ✅ للـ GET (health check)
export async function GET() {
  return Response.json({ 
    status: 'ok', 
    botConfigured: !!process.env.TELEGRAM_BOT_TOKEN 
  });
}
