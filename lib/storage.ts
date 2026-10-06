import {Meeting} from './model';
export type AudioChunk={id:string;meetingId:string;at:number;duration:number;samples:ArrayBuffer;hasSpeech:boolean;processed:boolean};
let database:Promise<IDBDatabase>|undefined;
function db(){database??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('hush-meetings',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('meetings',{keyPath:'id'});const a=d.createObjectStore('audio',{keyPath:'id'});a.createIndex('meetingId','meetingId');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return database;}
async function request<T>(store:string,mode:IDBTransactionMode,operation:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(store,mode);const r=operation(t.objectStore(store));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
export const saveMeeting=(meeting:Meeting)=>request('meetings','readwrite',s=>s.put(meeting));
export const loadMeetings=()=>request<Meeting[]>('meetings','readonly',s=>s.getAll());
export const saveAudio=(chunk:AudioChunk)=>request('audio','readwrite',s=>s.put(chunk));
export const loadAudio=(meetingId:string)=>request<AudioChunk[]>('audio','readonly',s=>s.index('meetingId').getAll(meetingId));
export async function deleteMeeting(id:string){await request('meetings','readwrite',s=>s.delete(id));const chunks=await loadAudio(id);for(const c of chunks)await request('audio','readwrite',s=>s.delete(c.id));}
