export interface ProxyData {
  id?: number;
  link: string;
  status: 'active' | 'inactive';
  added_time: string;
  speed: number;
}

function getDB() {
  const globalAny = globalThis as any;
  return globalAny.process?.env?.DB || globalAny.DB || null;
}

export const db = {
  getTopProxies: async (limit: number = 3): Promise<ProxyData[]> => {
    const database = getDB();
    if (!database) return [];
    
    try {
      const { results } = await database.prepare(
        `SELECT * FROM proxies WHERE status = 'active' ORDER BY speed ASC LIMIT ?`
      ).bind(limit).all();
      return results as ProxyData[];
    } catch (e) {
      console.error('DB Error:', e);
      return [];
    }
  },
  
  batchInsertProxies: async (proxies: ProxyData[]): Promise<void> => {
    const database = getDB();
    if (!database || proxies.length === 0) return;
    
    const statements = proxies.map(p => 
      database.prepare(
        `INSERT OR REPLACE INTO proxies (link, status, added_time, speed) VALUES (?, ?, ?, ?)`
      ).bind(p.link, p.status, p.added_time, p.speed)
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
  }
};
