// app/api/webhook/telegram/route.ts
import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';



// ========== إعدادات آمنة للبيئة ==========
const getBotToken = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  return token;
};

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '') || '';

// ========== قاموس الترجمات (i18n) - ثابت ومُحسّن ==========
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

type LangKey = keyof typeof I18N;

const getLangKey = (ctx: Context): LangKey => 
  ctx.from?.language_code?.startsWith('ar') ? 'ar' : 'en';

// ========== دوال مساعدة ==========
const buildKeyboard = (proxies: any[], lang: LangKey) => {
  const kb = new InlineKeyboard();
  proxies.forEach((p, i) => {
    kb.url(I18N[lang].connect(i + 1), p.link).row();
  });
  kb.text(I18N[lang].refresh, 'refresh_proxies').row();
  return kb;
};

const buildMessage = (proxies: any[], lang: LangKey) => {
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

// ========== معالجة الأوامر ==========
const handleStart = async (ctx: Context) => {
  try {
    const lang = getLangKey(ctx);
    
    if (REQUIRED_CHANNEL && !(await checkMembership(ctx, REQUIRED_CHANNEL))) {
      return ctx.reply(I18N[lang].forceJoin(REQUIRED_CHANNEL), {
        reply_markup: new InlineKeyboard().url(I18N[lang].joinBtn, `https://t.me/${REQUIRED_CHANNEL}`)
      });
    }

    const proxies = await db.getTopProxies(3);
    if (!proxies.length) return ctx.reply(I18N[lang].noProxies);

    await ctx.reply(buildMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, lang)
    });
  } catch (err) {
    console.error('🚨 Start error:', err);
    await ctx.reply(I18N[getLangKey(ctx)].error).catch(() => {});
  }
};

const handleRefresh = async (ctx: Context) => {
  try {
    await ctx.answerCallbackQuery();
    const lang = getLangKey(ctx);
    
    const proxies = await db.getTopProxies(3);
    if (!proxies.length) {
      return ctx.answerCallbackQuery({ text: I18N[lang].noUpdate, show_alert: true });
    }

    await ctx.editMessageText(buildMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, lang)
    });
    await ctx.answerCallbackQuery({ text: I18N[lang].updated });
  } catch (err) {
    console.error('🚨 Refresh error:', err);
    await ctx.answerCallbackQuery({ 
      text: I18N[getLangKey(ctx)].error, 
      show_alert: true 
    }).catch(() => {});
  }
};

// ========== تهيئة البوت (Lazy - فقط عند التنفيذ) ==========
const createBot = () => {
  const token = getBotToken();
  const bot = new Bot(token);
  
  bot.command('start', handleStart);
  bot.callbackQuery('refresh_proxies', handleRefresh);
  bot.catch((err) => console.error('🤖 Bot error:', err));
  
  return bot;
};

// ========== Webhook Handler لـ Next.js App Router ==========
export const POST = (req: Request) => {
  const bot = createBot(); // ✅ تهيئة داخل الدالة فقط
  return webhookCallback(bot, 'std/http')(req);
};

// ✅ GET للتحقق من حالة البوت - باستخدام bot.api.getMe() الصحيح
export const GET = async () => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return Response.json({ ok: false, error: 'No token' }, { status: 503 });
    
    const bot = new Bot(token);
    // ✅ التصحيح: getMe() موجودة على bot.api وليس bot
    const me = await bot.api.getMe();
    return Response.json({ 
      ok: true, 
      username: me.username, 
      name: me.first_name,
      isBot: me.is_bot 
    });
  } catch (err) {
    console.error('GET error:', err);
    return Response.json({ ok: false, error: 'Bot check failed' }, { status: 500 });
  }
};

// ⚠️ لا تصدر أي شيء آخر هنا - فقط POST و GET و runtime مسموحة في Next.js Route
