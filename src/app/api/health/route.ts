import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    await db.query('select 1');
    return NextResponse.json({ ok: true, db: db.driver });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
