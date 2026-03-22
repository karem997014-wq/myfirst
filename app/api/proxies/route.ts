import { db } from '@/lib/db';

export const runtime = 'edge';

export async function GET() {
  try {
    const proxies = await db.getAll();
    return Response.json({ proxies });
  } catch (error) {
    return Response.json({ error: 'Failed to fetch proxies' }, { status: 500 });
  }
}
