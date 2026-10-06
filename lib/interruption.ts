import {Candidate,Meeting,Mode} from './model';
export type Gate={now:number;lastVoiceAt:number;lastSpokeAt:number;startedAt:number;mode:Mode;muted:boolean;paused:boolean;speaking:boolean;processing:boolean;captureActive:boolean;pendingAudio:boolean;revision:number;interview?:boolean};
export function scoreQuestion(c:Candidate) {return c.importance*.5+c.urgency*.2+c.confidence*.3-c.naturalResolution*.35;}
export function bestCandidate(meeting:Meeting) {return [...meeting.candidates].filter(c=>c.confidence>=.75&&c.importance>=.65&&scoreQuestion(c)>=.6).sort((a,b)=>scoreQuestion(b)-scoreQuestion(a))[0];}
export function canSpeak(c:Candidate,g:Gate):boolean {
  if(g.muted||g.paused||g.speaking||g.processing||g.pendingAudio||!g.captureActive||g.mode==='silent'||c.revision!==g.revision)return false;
  if(g.mode==='approval'&&!c.approved)return false;
  if(c.confidence<.75||c.importance<.65||scoreQuestion(c)<.6)return false;
  if(g.now-g.lastVoiceAt<2500)return false;
  if(!g.interview&&(g.now-g.startedAt<20000||g.now-c.createdAt<10000||g.now-g.lastSpokeAt<90000))return false;
  return true;
}
