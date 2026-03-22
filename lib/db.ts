export interface ProxyData {
  id?: number;
  link: string;
  status: 'active' | 'inactive';
  added_time: string;
  speed: number;
}

// الحصول على D1 في بيئة Cloudflare Workers
function getDB() {
  // في Cloudflare Pages/Workers
  if (typeof process !== 'undefined' && process.env.DB) {
    return process.env.DB as any;
  }
  // في Next.js مع Cloudflare
  try {
    const { getRequestContext } = require('@cloudflare/next-on-pages');
    return getRequestContext().env.DB;
  } catch {
    throw new Error('Database not found. Make sure D1 binding is configured.');
  }
}

export const db = {
  getTopProxies: async (limit: number = 3): Promise<ProxyData[]> => {
    const database = getDB();
    const { results } = await database.prepare(
      `SELECT * FROM proxies WHERE status = 'active' ORDER BY speed ASC LIMIT ?`
    ).bind(limit).all();
    return results as ProxyData[];
  },
  
  insertProxy: async (proxy: ProxyData): Promise<void> => {
    const database = getDB();
    await database.prepare(`
      INSERT OR REPLACE INTO proxies (link, status, added_time, speed) 
      VALUES (?, ?, ?, ?)
    `).bind(proxy.link, proxy.status, proxy.added_time, proxy.speed).run();
  },

  batchInsertProxies: async (proxies: ProxyData[]): Promise<void> => {
    const database = getDB();
    // D1 يدعم batch statements
    const statements = proxies.map(proxy => 
      database.prepare(`
        INSERT OR REPLACE INTO proxies (link, status, added_time, speed) 
        VALUES (?, ?, ?, ?)
      `).bind(proxy.link, proxy.status, proxy.added_time, proxy.speed)
    );
    
    if (statements.length > 0) {
      await database.batch(statements);
    }
  },

  getAll: async (): Promise<ProxyData[]> => {
    const database = getDB();
    const { results } = await database.prepare(
      `SELECT * FROM proxies ORDER BY added_time DESC`
    ).all();
    return results as ProxyData[];
  },

  clearAll: async (): Promise<void> => {
    const database = getDB();
    await database.prepare(`DELETE FROM proxies`).run();
  }
};
