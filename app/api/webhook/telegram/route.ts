import { db } from '@/lib/db';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '';

// ... (نفس i18n و getLang)

// ============ Telegram API ============
async function tgApi(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) console.error(`TG API Error (${method}):`, data);
  return data;
}

// ============ Handlers ============
async function handleStart(msg: any) {
  console.log('🚀 handleStart called:', msg.from?.username);
  
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getLang(msg.from.language_code);

  // التحقق من القناة
  if (REQUIRED_CHANNEL && !REQUIRED_CHANNEL.includes('your_channel')) {
    try {
      const member = await tgApi('getChatMember', {
        chat_id: REQUIRED_CHANNEL,
        user_id: userId
      });
      
      if (['left', 'kicked'].includes(member.result?.status)) {
        console.log('❌ User not member:', userId);
        return tgApi('sendMessage', {
          chat_id: chatId,
          text: lang.forceJoinText(REQUIRED_CHANNEL),
          reply_markup: {
            inline_keyboard: [[
              { text: lang.forceJoinButton, url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }
            ]]
          }
        });
      }
    } catch (e) {
      console.log('Channel check error:', e);
    }
  }

  // جلب البروكسيات
  console.log('📡 Fetching proxies...');
  const proxies = await db.getTopProxies(3);
  console.log('✅ Found proxies:', proxies.length);

  if (proxies.length === 0) {
    return tgApi('sendMessage', { chat_id: chatId, text: lang.noProxies });
  }

  // بناء الرسالة
  const buttons: any[] = [];
  let text = lang.success;

  proxies.forEach((p, i) => {
    const num = i + 1;
    text += `${lang.proxyLine(num, p.speed)}\n`;
    buttons.push([{ text: lang.connectBtn(num), url: p.link }]);
  });

  text += lang.share;
  buttons.push([{ text: lang.refresh, callback_data: 'refresh_proxies' }]);

  console.log('📤 Sending message...');
  return tgApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function handleRefresh(query: any) {
  console.log('🔄 handleRefresh called');
  
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const queryId = query.id;
  const lang = getLang(query.from.language_code);

  await tgApi('answerCallbackQuery', { callback_query_id: queryId, text: '⏳...' });

  const proxies = await db.getTopProxies(3);
  
  if (proxies.length === 0) {
    return tgApi('editMessageText', { chat_id: chatId, message_id: msgId, text: lang.noProxies });
  }

  const buttons: any[] = [];
  let text = lang.success;

  proxies.forEach((p, i) => {
    const num = i + 1;
    text += `${lang.proxyLine(num, p.speed)}\n`;
    buttons.push([{ text: lang.connectBtn(num), url: p.link }]);
  });

  text += lang.share;
  buttons.push([{ text: lang.refresh, callback_data: 'refresh_proxies' }]);

  await tgApi('editMessageText', {
    chat_id: chatId,
    message_id: msgId,
    text,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });

  return tgApi('answerCallbackQuery', { callback_query_id: queryId, text: lang.updated });
}

// ============ Main Handler ============
export async function POST(req: Request) {
  console.log('📩 POST received at:', new Date().toISOString());
  console.log('🔗 URL:', req.url);
  
  try {
    const update = await req.json();
    console.log('📦 Update:', JSON.stringify(update, null, 2));

    // ✅ التحقق من الـ message أو callback_query
    if (update.message?.text === '/start') {
      console.log('✅ Detected /start command');
      handleStart(update.message).catch(e => console.error('Start error:', e));
    }
    else if (update.callback_query?.data === 'refresh_proxies') {
      console.log('✅ Detected refresh callback');
      handleRefresh(update.callback_query).catch(e => console.error('Refresh error:', e));
    }
    else {
      console.log('⚠️ Unknown update type:', Object.keys(update));
    }
    
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('❌ POST error:', err);
    return new Response('OK', { status: 200 });
  }
}

export async function GET() {
  return Response.json({ 
    ok: true, 
    hasToken: !!TOKEN,
    hasChannel: !!REQUIRED_CHANNEL 
  });
}
