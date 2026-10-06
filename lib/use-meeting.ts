'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {applyPatch, Candidate,Meeting,memoryFor,newMeeting,PresenceState,resultSchema} from './model';
import {bestCandidate,canSpeak} from './interruption';
import {Microphone} from './audio/capture';
import {Voice} from './audio/speech';
import {base64,joinSamples,wav} from './audio/wav';
import {AudioChunk,loadAudio,loadMeetings,saveAudio,saveMeeting} from './storage';
import {cloudLoad,cloudSave} from './supabase';
import {download} from './export';
export function useMeeting(){
 const [meeting,setMeeting]=useState<Meeting|null>(null),[history,setHistory]=useState<Meeting[]>([]),[phase,setPhase]=useState<'home'|'starting'|'live'|'ending'|'ended'>('home');
 const [presence,setPresence]=useState<PresenceState>('idle'),[paused,setPaused]=useState(false),[micMuted,setMicMuted]=useState(false),[aiMuted,setAiMuted]=useState(false),[level,setLevel]=useState(0),[elapsed,setElapsed]=useState(0),[error,setError]=useState(''),[aiReady,setAiReady]=useState<boolean|null>(null),[cloudStatus,setCloudStatus]=useState('Saved on this device'),[pendingCount,setPendingCount]=useState(0),[interview,setInterview]=useState(false);
 const current=useRef<Meeting|null>(null),microphone=useRef<Microphone|null>(null),voice=useRef<Voice|null>(null),queue=useRef<AudioChunk[]>([]),busy=useRef(false),speaking=useRef(false),active=useRef(false),muted=useRef(false),pausedRef=useRef(false),micMutedRef=useRef(false),lastVoice=useRef(0),lastSpoke=useRef(0),lastRequest=useRef(0),retryAt=useRef(0),failures=useRef(0),persistChain=useRef(Promise.resolve()),pumpRef=useRef<()=>Promise<void>>(async()=>{}),interviewRef=useRef(false),aiReadyRef=useRef(false),mounted=useRef(true),activeTime=useRef(0),tickAt=useRef(0),cloudTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const update=useCallback((next:Meeting)=>{current.current=next;setMeeting(next);persistChain.current=persistChain.current.then(async()=>{await saveMeeting(next);}).catch(()=>{setError('Device storage is full or unavailable. Export your notes before closing.');});if(cloudTimer.current)clearTimeout(cloudTimer.current);cloudTimer.current=setTimeout(()=>{cloudSave(current.current!).then(saved=>setCloudStatus(saved?'Synced to your account':'Saved on this device')).catch(e=>{setCloudStatus(e.message);});},2500);},[]);
 const refreshHistory=useCallback(async()=>{try{const local=await loadMeetings();const cloud=await cloudLoad().catch(()=>[]);const merged=new Map(local.map(m=>[m.id,m]));for(const m of cloud){const old=merged.get(m.id);if(!old||m.revision>old.revision)merged.set(m.id,m);}setHistory([...merged.values()].sort((a,b)=>b.startedAt-a.startedAt));}catch{setError('Device storage is unavailable. Please allow site storage to save meetings.');}},[]);
 useEffect(()=>{mounted.current=true;void refreshHistory();fetch('/api/session',{method:'POST'}).then(r=>r.json()).then(data=>{if(data.error)throw new Error(data.error);setAiReady(data.ai);aiReadyRef.current=data.ai;}).catch(()=>{setAiReady(false);setError('Connection unavailable. Audio can still be saved on this device.');});voice.current=new Voice();
 const before=(e:BeforeUnloadEvent)=>{if(active.current){e.preventDefault();}};window.addEventListener('beforeunload',before);const online=()=>{failures.current=0;retryAt.current=0;void pumpRef.current();};window.addEventListener('online',online);
 return()=>{mounted.current=false;window.removeEventListener('beforeunload',before);window.removeEventListener('online',online);voice.current?.cancel();void microphone.current?.stop();if(cloudTimer.current)clearTimeout(cloudTimer.current);};},[refreshHistory]);
 const processInput=useCallback(async(audio?:AudioChunk,final=false)=>{
  const snapshot=current.current;if(!snapshot)return;
  const cursor=snapshot.transcript.length;
  const response=await fetch('/api/process',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(55000),body:JSON.stringify({memory:memoryFor(snapshot),recent:snapshot.transcript.slice(Math.max(0,snapshot.analysisCursor-8)).slice(-60),language:snapshot.language,final,...audio?{audio:{base64:base64(wav(new Int16Array(audio.samples))),mimeType:'audio/wav'}}:{}})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Connection interrupted. Your audio and notes are saved.');
  const result=resultSchema.parse(data);if(current.current?.id!==snapshot.id)return;
  const base=current.current;const additions=result.segments.map((s,i)=>({id:`${audio?.id||'text'}:${i}`,speaker:s.speaker,text:s.text,at:(audio?.at||Date.now())+Math.min(audio?.duration||60,s.offsetSeconds)*1000,source:'human' as const}));
  const existing=new Set(base.transcript.map(s=>s.id));const transcript=[...base.transcript,...additions.filter(s=>!existing.has(s.id))].sort((a,b)=>a.at-b.at);
  const next=applyPatch({...base,transcript},result.patch);next.analysisCursor=cursor+additions.length;update(next);
  if(audio)await saveAudio({...audio,processed:true});
 },[update]);
 const pump=useCallback(async()=>{
  if(busy.current||speaking.current||!current.current||!aiReadyRef.current||Date.now()<retryAt.current||failures.current>=3)return;
  const chunk=queue.current[0];const textPending=current.current.analysisCursor<current.current.transcript.length;
  if(!chunk&&!textPending)return;
  if(Date.now()-lastRequest.current<12000)return;
  busy.current=true;lastRequest.current=Date.now();setPresence(interviewRef.current?'processing_response':'thinking');
  try{await processInput(chunk);if(chunk)queue.current.shift();failures.current=0;setError('');setPendingCount(queue.current.length);}catch(e){failures.current++;retryAt.current=Date.now()+Math.min(60000,15000*2**failures.current);setError(e instanceof Error?e.message:'AI connection interrupted. Your audio is saved.');setPresence('error');}finally{busy.current=false;}
 },[processInput]);
 useEffect(()=>{pumpRef.current=pump;},[pump]);
 const speak=useCallback(async(candidate:Candidate)=>{
  if(!current.current||speaking.current)return;
  speaking.current=true;setPresence('waiting_pause');
  try{
   await microphone.current?.setPaused(true);if(muted.current||pausedRef.current||!active.current){speaking.current=false;await microphone.current?.setPaused(pausedRef.current||micMutedRef.current);return;}
   // Flushing may have queued unheard speech; process it before asking.
   if(queue.current.length){speaking.current=false;await microphone.current?.setPaused(false);void pumpRef.current();return;}
   let started=false;
   const success=await voice.current!.speak(candidate.text,current.current.language,()=>{
    started=true;lastSpoke.current=Date.now();setPresence('speaking');const m=current.current!;
    update({...m,candidates:m.candidates.filter(c=>c.gapKey!==candidate.gapKey),questions:[...m.questions,{id:candidate.id,gapKey:candidate.gapKey,text:candidate.text,at:Date.now()}],transcript:[...m.transcript,{id:`ai:${candidate.id}`,text:candidate.text,speaker:'Hush',at:Date.now(),source:'ai'}]});
   },()=>{speaking.current=false;});
   if(!success&&!started)setError('Question was not played. You can retry it.');
  }catch(e){speaking.current=false;setError(e instanceof Error?e.message:'Voice playback failed.');}finally{speaking.current=false;if(active.current){await microphone.current?.setPaused(pausedRef.current||micMutedRef.current);lastVoice.current=Date.now();setPresence('processing_response');}}
 },[update]);
 useEffect(()=>{const interval=setInterval(()=>{
  if(!mounted.current)return;
  const now=Date.now();if(active.current&&!pausedRef.current){activeTime.current+=Math.max(0,now-tickAt.current);setElapsed(Math.floor(activeTime.current/1000));}tickAt.current=now;
  void pumpRef.current();
  const m=current.current;if(!m||!active.current||speaking.current||busy.current)return;
  const candidate=bestCandidate(m);const pendingSpeech=microphone.current?.hasUnprocessedSpeech()||false;
  if(candidate&&canSpeak(candidate,{now,lastVoiceAt:lastVoice.current,lastSpokeAt:lastSpoke.current,startedAt:m.startedAt,mode:m.mode,muted:muted.current,paused:pausedRef.current||micMutedRef.current,speaking:speaking.current,processing:busy.current,captureActive:active.current,pendingAudio:!!queue.current.length||pendingSpeech,revision:m.revision,interview:interviewRef.current})){void speak(candidate);return;}
  if(muted.current)setPresence('muted');else if(pausedRef.current||micMutedRef.current)setPresence('idle');else if(failures.current)setPresence('error');else if(candidate)setPresence(m.mode==='silent'?'question_ready':m.mode==='approval'&&!candidate.approved?'waiting_permission':'waiting_pause');else setPresence('listening');
 },400);return()=>clearInterval(interval);},[speak]);
 const attachMic=useCallback(async()=>{
  const mic=new Microphone({onLevel:(l,voice)=>{setLevel(l);if(voice)lastVoice.current=Date.now();},onChunk:(samples,at,hasSpeech)=>{
   const m=current.current;if(!m)return;const chunk:AudioChunk={id:crypto.randomUUID(),meetingId:m.id,samples:samples.buffer as ArrayBuffer,at,duration:samples.length/16000,hasSpeech,processed:!hasSpeech};
   persistChain.current=persistChain.current.then(async()=>{await saveAudio(chunk);if(hasSpeech){queue.current.push(chunk);setPendingCount(queue.current.length);void pumpRef.current();}}).catch(()=>{setError('Audio storage is full. Export this meeting and free device space.');});
  },onInterrupted:()=>{active.current=false;pausedRef.current=true;setPaused(true);setError('Microphone was disconnected or suspended. Resume to reconnect.');setPresence('error');}});
  microphone.current=mic;await mic.start();active.current=true;lastVoice.current=Date.now();tickAt.current=Date.now();
 },[]);
 const start=useCallback(async(title:string,language:Meeting['language'])=>{
  setPhase('starting');setError('');queue.current=[];failures.current=0;lastRequest.current=0;lastSpoke.current=0;activeTime.current=0;setElapsed(0);setPaused(false);pausedRef.current=false;setMicMuted(false);micMutedRef.current=false;setAiMuted(false);muted.current=false;setInterview(false);interviewRef.current=false;
  const m=newMeeting(title,language);current.current=m;
  try{await attachMic();update(m);setPhase('live');setPresence('listening');}catch(e){current.current=null;setMeeting(null);setPhase('home');setError(e instanceof DOMException&&e.name==='NotAllowedError'?'Microphone permission was denied. Allow microphone access in your browser’s site settings, then try again.':e instanceof DOMException&&e.name==='NotFoundError'?'No microphone was found. Connect one and try again.':e instanceof Error?e.message:'Could not start microphone.');}
 },[attachMic,update]);
 const togglePause=useCallback(async()=>{
  const next=!pausedRef.current;pausedRef.current=next;setPaused(next);if(next){voice.current?.cancel();speaking.current=false;await microphone.current?.setPaused(true);}else{if(!active.current){await microphone.current?.stop();try{await attachMic();}catch{setError('Could not reconnect microphone. Please check site permissions.');pausedRef.current=true;setPaused(true);return;}}await microphone.current?.setPaused(micMutedRef.current);lastVoice.current=Date.now();tickAt.current=Date.now();}
 },[attachMic]);
 const toggleMic=useCallback(async()=>{const next=!micMutedRef.current;micMutedRef.current=next;setMicMuted(next);voice.current?.cancel();speaking.current=false;await microphone.current?.setPaused(next||pausedRef.current);lastVoice.current=Date.now();},[]);
 const toggleAI=useCallback(()=>{muted.current=!muted.current;setAiMuted(muted.current);if(muted.current)voice.current?.cancel();},[]);
 const finalize=useCallback(async()=>{if(!current.current||!aiReadyRef.current)return;busy.current=true;setPresence('thinking');try{await processInput(undefined,true);}catch(e){setError(e instanceof Error?e.message:'Final notes are unavailable. Your live notes are saved.');}finally{busy.current=false;setPresence('idle');}},[processInput]);
 const end=useCallback(async()=>{
  setPhase('ending');active.current=false;voice.current?.cancel();speaking.current=false;await microphone.current?.stop();microphone.current=null;await persistChain.current;
  const deadline=Date.now()+55000;
  while((queue.current.length||busy.current)&&Date.now()<deadline&&failures.current===0){await pumpRef.current();await new Promise(r=>setTimeout(r,500));}
  if(!queue.current.length&&!busy.current&&failures.current===0)await finalize();else setError('Some audio still needs processing. Your recording is saved; use Retry AI when connected.');
  const m=current.current;if(m){update({...m,endedAt:Date.now(),duration:Math.floor(activeTime.current/1000)});await persistChain.current;await cloudSave(current.current!).catch(()=>{});}setPhase('ended');setInterview(false);interviewRef.current=false;setPresence('idle');void refreshHistory();
 },[finalize,refreshHistory,update]);
 const open=useCallback(async(m:Meeting)=>{update(m);setElapsed(m.duration);activeTime.current=m.duration*1000;setPhase('ended');setError('');queue.current=(await loadAudio(m.id)).filter(c=>!c.processed&&c.hasSpeech);setPendingCount(queue.current.length);},[update]);
 const retry=useCallback(async()=>{setError('');const r=await fetch('/api/session',{method:'POST'});const data=await r.json();aiReadyRef.current=!!data.ai;setAiReady(!!data.ai);if(!data.ai){setError('Connect Gemini in the server environment to process saved audio.');return;}failures.current=0;retryAt.current=0;lastRequest.current=0;await pumpRef.current();},[]);
 const approve=useCallback((text?:string)=>{const m=current.current;if(!m)return;const c=bestCandidate(m);if(!c)return;update({...m,candidates:m.candidates.map(q=>q.id===c.id?{...q,text:text?.trim()||q.text,approved:true}:q)});},[update]);
 const skip=useCallback(()=>{const m=current.current;if(!m)return;const c=bestCandidate(m);if(!c)return;update({...m,candidates:m.candidates.filter(q=>q.id!==c.id),questions:[...m.questions,{id:c.id,gapKey:c.gapKey,text:c.text,at:Date.now(),skipped:true}]});},[update]);
 const addText=useCallback((text:string,speaker:string)=>{const m=current.current;if(!m||!text.trim())return;update({...m,transcript:[...m.transcript,{id:crypto.randomUUID(),speaker:speaker.trim()||'Participant',text:text.trim(),at:Date.now(),source:'human'}]});void pumpRef.current();},[update]);
 const resolve=useCallback(async()=>{if(!current.current)return;setError('');setPhase('starting');try{await attachMic();setInterview(true);interviewRef.current=true;setPaused(false);pausedRef.current=false;setMicMuted(false);micMutedRef.current=false;update({...current.current,mode:'approval',candidates:current.current.candidates.map(c=>({...c,createdAt:Date.now()-11000}))});setPhase('live');}catch{setPhase('ended');setError('Allow microphone access to answer the remaining questions.');}},[attachMic,update]);
 const exportAudio=useCallback(async()=>{const m=current.current;if(!m)return;const chunks=(await loadAudio(m.id)).sort((a,b)=>a.at-b.at);if(!chunks.length){setError('This meeting has no saved audio.');return;}download(new Blob([wav(joinSamples(chunks.map(c=>new Int16Array(c.samples))))],{type:'audio/wav'}),`${m.title}.wav`);},[]);
 return {meeting,history,phase,presence,paused,micMuted,aiMuted,level,elapsed,error,aiReady,cloudStatus,pendingCount,interview,start,end,togglePause,toggleMic,toggleAI,update,open,retry,approve,skip,addText,resolve,exportAudio,refreshHistory,home:()=>{setPhase('home');setMeeting(null);current.current=null;setError('');},clearError:()=>setError('')};
}
