// bot/handler.ts
import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '@/lib/db';

// ========== الإعدادات ==========
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace('@', '') || '';

if (!TOKEN) throw new Error('❌ TELEGRAM_BOT_TOKEN غير موجود في المتغيرات');

const bot = new Bot(TOKEN);

// ========== الترجمات (i18n) ==========
const i18n: Record<string, any> = {
  ar: {
    forceJoin: '🔒 للانضمام للبوت يجب عليك الاشتراك في القناة أولاً',
    joinButton: '📢 اشترك الآن',
    noProxies: '⚠️ لا توجد بروكسيات متاحة حالياً',
    success: '✅ *أفضل 3 بروكسيات سريعة*:\n\n',
    proxyLine: (num: number, speed: string) => `${num}🔹 سرعة: \`${speed}\`\n`,
    connectBtn: (num: number) => `🔗 اتصال ${num}`,
    refresh: '🔄 تحديث',
    share: '\n📤 *شارك البوت مع أصدقائك*',
    updated: '✅ تم التحديث!',
    error: '❌ حدث خطأ، حاول لاحقاً'
  },
  en: {
    forceJoin: '🔒 Please join our channel to use the bot',
    joinButton: '📢 Join Channel',
    noProxies: '⚠️ No proxies available right now',
    success: '✅ *Top 3 Fastest Proxies*:\n\n',
    proxyLine: (num: number, speed: string) => `${num}🔹 Speed: \`${speed}\`\n`,
    connectBtn: (num: number) => `🔗 Connect ${num}`,
    refresh: '🔄 Refresh',
    share: '\n📤 *Share this bot with friends*',
    updated: '✅ Updated!',
    error: '❌ Something went wrong, try later'
  }
};

const getLang = (code?: string) => i18n[code?.startsWith('ar') ? 'ar' : 'en'];

// ========== التحقق من الاشتراك في القناة ==========
async function isMember(userId: number, channelId: string): Promise<boolean> {
  if (!channelId) return true;
  try {
    const member = await bot.api.getChatMember(channelId, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

// ========== بناء لوحة الأزرار ==========
function buildKeyboard(proxies: any[], lang: any) {
  const keyboard = new InlineKeyboard();
  
  proxies.forEach((p, i) => {
    keyboard.url(lang.connectBtn(i + 1), p.link);
  });
  
  keyboard.text(lang.refresh, 'refresh_proxies');
  return keyboard;
}

// ========== بناء رسالة البروكسيات ==========
function buildMessage(proxies: any[], lang: any): string {
  let text = lang.success;
  proxies.forEach((p, i) => {
    text += lang.proxyLine(i + 1, p.speed);
  });
  text += lang.share;
  return text;
}

// ========== Handler: /start ==========
bot.command('start', async (ctx: Context) => {
  try {
    const lang = getLang(ctx.from?.language_code);
    const userId = ctx.from!.id;

    // 🔒 التحقق من القناة
    if (REQUIRED_CHANNEL && !(await isMember(userId, REQUIRED_CHANNEL))) {
      return ctx.reply(lang.forceJoin, {
        reply_markup: new InlineKeyboard().url(
          lang.joinButton, 
          `https://t.me/${REQUIRED_CHANNEL}`
        )
      });
    }

    // 📡 جلب البروكسيات
    const proxies = await db.getTopProxies(3);
    
    if (!proxies.length) {
      return ctx.reply(lang.noProxies);
    }

    // 📤 إرسال الرسالة
    await ctx.reply(buildMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, lang)
    });

  } catch (err) {
    console.error('Start error:', err);
    await ctx.reply(getLang().error);
  }
});

// ========== Handler: زر التحديث ==========
bot.callbackQuery('refresh_proxies', async (ctx: Context) => {
  try {
    await ctx.answerCallbackQuery({ text: '⏳...' });
    
    const lang = getLang(ctx.from?.language_code);
    const proxies = await db.getTopProxies(3);

    if (!proxies.length) {
      return ctx.editMessageText(lang.noProxies);
    }

    await ctx.editMessageText(buildMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, lang)
    });
    
    await ctx.answerCallbackQuery({ text: lang.updated });
    
  } catch (err) {
    console.error('Refresh error:', err);
    await ctx.answerCallbackQuery({ text: getLang().error });
  }
});

// ========== Webhook Handler لـ Cloudflare Pages/Workers ==========
export async function POST(req: Request) {
  try {
    const update = await req.json();
    await bot.handleUpdate(update);
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    return new Response('OK', { status: 200 }); // Telegram expects 200
  }
}

export async function GET() {
  return Response.json({ 
    ok: true, 
    botInfo: await bot.getMe() 
  });
}

// ========== تصدير البوت للاستخدام المحلي ==========
export { bot };
