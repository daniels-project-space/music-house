import { generateKeyPair, SignJWT } from "jose";
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { issueRenderSession, verifyRenderSession, issueRenderMutationProof, verifyRenderMutationProof, renderWorkerTokenDigest, RENDER_SESSION_COOKIE } from "../src/lib/render-session";
import { renderAuthentication } from "../src/lib/render-auth";
import { beginRenderGoogleLogin, verifyRenderGoogleFlow, verifyRenderGoogleIdToken } from "../src/lib/render-google-login";
import { create, getOwned, listOwned, setEngineBinding, syncEngineState, setRunning, setComplete, setFailed, authorizeWorker } from "../convex/jobs";
const secret="test-only-cryptographic-session-key-1234567890";
const now=Date.now();
const handler=(fn:any)=>fn._handler;
test("render sessions reject forgery, expiry, missing setup, and another signer",async()=>{
  const token=await issueRenderSession("google:owner-a","owner@example.com",secret,now);
  assert.equal((await verifyRenderSession(token,secret,now))?.subject,"google:owner-a");
  assert.equal(await verifyRenderSession(token,secret,now+8*60*60_000),null);
  assert.equal(await verifyRenderSession(token,"another-test-secret-key-123456789012",now),null);
  assert.equal(await verifyRenderSession(token,undefined,now),null);
  assert.equal(await verifyRenderSession(token+".extra",secret,now),null);
  const [payload,signature]=token.split(".");
  const forged=Buffer.from(JSON.stringify({version:1,audience:"music-house-render",subject:"google:other-user",email:"other@example.com",issuedAt:now,expiresAt:now+8*60*60_000})).toString("base64url");
  assert.equal(await verifyRenderSession(`${forged}.${signature}`,secret,now),null);
  assert.notEqual(payload,forged);
});
test("HTTP generation boundary rejects anonymous callers and cookie CSRF",async()=>{
  const previous=process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET=secret;
  try{
    const anonymous=await renderAuthentication(new NextRequest("https://music-house.example/api/generate",{method:"POST",body:"{}"}));assert.equal(anonymous.response?.status,401);
    const token=await issueRenderSession("google:owner-a","owner@example.com",secret);
    const headers={cookie:`${RENDER_SESSION_COOKIE}=${token}`,origin:"https://music-house.example"};
    const owner=await renderAuthentication(new NextRequest("https://music-house.example/api/generate",{method:"POST",headers,body:"{}"}));assert.equal(owner.identity?.subject,"google:owner-a");
    const csrf=await renderAuthentication(new NextRequest("https://music-house.example/api/generate",{method:"POST",headers:{...headers,origin:"https://attacker.example"},body:"{}"}));assert.equal(csrf.response?.status,403);
  }finally{if(previous===undefined)delete process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;else process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET=previous;}
});
test("Google authorization uses PKCE and rejects altered, expired and cross-browser state",()=>{
  const config={clientId:"test-client",clientSecret:"test-secret",sessionSecret:secret,emails:["owner@example.com"],origin:"https://music-house.example",callback:"https://music-house.example/api/auth/callback"};
  const flow=beginRenderGoogleLogin(config,now),url=new URL(flow.url),state=url.searchParams.get("state");
  assert.equal(url.hostname,"accounts.google.com");assert.equal(url.searchParams.get("code_challenge_method"),"S256");assert.equal(url.searchParams.get("scope"),"openid email");
  const decoded=verifyRenderGoogleFlow(flow.cookie,state,secret,now);assert.equal(decoded.state,state);assert.equal(decoded.verifier.length,43);
  assert.throws(()=>verifyRenderGoogleFlow(flow.cookie,"another-browser-state",secret,now));
  assert.throws(()=>verifyRenderGoogleFlow(flow.cookie,state,secret,now+600_000));
  assert.throws(()=>verifyRenderGoogleFlow(flow.cookie+"tampered",state,secret,now));
});
test("direct Convex callers cannot create anonymous jobs, adopt foreign jobs, or forge engine ledger changes",async()=>{
  const previous=process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET=secret;
  try{
    const token=await issueRenderSession("google:owner-a","owner@example.com",secret);
    const other=await issueRenderSession("google:owner-b","other@example.com",secret);
    const rows:any[]=[];
    const ctx={db:{insert:async(_table:string,args:any)=>{rows.push({_id:"job-a",...args});return"job-a";},get:async()=>rows[0],patch:async(_id:string,args:any)=>Object.assign(rows[0],args),query:()=>({withIndex:(_name:string,q:any)=>{let subject="";q({eq:(_f:string,v:string)=>{subject=v;}});return{order:()=>({take:async()=>rows.filter(r=>r.ownerSubject===subject)})};}})}};
    const args={generator:"minimax",prompt:"Warm acoustic pop",lyrics:"[verse]\nSource",config:{},sessionToken:token};
    await assert.rejects(handler(create)(ctx,{...args,sessionToken:"forged"}),/login/);assert.equal(rows.length,0);
    await handler(create)(ctx,args);assert.equal(rows[0].ownerSubject,"google:owner-a");assert.equal(rows[0].sessionToken,undefined);
    await assert.rejects(handler(setRunning)(ctx,{id:"job-a"}),/verified engine/);
    await assert.rejects(handler(setComplete)(ctx,{id:"job-a",resultTrackIds:[]}),/verified engine/);
    await assert.rejects(handler(setFailed)(ctx,{id:"job-a",error:"forged"}),/login/);
    assert.equal(await handler(getOwned)(ctx,{id:"job-a",sessionToken:other}),null);
    assert.equal((await handler(getOwned)(ctx,{id:"job-a",sessionToken:token}))._id,"job-a");
    assert.deepEqual(await handler(listOwned)(ctx,{sessionToken:other}),[]);
    const binding={jobId:"engine-a",state:"awaiting-final-qualification",manifestSha256:"a".repeat(64),output:{bucket:"music-house",key:"key",receiptKey:"receipt"}};
    await assert.rejects(handler(setEngineBinding)(ctx,{id:"job-a",binding,sessionToken:token,serverProof:""}),/Trusted/);
    const proof=await issueRenderMutationProof("bind-engine","google:owner-a",{id:"job-a",binding},secret);
    await handler(setEngineBinding)(ctx,{id:"job-a",binding,sessionToken:token,serverProof:proof});assert.equal(rows[0].status,"pending");
    await assert.rejects(handler(syncEngineState)(ctx,{id:"job-a",engineJobId:"engine-a",state:"completed",sessionToken:token,serverProof:proof}),/Trusted/);
    const readProof=await issueRenderMutationProof("sync-engine","google:owner-a",{id:"job-a",engineJobId:"engine-a",state:"running"},secret);
    await handler(syncEngineState)(ctx,{id:"job-a",engineJobId:"engine-a",state:"running",sessionToken:token,serverProof:readProof});assert.equal(rows[0].status,"running");
  }finally{if(previous===undefined)delete process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;else process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET=previous;}
});
test("trusted mutation proofs bind operation, arguments, owner and deadline",async()=>{
  const args={id:"job-a",state:"running"};const proof=await issueRenderMutationProof("sync-engine","google:owner-a",args,secret,now);
  assert.equal(await verifyRenderMutationProof(proof,"sync-engine","google:owner-a",{state:"running",id:"job-a"},secret,now),true);
  for(const [operation,subject,value,time] of [["bind-engine","google:owner-a",args,now],["sync-engine","google:owner-b",args,now],["sync-engine","google:owner-a",{...args,state:"completed"},now],["sync-engine","google:owner-a",args,now+60_000]] as const){
    assert.equal(await verifyRenderMutationProof(proof,operation,subject,value,secret,time),false);
  }
});

test("Google login verifies real JWT signatures, audience, issuer, nonce and approved verified email",async()=>{
  const {publicKey,privateKey}=await generateKeyPair("RS256");
  const config={clientId:"test-client",clientSecret:"test-secret",sessionSecret:secret,emails:["owner@example.com"],origin:"https://music-house.example",callback:"https://music-house.example/api/auth/callback"};
  const make=async(overrides:Record<string,unknown>={})=>new SignJWT({sub:"account-a",email:"owner@example.com",email_verified:true,nonce:"test-nonce",iss:"https://accounts.google.com",aud:"test-client",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,...overrides}).setProtectedHeader({alg:"RS256"}).sign(privateKey);
  assert.deepEqual(await verifyRenderGoogleIdToken(await make(),"test-nonce",config,async()=>publicKey),{subject:"google:account-a",email:"owner@example.com"});
  for(const overrides of [{aud:"other-client"},{iss:"https://attacker.example"},{nonce:"wrong"},{email_verified:false},{email:"other@example.com"},{azp:"other-client"},{exp:1}]){
    await assert.rejects(verifyRenderGoogleIdToken(await make(overrides),"test-nonce",config,async()=>publicKey));
  }
  const another=await generateKeyPair("RS256");await assert.rejects(verifyRenderGoogleIdToken(await make(),"test-nonce",config,async()=>another.publicKey));
});


test("owned provider jobs require a job-scoped worker capability before admission and every update",async()=>{
  const token="a".repeat(64), other="b".repeat(64);
  const job={ownerSubject:"google:owner-a",generator:"suno",workerTokenSha256:await renderWorkerTokenDigest(token),status:"pending"};
  const ctx={db:{get:async()=>job,patch:async(_id:string,value:any)=>Object.assign(job,value)}};
  for(const capability of [undefined,other]){
    await assert.rejects(handler(authorizeWorker)(ctx,{id:"owned",workerToken:capability}),/worker/);
    await assert.rejects(handler(setRunning)(ctx,{id:"owned",workerToken:capability}),/worker/);
    await assert.rejects(handler(setComplete)(ctx,{id:"owned",resultTrackIds:[],workerToken:capability}),/worker/);
    await assert.rejects(handler(setFailed)(ctx,{id:"owned",error:"forged",workerToken:capability}),/worker/);
  }
  assert.equal(job.status,"pending");
  assert.equal(await handler(authorizeWorker)(ctx,{id:"owned",workerToken:token}),true);
  await handler(setRunning)(ctx,{id:"owned",workerToken:token});assert.equal(job.status,"running");
  await handler(setComplete)(ctx,{id:"owned",resultTrackIds:[],workerToken:token});assert.equal(job.status,"complete");
  const legacy={db:{get:async()=>({generator:"suno"}),patch:async()=>{}}};
  assert.equal(await handler(authorizeWorker)(legacy,{id:"legacy"}),true);
  await handler(setRunning)(legacy,{id:"legacy"});
});
