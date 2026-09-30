import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { music3EngineConfig, stageMusic3Engine, pollMusic3Engine, readMusic3EngineOutput } from "../src/lib/render-engine-music3";
const engineId = "a".repeat(32);
const output = { bucket: "music-house", key: `projects/music-house/jobs/${engineId}/music3.wav`, receiptKey: `projects/music-house/jobs/${engineId}/music3.receipt.json` };
const env = { MUSIC_HOUSE_RENDER_ENGINE_CONVEX_SITE_URL: "https://example.convex.site", MUSIC_HOUSE_RENDER_ENGINE_PROJECT_TOKEN: "b".repeat(64),
  MUSIC_HOUSE_RENDER_ENGINE_MUSIC3_WORKFLOW_ID: "c".repeat(32), MUSIC_HOUSE_RENDER_ENGINE_MAX_COST_USD: "5" };
function configure() {
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));Object.assign(process.env, env);
  return () => { for (const [key,value] of Object.entries(old)) if(value === undefined)delete process.env[key];else process.env[key]=value; };
}
const input = { sourceId: "source-job-001", lyrics: "  [verse]\nSource lyrics.\n ", description: "Warm acoustic pop", seed: 42 };
test("Music3 requires explicit bounded server setup and the registered project bucket", () => {
  assert.throws(() => music3EngineConfig({}));
  assert.equal(music3EngineConfig(env).bucket, "music-house");
  const aliases = { ...env, MUSIC_HOUSE_RENDER_ENGINE_CONVEX_SITE_URL: undefined, MUSIC_HOUSE_RENDER_ENGINE_PROJECT_TOKEN: undefined, RENDER_ENGINE_CONVEX_SITE_URL: env.MUSIC_HOUSE_RENDER_ENGINE_CONVEX_SITE_URL, RENDER_ENGINE_PROJECT_TOKEN: env.MUSIC_HOUSE_RENDER_ENGINE_PROJECT_TOKEN };
  assert.equal(music3EngineConfig(aliases).origin, "https://example.convex.site");
  for (const override of [{ MUSIC_HOUSE_RENDER_ENGINE_CONVEX_SITE_URL:"https://evil.example" }, { MUSIC_HOUSE_RENDER_ENGINE_PROJECT_TOKEN:"bad" },
    { MUSIC_HOUSE_RENDER_ENGINE_OUTPUT_BUCKET:"another-project" }, { MUSIC_HOUSE_RENDER_ENGINE_MAX_COST_USD:"0" }]) assert.throws(() => music3EngineConfig({...env,...override}));
});
test("real staging caller preserves native request bytes, identity and verified waiting state", async () => {
  const undo=configure();try{
    const fetcher: typeof fetch = async (url,init) => {
      assert.equal(String(url),"https://example.convex.site/client/music3-jobs");assert.equal(init?.redirect,"error");
      const body=JSON.parse(String(init?.body));assert.equal(body.projectName,"music-house");assert.equal(body.workflowId,env.MUSIC_HOUSE_RENDER_ENGINE_MUSIC3_WORKFLOW_ID);
      assert.equal(body.request.lyrics,input.lyrics);assert.equal(body.request.maxAudioSeconds,300);assert.equal(body.request.maxCostUsd,5);
      assert.deepEqual(body.request.output,{contentType:"audio/wav",sampleRateHz:32000,channels:2,bitsPerSample:16});
      assert.equal(body.request.provider,undefined);
      return Response.json({jobId:engineId,state:"awaiting-final-qualification",manifestSha256:createHash("sha256").update(JSON.stringify(body.request)).digest("hex"),output},{status:202});
    };
    const receipt=await stageMusic3Engine(input,fetcher);assert.equal(receipt.state,"awaiting-final-qualification");assert.deepEqual(receipt.output,output);
    for(const change of [{manifestSha256:"d".repeat(64)},{output:{...output,bucket:"other-project"}},{state:"complete"}]){
      const bad: typeof fetch = async(url,init)=>{const good=await fetcher(url,init);return Response.json({...await good.json(),...change},{status:202});};
      await assert.rejects(stageMusic3Engine(input,bad));
    }
  }finally{undo();}
});
test("status and readback accept only exact native job and independently verified project output", async()=>{
  const undo=configure();try{
    const binding={jobId:engineId,state:"running",manifestSha256:"d".repeat(64),output};
    const verified={...output,sha256:"e".repeat(64),bytes:128044,contentType:"audio/wav",verifiedAt:123};
    const fetcher:typeof fetch=async(url)=>Response.json(String(url).includes("/jobs/output")?{...verified,url:"https://music-house.r2.cloudflarestorage.com/output?signature=test"}:
      {jobId:engineId,profileId:"minimax-music3",status:"completed",output:verified,outputRetired:false});
    assert.equal((await pollMusic3Engine(binding,fetcher)).state,"completed");assert.match(await readMusic3EngineOutput(binding,fetcher),/^https:/);
    for(const change of [{jobId:"f".repeat(32)},{profileId:"qwen3-tts"},{outputRetired:true},{output:{...verified,key:"projects/other/jobs/x/music3.wav"}},{output:{...verified,verifiedAt:undefined}}]){
      await assert.rejects(pollMusic3Engine(binding,async()=>Response.json({jobId:engineId,profileId:"minimax-music3",status:"completed",output:verified,...change})));
    }
    await assert.rejects(readMusic3EngineOutput(binding,async(url)=>String(url).includes("/jobs/output")?Response.json({...verified,sha256:"f".repeat(64),url:"https://example.com/file"}):fetcher(url)));
    await assert.rejects(readMusic3EngineOutput(binding,async()=>Response.json({jobId:engineId,profileId:"minimax-music3",status:"running"})));
  }finally{undo();}
});
