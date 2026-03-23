import * as cheerio from 'cheerio';
import { db, ProxyData } from '@/lib/db';

const TARGET_CHANNELS = [
  'https://t.me/s/ProxyMTProto',
  'https://t.me/s/MTProtoProxies',
  'https://t.me/s/TelMTProto',
  'https://t.me/s/Proxy',
  'https://t.me/s/MTProtoTG',
  'https://t.me/s/Proxies',
];

const BATCH_SIZE = 15; // زيادة الحزمة لتسريع العملية
const TIMEOUT_MS = 2500; // تقليل وقت الانتظار قليلاً لتجنب تعليق العامل

async function testProxySpeed(proxyLink: string): Promise<{ isWorking: boolean; speed: number }> {
  try {
    const urlStr = proxyLink.replace('tg://proxy?', 'https://t.me/proxy?').replace('tg://', 'https://');
    const url = new URL(urlStr);
    const server = url.searchParams.get('server');
    const port = url.searchParams.get('port');

    if (!server || !port) return { isWorking: false, speed: 0 };

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // محاولة اتصال سريعة جداً ببروتوكول HEAD
      await fetch(`http://${server}:${port}`, {
        signal: controller.signal,
        method: 'HEAD',
        mode: 'no-cors' 
      }).catch(() => {}); // نتوقع فشل البروتوكول، يهمنا الاستجابة الزمنية فقط
      
      clearTimeout(timeoutId);
      const speed = Date.now() - startTime;
      return { isWorking: speed < TIMEOUT_MS, speed };
    } catch {
      clearTimeout(timeoutId);
      return { isWorking: false, speed: 0 };
    }
  } catch {
    return { isWorking: false, speed: 0 };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allProxyLinks = new Set<string>();

  // جلب الروابط بالتوازي من جميع القنوات (أسرع بكثير من الحلقة القديمة)
  const channelRequests = TARGET_CHANNELS.map(channelUrl => 
    fetch(channelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(res => res.ok ? res.text() : '').catch(() => '')
  );

  const htmlContents = await Promise.all(channelRequests);
  
  for (const html of htmlContents) {
    const regex = /(https:\/\/t\.me\/proxy\?|tg:\/\/proxy\?)[^"\s<']+/g;
    const matches = html.match(regex) || [];
    matches.forEach(link => allProxyLinks.add(link));
  }

  const linksArray = Array.from(allProxyLinks).slice(0, 50); // تحديد العدد لتجنب الـ Timeout
  const workingProxies: ProxyData[] = [];
  
  // فحص البروكسيات على دفعات
  for (let i = 0; i < linksArray.length; i += BATCH_SIZE) {
    const batch = linksArray.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async link => {
      const res = await testProxySpeed(link);
      return res.isWorking ? { link, status: 'active' as const, speed: res.speed, added_time: new Date().toISOString() } : null;
    }));
    workingProxies.push(...(batchResults.filter(p => p !== null) as ProxyData[]));
  }

  if (workingProxies.length > 0) {
    await db.batchInsertProxies(workingProxies);
  }

  return Response.json({ success: true, working: workingProxies.length });
}
