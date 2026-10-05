import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {POST} from '../src/app/api/auth/session/route';
import {verifyRenderSession,RENDER_SESSION_COOKIE} from '../src/lib/render-session';
import {renderAuthentication} from '../src/lib/render-auth';
const origin='https://music-house.example';
test('actual public session handler isolates browsers, reuses ownership and never exposes capabilities in JSON',async()=>{
 const old=process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET='test-only-public-session-secret-1234567890';
 try{
  const make=()=>POST(new NextRequest(`${origin}/api/auth/session`,{method:'POST',headers:{origin}}));
  const first=await make(),other=await make();assert.equal(first.status,200);
  assert.deepEqual(await first.json(),{authenticated:true});
  const cookie=first.cookies.get(RENDER_SESSION_COOKIE)!.value;
  const a=await verifyRenderSession(cookie,process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET),b=await verifyRenderSession(other.cookies.get(RENDER_SESSION_COOKIE)!.value,process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET);
  assert.match(a!.subject,/^browser:/);assert.notEqual(a!.subject,b!.subject);
  assert.match(first.headers.get('set-cookie')!,/HttpOnly/);assert.match(first.headers.get('set-cookie')!,/Secure/);
  const headers={origin,cookie:`${RENDER_SESSION_COOKIE}=${cookie}`};
  const reused=await POST(new NextRequest(`${origin}/api/auth/session`,{method:'POST',headers}));assert.equal(reused.headers.get('set-cookie'),null);
  const auth=await renderAuthentication(new NextRequest(`${origin}/api/generate`,{method:'POST',headers}));assert.equal(auth.identity?.subject,a!.subject);
  assert.equal((await POST(new NextRequest(`${origin}/api/auth/session`,{method:'POST',headers:{origin:'https://foreign.example'}}))).status,403);
  delete process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;
  assert.equal((await make()).status,503);
 }finally{if(old===undefined)delete process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;else process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET=old;}
});
