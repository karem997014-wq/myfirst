import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';
import { db } from '@/lib/db';

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL?.replace(/^@+/, '').trim() || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

let botInstance: Bot<Context> | null = null;

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
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_BOT_TOKEN is missing");

  // ✅ التصحيح: إزالة الأقواس الخاطئة وتمرير الإعدادات بشكل صحيح
  botInstance = new Bot(BOT_TOKEN, {
    client: {
      // يمكن استخدام fetch الافتراضي هنا أو حذف هذا القسم بالكامل
      timeoutSeconds: 30,
    },
    // ⚠️ نصيحة: من الأفضل إزالة botInfo لترك Grammy تكتشفه تلقائياً لتجنب مشاكل التحديث
  });

  // معالجة الأخطاء
  botInstance.catch((err) => {
    console.error('Bot Error:', err);
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
          // إذا فشل التحقق، عادة ما يعني ذلك أن البوت ليس أدمن أو المستخدم غير موجود،
          // يمكنك هنا تقرير ماذا تفعل (سماح أو منع). سنتركه يمر حالياً.
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
      // التحقق من الاشتراك عند التحديث أيضاً (اختياري لكن يفضل)
      if (REQUIRED_CHANNEL) {
         const chat = await ctx.api.getChatMember(`@${REQUIRED_CHANNEL}`, ctx.from!.id);
         if (['left', 'kicked'].includes(chat.status)) {
             return ctx.answerCallbackQuery({ text: I18N[lang].forceJoin(REQUIRED_CHANNEL), show_alert: true });
         }
      }

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
  const bot = getBot();
  // هذا السطر يضمن أن Cloudflare ينتظر انتهاء البوت من إرسال الرسائل قبل إغلاق الاتصال
  return webhookCallback(bot, "cloudflare-mod")(req);
};

export const GET = async () => {
  return Response.json({ status: "Bot is alive", timestamp: new Date().toISOString() });
};
