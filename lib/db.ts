export interface ProxyData {
  id?: number;
  link: string;
  status: 'active' | 'inactive';
  added_time: string;
  speed: number;
}

// ✅ يعمل مع OpenNext + Cloudflare تلقائياً
function getDB() {
  // في Cloudflare Workers/Pages البيئة توفر DB مباشرة
  const globalAny = globalThis as any;
  
  if (globalAny.process?.env?.DB) {
    return globalAny.process.env.DB;
  }
  
  if (globalAny.DB) {
    return globalAny.DB;
  }
  
  // fallback للتطوير المحلي
  console.warn('⚠️ Using mock DB - set up D1 binding for production');
  return null;
}

export const db = {
  getTopProxies: async (limit: number = 3): Promise<ProxyData[]> => {
    const database = getDB();
    if (!database) return [];
    
    const { results } = await database.prepare(
      `SELECT * FROM proxies 
       WHERE status = 'active' 
       ORDER BY speed ASC 
       LIMIT ?`
    ).bind(limit).all();
    return results as ProxyData[];
  },
  
  insertProxy: async (proxy: ProxyData): Promise<void> => {
    const database = getDB();
    if (!database) return;
    
    await database.prepare(`
      INSERT OR REPLACE INTO proxies (link, status, added_time, speed) 
      VALUES (?, ?, ?, ?)
    `).bind(proxy.link, proxy.status, proxy.added_time, proxy.speed).run();
  },

  batchInsertProxies: async (proxies: ProxyData[]): Promise<void> => {
    const database = getDB();
    if (!database || proxies.length === 0) return;
    
    // D1 batch
    const statements = proxies.map(proxy => 
      database.prepare(`
        INSERT OR REPLACE INTO proxies (link, status, added_time, speed) 
        VALUES (?, ?, ?, ?)
      `).bind(proxy.link, proxy.status, proxy.added_time, proxy.speed)
    );
    
    await database.batch(statements);
  },

  getAll: async (): Promise<ProxyData[]> => {
    const database = getDB();
    if (!database) return [];
    
    const { results } = await database.prepare(
      `SELECT * FROM proxies ORDER BY added_time DESC`
    ).all();
    return results as ProxyData[];
  },

  clearAll: async (): Promise<void> => {
    const database = getDB();
    if (!database) return;
    await database.prepare(`DELETE FROM proxies`).run();
  }
};
