import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';

export const runtime = 'edge';

// Initialize the bot with the token from environment variables
const botToken = process.env.TELEGRAM_BOT_TOKEN || '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
const bot = new Bot(botToken);

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '@your_channel_username';

// --- Localization (i18n) Dictionary ---
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

// Helper function to detect user's language
function getLang(ctx: Context) {
  const code = ctx.from?.language_code || 'ar';
  if (code.startsWith('ar')) return i18n.ar;
  return i18n.en; // Fallback to English for non-Arabic users (ru, en, es, etc.)
}

bot.command('start', async (ctx) => {
  const lang = getLang(ctx);

  // 1. Force Join Logic
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const chatMember = await ctx.api.getChatMember(REQUIRED_CHANNEL, ctx.from?.id!);
      if (['left', 'kicked'].includes(chatMember.status)) {
        const keyboard = new InlineKeyboard().url(lang.forceJoinButton, `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`);
        return ctx.reply(lang.forceJoinText(REQUIRED_CHANNEL), {
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      console.error("Error checking chat member status:", error);
    }
  }

  // 2. Fetch top 3 fastest proxies from D1 Database
  const proxies = await db.getTopProxies(3);

  if (proxies.length === 0) {
    return ctx.reply(lang.noProxies);
  }

  // 3. Marketing Message & One-Click Connect Buttons
  let message = lang.successMessage;
  const keyboard = new InlineKeyboard();
  
  proxies.forEach((proxy, index) => {
    const num = index + 1;
    message += `${lang.proxyLine(num, proxy.speed)}\n`;
    
    // Add a one-click connect button for each proxy
    // Telegram automatically handles tg://proxy links when clicked from an inline button
    keyboard.url(lang.connectBtn(num), proxy.link).row();
  });

  message += lang.shareText;
  
  // Add the refresh button at the bottom
  keyboard.text(lang.refreshBtn, 'refresh_proxies');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Handle the refresh button
bot.callbackQuery('refresh_proxies', async (ctx) => {
  const lang = getLang(ctx);
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
  }).catch(() => {}); // Catch error if message content is exactly the same

  await ctx.answerCallbackQuery({ text: lang.updatedSuccess });
});

// Export the webhook handler for Next.js App Router
export const POST = webhookCallback(bot, 'std/http');
