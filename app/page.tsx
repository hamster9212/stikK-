"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type Kind = "toeic" | "pushup" | "stock";
type Status = "submitted" | "accepted" | "rejected" | "needs_review";
type RecordItem = {
  id: string; kind: Kind; date: string; createdAt: string; amount?: number;
  parts?: string[]; note: string; evidenceName?: string; evidenceHash?: string;
  status: Status; locked: boolean; details?: Record<string, string | number>;
};
type Audit = { id: string; at: string; action: string; recordId?: string; summary: string };
type BlogPost = { id: string; date: string; title: string; body: string; published: boolean };
type Level = "상" | "중" | "하";
type Condition = { focus: Level; tension: Level; noise: Level };
type EmergencySession = {
  id:string; startedAt:string; deadlineAt:string; task:string; before:Condition; after?:Condition;
  stage:"relax"|"video"|"focus"|"after"|"complete"|"failed";
  relaxStartedAt?:string; relaxCompletedAt?:string; videoHash?:string;
  videoDuration?:number; visibilityRatio?:number; regularity?:number; focusStartedAt?:string;
  focusCompletedAt?:string; completedAt?:string; failureReason?:string;
};
type AppState = { records: RecordItem[]; audits: Audit[]; posts: BlogPost[]; emergency:EmergencySession[]; startedAt?: string };

const PARTS = ["Part 2", "Part 3", "Part 4", "Part 5", "Part 7", "단어", "실전 모의고사"];
const TARGETS: Record<string, number> = { "Part 2": 2, "Part 3": 2, "Part 4": 2, "Part 5": 3, "Part 7": 3, "단어": 6, "실전 모의고사": 1 };
const STORAGE_KEY = "junyoung-referee-v1";
const initial: AppState = { records: [], audits: [], posts: [], emergency: [] };

function nowKst() { return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T"); }
function kstDate() { return nowKst().slice(0, 10); }
function uid() { return crypto.randomUUID(); }
async function sha256(data: ArrayBuffer | string) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
}
function weekStart(date = new Date()) {
  const d = new Date(date); const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day); d.setHours(3, 0, 0, 0); return d;
}
function withinWeek(r: RecordItem) { const d = new Date(`${r.date}T12:00:00+09:00`); return d >= weekStart(); }

export default function Home() {
  const [state, setState] = useState<AppState>(initial);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("로그인 대기");
  const [tab, setTab] = useState("today");
  const [message, setMessage] = useState("");
  const applyingRemote = useRef(false);
  const lastSerialized = useRef("");

  useEffect(() => onAuthStateChanged(auth, current => {
    setUser(current);
    setAuthReady(true);
    if (!current) {
      setReady(false);
      setState(initial);
      setSyncStatus("로그인 대기");
    }
  }), []);

  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    let unsubscribe = () => undefined;
    let cancelled = false;

    (async () => {
      setSyncStatus("클라우드 불러오는 중");
      const first = await getDoc(userRef);
      if (cancelled) return;
      if (!first.exists()) {
        const raw = localStorage.getItem(STORAGE_KEY);
        const legacy = raw ? JSON.parse(raw) : null;
        const migrated: AppState = legacy ? {
          records: legacy.records || [], audits: legacy.audits || [], posts: legacy.posts || [],
          emergency: legacy.emergency || [], startedAt: legacy.startedAt || nowKst(),
        } : { ...initial, startedAt: nowKst() };
        await setDoc(userRef, { ...migrated, updatedAt: serverTimestamp() });
        localStorage.removeItem(STORAGE_KEY);
      }
      unsubscribe = onSnapshot(userRef, { includeMetadataChanges: true }, snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        const remote: AppState = {
          records: data.records || [], audits: data.audits || [], posts: data.posts || [],
          emergency: data.emergency || [], startedAt: data.startedAt,
        };
        const serialized = JSON.stringify(remote);
        applyingRemote.current = true;
        lastSerialized.current = serialized;
        setState(remote);
        setReady(true);
        setSyncStatus(snapshot.metadata.hasPendingWrites ? "동기화 중" : snapshot.metadata.fromCache ? "오프라인 캐시" : "동기화 완료");
        queueMicrotask(() => { applyingRemote.current = false; });
      }, error => {
        setMessage(`동기화 오류: ${error.message}`);
        setSyncStatus("동기화 실패");
      });
    })().catch(error => {
      setMessage(`클라우드를 열 수 없습니다: ${error.message}`);
      setSyncStatus("연결 실패");
    });

    return () => { cancelled = true; unsubscribe(); };
  }, [user]);

  useEffect(() => {
    if (!user || !ready || applyingRemote.current) return;
    const serialized = JSON.stringify(state);
    if (serialized === lastSerialized.current) return;
    const timer = setTimeout(async () => {
      setSyncStatus("동기화 중");
      try {
        await setDoc(doc(db, "users", user.uid), { ...state, updatedAt: serverTimestamp() });
        lastSerialized.current = serialized;
        setSyncStatus("동기화 완료");
      } catch (error) {
        setSyncStatus("동기화 실패");
        setMessage(`저장하지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [state, user, ready]);
  useEffect(() => {
    if (!ready || !state.startedAt) return;
    navigator.serviceWorker?.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined);
    const current = new Date();
    if (current.getHours() < 3) return;
    const previous = new Date(current); previous.setDate(previous.getDate() - 1);
    const date = previous.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    if (date < state.startedAt.slice(0,10) || state.posts.some(p => p.id === `daily-${date}`)) return;
    const accepted = state.records.filter(r => r.date === date && r.status === "accepted");
    const total = accepted.filter(r => r.kind === "pushup").reduce((n,r)=>n+(r.amount||0),0);
    const stockProofs = accepted.filter(r => r.kind === "stock" && r.evidenceHash).length;
    const emergencyFailures=(state.emergency||[]).filter(x=>x.startedAt.slice(0,10)===date&&x.stage==="failed").length;
    const failures = [total < 100 ? `푸시업 ${total}/100개` : "", stockProofs < 2 ? `주식 증빙 ${stockProofs}/2건` : "", emergencyFailures?`비상 루틴 ${emergencyFailures}회 미완료`:""].filter(Boolean);
    if (!failures.length) return;
    const post: BlogPost = { id:`daily-${date}`, date, title:`${date} 약속 불이행 기록`, published:false, body:`박준영은 정한 기준을 충족하지 못했다. 확인된 미달은 ${failures.join(", ")}이다. 기록되지 않은 노력은 판정에 포함하지 않는다. 원인은 의지가 아니라 마감 전에 행동과 증빙을 배치하지 못한 데 있다. 다음 24시간에는 가장 작은 실행을 먼저 완료하고 즉시 증빙을 잠근다.` };
    setState(s=>({...s,posts:[post,...s.posts],audits:[{id:uid(),at:nowKst(),action:"FAILURE_POST_QUEUED",summary:`${date} 실패 회고 공개 대기`},...s.audits]}));
  }, [ready, state.startedAt, state.records, state.posts, state.emergency]);

  useEffect(()=>{if(!ready)return;const pending=state.emergency.filter(x=>['relax','video'].includes(x.stage));if(!pending.length)return;const next=Math.min(...pending.map(x=>new Date(x.deadlineAt).getTime()));const id=setTimeout(()=>setState(s=>{const now=Date.now();const failed=s.emergency.filter(x=>['relax','video'].includes(x.stage)&&new Date(x.deadlineAt).getTime()<=now);if(!failed.length)return s;return{...s,emergency:s.emergency.map(x=>failed.some(f=>f.id===x.id)?{...x,stage:'failed',failureReason:'시작 후 10분 안에 호흡 증빙 미완료'}:x),audits:[...failed.map(x=>({id:uid(),at:nowKst(),action:'EMERGENCY_FAILED',recordId:x.id,summary:'비상 루틴 10분 마감 초과'})),...s.audits]}}),Math.max(0,next-Date.now())+100);return()=>clearTimeout(id)},[ready,state.emergency]);

  const saveRecord = async (record: Omit<RecordItem, "id" | "createdAt" | "status" | "locked">, file?: File) => {
    let evidenceHash = "", evidenceName = "";
    if (file) { evidenceHash = await sha256(await file.arrayBuffer()); evidenceName = file.name; }
    const duplicate = evidenceHash && state.records.some(r => r.evidenceHash === evidenceHash);
    const item: RecordItem = { ...record, id: uid(), createdAt: nowKst(), evidenceHash, evidenceName, status: !file || duplicate ? "needs_review" : "submitted", locked: true };
    const audit: Audit = { id: uid(), at: nowKst(), action: "CREATE_LOCKED", recordId: item.id, summary: `${label(record.kind)} 기록 생성${duplicate ? " · 중복 증빙 감지" : ""}` };
    setState(s => ({ ...s, records: [item, ...s.records], audits: [audit, ...s.audits] }));
    setMessage(duplicate ? "동일한 증빙이 이미 제출되어 검토 대기로 저장했습니다." : "기록을 잠갔습니다. 이제 수정하거나 삭제할 수 없습니다.");
  };

  const review = (id: string, accepted: boolean) => setState(s => ({ ...s,
    records: s.records.map(r => r.id === id ? { ...r, status: accepted ? "accepted" : "rejected" } : r),
    audits: [{ id: uid(), at: nowKst(), action: "REVIEW", recordId: id, summary: accepted ? "증빙 인정" : "증빙 반려" }, ...s.audits]
  }));

  const acceptedToday = state.records.filter(r => r.date === kstDate() && r.status === "accepted");
  const pushups = acceptedToday.filter(r => r.kind === "pushup").reduce((n, r) => n + (r.amount || 0), 0);
  const stockEvidence = state.records.filter(r => r.kind === "stock" && r.date === kstDate() && r.evidenceHash).length;
  const weekly = useMemo(() => Object.fromEntries(PARTS.map(p => [p, state.records.filter(r => r.kind === "toeic" && r.status === "accepted" && withinWeek(r) && r.parts?.includes(p)).length])), [state.records]);

  if (!authReady) return <main className="loading">로그인 상태 확인 중…</main>;
  if (!user) return <main className="lock-screen"><section className="lock-card"><p className="eyebrow">JUNYOUNG REFEREE</p><h1>모든 기기에서 같은 책임 원장</h1><p>같은 Google 계정으로 로그인하면 기록과 판정 결과가 자동으로 동기화됩니다. 증빙 영상 원본은 업로드하거나 저장하지 않습니다.</p><button onClick={() => signInWithPopup(auth, googleProvider).catch(error => setMessage(`로그인 실패: ${error.message}`))}>Google로 로그인</button>{message && <p role="status">{message}</p>}</section></main>;
  if (!ready) return <main className="loading">클라우드 기록을 여는 중…</main>;

  return <main className="shell">
    <header><div><p className="eyebrow">박준영의 공개 책임 원장</p><h1>오늘의 약속은 오늘 증명한다.</h1><small>{user.email} · {syncStatus}</small></div><div className="deadline"><span>일일 마감</span><strong>다음 날 03:00</strong><button onClick={() => signOut(auth)}>로그아웃</button></div></header>
    <nav>{[["today","오늘"],["emergency","비상 루틴"],["record","기록"],["review","검토"],["weekly","주간"],["blog","공개 회고"],["audit","감사 로그"]].map(([id,t]) => <button key={id} className={tab===id?"active":""} onClick={() => setTab(id)}>{t}</button>)}</nav>
    {message && <div className="notice" role="status">{message}<button onClick={() => setMessage("")}>닫기</button></div>}
    {tab === "today" && <Today pushups={pushups} stockEvidence={stockEvidence} weekly={weekly} records={state.records} />}
    {tab === "emergency" && <Emergency sessions={state.emergency} setState={setState} />}
    {tab === "record" && <RecordForms onSave={saveRecord} />}
    {tab === "review" && <Review records={state.records} onReview={review} />}
    {tab === "weekly" && <Weekly weekly={weekly} />}
    {tab === "blog" && <Blog posts={state.posts} />}
    {tab === "audit" && <AuditLog audits={state.audits} />}
    <footer>오프라인 우선 · Asia/Seoul · 증빙 없는 기록은 달성 집계 제외</footer>
  </main>;
}

function Today({ pushups, stockEvidence, weekly, records }: { pushups:number; stockEvidence:number; weekly:Record<string,number>; records:RecordItem[] }) {
  const pending = records.filter(r => r.status === "submitted" || r.status === "needs_review").length;
  return <section><div className="hero-grid"><article className="metric primary"><span>푸시업</span><strong>{pushups}<small>/100</small></strong><progress value={pushups} max={100}/><p>{Math.max(0,100-pushups)}개 남음</p></article><article className="metric"><span>주식 증빙</span><strong>{stockEvidence}<small>/2장</small></strong><progress value={stockEvidence} max={2}/><p>주문·체결 + 보유 내역</p></article><article className="metric"><span>검토 대기</span><strong>{pending}<small>건</small></strong><p>불확실한 기록은 성공으로 세지 않습니다.</p></article></div><div className="panel"><div className="section-title"><div><p className="eyebrow">우선순위</p><h2>지금 빠져나갈 구멍</h2></div></div><ol className="risks">{pushups < 100 && <li><b>푸시업 {100-pushups}개 부족</b><span>세트 기록과 증빙을 함께 제출하세요.</span></li>}{stockEvidence < 2 && <li><b>주식 화면 {2-stockEvidence}장 부족</b><span>무매매도 주문·체결 내역으로 증명해야 합니다.</span></li>}{Object.entries(weekly).filter(([p,n])=>n<TARGETS[p]).slice(0,3).map(([p,n])=><li key={p}><b>{p} {TARGETS[p]-n}회 부족</b><span>월요일 오전 3시 이후에는 되돌릴 수 없습니다.</span></li>)}</ol></div></section>;
}

function Emergency({sessions,setState}:{sessions:EmergencySession[];setState:React.Dispatch<React.SetStateAction<AppState>>}){
  const active=sessions.find(x=>!['complete','failed'].includes(x.stage));
  const [task,setTask]=useState(""); const [before,setBefore]=useState<Condition>({focus:"하",tension:"상",noise:"상"});
  const [after,setAfter]=useState<Condition>({focus:"중",tension:"중",noise:"중"}); const [busy,setBusy]=useState(false); const [result,setResult]=useState("");
  const update=(id:string,patch:Partial<EmergencySession>,action:string,summary:string)=>setState(s=>({...s,emergency:s.emergency.map(x=>x.id===id?{...x,...patch}:x),audits:[{id:uid(),at:nowKst(),action,recordId:id,summary},...s.audits]}));
  const start=(e:FormEvent)=>{e.preventDefault();const started=new Date();const item:EmergencySession={id:uid(),startedAt:started.toISOString(),deadlineAt:new Date(started.getTime()+600000).toISOString(),task:task.trim(),before,stage:"relax"};setState(s=>({...s,emergency:[item,...s.emergency],audits:[{id:uid(),at:nowKst(),action:"EMERGENCY_STARTED",recordId:item.id,summary:`비상 루틴 시작 · 고정 업무: ${item.task}`},...s.audits]}));setTask("");};
  const video=async(file:File)=>{if(!active)return;setBusy(true);setResult("영상 길이와 움직임을 기기 안에서 분석하고 있습니다…");try{const hash=await sha256(await file.arrayBuffer());if(sessions.some(x=>x.videoHash===hash)){setResult("과거와 동일한 영상입니다. 새로 촬영하세요.");return;}const analysis=await analyzeBreathingVideo(file);if(!analysis.pass){setResult(`${analysis.reason} 새 3분 영상을 촬영하세요.`);return;}update(active.id,{stage:"focus",videoHash:hash,videoDuration:analysis.duration,visibilityRatio:analysis.coverage,regularity:analysis.regularity},"BREATH_VIDEO_ACCEPTED",`3분 호흡 영상 인정 · 관찰 ${Math.round(analysis.coverage*100)}% · 원본 즉시 폐기`);setResult("영상이 인정되었습니다. 원본은 저장하지 않고 폐기했습니다. 10분 안에 고정한 업무를 시작하세요.");}finally{setBusy(false);}};
  return <section className="panel emergency"><div className="section-title"><div><p className="eyebrow">CONDITION RESET</p><h2>생각을 늘리지 말고 정한 행동을 실행</h2></div></div>
    {!active&&<form className="record-form" onSubmit={start}><label>루틴 직후 시작할 업무<input value={task} onChange={e=>setTask(e.target.value)} required minLength={3} placeholder="예: Part 5 오답 10문제 검토"/><small>시작 후 수정·삭제할 수 없습니다.</small></label><ConditionFields value={before} onChange={setBefore}/><button className="submit">비상 루틴 시작</button></form>}
    {active&&<div className="routine"><div className="routine-head"><div><span className={`pill ${active.stage}`}>{stageLabel(active.stage)}</span><h3>{active.task}</h3></div><Deadline at={active.deadlineAt}/></div>
      {active.stage==="relax"&&<><div className="protocol"><b>눈을 감고 얕고 편안하게 호흡</b><ol><li>발끝 수축 후 이완 · 5초</li><li>손가락 끝 수축 후 이완 · 5초</li><li>어깨 수축 후 이완 · 5초</li><li>목 수축 후 이완 · 5초</li></ol></div><Timer seconds={20} label="20초 이완" startedAt={active.relaxStartedAt} onStart={()=>update(active.id,{relaxStartedAt:new Date().toISOString()},"RELAX_TIMER_STARTED","20초 이완 타이머 시작")} onDone={()=>update(active.id,{stage:"video",relaxCompletedAt:new Date().toISOString()},"RELAX_TIMER_COMPLETED","20초 이완 연속 완료")}/></>}
      {active.stage==="video"&&<div className="upload-box"><h3>3분 호흡 영상 확인</h3><p>입과 코를 크게 담아 3분 이상 연속 촬영하세요. 브라우저 안에서만 판정하며 원본 영상은 업로드·저장하지 않고 확인 직후 폐기합니다.</p><input type="file" accept="video/*" disabled={busy} onChange={e=>{const input=e.currentTarget;const file=input.files?.[0];if(file)video(file).finally(()=>{input.value="";});}}/>{result&&<p role="status">{result}</p>}</div>}
      {active.stage==="focus"&&<><p className="coach">지금 할 일은 하나뿐입니다: <b>{active.task}</b></p><Timer seconds={600} label="10분 집중" startedAt={active.focusStartedAt} onStart={()=>update(active.id,{focusStartedAt:new Date().toISOString()},"FOCUS_TIMER_STARTED","10분 집중 타이머 시작")} onDone={()=>update(active.id,{stage:"after",focusCompletedAt:new Date().toISOString()},"FOCUS_TIMER_COMPLETED","고정 업무 10분 유지 완료")}/></>}
      {active.stage==="after"&&<form className="record-form" onSubmit={e=>{e.preventDefault();update(active.id,{stage:"complete",after,completedAt:new Date().toISOString()},"EMERGENCY_COMPLETED","비상 루틴 및 업무 10분 유지 성공");}}><ConditionFields value={after} onChange={setAfter}/><button className="submit">사후 상태 저장하고 완료</button></form>}
    </div>}
    <div className="history"><h3>비상 루틴 이력</h3>{!sessions.length?<Empty text="아직 실행 기록이 없습니다."/>:sessions.map(x=><article className="row" key={x.id}><div><span className={`pill ${x.stage}`}>{stageLabel(x.stage)}</span><h3>{x.task}</h3><p>{new Date(x.startedAt).toLocaleString("ko-KR")} · {x.failureReason||conditionSummary(x)}</p></div></article>)}</div>
  </section>;
}

function ConditionFields({value,onChange}:{value:Condition;onChange:(v:Condition)=>void}){return <fieldset><legend>현재 상태 (분석용)</legend><div className="three"><LevelField label="집중 가능성" value={value.focus} onChange={v=>onChange({...value,focus:v})}/><LevelField label="신체 긴장" value={value.tension} onChange={v=>onChange({...value,tension:v})}/><LevelField label="정신적 소란" value={value.noise} onChange={v=>onChange({...value,noise:v})}/></div></fieldset>}
function LevelField({label,value,onChange}:{label:string;value:Level;onChange:(v:Level)=>void}){return <label>{label}<select value={value} onChange={e=>onChange(e.target.value as Level)}><option>상</option><option>중</option><option>하</option></select></label>}
function Timer({seconds,label,startedAt,onStart,onDone}:{seconds:number;label:string;startedAt?:string;onStart:()=>void;onDone:()=>void}){const [end,setEnd]=useState<number|undefined>(startedAt?new Date(startedAt).getTime()+seconds*1000:undefined);const [left,setLeft]=useState(seconds);useEffect(()=>{if(!end)return;const tick=()=>{const n=Math.max(0,Math.ceil((end-Date.now())/1000));setLeft(n);if(n===0){setEnd(undefined);onDone();}};tick();const id=setInterval(tick,250);return()=>clearInterval(id);},[end,onDone]);return <div className="timer"><strong>{Math.floor(left/60).toString().padStart(2,"0")}:{(left%60).toString().padStart(2,"0")}</strong><button disabled={!!end||!!startedAt} onClick={()=>{const finish=Date.now()+seconds*1000;setLeft(seconds);setEnd(finish);onStart();}}>{end?`${label} 진행 중`:startedAt?`${label} 완료 처리 중`:`${label} 시작`}</button><small>일시정지 없이 연속 완료만 인정됩니다.</small></div>}
function Deadline({at}:{at:string}){const [left,setLeft]=useState(0);useEffect(()=>{const tick=()=>setLeft(Math.max(0,Math.ceil((new Date(at).getTime()-Date.now())/1000)));tick();const id=setInterval(tick,1000);return()=>clearInterval(id)},[at]);return <div className="deadline-box"><small>호흡 증빙 마감</small><b>{Math.floor(left/60).toString().padStart(2,"0")}:{(left%60).toString().padStart(2,"0")}</b></div>}
function stageLabel(s:EmergencySession['stage']){return ({relax:"20초 이완",video:"영상 검증",focus:"10분 집중",after:"사후 측정",complete:"성공",failed:"실패"})[s]}
function conditionSummary(x:EmergencySession){return x.after?`집중 ${x.before.focus}→${x.after.focus}, 긴장 ${x.before.tension}→${x.after.tension}, 소란 ${x.before.noise}→${x.after.noise}`:"진행 중"}
async function analyzeBreathingVideo(file:File):Promise<{pass:boolean;reason:string;duration:number;coverage:number;regularity:number}>{const url=URL.createObjectURL(file);const v=document.createElement('video');v.muted=true;v.src=url;await new Promise<void>((ok,bad)=>{v.onloadedmetadata=()=>ok();v.onerror=()=>bad(new Error('영상을 읽을 수 없습니다.'));});const duration=v.duration;if(!Number.isFinite(duration)||duration<180){URL.revokeObjectURL(url);return{pass:false,reason:'영상이 3분 미만입니다.',duration,coverage:0,regularity:0}}const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;const values:number[]=[];let valid=0;for(let t=0;t<180;t+=5){v.currentTime=t;await new Promise<void>(ok=>v.onseeked=()=>ok());ctx.drawImage(v,0,0,96,96);const d=ctx.getImageData(24,24,48,48).data;let mean=0,variance=0;for(let i=0;i<d.length;i+=4)mean+=(d[i]+d[i+1]+d[i+2])/3;mean/=d.length/4;for(let i=0;i<d.length;i+=4){const g=(d[i]+d[i+1]+d[i+2])/3;variance+=(g-mean)**2}variance/=d.length/4;if(variance>8)valid++;values.push(mean);}URL.revokeObjectURL(url);const coverage=valid/values.length;const delta=values.slice(1).map((x,i)=>Math.abs(x-values[i]));const median=[...delta].sort((a,b)=>a-b)[Math.floor(delta.length/2)]||0;const moving=delta.filter(x=>x>Math.max(.18,median*.45)).length/delta.length;const regularity=Math.min(1,moving/.35);if(coverage<.9)return{pass:false,reason:'코·입 관찰 가능 구간이 90% 미만입니다.',duration,coverage,regularity};if(regularity<.6)return{pass:false,reason:'코·입 주변의 반복적인 미세 움직임이 충분하지 않습니다.',duration,coverage,regularity};return{pass:true,reason:'인정',duration,coverage,regularity}}

function RecordForms({ onSave }: { onSave:(r:Omit<RecordItem,"id"|"createdAt"|"status"|"locked">,f?:File)=>void }) {
  const [kind,setKind]=useState<Kind>("toeic");
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault(); const f=new FormData(e.currentTarget); const file=f.get("evidence") as File; const date=String(f.get("date")); const note=String(f.get("note")||""); if(kind==="toeic") onSave({kind,date,note,parts:f.getAll("parts").map(String)},file.size?file:undefined); if(kind==="pushup") onSave({kind,date,note,amount:Number(f.get("amount"))},file.size?file:undefined); if(kind==="stock") onSave({kind,date,note,details:{ticker:String(f.get("ticker")||"비공개"),side:String(f.get("side")),window:String(f.get("window")),price:String(f.get("price")),quantity:String(f.get("quantity")),orderType:String(f.get("orderType")),rationale:String(f.get("rationale")),exitRule:String(f.get("exitRule"))}},file.size?file:undefined); e.currentTarget.reset();};
  return <section className="panel"><div className="section-title"><div><p className="eyebrow">확정 기록</p><h2>제출하는 순간 원본이 잠깁니다</h2></div></div><div className="segmented">{(["toeic","pushup","stock"] as Kind[]).map(k=><button key={k} className={kind===k?"active":""} onClick={()=>setKind(k)}>{label(k)}</button>)}</div><form className="record-form" onSubmit={submit}><label>기준 날짜<input name="date" type="date" defaultValue={kstDate()} required/></label>{kind==="toeic"&&<fieldset><legend>학습 영역</legend><div className="checks">{PARTS.map(p=><label key={p}><input type="checkbox" name="parts" value={p}/>{p}</label>)}</div></fieldset>}{kind==="pushup"&&<label>이번 세트 횟수<input name="amount" type="number" min="1" max="500" required/></label>}{kind==="stock"&&<><div className="two"><label>종목명·티커<input name="ticker" required/></label><label>행동<select name="side"><option>매매하지 않기</option><option>매수</option><option>매도</option></select></label></div><div className="two"><label>허용 시간대<input name="window" placeholder="예: 23:30–01:00" required/></label><label>목표 가격 범위<input name="price" required/></label></div><div className="two"><label>수량 또는 금액<input name="quantity" required/></label><label>주문 유형<select name="orderType"><option>지정가</option><option>시장가</option><option>조건부</option><option>무매매</option></select></label></div><label>계획 근거·시장 평가<textarea name="rationale" required/></label><label>손절·익절 또는 금지 조건<textarea name="exitRule" required/></label></>}<label>메모<textarea name="note" placeholder="사실만 기록하세요."/></label><label>증빙 이미지<input name="evidence" type="file" accept="image/*" required/><small>원본 사진은 공개 블로그에 게시하지 않습니다.</small></label><button className="submit">기록 잠그고 제출</button></form></section>;
}

function Review({records,onReview}:{records:RecordItem[];onReview:(id:string,a:boolean)=>void}){const items=records.filter(r=>r.status==="submitted"||r.status==="needs_review");return <section className="panel"><div className="section-title"><div><p className="eyebrow">증빙 판정</p><h2>확실하지 않으면 인정하지 않습니다</h2></div></div>{!items.length?<Empty text="검토할 기록이 없습니다."/>:<div className="list">{items.map(r=><article className="row" key={r.id}><div><span className={`pill ${r.status}`}>{r.status==="submitted"?"검토 가능":"추가 검토 필요"}</span><h3>{label(r.kind)} · {r.date}</h3><p>{r.evidenceName||"증빙 없음"} · {r.note||"메모 없음"}</p></div><div className="actions"><button onClick={()=>onReview(r.id,false)}>반려</button><button className="approve" disabled={!r.evidenceHash} onClick={()=>onReview(r.id,true)}>증빙 인정</button></div></article>)}</div>}</section>}
function Weekly({weekly}:{weekly:Record<string,number>}){return <section className="panel"><div className="section-title"><div><p className="eyebrow">주간 균형</p><h2>월요일 오전 3시 마감</h2></div></div><div className="weekly-grid">{PARTS.map(p=><article key={p}><div><b>{p}</b><span>{weekly[p]} / {TARGETS[p]}회</span></div><progress value={weekly[p]} max={TARGETS[p]}/><small>{weekly[p]>=TARGETS[p]?"목표 충족":`${TARGETS[p]-weekly[p]}회 부족`}</small></article>)}</div><p className="coach">{Object.entries(weekly).filter(([p,n])=>n<TARGETS[p]).length?`우선 학습: ${Object.entries(weekly).filter(([p,n])=>n<TARGETS[p]).slice(0,2).map(([p])=>p).join(" 또는 ")}. 이미 한 영역을 더 반복하는 것보다 빈 구간을 먼저 채우세요.`:"이번 주 토익 영역 목표가 모두 충족되었습니다."}</p></section>}
function Blog({posts}:{posts:BlogPost[]}){return <section className="panel"><div className="section-title"><div><p className="eyebrow">PUBLIC ACCOUNTABILITY</p><h2>실패 다음 날 공개되는 회고</h2></div></div><div className="policy"><b>공개 원칙</b><p>실명과 행동 위반은 공개합니다. 증빙 사진, 종목, 수량, 손익, 계정 정보는 공개하지 않습니다. 오프라인이면 연결 복구 즉시 게시합니다.</p></div>{!posts.length?<Empty text="아직 공개된 실패 회고가 없습니다."/>:posts.map(p=><article className="post" key={p.id}><time>{p.date}</time><h3>{p.title}</h3><p>{p.body}</p></article>)}</section>}
function AuditLog({audits}:{audits:Audit[]}){return <section className="panel"><div className="section-title"><div><p className="eyebrow">IMMUTABLE TRAIL</p><h2>숨길 수 없는 변경 이력</h2></div></div>{!audits.length?<Empty text="아직 기록이 없습니다."/>:<div className="timeline">{audits.map(a=><div key={a.id}><time>{a.at.replace("T"," ")}</time><b>{a.action}</b><p>{a.summary}</p></div>)}</div>}</section>}
function Empty({text}:{text:string}){return <div className="empty">{text}</div>}
function label(k:Kind){return k==="toeic"?"토익":k==="pushup"?"푸시업":"주식 규칙"}
