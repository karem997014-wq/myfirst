import { Bot, webhookCallback, InlineKeyboard, Context, HttpError } from 'grammy';
import { db } from '@/lib/db';

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '').trim() || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

let botInstance: Bot<Context> | null = null;

// ✅ إضافة: إعداد fetch adapter لـ Cloudflare Workers
const fetchAdapter = (url: string, init?: RequestInit): Promise<Response> => {
  return fetch(url, {
    ...init,
    // ✅ مهم: تعطيل التحقق من SSL فقط إذا كنت تستخدم proxy محلي (اختياري)
    // @ts-ignore - Cloudflare يدعم هذه الخيارات
    cf: {
      // استخدام http2 إذا كان متاحاً
      http2: true,
    }
  });
};

const I18N = {
  ar: {
    forceJoin: (ch: string) => `🔒 اشترك أولاً في القناة لتتمكن من استخدام البوت:\n@${ch}`,
    joinBtn: '📢 اشترك الآن',
    noProxies: '⚠️ لا توجد بروكسيات نشطة حالياً، جاري التحديث...',
    success: '✅ *أسرع بروكسيات مفحوصة حالياً:*\n\n',
    proxy: (i: number, speed: number) => `⚡ **#${i}** 📶 \`${speed}ms\``,
    connect: (i: number) => `🚀 اتصال ${i}`,
    refresh: '🔄 تحديث القائمة',
    share: '\n📤 *شارك البوت مع أصدقائك لتعم الفائدة!*',
    error: '❌ عذراً، حدث خطأ مؤقت.'
  },
  en: {
    forceJoin: (ch: string) => `🔒 Please join our channel first:\n@${ch}`,
    joinBtn: '📢 Join Now',
    noProxies: '⚠️ No active proxies found, scanning...',
    success: '✅ *Top Verified Proxies:*\n\n',
    proxy: (i: number, speed: number) => `⚡ **#${i}** 📶 \`${speed}ms\``,
    connect: (i: number) => `🚀 Connect ${i}`,
    refresh: '🔄 Refresh List',
    share: '\n📤 *Share this bot with your friends!*',
    error: '❌ Sorry, an error occurred.'
  }
};

function getBot() {
  if (botInstance) return botInstance;
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");

  // ✅ إنشاء البوت مع fetch adapter مخصص
  botInstance = new Bot(BOT_TOKEN, {
    // ✅ إضافة: استخدام fetch adapter
    client: {
      fetch: fetchAdapter,
      // يمكنك إضافة timeout أطول إذا كانت الشبكة بطيئة
      timeoutSeconds: 30,
      // إعادة المحاولة في حال الفشل
      retry: 3,
    },
    botInfo: {
      id: Number(BOT_TOKEN.split(':')[0]),
      is_bot: true,
      first_name: "Turpo MTProxy bot", 
      username: "TurpoMTProxyBot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });

  // ✅ إضافة: معالجة الأخطاء بشكل أفضل
  botInstance.catch((err) => {
    console.error('Bot Error:', err);
    if (err instanceof HttpError) {
      console.error('HTTP Error Details:', err.error);
    }
  });

  // أمر البداية
  botInstance.command('start', async (ctx) => {
    const lang = ctx.from?.language_code?.startsWith('ar') ? 'ar' : 'en';
    try {
      if (REQUIRED_CHANNEL) {
        try {
          const chat = await ctx.api.getChatMember(`@${REQUIRED_CHANNEL}`, ctx.from!.id);
          if (['left', 'kicked'].includes(chat.status)) {
            return ctx.reply(I18N[lang].forceJoin(REQUIRED_CHANNEL), {
              reply_markup: new InlineKeyboard().url(I18N[lang].joinBtn, `https://t.me/${REQUIRED_CHANNEL}`)
            });
          }
        } catch (e) { 
          console.error('Channel check error:', e);
        }
      }

      const proxies = await db.getTopProxies(5);
      if (!proxies?.length) return ctx.reply(I18N[lang].noProxies);

      let text = I18N[lang].success;
      const kb = new InlineKeyboard();
      proxies.forEach((p, i) => {
        text += `${I18N[lang].proxy(i + 1, p.speed)}\n`;
        kb.url(I18N[lang].connect(i + 1), p.link).row();
      });
      
      kb.text(I18N[lang].refresh, 'refresh_proxies').row()
        .url('📤 Share Bot', `https://t.me/share/url?url=https://t.me/TurpoMTProxyBot&text=MTProxy for Telegram!`);

      await ctx.reply(text + I18N[lang].share, { parse_mode: 'Markdown', reply_markup: kb });
    } catch (err) {
      console.error('Command Error:', err);
      await ctx.reply(I18N[lang].error).catch(() => {});
    }
  });

  // تحديث القائمة
  botInstance.callbackQuery('refresh_proxies', async (ctx) => {
    const lang = ctx.from?.language_code?.startsWith('ar') ? 'ar' : 'en';
    try {
      const proxies = await db.getTopProxies(5);
      if (!proxies?.length) return ctx.answerCallbackQuery({ text: I18N[lang].noProxies, show_alert: true });

      let text = I18N[lang].success;
      const kb = new InlineKeyboard();
      proxies.forEach((p, i) => {
        text += `${I18N[lang].proxy(i + 1, p.speed)}\n`;
        kb.url(I18N[lang].connect(i + 1), p.link).row();
      });
      kb.text(I18N[lang].refresh, 'refresh_proxies').row()
        .url('📤 Share Bot', `https://t.me/share/url?url=https://t.me/TurpoMTProxyBot&text=MTProxy for Telegram!`);

      await ctx.editMessageText(text + I18N[lang].share, { parse_mode: 'Markdown', reply_markup: kb });
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.error('Callback Error:', e);
      await ctx.answerCallbackQuery().catch(() => {});
    }
  });

  return botInstance;
}

export const POST = async (req: Request) => {
  try {
    const bot = getBot();
    const handleUpdate = webhookCallback(bot, 'std/http');
    return await handleUpdate(req);
  } catch (err) {
    console.error('Webhook Error:', err);
    return new Response('OK', { status: 200 }); 
  }
};

export const GET = async () => {
  return Response.json({ status: "Bot is alive", timestamp: new Date().toISOString() });
};
