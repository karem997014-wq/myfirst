import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';



// 🔐 التحقق من وجود التوكن - لا تستخدم قيمة افتراضية في الإنتاج
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error('❌ TELEGRAM_BOT_TOKEN is required');
}

const bot = new Bot(botToken);
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace('@', '') || '';

// --- Localization (i18n) ---
const i18n = {
  ar: {
    forceJoinText: (channel: string) => 
      `عذراً عزيزي، يجب عليك الاشتراك في قناتنا أولاً للحصول على البروكسيات السريعة.\n\nالقناة: @${channel}`,
    forceJoinButton: '📢 اشترك في القناة',
    noProxies: '⚠️ لا توجد بروكسيات متاحة حالياً. جاري الفحص، حاول لاحقاً.',
    successMessage: '✅ *تم فحص هذه البروكسيات مؤخراً وتعمل بسرعة عالية*\n\n',
    proxyLine: (index: number, speed: number) => 
      `⚡️ **بروكسي ${index}** \`(${speed}ms)\``,
    connectBtn: (index: number) => `🚀 اتصال ${index}`,
    refreshBtn: '🔄 تحديث',
    shareText: '\n📤 *شارك البوت مع أصدقائك*',
    updatedSuccess: '✅ تم التحديث!',
    noNewProxies: '⚠️ لا توجد تحديثات جديدة حالياً',
    error: '❌ حدث خطأ، حاول لاحقاً'
  },
  en: {
    forceJoinText: (channel: string) => 
      `Sorry, please join our channel first to access fast proxies.\n\nChannel: @${channel}`,
    forceJoinButton: '📢 Join Channel',
    noProxies: '⚠️ No proxies available. Scanning for new ones, try again soon.',
    successMessage: '✅ *These proxies were recently verified and working*\n\n',
    proxyLine: (index: number, speed: number) => 
      `⚡️ **Proxy ${index}** \`(${speed}ms)\``,
    connectBtn: (index: number) => `🚀 Connect ${index}`,
    refreshBtn: '🔄 Refresh',
    shareText: '\n📤 *Share this bot with friends*',
    updatedSuccess: '✅ Updated!',
    noNewProxies: '⚠️ No new proxies at the moment',
    error: '❌ Something went wrong, try later'
  }
};

function getLang(ctx: Context) {
  const code = ctx.from?.language_code || 'en';
  return code.startsWith('ar') ? i18n.ar : i18n.en;
}

// 🔒 دالة التحقق من العضوية (مع تحسينات)
async function checkChannelMembership(ctx: Context, channelId: string): Promise<boolean> {
  if (!channelId) return true;
  try {
    const member = await ctx.api.getChatMember(channelId, ctx.from!.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    // إذا كان البوت ليس أدمن في القناة، نسمح للمستخدم بالاستمرار (لتجنب التعطيل)
    console.warn('⚠️ Channel check failed (bot may not be admin):', err);
    return true;
  }
}

// 🎨 دالة بناء الأزرار (بدون .row() بعد كل زر)
function buildProxyKeyboard(proxies: any[], lang: any) {
  const keyboard = new InlineKeyboard();
  
  // زر لكل بروكسي في سطر منفصل (أفضل للتجربة على الموبايل)
  proxies.forEach((p, i) => {
    keyboard.url(lang.connectBtn(i + 1), p.link).row();
  });
  
  // زر التحديث في سطر منفصل في الأسفل
  keyboard.text(lang.refreshBtn, 'refresh_proxies').row();
  
  return keyboard;
}

// 📝 دالة بناء النص
function buildProxyMessage(proxies: any[], lang: any): string {
  let text = lang.successMessage;
  proxies.forEach((p, i) => {
    text += `${lang.proxyLine(i + 1, p.speed)}\n`;
  });
  text += lang.shareText;
  return text;
}

// ========== Handlers ==========

bot.command('start', async (ctx: Context) => {
  try {
    const lang = getLang(ctx);

    // 🔒 التحقق من الاشتراك
    if (REQUIRED_CHANNEL && !(await checkChannelMembership(ctx, REQUIRED_CHANNEL))) {
      const keyboard = new InlineKeyboard().url(
        lang.forceJoinButton, 
        `https://t.me/${REQUIRED_CHANNEL}`
      );
      return ctx.reply(lang.forceJoinText(REQUIRED_CHANNEL), {
        reply_markup: keyboard,
      });
    }

    // 📡 جلب البروكسيات
    const proxies = await db.getTopProxies(3);
    
    if (!proxies.length) {
      return ctx.reply(lang.noProxies);
    }

    // 📤 الإرسال
    await ctx.reply(buildProxyMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildProxyKeyboard(proxies, lang),
    });

  } catch (err) {
    console.error('🚨 Start handler error:', err);
    await ctx.reply(getLang(ctx).error).catch(() => {});
  }
});

bot.callbackQuery('refresh_proxies', async (ctx: Context) => {
  try {
    await ctx.answerCallbackQuery(); // تأكيد الاستلام أولاً
    
    const lang = getLang(ctx);
    const proxies = await db.getTopProxies(3);
    
    if (!proxies.length) {
      return ctx.answerCallbackQuery({ text: lang.noNewProxies, show_alert: true });
    }

    await ctx.editMessageText(buildProxyMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildProxyKeyboard(proxies, lang),
    });

    await ctx.answerCallbackQuery({ text: lang.updatedSuccess });
    
  } catch (err) {
    console.error('🚨 Refresh handler error:', err);
    // محاولة إعلام المستخدم بالخطأ
    await ctx.answerCallbackQuery({ 
      text: getLang(ctx).error, 
      show_alert: true 
    }).catch(() => {});
  }
});

// 🌐 Webhook handler لـ Next.js App Router / Cloudflare
export const POST = webhookCallback(bot, 'std/http');

// 🔄 اختياري: دعم GET للتحقق من حالة البوت
export async function GET() {
  try {
    const me = await bot.getMe();
    return Response.json({ ok: true, bot: me.username });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

