import {geminiConfigured} from '@/lib/ai/config';
export async function GET(){return Response.json({ok:true,ai:geminiConfigured(),cloud:!!process.env.NEXT_PUBLIC_SUPABASE_URL},{headers:{'Cache-Control':'no-store'}});}
