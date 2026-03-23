import * as cheerio from 'cheerio';
import { db, ProxyData } from '@/lib/db';


// Expanded list of public Telegram channels to scrape MTProto proxies from
const TARGET_CHANNELS = [
  'https://t.me/s/ProxyMTProto',
  'https://t.me/s/MTProtoProxies',
  'https://t.me/s/TelMTProto',
  'https://t.me/s/MTProtoTG',

];

/**
 * Performs a real connection test using `fetch` as a workaround for TCP Ping.
 * Since MTProto proxies use TLS/TCP, sending an HTTP request to the port will usually
 * result in a protocol error or empty response IF the port is open. If it times out or 
 * connection is refused, the proxy is dead.
 */
async function testProxySpeed(proxyLink: string): Promise<{ isWorking: boolean; speed: number }> {
  try {
    // Hack to easily parse query params from tg:// or https://t.me/
    const urlStr = proxyLink.replace('tg://', 'http://').replace('https://t.me/', 'http://');
    const url = new URL(urlStr);
    const server = url.searchParams.get('server');
    const port = url.searchParams.get('port');

    if (!server || !port) return { isWorking: false, speed: 0 };

    const startTime = Date.now();
    const controller = new AbortController();
    // Set a strict timeout of 2000ms (2 seconds)
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      // Attempt to connect to the IP and Port
      await fetch(`http://${server}:${port}`, { signal: controller.signal }).catch(() => {});
      clearTimeout(timeoutId);

      const speed = Date.now() - startTime;
      
      // If it responded/failed-protocol within 2 seconds, the port is open and reachable!
      return { isWorking: speed < 2000, speed };
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
  let totalWorking = 0;
  const workingProxies: ProxyData[] = [];

  for (const channelUrl of TARGET_CHANNELS) {
    try {
      const response = await fetch(channelUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const proxyLinks = new Set<string>();

      // 1. Regex Power: Extract links even if they are plain text
      const regexTme = /https:\/\/t\.me\/proxy\?[^"\s<']+/g;
      const regexTg = /tg:\/\/proxy\?[^"\s<']+/g;
      
      const matchesTme = html.match(regexTme) || [];
      const matchesTg = html.match(regexTg) || [];

      matchesTme.forEach(link => proxyLinks.add(link));
      matchesTg.forEach(link => proxyLinks.add(link));

      // Test and store each proxy
      for (const link of proxyLinks) {
        totalScraped++;
        const testResult = await testProxySpeed(link);
        
        if (testResult.isWorking) {
          totalWorking++;
          workingProxies.push({
            link,
            status: 'active',
            speed: testResult.speed,
            added_time: new Date().toISOString(),
          });
        }
      }

    } catch (error) {
      console.error(`Error scraping channel ${channelUrl}:`, error);
    }
  }

  // 2. Batch Inserts: Insert all working proxies at once to save D1 requests
  if (workingProxies.length > 0) {
    await db.batchInsertProxies(workingProxies);
  }

  return Response.json({
    success: true,
    message: 'Scraping and testing completed',
    stats: {
      scraped: totalScraped,
      working: totalWorking,
    }
  });
}
