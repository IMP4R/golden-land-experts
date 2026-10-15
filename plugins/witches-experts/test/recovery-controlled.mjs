import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { apply } from '../lib/index.js'

const HOME = process.env.DSH_HOME || '/Users/user0/golden-land-new/runtime/dsh-home-witches'
const OUT = process.env.RECOVERY_OUT
const REVISION = process.env.RECOVERY_REVISION || 'unknown'
const ROUTES = `${HOME}/storages/witch-routes.json`
const TRACE = `${HOME}/memory/broker-trace.jsonl`
const FIXTURE = new URL('./acceptance-candidates.jsonl', import.meta.url)
if (!OUT) throw new Error('RECOVERY_OUT required')
await mkdir(OUT, { recursive: true })
process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
process.env.GOLDEN_LAND_LEDGER_PATH = FIXTURE.pathname
process.env.WITCHES_BROKER_ACCEPTANCE_TRACE = '1'
const now = () => new Date().toISOString()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function evidence(name, value) { const p = `${OUT}/${name}.json`; await writeFile(p, `${JSON.stringify(value, null, 2)}\n`); return p }
async function traceRows() { return (await readFile(TRACE, 'utf8').catch(() => '')).split('\n').filter(Boolean).flatMap(x => { try { return [JSON.parse(x)] } catch { return [] } }) }
function msg(id, text) { return { role:'user', id, content:[{type:'text',text}], source:{kind:'user',rpcId:`rpc-${id}`,clientTimeZone:'Europe/Moscow'} } }
function textOf(m) { return (m.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n') }
function outputChunks(json, usage={inputTokens:111,outputTokens:22}) { return [
  {type:'block-start',index:0,blockType:'text'},
  {type:'text-delta',index:0,text:json},
  {type:'block-end',index:0,block:{type:'text',text:json}},
  {type:'usage',usage},
  {type:'finish',reason:{kind:'stop'}},
] }
class ControlledLlm {
  constructor() { this.dispatches=[]; this.prepares=[]; this.delays=new Map(); this.ready=new Map(); this.releases=new Map(); this.contextWindow=2048 }
  setDelay(key, ms) { this.delays.set(key, ms) }
  barrier(key) { let readyResolve, releaseResolve; const ready=new Promise(r=>readyResolve=r); const release=new Promise(r=>releaseResolve=r); this.ready.set(key,{promise:ready,resolve:readyResolve}); this.releases.set(key,{promise:release,resolve:releaseResolve}); return {ready,release:()=>releaseResolve()} }
  async prepareCall(config) {
    const snapshot={...config,preparedAt:now()}; this.prepares.push(snapshot)
    return { config:{...config}, context:{contextWindow:this.contextWindow}, stream: options => this.streamPrepared(snapshot, options) }
  }
  async * streamPrepared(snapshot, options) {
    const human=[...options.messages].reverse().find(m=>m.source?.kind==='user')
    const key=textOf(human).match(/CASE_[A-Z0-9_-]+/)?.[0] || human?.id || randomUUID()
    const barrier=this.ready.get(key)
    if (barrier) { barrier.resolve(); await this.releases.get(key).promise }
    const delay=this.delays.get(key)||0; if(delay) await sleep(delay)
    const candidateRaw=textOf(options.messages.at(-1)); let offered=[]
    try { offered=JSON.parse(candidateRaw).candidates.map(x=>x.id) } catch {}
    let ids=[]
    const h=textOf(human).toLowerCase()
    if(h.includes('blockbot') && offered.includes('blockbot_verified')) ids=['blockbot_verified']
    if(h.includes('gift') && offered.includes('gift_parser_verified')) ids=['gift_parser_verified']
    if(h.includes('generic') && offered.includes('generic_telegram_bot')) ids=['generic_telegram_bot']
    if(h.includes('case_many')) ids=['blockbot_verified','gift_parser_verified','generic_telegram_bot'].filter(x=>offered.includes(x))
    const visible=JSON.stringify({selected_ids:ids,missing:[]})
    this.dispatches.push({at:now(),key,provider:snapshot.provider,model:snapshot.model,routeSnapshot:snapshot,options:{tools:options.tools,messages:options.messages.map(m=>({id:m.id,source:m.source,text:textOf(m)}))},usage:{inputTokens:111,outputTokens:22},visible})
    yield* outputChunks(visible)
  }
}
function makeHarness(testId, sessionId, llm, initialHistory=[]) {
  const listeners=[]; const registeredTools=[]; const sections=[]
  const ctx={
    llm,
    tools:{register(spec){registeredTools.push(spec);return()=>{}}},
    systemPrompt:{section(spec){sections.push(spec);return()=>{}},async assemble(){return {sections:[{text:'CANONICAL_SYSTEM PERSONA'}],variables:{}}}},
    subagents:null,
    get(){return undefined}, effect(fn){return fn()}, on(name,fn){if(name==='agent/pre-step')listeners.push(fn);return()=>{}}, logger:{warn(){}},
  }
  apply(ctx,{brokerTimeoutMs:10000,brokerMaxOutputTokens:256,brokerCandidateTopK:24,cheapProvider:'controlled',cheapModel:'A',expensiveProvider:'controlled',expensiveModel:'X'})
  const session={id:sessionId,header:{id:sessionId,agentPreset:'witches'},events:[],deriveMessages(){return [...initialHistory]}}
  const agent={id:sessionId,session,options:{agentRole:'witch'},ctx,inject(){}}
  async function deliver(message) {
    session.events.push({type:'user/message',seq:session.events.length+1,data:message})
    const decision={kind:'enter',messages:[message]}
    let current=decision
    for(const listener of listeners) current=await listener({agent,messages:[message],signal:new AbortController().signal,turn:session.events.length,step:1},async()=>current)
    return current
  }
  return {ctx,agent,session,deliver,registeredTools,sections}
}
async function setRoute(sessionId, model, revision) {
  const all=JSON.parse(await readFile(ROUTES,'utf8').catch(()=> '{}'))
  all[sessionId]={cheap:{provider:'controlled',model},expensive:{provider:'controlled',model:'X'},active:'cheap',revision}
  await writeFile(ROUTES,`${JSON.stringify(all,null,2)}\n`)
}
async function removeRoute(sessionId) {
  const all=JSON.parse(await readFile(ROUTES,'utf8').catch(()=> '{}')); delete all[sessionId]; await writeFile(ROUTES,`${JSON.stringify(all,null,2)}\n`)
}
function base(id, kind){return {schema:'broker-recovery-test/v1',test_id:id,evidence_kind:kind,revision:REVISION,driver_pid:process.pid,started_at:now(),credentialed:false,controlled_mock:true}}
async function run(testId, body) {
  const result=base(testId,'controlled-production-orchestration')
  try { await evidence(`${testId}-start`,result); await body(result); result.status=result.pass?'PASS':'FAIL' }
  catch(error){result.pass=false;result.status='FAIL';result.error=String(error?.stack||error)}
  finally {result.finished_at=now();result.artifact=await evidence(`${testId}-result`,result)}
  return result
}

const results={}
results.T3=await run('T3',async r=>{
  const llm=new ControlledLlm(); llm.contextWindow=2048
  const overflowSession=`controlled-T3-overflow-${randomUUID()}`; await setRoute(overflowSession,'tiny',0)
  try {
    const huge=msg('old-huge','OLD_RAW '+ 'x'.repeat(9000)); const h=makeHarness('T3',overflowSession,llm,[huge])
    r.overflow=await h.deliver(msg('t3-overflow','CASE_OVERFLOW blockbot'))
    await evidence('T3-overflow-step',{at:now(),sessionId:overflowSession,dispatches:llm.dispatches,decision:r.overflow})
  } finally {await removeRoute(overflowSession)}
  const overflowTrace=(await traceRows()).filter(x=>x.kind==='broker-call'&&x.humanMessageId==='t3-overflow').at(-1)
  const dispatchBefore=llm.dispatches.length
  const fitSession=`controlled-T3-fit-${randomUUID()}`; await setRoute(fitSession,'tiny',0)
  try { const h=makeHarness('T3',fitSession,llm,[]); r.fit=await h.deliver(msg('t3-fit','CASE_FIT blockbot')); await evidence('T3-fit-step',{at:now(),sessionId:fitSession,dispatches:llm.dispatches.slice(dispatchBefore),decision:r.fit}) } finally {await removeRoute(fitSession)}
  const fitDispatches=llm.dispatches.slice(dispatchBefore)
  r.proof={overflowStatus:overflowTrace?.filterStatus,overflowCode:overflowTrace?.generation?.code,overflowDispatches:dispatchBefore,overflowUsage:overflowTrace?.generation?.inputTokens??0,overflowCapsule:overflowTrace?.capsule?.serialized??'',fitDispatches:fitDispatches.length,fitUsage:fitDispatches[0]?.usage,fitModel:fitDispatches[0]?.model}
  r.pass=r.proof.overflowStatus==='context_overflow'&&r.proof.overflowDispatches===0&&r.proof.overflowUsage===0&&r.proof.overflowCapsule===''&&r.proof.fitDispatches===1&&r.proof.fitUsage.inputTokens>0
})
results.T4=await run('T4',async r=>{
  const llm=new ControlledLlm(); const sid=`controlled-T4-${randomUUID()}`;await setRoute(sid,'A',0)
  try {const h=makeHarness('T4',sid,llm,[]);const same=msg('same-message-id','CASE_DEDUP blockbot');const [a,b]=await Promise.all([h.deliver(same),h.deliver(same)]);const afterSame=llm.dispatches.length;const c=await h.deliver(msg('new-message-id','CASE_DEDUP blockbot'));r.proof={sessionId:sid,sameMessageId:'same-message-id',firstTwoDispatches:afterSame,totalDispatches:llm.dispatches.length,usageCalls:llm.dispatches.filter(x=>x.usage.inputTokens>0).length,decisions:[a,b,c],dispatches:llm.dispatches};r.pass=afterSame===1&&llm.dispatches.length===2;await evidence('T4-deliveries',r.proof)}finally{await removeRoute(sid)}
})
results.T5=await run('T5',async r=>{
  const llm=new ControlledLlm();llm.setDelay('CASE_A',1200);llm.setDelay('CASE_B',50);const sid=`controlled-T5-${randomUUID()}`;await setRoute(sid,'A',0)
  try {const h=makeHarness('T5',sid,llm,[]);const pa=h.deliver(msg('race-A','CASE_A blockbot'));await sleep(50);const pb=h.deliver(msg('race-B','CASE_B gift'));const [a,b]=await Promise.all([pa,pb]);const calls=(await traceRows()).filter(x=>x.kind==='broker-call'&&['race-A','race-B'].includes(x.humanMessageId));r.proof={sessionId:sid,dispatchOrder:llm.dispatches.map(x=>x.key),dispatchCount:llm.dispatches.length,usageCount:llm.dispatches.filter(x=>x.usage.inputTokens>0).length,calls,decisionA:a,decisionB:b};const ca=calls.find(x=>x.humanMessageId==='race-A'),cb=calls.find(x=>x.humanMessageId==='race-B');const aApplied=(a.messages||[]).some(m=>m.source?.form==='memory-capsule'),bApplied=(b.messages||[]).some(m=>m.source?.form==='memory-capsule');r.pass=llm.dispatches.length===2&&llm.dispatches[0]?.key==='CASE_B'&&ca?.capsule?.late===true&&cb?.capsule?.late===false&&!aApplied&&bApplied;await evidence('T5-race',r.proof)}finally{await removeRoute(sid)}
})
results.T6=await run('T6',async r=>{
  const llm=new ControlledLlm();const barrier=llm.barrier('CASE_SNAPSHOT_A');const sid=`controlled-T6-${randomUUID()}`;await setRoute(sid,'A',7)
  try {const h=makeHarness('T6',sid,llm,[]);const first=h.deliver(msg('snap-A','CASE_SNAPSHOT_A blockbot'));await barrier.ready;await evidence('T6-barrier-ready',{at:now(),sessionId:sid,prepares:llm.prepares,routeBefore:{model:'A',revision:7}});await setRoute(sid,'B',8);await evidence('T6-route-mutated',{at:now(),sessionId:sid,routeAfter:{model:'B',revision:8}});barrier.release();const a=await first;const b=await h.deliver(msg('snap-B','CASE_SNAPSHOT_B gift'));const calls=(await traceRows()).filter(x=>x.kind==='broker-call'&&['snap-A','snap-B'].includes(x.humanMessageId));r.proof={sessionId:sid,dispatches:llm.dispatches,calls,decisionA:a,decisionB:b};r.pass=llm.dispatches[0]?.model==='A'&&llm.dispatches[1]?.model==='B'&&calls.find(x=>x.humanMessageId==='snap-A')?.routeRevision===7&&calls.find(x=>x.humanMessageId==='snap-B')?.routeRevision===8;await evidence('T6-snapshot',r.proof)}finally{barrier.release();await removeRoute(sid)}
})
await evidence('controlled-suite-result',{at:now(),revision:REVISION,results})
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.status])),null,2))
