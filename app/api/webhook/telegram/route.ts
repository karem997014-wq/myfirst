// app/api/webhook/telegram/route.ts
import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';

export const runtime = 'edge';

// ========== إعدادات آمنة ==========
const getBotToken = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  return token;
};

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '').trim() || '';

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
    const member = await ctx.api.getChatMember(channel, ctx.from!.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch { return true; }
};

// ========== Handlers (سريعة ومُحسّنة لـ Edge) ==========
const handleStart = async (ctx: Context) => {
  const lang = getLangKey(ctx);
  try {
    // 🔒 تحقق سريع من القناة (بدون انتظار طويل)
    if (REQUIRED_CHANNEL) {
      const isMember = await Promise.race([
        checkMembership(ctx, REQUIRED_CHANNEL),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      if (!isMember) {
        return ctx.reply(I18N[lang].forceJoin(REQUIRED_CHANNEL), {
          reply_markup: new InlineKeyboard().url(I18N[lang].joinBtn, `https://t.me/${REQUIRED_CHANNEL}`)
        });
      }
    }

    // 📡 جلب البروكسيات مع مهلة زمنية
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

// ========== تهيئة البوت ==========
const createBot = () => {
  const token = getBotToken();
  const bot = new Bot(token);
  
  bot.command('start', handleStart);
  bot.callbackQuery('refresh_proxies', handleRefresh);
  bot.catch((err) => console.error('Bot error:', err));
  
  return bot;
};

// ========== POST Handler - مُحسّن لـ Edge ==========
export const POST = async (req: Request) => {
  try {
    // ✅ قراءة الجسم مرة واحدة فقط (مهم لـ Edge)
    const update = await req.json();
    
    // ✅ تهيئة البوت ومعالجة التحديث فوراً
    const bot = createBot();
    await bot.handleUpdate(update);
    
    // ✅ إرجاع استجابة سريعة لـ Telegram (يجب أن تكون < 30 ثانية)
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (err) {
    console.error('Webhook error:', err);
    // ✅ Telegram يتوقع دائماً 200 حتى لو حدث خطأ داخلي
    return new Response('OK', { status: 200 });
  }
};

// ========== GET Handler للتحقق ==========
export const GET = async () => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return Response.json({ ok: false, error: 'No token' }, { status: 503 });
    
    const bot = new Bot(token);
    const me = await bot.api.getMe();
    return Response.json({ ok: true, username: me.username, name: me.first_name });
  } catch (err) {
    console.error('GET error:', err);
    return Response.json({ ok: false, error: 'Check failed' }, { status: 500 });
  }
};
