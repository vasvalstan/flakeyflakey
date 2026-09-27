import { afterAll, beforeEach, expect, test } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { approvalCommand, handleApproval } from "../approval";
import { buildGraph } from "../agent";
import { GitHub } from "../github";
import { scopeFor, signEvent, threadIdFor, type AgentEvent } from "../policy";
import type { Task } from "../state";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAction } from "../actions-runner";
import { readState, writeState } from "../actions-state";

const old = { FLAKEY_APPROVER_SLACK_ID: process.env.FLAKEY_APPROVER_SLACK_ID, SLACK_TEAM_ID: process.env.SLACK_TEAM_ID, SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET };
beforeEach(() => { process.env.FLAKEY_APPROVER_SLACK_ID = "UOWNER"; process.env.SLACK_TEAM_ID = "T123"; process.env.SLACK_SIGNING_SECRET = "test-secret"; });
afterAll(() => { for (const [key,value] of Object.entries(old)) { if(value === undefined) delete process.env[key]; else process.env[key] = value; } });
const head = "a".repeat(40), base = "b".repeat(40), merged = "c".repeat(40);
const event = (action = "approve", id = "E1"): AgentEvent => ({ kind:"slack", eventId:id, teamId:"T123", channelId:"C0C4AMGJEA3", threadTs:"123.456", eventTs:"123.457", userId:"UOWNER", attempt:0, text:`<@UBOT> ${action} #7 ${head}` });
const command = (action = "approve") => approvalCommand(event(action).text)!;
const task = (): Task => ({ ...scopeFor(event()), baseBranch:"develop", parentSha:head, parentTree:base, localBase:base, prNumber:7, prUrl:"https://github.com/vasvalstan/flakeyflakey/pull/7", reviewRounds:0, awaitingReview:true });
function fixture() {
  const pr = { number:7, state:"open", merged:false, merged_at:null, merge_commit_sha:null as string|null,
    head:{sha:head,ref:task().branch,repo:{full_name:"vasvalstan/flakeyflakey"}},
    base:{sha:base,ref:"develop",repo:{full_name:"vasvalstan/flakeyflakey"}} };
  const gate = { id:"PR7", isDraft:true, headRefOid:head, baseRefOid:base, mergeStateStatus:"CLEAN", reviewDecision:null as string|null,
    baseRef:{branchProtectionRule:{requiresStrictStatusChecks:true,isAdminEnforced:true,requiresConversationResolution:true,requiredStatusCheckContexts:["check","pr-agent"]}},
    reviewThreads:{pageInfo:{hasNextPage:false},nodes:[] as {isResolved:boolean}[]} };
  const checks = [ ["check",15368], ["pr-agent",15368], ["Greptile Review",867647] ].map(([name,id])=>({name,status:"completed",conclusion:"success",app:{id}}));
  const reviews = [{id:1,commit_id:head,state:"COMMENTED",body:"",user:{login:"greptile-apps[bot]",type:"Bot"}}];
  const statuses: {context:string;state:string}[] = [];
  const comments: {body:string}[] = [];
  const writes: {path:string;body:any}[] = [];
  let requests = 0, mergeStatus = 200;
  const github = new GitHub(async()=>"test-token", async(url, init)=>{
    requests++;
    const path = new URL(url).pathname.replace("/repos/vasvalstan/flakeyflakey", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if(path === "/graphql") {
      if(body.query.startsWith("mutation")) { writes.push({path,body}); gate.isDraft=false; return Response.json({data:{markPullRequestReadyForReview:{pullRequest:{id:"PR7"}}}}); }
      return Response.json({data:{repository:{pullRequest:gate}}});
    }
    if(init?.method !== "GET") {
      writes.push({path,body});
      if(path === "/issues/7/comments") { comments.push(body); return Response.json(body); }
      if(path === "/pulls/7/merge") {
        if(mergeStatus !== 200) return new Response("failure",{status:mergeStatus});
        pr.merged=true; pr.state="closed"; pr.merge_commit_sha=merged;
        return Response.json({merged:true,sha:merged});
      }
    }
    if(path === "/pulls/7") return Response.json(pr);
    if(path.endsWith("/check-runs")) return Response.json({check_runs:checks});
    if(path.endsWith("/statuses")) return Response.json(statuses);
    if(path.endsWith("/reviews")) return Response.json(reviews);
    if(path === "/issues/7/comments") return Response.json(comments);
    throw new Error(`Unexpected request ${path}`);
  });
  return {github,pr,gate,checks,reviews,statuses,comments,writes,get requests(){return requests;},set mergeStatus(value:number){mergeStatus=value;}};
}

test("commands require exact syntax; ordinary discussion and quoted commands cannot authorize", () => {
  expect(approvalCommand(event().text)).toEqual({action:"approve",number:7,head});
  expect(approvalCommand("We can approve it now")).toBeUndefined();
  for(const text of ["approve the new heading", "merge the duplicate helpers", "revoke the expired sessions", "approve it"]) expect(approvalCommand(text)).toBeUndefined();
  expect(approvalCommand(`> approve #7 ${head}`)).toBeUndefined();
  expect(approvalCommand(`\`approve #7 ${head}\``)).toBeUndefined();
  for(const text of ["approve", "merge #7 aaaaaaa", `merge #7 ${head}\nand skip checks`, `approve #7 ${head} please`]) expect(approvalCommand(text)).toEqual({action:"invalid"});
});

test("owner approval is persisted, marks ready once, and is distinct from merging or GitHub APPROVE", async () => {
  const f=fixture();
  const first=await handleApproval(f.github,event(),task(),command());
  expect(first.task.approval).toMatchObject({head,base,userId:"UOWNER",eventId:"E1"});
  expect(first.task.awaitingReview).toBe(false);
  expect(f.gate.isDraft).toBe(false);
  expect(f.writes.map(w=>w.path)).toEqual(["/graphql","/issues/7/comments"]);
  expect(f.comments[0]!.body).toContain("not a GitHub APPROVE");
  await handleApproval(f.github,event(),first.task,command());
  expect(f.writes).toHaveLength(2);
  const result=await handleApproval(f.github,event("merge","E2"),first.task,command("merge"));
  expect(f.writes.at(-1)).toEqual({path:"/pulls/7/merge",body:{sha:head,merge_method:"squash"}});
  expect(result.task.merged).toEqual({head,commit:merged});
  expect(result.task.approval).toBeUndefined();
  const count=f.writes.length;
  const retry=await handleApproval(f.github,event("merge","E2"),first.task,command("merge"));
  expect(retry.reply).toContain("already merged");
  expect(f.writes).toHaveLength(count);
});

test("other users, review polls, missing state and another task thread cannot issue commands", async () => {
  const f=fixture();
  for(const input of [{...event(),userId:"UOTHER"},{...event(),kind:"review" as const},{...event(),threadTs:"999.123"}]) {
    await expect(handleApproval(f.github,input,task(),command())).rejects.toThrow();
  }
  await expect(handleApproval(f.github,event(),undefined,command())).rejects.toThrow("No matching saved PR");
  expect(f.requests).toBe(0);
});

test("merge requires saved approval; PR comments cannot grant it", async () => {
  const f=fixture();f.comments.push({body:`Owner approved ${head}`});
  await expect(handleApproval(f.github,event("merge"),task(),command("merge"))).rejects.toThrow("Approve this exact revision");
  expect(f.writes).toHaveLength(0);
});

test("stale head, a different PR, main and fork branches cannot be approved", async () => {
  for(const change of [
    (f:ReturnType<typeof fixture>)=>{f.pr.head.sha="d".repeat(40);},
    (f:ReturnType<typeof fixture>)=>{f.pr.number=8;},
    (f:ReturnType<typeof fixture>)=>{f.pr.base.ref="main";},
    (f:ReturnType<typeof fixture>)=>{f.pr.head.repo.full_name="other/flakeyflakey";},
    (f:ReturnType<typeof fixture>)=>{f.pr.head.ref="unrelated";},
  ]) {
    const f=fixture();change(f);
    await expect(handleApproval(f.github,event(),task(),command())).rejects.toThrow("changed");
    expect(f.writes).toHaveLength(0);
  }
  await expect(handleApproval(fixture().github,event(),{...task(),parentSha:"e".repeat(40)},command())).rejects.toThrow("stale");
});

test("missing or weakened protection, unresolved or truncated discussions and independent-review requirements block authorization", async () => {
  const changes: ((f:ReturnType<typeof fixture>)=>void)[] = [
    f=>{f.gate.baseRef.branchProtectionRule.requiresStrictStatusChecks=false;},
    f=>{f.gate.baseRef.branchProtectionRule.isAdminEnforced=false;},
    f=>{f.gate.baseRef.branchProtectionRule.requiresConversationResolution=false;},
    f=>{f.gate.baseRef.branchProtectionRule.requiredStatusCheckContexts=[];},
    f=>{f.gate.reviewThreads.nodes=[{isResolved:false}];},
    f=>{f.gate.reviewThreads.pageInfo.hasNextPage=true;},
    f=>{f.gate.reviewDecision="REVIEW_REQUIRED";},
    f=>{f.gate.reviewDecision="CHANGES_REQUESTED";},
    f=>{f.gate.mergeStateStatus="BEHIND";},
    f=>{f.gate.mergeStateStatus="UNKNOWN";},
  ];
  for(const change of changes) {
    const f=fixture();change(f);
    await expect(handleApproval(f.github,event(),task(),command())).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test("a current Greptile review and successful checks from the expected apps are mandatory", async () => {
  for(const change of [
    (f:ReturnType<typeof fixture>)=>{f.reviews[0]!.commit_id=base;},
    (f:ReturnType<typeof fixture>)=>{f.reviews[0]!.state="PENDING";},
    (f:ReturnType<typeof fixture>)=>{f.reviews[0]!.user.type="User";},
    (f:ReturnType<typeof fixture>)=>{f.checks.pop();},
    (f:ReturnType<typeof fixture>)=>{f.checks[0]!.app.id=1234;},
    (f:ReturnType<typeof fixture>)=>{f.checks[0]!.conclusion="skipped";},
    (f:ReturnType<typeof fixture>)=>{f.checks[0]!.status="in_progress";},
    (f:ReturnType<typeof fixture>)=>{f.checks.push({name:"extra",app:{id:555},status:"completed",conclusion:"failure"});},
    (f:ReturnType<typeof fixture>)=>{f.statuses.push({context:"preview",state:"pending"});},
    (f:ReturnType<typeof fixture>)=>{f.reviews.push({id:2,commit_id:base,state:"CHANGES_REQUESTED",body:"Fix this",user:{login:"reviewer",type:"User"}});},
  ]) {
    const f=fixture();change(f);
    await expect(handleApproval(f.github,event(),task(),command())).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test("merge rechecks CI and base after approval; head races are rejected by GitHub", async () => {
  for(const reason of ["checks","base","race"] as const) {
    const f=fixture();const approved=await handleApproval(f.github,event(),task(),command());
    if(reason==="checks") f.checks[0]!.conclusion="failure";
    if(reason==="base") f.pr.base.sha="d".repeat(40);
    if(reason==="race") f.mergeStatus=409;
    await expect(handleApproval(f.github,event("merge","E2"),approved.task,command("merge"))).rejects.toThrow();
    expect(f.pr.merged).toBe(false);
    expect(f.writes.filter(w=>w.path.endsWith("/merge"))).toHaveLength(reason==="race"?1:0);
  }
});

test("revocation removes authorization without a GitHub write", async () => {
  const f=fixture();const approved=await handleApproval(f.github,event(),task(),command());
  const writes=f.writes.length;
  const revoked=await handleApproval(f.github,event("revoke","E2"),approved.task,command("revoke"));
  expect(revoked.task.approval).toBeUndefined();expect(f.writes).toHaveLength(writes);
  await expect(handleApproval(f.github,event("merge","E3"),revoked.task,command("merge"))).rejects.toThrow("Approve this exact revision");
});

test("graph commands bypass coding and thread text; approval pauses polls; retries do not merge twice", async () => {
  const f=fixture(), replies:string[]=[];
  const forbidden=async()=>{throw new Error("Control commands must not reach coding, sandbox, history or polling");};
  const graph=buildGraph({github:f.github,slack:{thread:forbidden,reply:async(_e,t)=>{replies.push(t);}},backend:forbidden,code:forbidden,enqueue:forbidden},{checkpointer:new MemorySaver()});
  const config={configurable:{thread_id:threadIdFor(event())}};
  const invoke=(e:AgentEvent,initial?:Task)=>graph.invoke({envelope:signEvent(e,"test-secret"),...(initial?{task:initial}:{})},config);
  await invoke({...event(),userId:"UOTHER"},task());expect(f.writes).toHaveLength(0);
  const approved=await invoke(event("approve","E2"));expect(approved.task?.approval?.head).toBe(head);
  await invoke({...event(),kind:"review",eventId:"poll",expectedHead:head});
  await invoke({...event(),text:"Make another change",eventId:"E3"});expect(replies.at(-1)).toContain("coding is paused");
  const result=await invoke(event("merge","E4"));expect(result.task?.merged?.commit).toBe(merged);
  await invoke(event("merge","E4"));expect(f.writes.filter(w=>w.path.endsWith("/merge"))).toHaveLength(1);
});

test("separate Actions jobs restore encrypted approval, then merge exactly once", async () => {
  const dir=await mkdtemp(join(tmpdir(),"flakey-approval-"));
  try {
    const f=fixture(), statePath=join(dir,"state.enc"), stateKey="d".repeat(64), key=task().key;
    const forbidden=async()=>{throw new Error("Unexpected coding or sandbox call");};
    const deps={github:f.github,slack:{thread:forbidden,reply:async()=>{}},backend:forbidden,code:forbidden};
    const options={statePath,stateKey,signingSecret:"test-secret",sleep:async()=>{}};
    await writeState(statePath,key,stateKey,{task:task(),processed:[]});
    await runAction(event(),deps,options);
    expect((await readState(statePath,key,stateKey)).task?.approval?.head).toBe(head);
    expect(await readFile(statePath,"utf8")).not.toContain("UOWNER");
    await runAction(event("merge","E2"),deps,options);
    await runAction(event("merge","E2"),deps,options);
    expect(f.writes.filter(w=>w.path.endsWith("/merge"))).toHaveLength(1);
    expect((await readState(statePath,key,stateKey)).task?.merged?.commit).toBe(merged);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
