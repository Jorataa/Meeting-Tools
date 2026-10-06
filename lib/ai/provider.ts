import {Meeting, resultSchema} from '../model';
import {z} from 'zod';
export type AnalysisInput={memory:ReturnType<typeof import('../model').memoryFor>;recent:{id:string;speaker:string;text:string;at:number}[];language:Meeting['language'];final:boolean;audio?:{base64:string;mimeType:string};};
export interface AIProvider {analyze(input:AnalysisInput):Promise<z.infer<typeof resultSchema>>;}
