// app/api/webhook/telegram/route.ts
import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';

export const runtime = 'edge';

// ========== إعدادات آمنة للبيئة ==========
const getBotToken = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN غير موجود');
  return token.trim();
};

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '') || '';

// ========== قاموس الترجمات (i18n) ==========
const I18N = {
  ar: {
    forceJoin: (ch: string) => `🔒 عزيزي، اشترك في القناة أولاً:\n@${ch}`,
    joinBtn: '📢 اشترك الآن',
    noProxies: '⚠️ لا توجد بروكسيات متاحة، جاري الفحص...',
    success: '✅ *أفضل البروكسيات المفحوصة*\n\n',
    proxy: (i: number, speed: number) => `⚡ **#${i}** \`سرعة: ${speed}ms\``,
    connect: (i: number) => `🚀 اتصال ${i}`,
    refresh: '🔄 تحديث',
    share: '\n📤 *شارك البوت مع أصدقائك*',
    updated: '✅ تم التحديث!',
    noUpdate: '⚠️ لا توجد تحديثات جديدة',
    error: '❌ حدث خطأ، حاول لاحقاً'
  },
  en: {
    forceJoin: (ch: string) => `🔒 Please join first:\n@${ch}`,
    joinBtn: '📢 Join Channel',
    noProxies: '⚠️ No proxies available, scanning...',
    success: '✅ *Top verified proxies*\n\n',
    proxy: (i: number, speed: number) => `⚡ **#${i}** \`Speed: ${speed}ms\``,
    connect: (i: number) => `🚀 Connect ${i}`,
    refresh: '🔄 Refresh',
    share: '\n📤 *Share this bot*',
    updated: '✅ Updated!',
    noUpdate: '⚠️ No new proxies',
    error: '❌ Something went wrong'
  }
} as const;

const getLang = (ctx: Context) => {
  const code = ctx.from?.language_code || 'en';
  return code.startsWith('ar') ? I18N.ar : I18N.en;
};

// ========== دوال مساعدة ==========
const buildKeyboard = (proxies: any[], lang: keyof typeof I18N) => {
  const kb = new InlineKeyboard();
  proxies.forEach((p, i) => {
    kb.url(I18N[lang].connect(i + 1), p.link).row();
  });
  kb.text(I18N[lang].refresh, 'refresh_proxies').row();
  return kb;
};

const buildMessage = (proxies: any[], lang: keyof typeof I18N) => {
  let txt = I18N[lang].success;
  proxies.forEach((p, i) => { txt += `${I18N[lang].proxy(i + 1, p.speed)}\n`; });
  txt += I18N[lang].share;
  return txt;
};

const checkMembership = async (ctx: Context, channel: string): Promise<boolean> => {
  if (!channel) return true;
  try {
    const member = await ctx.api.getChatMember(channel, ctx.from!.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return true; // استمر إذا فشل التحقق (لعدم تعطيل البوت)
  }
};

// ========== معالجة الأوامر (يتم تهيئة البوت داخلها فقط عند التنفيذ) ==========
const handleStart = async (ctx: Context) => {
  try {
    const langKey = ctx.from?.language_code?.startsWith('ar') ? 'ar' : 'en';
    const lang = I18N[langKey];
    
    // 🔒 التحقق من الاشتراك في القناة
    if (REQUIRED_CHANNEL && !(await checkMembership(ctx, REQUIRED_CHANNEL))) {
      return ctx.reply(lang.forceJoin(REQUIRED_CHANNEL), {
        reply_markup: new InlineKeyboard().url(lang.joinBtn, `https://t.me/${REQUIRED_CHANNEL}`)
      });
    }

    // 📡 جلب البروكسيات من D1
    const proxies = await db.getTopProxies(3);
    if (!proxies.length) return ctx.reply(lang.noProxies);

    // 📤 إرسال الرسالة مع الأزرار
    await ctx.reply(buildMessage(proxies, langKey), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, langKey)
    });
  } catch (err) {
    console.error('🚨 Start error:', err);
    await ctx.reply(getLang(ctx).error).catch(() => {});
  }
};

const handleRefresh = async (ctx: Context) => {
  try {
    await ctx.answerCallbackQuery();
    const langKey = ctx.from?.language_code?.startsWith('ar') ? 'ar' : 'en';
    const lang = I18N[langKey];
    
    const proxies = await db.getTopProxies(3);
    if (!proxies.length) {
      return ctx.answerCallbackQuery({ text: lang.noUpdate, show_alert: true });
    }

    await ctx.editMessageText(buildMessage(proxies, langKey), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, langKey)
    });
    await ctx.answerCallbackQuery({ text: lang.updated });
  } catch (err) {
    console.error('🚨 Refresh error:', err);
    await ctx.answerCallbackQuery({ 
      text: (ctx.from?.language_code?.startsWith('ar') ? I18N.ar : I18N.en).error, 
      show_alert: true 
    }).catch(() => {});
  }
};

// ========== تهيئة البوت (Lazy - فقط عند وقت التشغيل، ليس أثناء البناء) ==========
const createBot = () => {
  const token = getBotToken();
  const bot = new Bot(token);
  
  bot.command('start', handleStart);
  bot.callbackQuery('refresh_proxies', handleRefresh);
  
  // معالجة الأخطاء العامة
  bot.catch((err) => {
    console.error('🤖 Bot error:', err);
  });
  
  return bot;
};

// ========== Webhook Handler لـ Next.js App Router ==========
export const POST = (req: Request) => {
  // ✅ تهيئة البوت داخل الدالة فقط عند الاستلام الفعلي (يتجنب خطأ البناء)
  const bot = createBot();
  return webhookCallback(bot, 'std/http')(req);
};

// ✅ اختياري: للتحقق من حالة البوت
export const GET = async () => {
  try {
    // لا نهيئ البوت هنا إلا إذا كان التوكن موجوداً
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return Response.json({ ok: false, error: 'No token' }, { status: 503 });
    
    const bot = new Bot(token);
    const me = await bot.getMe();
    return Response.json({ ok: true, username: me.username, name: me.first_name });
  } catch (err) {
    console.error('GET error:', err);
    return Response.json({ ok: false, error: 'Bot check failed' }, { status: 500 });
  }
};

// ⚠️ لا تصدر أي شيء آخر هنا (مثل: export { bot }) - هذا يسبب خطأ Next.js
