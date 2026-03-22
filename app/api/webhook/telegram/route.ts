import { db, ProxyData } from '@/lib/db';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '';

const i18n = {
  ar: {
    forceJoinText: (channel: string) => `عذراً عزيزي، يجب عليك الاشتراك في قناتنا أولاً للحصول على البروكسيات السريعة.\n\nالقناة: ${channel}`,
    forceJoinButton: '📢 اشترك في القناة أولاً',
    noProxies: 'عذراً، لا توجد بروكسيات متاحة حالياً.',
    successMessage: '✅ تم فحص هذا البروكسي قبل ثوانٍ وهو يعمل بسرعة 100%\n\n',
    proxyLine: (index: number, speed: number) => `⚡️ **بروكسي ${index}** (السرعة: ${speed}ms)`,
    connectBtn: (index: number) => `🚀 اتصال بالبروكسي ${index}`,
    refreshBtn: '🔄 تحديث البروكسيات',
    shareText: '\nشارك البوت مع أصدقائك!',
    updatedSuccess: 'تم تحديث البروكسيات بنجاح!',
    noNewProxies: 'لا توجد بروكسيات جديدة حالياً.'
  },
  en: {
    forceJoinText: (channel: string) => `Sorry, you must join our channel first.\n\nChannel: ${channel}`,
    forceJoinButton: '📢 Join Channel First',
    noProxies: 'Sorry, no proxies available.',
    successMessage: '✅ This proxy works at 100% speed\n\n',
    proxyLine: (index: number, speed: number) => `⚡️ **Proxy ${index}** (Speed: ${speed}ms)`,
    connectBtn: (index: number) => `🚀 Connect to Proxy ${index}`,
    refreshBtn: '🔄 Refresh Proxies',
    shareText: '\nShare with friends!',
    updatedSuccess: 'Proxies updated!',
    noNewProxies: 'No new proxies.'
  }
};

function getLang(code: string | undefined) {
  return code?.startsWith('ar') ? i18n.ar : i18n.en;
}

// ✅ إرسال رسالة باستخدام fetch مباشرة
async function sendMessage(chatId: number, text: string, options: any = {}) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || undefined,
    reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
  };
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${err}`);
  }
  
  return res.json();
}

// ✅ تعديل رسالة
async function editMessage(chatId: number, messageId: number, text: string, options: any = {}) {
  const url = `https://api.telegram.org/bot${TOKEN}/editMessageText`;
  
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: options.parse_mode || undefined,
    reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
  };
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ✅ رد على callback
async function answerCallback(queryId: string, text: string) {
  const url = `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: queryId,
      text: text
    })
  });
}

// ✅ التحقق من عضوية القناة
async function checkChannelMembership(userId: number): Promise<boolean> {
  if (!REQUIRED_CHANNEL || REQUIRED_CHANNEL.includes('your_channel')) return true;
  
  try {
    const url = `https://api.telegram.org/bot${TOKEN}/getChatMember`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: REQUIRED_CHANNEL,
        user_id: userId
      })
    });
    
    const data = await res.json();
    return !['left', 'kicked'].includes(data.result?.status);
  } catch (e) {
    return true; // إذا فشل التحقق، نسمح بالمرور
  }
}

// ✅ معالجة /start
async function handleStart(message: any) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const lang = getLang(message.from.language_code);
  
  // التحقق من الاشتراك
  const isMember = await checkChannelMembership(userId);
  if (!isMember) {
    const keyboard = {
      inline_keyboard: [[
        { text: lang.forceJoinButton, url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }
      ]]
    };
    return sendMessage(chatId, lang.forceJoinText(REQUIRED_CHANNEL), { reply_markup: keyboard });
  }
  
  // جلب البروكسيات
  const proxies = await db.getTopProxies(3);
  
  if (proxies.length === 0) {
    return sendMessage(chatId, lang.noProxies);
  }
  
  // بناء الرسالة
  let text = lang.successMessage;
  const buttons: any[] = [];
  
  proxies.forEach((p, i) => {
    const num = i + 1;
    text += `${lang.proxyLine(num, p.speed)}\n`;
    buttons.push([{ text: lang.connectBtn(num), url: p.link }]);
  });
  
  text += lang.shareText;
  buttons.push([{ text: lang.refreshBtn, callback_data: 'refresh_proxies' }]);
  
  return sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// ✅ معالجة Refresh
async function handleRefresh(callbackQuery: any) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const queryId = callbackQuery.id;
  const lang = getLang(callbackQuery.from.language_code);
  
  await answerCallback(queryId, '⏳...');
  
  const proxies = await db.getTopProxies(3);
  
  if (proxies.length === 0) {
    return editMessage(chatId, messageId, lang.noProxies);
  }
  
  let text = lang.successMessage;
  const buttons: any[] = [];
  
  proxies.forEach((p, i) => {
    const num = i + 1;
    text += `${lang.proxyLine(num, p.speed)}\n`;
    buttons.push([{ text: lang.connectBtn(num), url: p.link }]);
  });
  
  text += lang.shareText;
  buttons.push([{ text: lang.refreshBtn, callback_data: 'refresh_proxies' }]);
  
  await editMessage(chatId, messageId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
  
  return answerCallback(queryId, lang.updatedSuccess);
}

// ✅ الـ Handler الرئيسي
export async function POST(req: Request) {
  try {
    const update = await req.json();
    
    // معالجة في الخلفية
    if (update.message?.text === '/start') {
      handleStart(update.message).catch(console.error);
    } else if (update.callback_query?.data === 'refresh_proxies') {
      handleRefresh(update.callback_query).catch(console.error);
    }
    
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('POST error:', err);
    return new Response('OK', { status: 200 });
  }
}

export async function GET() {
  return Response.json({ 
    ok: true, 
    tokenSet: !!TOKEN 
  });
}
