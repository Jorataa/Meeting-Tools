import {credentials} from '@/lib/auth/credentials';
export const runtime='nodejs';
export async function POST(request:Request){return credentials(request,false);}
