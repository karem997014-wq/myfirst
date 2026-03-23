import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '@/lib/db';

// ========== إعدادات آمنة ==========
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing in env');

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '').trim() || '';

// ========== تخزين عالمي للبوت (Singleton) ==========
// سيتم تهيئة هذا المتغير مرة واحدة عند تحميل الـ Worker
let bot: Bot<Context> | null = null;
let botInfo: any = null;

// ========== i18n ==========
const I18N = {
  ar: {
    forceJoin: (ch: string) => `🔒 اشترك أولاً:\n@${ch}`,
    joinBtn: '📢 اشترك الآن',
    noProxies: '⚠️ لا توجد بروكسيات، جاري الفحص...',
    success: '✅ *بروكسيات مفحوصة*\n\n',
    proxy: (i: number, speed: number) => `⚡ **#${i}** \`${speed}ms\``,
    connect: (i: number) => `🚀 اتصال ${i}`,
    refresh: '🔄 تحديث',
    share: '\n📤 *شارك البوت*',
    updated: '✅ تم التحديث!',
    noUpdate: '⚠️ لا توجد تحديثات',
    error: '❌ حدث خطأ'
  },
  en: {
    forceJoin: (ch: string) => `🔒 Join first:\n@${ch}`,
    joinBtn: '📢 Join Channel',
    noProxies: '⚠️ No proxies, scanning...',
    success: '✅ *Verified proxies*\n\n',
    proxy: (i: number, speed: number) => `⚡ **#${i}** \`${speed}ms\``,
    connect: (i: number) => `🚀 Connect ${i}`,
    refresh: '🔄 Refresh',
    share: '\n📤 *Share this bot*',
    updated: '✅ Updated!',
    noUpdate: '⚠️ No new proxies',
    error: '❌ Something went wrong'
  }
} as const;

type LangKey = keyof typeof I18N;
const getLangKey = (ctx: Context): LangKey => ctx.from?.language_code?.startsWith('ar') ? 'ar' : 'en';

// ========== دوال مساعدة ==========
const buildKeyboard = (proxies: any[], lang: LangKey) => {
  const kb = new InlineKeyboard();
  proxies.forEach((p, i) => kb.url(I18N[lang].connect(i + 1), p.link).row());
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
    // مهلة قصيرة جداً للتحقق حتى لا نعلق الطلب
    const member = await Promise.race([
      ctx.api.getChatMember(channel, ctx.from!.id),
      new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
    ]);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return true; // Fail open: نسمح بالدخول إذا فشل التحقق لتجنب تعليق البوت
  }
};

// ========== Handlers ==========
const handleStart = async (ctx: Context) => {
  const lang = getLangKey(ctx);
  try {
    if (REQUIRED_CHANNEL) {
      const isMember = await checkMembership(ctx, REQUIRED_CHANNEL);
      if (!isMember) {
        return ctx.reply(I18N[lang].forceJoin(REQUIRED_CHANNEL), {
          reply_markup: new InlineKeyboard().url(I18N[lang].joinBtn, `https://t.me/${REQUIRED_CHANNEL}`)
        });
      }
    }

    // جلب البروكسيات مع مهلة زمنية صارمة
    const proxies = await Promise.race([
      db.getTopProxies(3),
      new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('db-timeout')), 4000))
    ]);

    if (!proxies?.length) return ctx.reply(I18N[lang].noProxies);

    await ctx.reply(buildMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, lang)
    });
  } catch (err) {
    console.error('Start error:', err);
    await ctx.reply(I18N[lang].error).catch(() => {});
  }
};

const handleRefresh = async (ctx: Context) => {
  const lang = getLangKey(ctx);
  try {
    await ctx.answerCallbackQuery();
    
    const proxies = await Promise.race([
      db.getTopProxies(3),
      new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
    ]);

    if (!proxies?.length) {
      return ctx.answerCallbackQuery({ text: I18N[lang].noUpdate, show_alert: true });
    }

    await ctx.editMessageText(buildMessage(proxies, lang), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(proxies, lang)
    });
    await ctx.answerCallbackQuery({ text: I18N[lang].updated });
  } catch (err) {
    console.error('Refresh error:', err);
    await ctx.answerCallbackQuery({ text: I18N[lang].error, show_alert: true }).catch(() => {});
  }
};

// ========== تهيئة البوت (تتم مرة واحدة فقط) ==========
// هذه الدالة تستدعى تلقائياً عند أول تحميل للكود في الـ Worker
const initializeBot = async () => {
  if (bot) return; // تم التهيئة مسبقاً

  try {
    // إنشاء بوت مؤقت لجلب المعلومات فقط
    const tempBot = new Bot(BOT_TOKEN);
    
    // نستخدم مهلة زمنية صارمة للتهيئة الأولية حتى لا يفشل الـ Worker عند البدء
    const initPromise = tempBot.init();
    const timeoutPromise = new Promise<void>((_, rej) => setTimeout(() => rej(new Error('Init timeout')), 5000));
    
    await Promise.race([initPromise, timeoutPromise]);
    
    botInfo = tempBot.botInfo;
    
    // إنشاء البوت النهائي بالمعلومات الجاهزة (لن يحاول الاتصال بتليجرام مرة أخرى)
    bot = new Bot(BOT_TOKEN, { botInfo });
    
    bot.command('start', handleStart);
    bot.callbackQuery('refresh_proxies', handleRefresh);
    bot.catch((err) => console.error('Bot handler error:', err));
    
    console.log('✅ Bot initialized successfully:', botInfo.username);
  } catch (error) {
    console.error('❌ Failed to initialize bot:', error);
    // لا نرمي الخطأ هنا لئلا نفشل الـ Worker بالكامل، لكن البوت لن يعمل حتى يصلح الأمر
    throw error; 
  }
};

// استدعاء التهيئة فوراً عند تحميل الملف (في بيئة Cloudflare يحدث هذا عند الـ Cold Start)
// ملاحظة: في Next.js App Router على Pages، قد نحتاج لضمان حدوث هذا قبل أول طلب POST
// لكن بما أن المتغير global، فسيتم الاحتفاظ به بين الطلبات في نفس الـ Instance.
initializeBot().catch(e => console.error("Init failed at startup", e));


// ========== POST Handler ==========
export const POST = async (req: Request) => {
  // 1. التأكد من أن البوت مهيأ (إذا لم يكن كذلك، نحاول مرة واحدة بسرعة)
  if (!bot || !botInfo) {
    try {
      await initializeBot();
    } catch (e) {
      console.error("Bot not ready:", e);
      // نرجع 503 ليقوم تليجرام بإعادة المحاولة لاحقاً بدلاً من إلغاء الطلب
      return new Response('Service Unavailable: Bot initializing', { status: 503 });
    }
  }

  try {
    const update = await req.json();
    
    // 2. معالجة التحديث فوراً (بدون أي waitUntil بطيء)
    // نمرر { canDrop: false } لمنع grammy من محاولة استخدام waitUntil بشكل افتراضي في بعض الحالات
    await bot!.handleUpdate(update, { canDrop: false }); 
    
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (err) {
    console.error('Webhook processing error:', err);
    // نرجع 200 دائماً لتليجرام ليتوقف عن إعادة الإرسال للأخطاء المنطقية
    return new Response('OK', { status: 200 });
  }
};

// ========== GET Handler للتحقق والتهيئة اليدوية ==========
export const GET = async () => {
  try {
    await initializeBot();
    if (!botInfo) throw new Error('Bot info still missing');
    
    return Response.json({ 
      ok: true, 
      username: botInfo.username, 
      name: botInfo.first_name,
      status: 'Ready'
    });
  } catch (err) {
    console.error('GET / Health check error:', err);
    return Response.json({ ok: false, error: 'Initialization failed' }, { status: 500 });
  }
};
