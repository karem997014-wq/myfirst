import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '@/lib/db';

// ========== إعدادات آمنة ==========
// ملاحظة: نقرأ المتغير هنا لكن لا نرمي خطأ فوراً لضمان نجاح عملية البناء (Build)
const getBotToken = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    // الخطأ سيظهر فقط عند المحاولة الفعلية للاستخدام (Runtime)
    throw new Error('TELEGRAM_BOT_TOKEN is missing in environment variables');
  }
  return token;
};

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '').trim() || '';

// ========== تخزين عالمي للبوت (Singleton) ==========
let bot: Bot<Context> | null = null;
let botInfo: any = null;
let initPromise: Promise<void> | null = null;

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
    const member = await Promise.race([
      ctx.api.getChatMember(channel, ctx.from!.id),
      new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
    ]);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return true; 
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

// ========== تهيئة البوت ==========
const initializeBot = async () => {
  if (bot && botInfo) return; // موجود مسبقاً
  if (initPromise) return initPromise; // هناك عملية تهيئة جارية

  initPromise = (async () => {
    try {
      const token = getBotToken(); // التحقق هنا آمن لأنه أثناء Runtime
      const tempBot = new Bot(token);
      
      const initPromiseInner = tempBot.init();
      const timeoutPromise = new Promise<void>((_, rej) => setTimeout(() => rej(new Error('Init timeout')), 5000));
      
      await Promise.race([initPromiseInner, timeoutPromise]);
      
      botInfo = tempBot.botInfo;
      bot = new Bot(token, { botInfo });
      
      bot.command('start', handleStart);
      bot.callbackQuery('refresh_proxies', handleRefresh);
      bot.catch((err) => console.error('Bot handler error:', err));
      
      console.log('✅ Bot initialized:', botInfo.username);
    } catch (error) {
      console.error('❌ Bot init failed:', error);
      throw error;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

// نحاول التهيئة في الخلفية عند تحميل الملف، لكن لا ننتظرها هنا لتجنب فشل البناء
// في بيئة Cloudflare Workers، هذا الكود يعمل عند الـ Cold Start فقط
if (typeof window === 'undefined') {
    initializeBot().catch(e => console.error("Background init failed", e));
}

// ========== POST Handler ==========
export const POST = async (req: Request) => {
  try {
    // ننتظر التهيئة هنا إذا لزم الأمر
    await initializeBot();

    if (!bot) {
      console.error('Bot instance not created after init');
      return new Response('Internal Server Error', { status: 500 });
    }

    const update = await req.json();
    await bot.handleUpdate(update);
    
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (err) {
    console.error('Webhook error:', err);
    // نرجع 200 لتليجرام في حال الأخطاء المنطقية لمنع إعادة الإرسال
    if (err instanceof Error && err.message.includes('TELEGRAM_BOT_TOKEN')) {
        return new Response('Configuration Error: Missing Token', { status: 500 });
    }
    return new Response('OK', { status: 200 });
  }
};

// ========== GET Handler ==========
export const GET = async () => {
  try {
    await initializeBot();
    if (!botInfo) throw new Error('Bot info missing');
    
    return Response.json({ 
      ok: true, 
      username: botInfo.username, 
      name: botInfo.first_name,
      status: 'Ready'
    });
  } catch (err) {
    console.error('Health check error:', err);
    return Response.json({ ok: false, error: 'Initialization failed' }, { status: 500 });
  }
};
