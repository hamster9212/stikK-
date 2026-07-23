import test from "node:test";
import assert from "node:assert/strict";

const exerciseTotal = (entries, kind) => entries.filter(x=>x.accepted && x.kind===kind).reduce((n,x)=>n+x.count,0);
const duplicate = (hash, hashes) => Boolean(hash && hashes.includes(hash));
const pendingVerdict = records => records.some(r=>["submitted","needs_review"].includes(r.status)) ? "pending" : "final";

test("인정된 푸시업만 합산한다",()=>assert.equal(exerciseTotal([{kind:"pushup",count:30,accepted:true},{kind:"pushup",count:70,accepted:true},{kind:"pushup",count:50,accepted:false}],"pushup"),100));
test("윗몸일으키기는 푸시업과 별도로 합산한다",()=>assert.equal(exerciseTotal([{kind:"pushup",count:30,accepted:true},{kind:"situp",count:40,accepted:true},{kind:"situp",count:20,accepted:false}],"situp"),40));
test("동일 이미지 해시를 탐지한다",()=>assert.equal(duplicate("abc",["abc","def"]),true));
test("검토 중 기록이 있으면 확정하지 않는다",()=>assert.equal(pendingVerdict([{status:"needs_review"}]),"pending"));
