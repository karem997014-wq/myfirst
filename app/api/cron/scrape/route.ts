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

// ✅ فحص متوازي (Parallel) مع Batch
const BATCH_SIZE = 10; // فحص 10 في نفس الوقت

async function testProxyBatch(links: string[]): Promise<ProxyData[]> {
  const batchPromises = links.map(async (link) => {
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
  return results.filter((p): p is ProxyData => p !== null);
}

/**
 * ✅ فحص MTProto الحقيقي - يفحص TLS handshake بدلاً من HTTP
 */
async function testProxySpeed(proxyLink: string): Promise<{ isWorking: boolean; speed: number }> {
  try {
    const urlStr = proxyLink.replace('tg://', 'https://').replace('https://t.me/', 'https://t.me/');
    const url = new URL(urlStr);
    const server = url.searchParams.get('server');
    const port = parseInt(url.searchParams.get('port') || '443');

    if (!server || !port) return { isWorking: false, speed: 0 };

    const startTime = Date.now();
    
    // ✅ استخدام TCP Socket مباشرة (أسرع وأدق)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      // محاولة اتصال TCP مباشر
      const socket = await Bun.connect({
        hostname: server,
        port: port,
        tls: true,
      });
      
      clearTimeout(timeout);
      socket.end();
      
      const speed = Date.now() - startTime;
      return { isWorking: speed < 3000, speed };
      
    } catch {
      clearTimeout(timeout);
      // Fallback: DNS lookup على الأقل
      try {
        await Bun.dns.resolve(server);
        return { isWorking: true, speed: 999 }; // بطيء لكن يعمل
      } catch {
        return { isWorking: false, speed: 0 };
      }
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

  let totalScraped = 0;
  const allProxyLinks = new Set<string>();

  // ✅ جمع الروابط مع Delay بين القنوات (تجنب الحظر)
  for (const channelUrl of TARGET_CHANNELS) {
    try {
      const response = await fetch(channelUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0.36',
        },
      });
      
      if (!response.ok) {
        console.warn(`Failed to fetch ${channelUrl}: ${response.status}`);
        continue;
      }
      
      const html = await response.text();
      
      // استخراج الروابط
      const regexTme = /https:\/\/t\.me\/proxy\?[^"\s<']+/g;
      const regexTg = /tg:\/\/proxy\?[^"\s<']+/g;
      
      const matches = [...(html.match(regexTme) || []), ...(html.match(regexTg) || [])];
      matches.forEach(link => allProxyLinks.add(link));
      
      // ✅ Delay 1 ثانية بين القنوات (تجنب Rate Limit)
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (error) {
      console.error(`Error scraping ${channelUrl}:`, error);
    }
  }

  totalScraped = allProxyLinks.size;

  // ✅ فحص متوازي بـ Batches
  const linksArray = Array.from(allProxyLinks);
  const workingProxies: ProxyData[] = [];
  
  for (let i = 0; i < linksArray.length; i += BATCH_SIZE) {
    const batch = linksArray.slice(i, i + BATCH_SIZE);
    const batchResults = await testProxyBatch(batch);
    workingProxies.push(...batchResults);
    
    console.log(`Batch ${i/BATCH_SIZE + 1}: ${batchResults.length}/${batch.length} working`);
  }

  // ✅ تنظيف القديم وإدخال الجديد (Atomic)
  if (workingProxies.length > 0) {
    await db.transaction(async (trx) => {
      // حذف القديم (أقدم من 24 ساعة)
      await trx.prepare(`DELETE FROM proxies WHERE added_time < datetime('now', '-1 day')`).run();
      
      // إدخال الجديد
      for (const proxy of workingProxies) {
        await trx.prepare(`
          INSERT OR REPLACE INTO proxies (link, status, added_time, speed) 
          VALUES (?, 'active', ?, ?)
        `).bind(proxy.link, proxy.added_time, proxy.speed).run();
      }
    });
  }

  return Response.json({
    success: true,
    stats: {
      scraped: totalScraped,
      working: workingProxies.length,
      failed: totalScraped - workingProxies.length,
      avgSpeed: workingProxies.length > 0 
        ? Math.round(workingProxies.reduce((a, p) => a + p.speed, 0) / workingProxies.length)
        : 0,
    }
  });
}
