import {clearAuthSession} from '@/lib/auth/server';
import {sameOrigin} from '@/lib/server-session';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Request origin not allowed.'},{status:403});
 await clearAuthSession();return Response.json({success:true},{headers:{'Cache-Control':'no-store'}});
}
