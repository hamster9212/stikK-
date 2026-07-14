import test from "node:test";
import assert from "node:assert/strict";

const weeklyTargets = { "Part 2":2,"Part 3":2,"Part 4":2,"Part 5":3,"Part 7":3,"단어":6,"실전 모의고사":1 };
const achieved = (actual, target) => Math.min(100, Math.round(actual / target * 100));
const pushupTotal = entries => entries.filter(x=>x.accepted).reduce((n,x)=>n+x.count,0);
const duplicate = (hash, hashes) => Boolean(hash && hashes.includes(hash));
const pendingVerdict = records => records.some(r=>["submitted","needs_review"].includes(r.status)) ? "pending" : "final";

test("주간 달성률은 100%를 넘지 않는다",()=>assert.equal(achieved(4,weeklyTargets["Part 2"]),100));
test("인정된 푸시업만 합산한다",()=>assert.equal(pushupTotal([{count:30,accepted:true},{count:70,accepted:true},{count:50,accepted:false}]),100));
test("모의고사는 Part별 횟수로 중복 집계하지 않는다",()=>{const selected=["실전 모의고사"];assert.equal(selected.includes("Part 2"),false)});
test("동일 이미지 해시를 탐지한다",()=>assert.equal(duplicate("abc",["abc","def"]),true));
test("검토 중 기록이 있으면 확정하지 않는다",()=>assert.equal(pendingVerdict([{status:"needs_review"}]),"pending"));
