"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Kind = "toeic" | "pushup" | "stock";
type Status = "submitted" | "accepted" | "rejected" | "needs_review";
type RecordItem = {
  id: string; kind: Kind; date: string; createdAt: string; amount?: number;
  parts?: string[]; note: string; evidenceName?: string; evidenceHash?: string;
  status: Status; locked: boolean; details?: Record<string, string | number>;
};
type Audit = { id: string; at: string; action: string; recordId?: string; summary: string };
type BlogPost = { id: string; date: string; title: string; body: string; published: boolean };
type AppState = { records: RecordItem[]; audits: Audit[]; posts: BlogPost[]; pinHash: string; unlocked: boolean; startedAt?: string };

const PARTS = ["Part 2", "Part 3", "Part 4", "Part 5", "Part 7", "단어", "실전 모의고사"];
const TARGETS: Record<string, number> = { "Part 2": 2, "Part 3": 2, "Part 4": 2, "Part 5": 3, "Part 7": 3, "단어": 6, "실전 모의고사": 1 };
const STORAGE_KEY = "junyoung-referee-v1";
const initial: AppState = { records: [], audits: [], posts: [], pinHash: "", unlocked: false };

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
  const [tab, setTab] = useState("today");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setState({ ...JSON.parse(raw), unlocked: false }); setReady(true); }, []);
  useEffect(() => { if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, unlocked: false })); }, [state, ready]);
  useEffect(() => {
    if (!ready || !state.startedAt) return;
    navigator.serviceWorker?.register("/stikK-/sw.js", { scope: "/stikK-/" }).catch(() => undefined);
    const current = new Date();
    if (current.getHours() < 3) return;
    const previous = new Date(current); previous.setDate(previous.getDate() - 1);
    const date = previous.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    if (date < state.startedAt.slice(0,10) || state.posts.some(p => p.id === `daily-${date}`)) return;
    const accepted = state.records.filter(r => r.date === date && r.status === "accepted");
    const total = accepted.filter(r => r.kind === "pushup").reduce((n,r)=>n+(r.amount||0),0);
    const stockProofs = accepted.filter(r => r.kind === "stock" && r.evidenceHash).length;
    const failures = [total < 100 ? `푸시업 ${total}/100개` : "", stockProofs < 2 ? `주식 증빙 ${stockProofs}/2건` : ""].filter(Boolean);
    if (!failures.length) return;
    const post: BlogPost = { id:`daily-${date}`, date, title:`${date} 약속 불이행 기록`, published:false, body:`박준영은 정한 기준을 충족하지 못했다. 확인된 미달은 ${failures.join(", ")}이다. 기록되지 않은 노력은 판정에 포함하지 않는다. 원인은 의지가 아니라 마감 전에 행동과 증빙을 배치하지 못한 데 있다. 다음 24시간에는 가장 작은 실행을 먼저 완료하고 즉시 증빙을 잠근다.` };
    setState(s=>({...s,posts:[post,...s.posts],audits:[{id:uid(),at:nowKst(),action:"FAILURE_POST_QUEUED",summary:`${date} 실패 회고 공개 대기`},...s.audits]}));
  }, [ready, state.startedAt, state.records, state.posts]);

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

  const lock = async (e: FormEvent) => {
    e.preventDefault(); const hash = await sha256(pin);
    if (!state.pinHash) setState(s => ({ ...s, pinHash: hash, unlocked: true, startedAt: nowKst() }));
    else if (hash === state.pinHash) setState(s => ({ ...s, unlocked: true })); else setMessage("PIN이 일치하지 않습니다.");
    setPin("");
  };

  if (!ready) return <main className="loading">기록 원장을 여는 중…</main>;
  if (!state.unlocked) return <main className="lock-screen"><section className="lock-card"><p className="eyebrow">JUNYOUNG REFEREE</p><h1>핑계보다 먼저 남는 기록</h1><p>이 기기의 기록은 로컬에 저장되며, 확정된 기록과 감사 로그는 앱에서 삭제할 수 없습니다.</p><form onSubmit={lock}><label>{state.pinHash ? "로컬 PIN" : "처음 사용할 PIN 만들기"}<input type="password" minLength={4} required value={pin} onChange={e => setPin(e.target.value)} inputMode="numeric" /></label><button>{state.pinHash ? "원장 열기" : "PIN 고정하기"}</button></form></section></main>;

  return <main className="shell">
    <header><div><p className="eyebrow">박준영의 공개 책임 원장</p><h1>오늘의 약속은 오늘 증명한다.</h1></div><div className="deadline"><span>일일 마감</span><strong>다음 날 03:00</strong></div></header>
    <nav>{[["today","오늘"],["record","기록"],["review","검토"],["weekly","주간"],["blog","공개 회고"],["audit","감사 로그"]].map(([id,t]) => <button key={id} className={tab===id?"active":""} onClick={() => setTab(id)}>{t}</button>)}</nav>
    {message && <div className="notice" role="status">{message}<button onClick={() => setMessage("")}>닫기</button></div>}
    {tab === "today" && <Today pushups={pushups} stockEvidence={stockEvidence} weekly={weekly} records={state.records} />}
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
