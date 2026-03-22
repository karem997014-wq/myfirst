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

const BATCH_SIZE = 10;
const TIMEOUT_MS = 3000;

// ✅ Type guard صحيح
function isValidProxy(p: ProxyData | null): p is ProxyData {
  return p !== null && p.link !== undefined;
}

async function testProxyBatch(links: string[]): Promise<ProxyData[]> {
  const batchPromises = links.map(async (link): Promise<ProxyData | null> => {
    const result = await testProxySpeed(link);
    if (result.isWorking) {
      return {
        link,
        status: 'active' as const,
        speed: result.speed,
        added_time: new Date().toISOString(),
      };
    }
    return null;
  });

  const results = await Promise.all(batchPromises);
  // ✅ تصفية null بشكل صحيح
  return results.filter((p): p is ProxyData => p !== null);
}

/**
 * فحص البروكسي باستخدام fetch مع AbortController
 */
async function testProxySpeed(proxyLink: string): Promise<{ isWorking: boolean; speed: number }> {
  try {
    const urlStr = proxyLink
      .replace('tg://proxy?', 'https://t.me/proxy?')
      .replace('tg://', 'https://');
    
    const url = new URL(urlStr);
    const server = url.searchParams.get('server');
    const port = url.searchParams.get('port');

    if (!server || !port) {
      return { isWorking: false, speed: 0 };
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // محاولة اتصال TCP سريعة
      await fetch(`http://${server}:${port}`, {
        signal: controller.signal,
        method: 'HEAD',
      }).catch(() => {
        // نتوقع خطأ بروتوكول، المهم هو الوقت
      });
      
      clearTimeout(timeoutId);
      const speed = Date.now() - startTime;
      
      return { isWorking: speed < TIMEOUT_MS, speed };
    } catch (e) {
      clearTimeout(timeoutId);
      return { isWorking: false, speed: 0 };
    }
  } catch (error) {
    return { isWorking: false, speed: 0 };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let totalScraped = 0;
  const allProxyLinks = new Set<string>();

  // جمع الروابط من القنوات
  for (const channelUrl of TARGET_CHANNELS) {
    try {
      const response = await fetch(channelUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) {
        console.warn(`Failed: ${channelUrl} (${response.status})`);
        continue;
      }
      
      const html = await response.text();
      
      const regexTme = /https:\/\/t\.me\/proxy\?[^"\s<']+/g;
      const regexTg = /tg:\/\/proxy\?[^"\s<']+/g;
      
      const matchesTme = html.match(regexTme) || [];
      const matchesTg = html.match(regexTg) || [];
      
      [...matchesTme, ...matchesTg].forEach(link => allProxyLinks.add(link));
      
      // Delay بسيط
      await new Promise(r => setTimeout(r, 500));
      
    } catch (error) {
      console.error(`Error scraping ${channelUrl}:`, error);
    }
  }

  totalScraped = allProxyLinks.size;

  // فحص متوازي
  const linksArray = Array.from(allProxyLinks);
  const workingProxies: ProxyData[] = [];
  
  for (let i = 0; i < linksArray.length; i += BATCH_SIZE) {
    const batch = linksArray.slice(i, i + BATCH_SIZE);
    const batchResults = await testProxyBatch(batch);
    workingProxies.push(...batchResults);
  }

  // إدخال في D1
  if (workingProxies.length > 0) {
    await db.batchInsertProxies(workingProxies);
  }

  return Response.json({
    success: true,
    stats: {
      scraped: totalScraped,
      working: workingProxies.length,
      avgSpeed: workingProxies.length > 0 
        ? Math.round(workingProxies.reduce((a, p) => a + p.speed, 0) / workingProxies.length)
        : 0,
    }
  });
}
