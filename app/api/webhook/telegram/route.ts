import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';

// ========== إعدادات آمنة ==========
const getBotToken = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  return token;
};

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '').trim() || '';

// تخزين مؤقت لمعلومات البوت لتجنب جلبها في كل طلب (اختياري لكن مفضل للأداء)
let cachedBotInfo: any = null;

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
    // تحسين: استخدام api المباشر من السياق أسرع
    const member = await ctx.api.getChatMember(channel, ctx.from!.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch { 
    // في حال فشل التحقق (مثلاً البوت ليس أدمن)، نسمح بالدخول لتجنب تعليق البوت
    // أو يمكنك إرجاع false إذا كنت تريد صارماً
    return true; 
  }
};

// ========== Handlers ==========
const handleStart = async (ctx: Context) => {
  const lang = getLangKey(ctx);
  try {
    if (REQUIRED_CHANNEL) {
      // تحسين المهلة الزمنية للتحقق من العضوية
      const isMember = await Promise.race([
        checkMembership(ctx, REQUIRED_CHANNEL),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 4000)) // Fail open after 4s
      ]);
      
      if (!isMember) {
        return ctx.reply(I18N[lang].forceJoin(REQUIRED_CHANNEL), {
          reply_markup: new InlineKeyboard().url(I18N[lang].joinBtn, `https://t.me/${REQUIRED_CHANNEL}`)
        });
      }
    }

    const proxies = await Promise.race([
      db.getTopProxies(3),
      new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('db-timeout')), 5000))
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
      new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
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

// ========== تهيئة البوت (النقطة الحاسمة) ==========
const createBot = async () => {
  const token = getBotToken();
  
  // محاولة استعادة المعلومات من الذاكرة المؤقتة أولاً
  let botInfo = cachedBotInfo;

  if (!botInfo) {
    // إذا لم تكن موجودة، نجلبها مرة واحدة (يمكن حدوث ذلك في أول طلب بعد إعادة التشغيل)
    // نستخدم مهلة قصيرة لأننا في بيئة Edge
    try {
      const tempBot = new Bot(token);
      // ننتظر جلب المعلومات فقط في حالة عدم وجودها في الكاش
      await tempBot.init(); 
      botInfo = tempBot.botInfo;
      cachedBotInfo = botInfo; // حفظها للطلبات التالية
    } catch (e) {
      console.error("Failed to init bot info:", e);
      throw new Error("Cannot initialize bot info. Check Token.");
    }
  }

  // ✅ الحل: تمرير botInfo مباشرة لمنع محاولة الجلب التلقائي الفاشلة
  const bot = new Bot(token, { botInfo });
  
  bot.command('start', handleStart);
  bot.callbackQuery('refresh_proxies', handleRefresh);
  bot.catch((err) => console.error('Bot handler error:', err));
  
  return bot;
};

// ========== POST Handler ==========
export const POST = async (req: Request) => {
  try {
    const update = await req.json();
    
    // إنشاء البوت بالمعلومات الجاهزة
    const bot = await createBot();
    
    // معالجة التحديث
    await bot.handleUpdate(update);
    
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (err) {
    console.error('Webhook error:', err);
    // تليجرام يتوقع 200 دائماً لمنع إعادة المحاولة اللانهائية للأخطاء غير القابلة للإصلاح
    return new Response('OK', { status: 200 });
  }
};

// ========== GET Handler للتحقق ==========
export const GET = async () => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return Response.json({ ok: false, error: 'No token' }, { status: 503 });
    
    // هنا يمكننا تحديث الكاش إذا أردنا
    const tempBot = new Bot(token);
    await tempBot.init();
    cachedBotInfo = tempBot.botInfo; // تحديث الكاش العالمي

    return Response.json({ 
      ok: true, 
      username: tempBot.botInfo.username, 
      name: tempBot.botInfo.first_name 
    });
  } catch (err) {
    console.error('GET error:', err);
    return Response.json({ ok: false, error: 'Check failed' }, { status: 500 });
  }
};
