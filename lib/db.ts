// This file simulates the Cloudflare D1 database for the local AI Studio preview.
// In a real Cloudflare deployment, you would use `getRequestContext().env.DB`

export interface ProxyData {
  id?: number;
  link: string;
  status: 'active' | 'inactive';
  added_time: string;
  speed: number;
}

// In-memory store for preview purposes
let mockDb: ProxyData[] = [];

export const db = {
  getTopProxies: async (limit: number = 3): Promise<ProxyData[]> => {
    // In D1: SELECT * FROM proxies WHERE status = 'active' ORDER BY speed ASC LIMIT ?
    return mockDb
      .filter((p) => p.status === 'active')
      .sort((a, b) => a.speed - b.speed)
      .slice(0, limit);
  },
  
  insertProxy: async (proxy: ProxyData): Promise<void> => {
    // In D1: INSERT OR REPLACE INTO proxies (link, status, added_time, speed) VALUES (...)
    const exists = mockDb.find((p) => p.link === proxy.link);
    if (!exists) {
      mockDb.push({
        ...proxy,
        id: mockDb.length + 1,
      });
    } else {
      // Update existing
      exists.status = proxy.status;
      exists.speed = proxy.speed;
      exists.added_time = proxy.added_time;
    }
  },

  batchInsertProxies: async (proxies: ProxyData[]): Promise<void> => {
    // In D1: Use a transaction or batch statement
    // e.g., db.batch([ db.prepare("INSERT OR REPLACE INTO proxies...").bind(...) ])
    for (const proxy of proxies) {
      const exists = mockDb.find((p) => p.link === proxy.link);
      if (!exists) {
        mockDb.push({
          ...proxy,
          id: mockDb.length + 1,
        });
      } else {
        exists.status = proxy.status;
        exists.speed = proxy.speed;
        exists.added_time = proxy.added_time;
      }
    }
  },

  getAll: async (): Promise<ProxyData[]> => {
    // In D1: SELECT * FROM proxies ORDER BY added_time DESC
    return [...mockDb].sort((a, b) => new Date(b.added_time).getTime() - new Date(a.added_time).getTime());
  },

  clearAll: async (): Promise<void> => {
    mockDb = [];
  }
};
