import * as cheerio from 'cheerio';
import { db, ProxyData } from '@/lib/db';

const TARGET_CHANNELS = [
  'https://t.me/s/ProxyMTProto',
  'https://t.me/s/MTProtoProxies',
  'https://t.me/s/TelMTProto',
  // أضف باقي القنوات هنا
];

// ✅ تصغير حجم الدفعة وتقليل الوقت لضمان السرعة
const BATCH_SIZE = 10; 
const TIMEOUT_MS = 1500; // 1.5 ثانية كافية لفحص الاتصال
const MAX_PROXIES_TO_CHECK = 30; // تقليل العدد الإجمالي لتسريع العملية

async function testProxySpeed(proxyLink: string): Promise<{ isWorking: boolean; speed: number }> {
  try {
    // تحويل الرابط لاستخراج السيرفر والمنفذ
    const urlStr = proxyLink.replace('tg://proxy?', 'https://t.me/proxy?').replace('tg://', 'https://');
    const url = new URL(urlStr);
    const server = url.searchParams.get('server');
    const port = url.searchParams.get('port');

    if (!server || !port) return { isWorking: false, speed: 0 };

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // نستخدم fetch عادي ولكن نتحكم في التايم آوت
      // ملاحظة: no-cors قد لا يعطي نتائج دقيقة دائماً، لكنه الأسرع
      await fetch(`http://${server}:${port}`, {
        signal: controller.signal,
        method: 'HEAD', // أسرع من GET
        // @ts-ignore - mode غير مدعوم في fetch العادي داخل Workers أحياناً بنفس الطريقة
        mode: 'no-cors' 
      }).catch(() => {}); // تجاهل الأخطاء، يهمنا فقط هل وصلنا لنهاية التايم آوت أم لا
      
      clearTimeout(timeoutId);
      const speed = Date.now() - startTime;
      
      // إذا كان السرعة أقل من التايم آوت، فالبروكسي يستجيب
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
  
  // التحقق من السر
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allProxyLinks = new Set<string>();

  // 1. جلب الصفحات بسرعة (Parallel)
  const channelRequests = TARGET_CHANNELS.map(channelUrl => 
    fetch(channelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      // وضع تایم آوت للجلب أيضاً
      signal: AbortSignal.timeout(5000) 
    }).then(res => res.ok ? res.text() : '').catch(() => '')
  );

  const htmlContents = await Promise.all(channelRequests);
  
  // 2. استخراج الروابط
  for (const html of htmlContents) {
    // تحسين الـ Regex ليكون أسرع
    const regex = /(https:\/\/t\.me\/proxy\?|tg:\/\/proxy\?)[^"'\s]+/g;
    const matches = html.match(regex) || [];
    matches.forEach(link => allProxyLinks.add(link));
  }

  // تقليل العدد لأقصى حد ممكن لتجنب توقف الـ Worker
  const linksArray = Array.from(allProxyLinks).slice(0, MAX_PROXIES_TO_CHECK);
  const workingProxies: ProxyData[] = [];
  
  // 3. الفحص على دفعات (Batch Processing)
  // هذا يمنع استهلاك الذاكرة والـ CPU دفعة واحدة
  for (let i = 0; i < linksArray.length; i += BATCH_SIZE) {
    const batch = linksArray.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.all(batch.map(async link => {
      const res = await testProxySpeed(link);
      if (res.isWorking) {
        return { link, status: 'active' as const, speed: res.speed, added_time: new Date().toISOString() };
      }
      return null;
    }));
    
    // إضافة النتائج العملية فقط
    workingProxies.push(...(batchResults.filter(p => p !== null) as ProxyData[]));
  }

  // 4. الحفظ في القاعدة
  if (workingProxies.length > 0) {
    try {
      await db.batchInsertProxies(workingProxies);
    } catch (e) {
      console.error("DB Insert Error:", e);
    }
  }

  return Response.json({ success: true, working: workingProxies.length });
}
