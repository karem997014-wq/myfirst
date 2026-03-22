'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Play, Server, ShieldCheck, Database, Zap } from 'lucide-react';

interface ProxyData {
  id?: number;
  link: string;
  status: string;
  added_time: string;
  speed: number;
}

export default function Dashboard() {
  const [proxies, setProxies] = useState<ProxyData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [stats, setStats] = useState<{scraped: number, working: number} | null>(null);

  const fetchProxies = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/proxies');
      if (res.ok) {
        const data = await res.json();
        setProxies(data.proxies || []);
      }
    } catch (error) {
      console.error("Failed to fetch proxies", error);
    }
    setIsLoading(false);
  };

  const triggerScraper = async () => {
    setIsScraping(true);
    setStats(null);
    try {
      const res = await fetch('/api/cron/scrape');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        await fetchProxies();
      }
    } catch (error) {
      console.error("Scraping failed", error);
    }
    setIsScraping(false);
  };

  useEffect(() => {
    fetchProxies();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-8 font-sans" dir="rtl">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
              <ShieldCheck className="w-8 h-8 text-emerald-500" />
              MTProto Proxy Bot
            </h1>
            <p className="text-slate-500 mt-1">Cloudflare D1 + Next.js Edge Telegram Bot</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={fetchProxies}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              تحديث القائمة
            </button>
            <button 
              onClick={triggerScraper}
              disabled={isScraping}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              <Play className={`w-4 h-4 ${isScraping ? 'animate-pulse' : ''}`} />
              {isScraping ? 'جاري القشط والفحص...' : 'تشغيل السكرابر يدوياً'}
            </button>
          </div>
        </header>

        {/* Stats Alert */}
        {stats && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-center gap-3">
            <Zap className="w-5 h-5 text-emerald-600" />
            <p>تم الانتهاء من الفحص! تم إيجاد <strong>{stats.scraped}</strong> رابط، منها <strong>{stats.working}</strong> بروكسي يعمل بسرعة ممتازة وتم تخزينها في قاعدة البيانات.</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Content - Proxy List */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-500" />
              البروكسيات المخزنة (D1 Database)
            </h2>
            
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              {proxies.length === 0 ? (
                <div className="p-12 text-center text-slate-500">
                  لا توجد بروكسيات حالياً. اضغط على "تشغيل السكرابر يدوياً" لجلب بروكسيات جديدة.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-sm font-medium text-slate-500">
                        <th className="p-4">السرعة (Ping)</th>
                        <th className="p-4">الحالة</th>
                        <th className="p-4">وقت الإضافة</th>
                        <th className="p-4">الرابط</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {proxies.map((proxy, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              proxy.speed < 100 ? 'bg-emerald-100 text-emerald-800' : 
                              proxy.speed < 200 ? 'bg-amber-100 text-amber-800' : 
                              'bg-red-100 text-red-800'
                            }`}>
                              {proxy.speed} ms
                            </span>
                          </td>
                          <td className="p-4">
                            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                              {proxy.status}
                            </span>
                          </td>
                          <td className="p-4 text-sm text-slate-500 font-mono" dir="ltr">
                            {new Date(proxy.added_time).toLocaleTimeString()}
                          </td>
                          <td className="p-4 text-sm font-mono text-slate-600 truncate max-w-[200px]" title={proxy.link} dir="ltr">
                            {proxy.link.substring(0, 30)}...
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar - Instructions */}
          <div className="space-y-6">
            <div className="bg-slate-900 text-slate-300 p-6 rounded-2xl shadow-sm">
              <h3 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-sky-400" />
                تعليمات النشر على Cloudflare
              </h3>
              <div className="space-y-4 text-sm">
                <p>
                  هذا المشروع جاهز للعمل على بيئة <strong>Cloudflare Edge</strong>.
                </p>
                <ol className="list-decimal list-inside space-y-2 text-slate-400">
                  <li>قم بإنشاء قاعدة بيانات D1 في حسابك.</li>
                  <li>انسخ <code className="text-sky-300 bg-slate-800 px-1 rounded">database_id</code> إلى ملف <code className="text-sky-300 bg-slate-800 px-1 rounded">wrangler.toml</code>.</li>
                  <li>قم بتنفيذ السكيما: <br/>
                    <code className="block mt-1 p-2 bg-slate-950 rounded border border-slate-800 text-xs font-mono" dir="ltr">
                      npx wrangler d1 execute proxy_db --file=./schema.sql
                    </code>
                  </li>
                  <li>أضف توكن البوت كمتغير بيئة: <br/>
                    <code className="block mt-1 p-2 bg-slate-950 rounded border border-slate-800 text-xs font-mono" dir="ltr">
                      npx wrangler secret put TELEGRAM_BOT_TOKEN
                    </code>
                  </li>
                  <li>اربط البوت بالـ Webhook الخاص بك: <br/>
                    <code className="block mt-1 p-2 bg-slate-950 rounded border border-slate-800 text-xs font-mono break-all" dir="ltr">
                      https://api.telegram.org/bot[TOKEN]/setWebhook?url=https://[YOUR_DOMAIN]/api/webhook/telegram
                    </code>
                  </li>
                </ol>
              </div>
            </div>
            
            <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl">
              <h3 className="text-indigo-900 font-semibold mb-2">معلومات التسويق (Adsgram)</h3>
              <p className="text-sm text-indigo-700 leading-relaxed">
                تم برمجة البوت ليرسل الرسالة التسويقية المطلوبة: 
                <br/><br/>
                <span className="italic font-medium bg-white px-2 py-1 rounded block border border-indigo-200">
                  "تم فحص هذا البروكسي قبل ثوانٍ وهو يعمل بسرعة 100%"
                </span>
                <br/>
                كما تم تفعيل ميزة <strong>الاشتراك الإجباري</strong> (Force Join) لزيادة أعضاء قناتك.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
