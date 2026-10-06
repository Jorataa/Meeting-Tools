import {authMode,verifiedRequestIdentity} from '@/lib/auth/server';
export async function GET(){return Response.json({mode:authMode(),user:await verifiedRequestIdentity()},{headers:{'Cache-Control':'no-store'}});}
