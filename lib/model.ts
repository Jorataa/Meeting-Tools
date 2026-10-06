import { z } from 'zod';
export const sectionSchema = z.enum(['overview','key_points','decisions','actions','open_questions','technical','risks','clarifications']);
export const noteSchema = z.object({id:z.string().min(1).max(100),section:sectionSchema,text:z.string().min(1).max(2000),owner:z.string().max(100).nullable(),deadline:z.string().max(120).nullable(),status:z.enum(['open','done','resolved']),evidence:z.array(z.string().max(100)).max(12)});
export const entitySchema = z.object({id:z.string().max(100),type:z.enum(['participant','topic','task','decision','system','dependency','risk','date','number','project','requirement','commitment']),label:z.string().max(200),facts:z.array(z.string().max(500)).max(12)});
export const candidateSchema = z.object({id:z.string().max(100),text:z.string().min(1).max(240),gapKey:z.string().max(120),noteId:z.string().max(100).nullable(),importance:z.number().min(0).max(1),urgency:z.number().min(0).max(1),confidence:z.number().min(0).max(1),naturalResolution:z.number().min(0).max(1),reason:z.string().max(300)});
export const patchSchema = z.object({topic:z.string().max(200),upserts:z.array(noteSchema).max(40),removeIds:z.array(z.string().max(100)).max(20),entities:z.array(entitySchema).max(30),candidates:z.array(candidateSchema).max(3),resolvedGapKeys:z.array(z.string().max(120)).max(20),answers:z.array(z.object({questionId:z.string().max(100),answer:z.string().max(1000)})).max(10)});
export const resultSchema = z.object({segments:z.array(z.object({speaker:z.string().max(100),text:z.string().min(1).max(3000),offsetSeconds:z.number().min(0).max(60)})).max(50),patch:patchSchema});
export type Note=z.infer<typeof noteSchema>;
export type Entity=z.infer<typeof entitySchema>;
export type Candidate=z.infer<typeof candidateSchema> & {createdAt:number;revision:number;approved?:boolean};
export type Patch=z.infer<typeof patchSchema>;
export type Segment={id:string;speaker:string;text:string;at:number;source:'human'|'ai'};
export type AskedQuestion={id:string;gapKey:string;text:string;at:number;answer?:string;skipped?:boolean};
export type Mode='silent'|'approval'|'autonomous';
export type PresenceState='idle'|'listening'|'thinking'|'question_ready'|'waiting_permission'|'waiting_pause'|'speaking'|'processing_response'|'muted'|'error';
export type Meeting={id:string;title:string;startedAt:number;endedAt?:number;duration:number;notes:Note[];entities:Entity[];topic:string;transcript:Segment[];questions:AskedQuestion[];candidates:Candidate[];revision:number;mode:Mode;language:'mixed'|'en'|'id';analysisCursor:number};
export function newMeeting(title:string,language:Meeting['language']):Meeting {return {id:crypto.randomUUID(),title:title.trim()||'Untitled meeting',startedAt:Date.now(),duration:0,notes:[],entities:[],topic:'',transcript:[],questions:[],candidates:[],revision:0,mode:'approval',language,analysisCursor:0};}
export function normalize(text:string) {return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function applyPatch(meeting:Meeting,patch:Patch):Meeting {
  const notes=new Map(meeting.notes.filter(n=>!patch.removeIds.includes(n.id)).map(n=>[n.id,n]));
  for(const note of patch.upserts) {
    // Model must keep IDs; reconcile semantic duplicates as a second guard.
    const existing=notes.get(note.id)??[...notes.values()].find(n=>n.section===note.section&&normalize(n.text)===normalize(note.text));
    notes.set(existing?.id??note.id,{...note,id:existing?.id??note.id});
  }
  const entities=new Map(meeting.entities.map(e=>[e.id,e]));
  for(const e of patch.entities) entities.set(e.id,e);
  const questions=meeting.questions.map(q=>{const a=patch.answers.find(a=>a.questionId===q.id);return a?{...q,answer:a.answer}:q;});
  const revision=meeting.revision+1;
  const resolved=new Set(patch.resolvedGapKeys.map(normalize));
  const candidates:Candidate[]=[];
  // Revalidate every turn: a stale candidate never survives just because it was approved.
  for(const c of patch.candidates){
    if(resolved.has(normalize(c.gapKey))||questions.some(q=>normalize(q.gapKey)===normalize(c.gapKey)||normalize(q.text)===normalize(c.text)))continue;
    const old=meeting.candidates.find(o=>normalize(o.gapKey)===normalize(c.gapKey));
    candidates.push({...c,createdAt:old?.createdAt??Date.now(),revision,approved:old?.approved&&old.text===c.text});
  }
  return {...meeting,notes:[...notes.values()],entities:[...entities.values()].slice(-200),topic:patch.topic,questions,candidates,revision};
}
export function memoryFor(meeting:Meeting) {return {topic:meeting.topic,notes:meeting.notes.slice(-200),entities:meeting.entities.slice(-200),previousQuestions:meeting.questions.slice(-60)};}
