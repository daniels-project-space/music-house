import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as bulk } from "../src/app/api/presign/route";
import { GET as audio } from "../src/app/api/audio/route";
import { GET as video } from "../src/app/api/video/route";
import { GET as cover } from "../src/app/api/cover/route";
import { GET as download } from "../src/app/api/download/route";
import { isPublicMediaKey } from "../src/lib/public-media-key";
const key=`projects/music-house/jobs/${"a".repeat(32)}/music3.wav`;
test("actual generic routes never sign private engine keys, with or without a session cookie",async()=>{
  const cookie="music-house-login=test-only-cookie";
  for(const headers of [{},{cookie}] as Record<string,string>[]) {
    for(const route of [audio,video,cover,download]) {
      const response=await route(new NextRequest(`https://music-house.example/api/media?key=${encodeURIComponent(key)}`,{headers}));
      assert.equal(response.status,404);assert.equal(response.headers.get("location"),null);
      assert.equal((await response.json()).url,undefined);
    }
    const response=await bulk(new NextRequest("https://music-house.example/api/presign",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({keys:["artist/album/known-track.wav",key]})}));
    assert.equal(response.status,404);assert.equal((await response.json()).urls,undefined);
  }
});
test("reserved engine receipts and malformed key variants also fail closed",async()=>{
  for(const value of [key.replace("music3.wav","music3.receipt.json"),`/${key}`,`Projects/music-house/jobs/id/music3.wav`,`artist/../${key}`,`projects%2Fmusic-house%2Fjobs/id/music3.wav`,"artist\\track.wav",null,42]) assert.equal(isPublicMediaKey(value),false);
  for(const route of [audio,video,cover,download]) assert.equal((await route(new NextRequest("https://music-house.example/api/media"))).status,400);
  assert.equal((await bulk(new NextRequest("https://music-house.example/api/presign",{method:"POST",body:JSON.stringify({keys:[42]})}))).status,404);
});
test("actual catalog audio and download routes still sign existing public asset keys",async()=>{
  const previous=globalThis.fetch;
  const token=process.env.VAULT_ACCESS_TOKEN;process.env.VAULT_ACCESS_TOKEN="test-only-vault-token";
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({value:[{keyName:"R2_ACCOUNT_ID",value:"test-account"},{keyName:"R2_ACCESS_KEY_ID",value:"test-access"},{keyName:"R2_SECRET_ACCESS_KEY",value:"test-only-secret"}]});};
  try {
    const request=new NextRequest("https://music-house.example/api/audio?key=artist%2Falbum%2Fknown-track.wav");
    const response=await audio(request);assert.equal(response.status,200);
    assert.match((await response.json()).url,/artist\/album\/known-track.wav/);
    const attachment=await download(request);assert.equal(attachment.status,302);assert.match(attachment.headers.get("location")!,/known-track.wav/);
    const responseBulk=await bulk(new NextRequest("https://music-house.example/api/presign",{method:"POST",body:JSON.stringify({keys:["artist/album/known-track.wav"]})}));
    assert.equal(responseBulk.status,200);assert.match((await responseBulk.json()).urls["artist/album/known-track.wav"],/known-track.wav/);
    assert.equal(calls,1); // Fake vault read only; signing is local, no storage request.
  } finally {globalThis.fetch=previous;if(token===undefined)delete process.env.VAULT_ACCESS_TOKEN;else process.env.VAULT_ACCESS_TOKEN=token;}
});
