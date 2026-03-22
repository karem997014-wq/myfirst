export interface ProxyData {
  id?: number;
  link: string;
  status: 'active' | 'inactive';
  added_time: string;
  speed: number;
}

function getDB() {
  if (typeof process !== 'undefined' && process.env.DB) {
    return process.env.DB as any;
  }
  try {
    const { getRequestContext } = require('@cloudflare/next-on-pages');
    return getRequestContext().env.DB;
  } catch {
    throw new Error('Database not found');
  }
}

export const db = {
  // ✅ Prepared Statements لإعادة الاستخدام
  getTopProxies: async (limit: number = 3): Promise<ProxyData[]> => {
    const database = getDB();
    const { results } = await database.prepare(
      `SELECT * FROM proxies 
       WHERE status = 'active' AND added_time > datetime('now', '-6 hours')
       ORDER BY speed ASC 
       LIMIT ?`
    ).bind(limit).all();
    return results as ProxyData[];
  },
  
  // ✅ Transaction support
  transaction: async (callback: (trx: any) => Promise<void>): Promise<void> => {
    const database = getDB();
    const trx = await database.batch([
      database.prepare('BEGIN'),
    ]);
    try {
      await callback(database);
      await database.prepare('COMMIT').run();
    } catch (e) {
      await database.prepare('ROLLBACK').run();
      throw e;
    }
  },

  batchInsertProxies: async (proxies: ProxyData[]): Promise<void> => {
    const database = getDB();
    // D1 يدعم 100 statement في batch واحد
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < proxies.length; i += BATCH_SIZE) {
      const batch = proxies.slice(i, i + BATCH_SIZE);
      const statements = batch.map(proxy => 
        database.prepare(`
          INSERT OR REPLACE INTO proxies (link, status, added_time, speed) 
          VALUES (?, ?, ?, ?)
        `).bind(proxy.link, proxy.status, proxy.added_time, proxy.speed)
      );
      await database.batch(statements);
    }
  },

  getAll: async (): Promise<ProxyData[]> => {
    const database = getDB();
    const { results } = await database.prepare(
      `SELECT * FROM proxies 
       WHERE added_time > datetime('now', '-24 hours')
       ORDER BY added_time DESC`
    ).all();
    return results as ProxyData[];
  },

  cleanup: async (): Promise<void> => {
    const database = getDB();
    await database.prepare(
      `DELETE FROM proxies WHERE added_time < datetime('now', '-7 days')`
    ).run();
  }
};
