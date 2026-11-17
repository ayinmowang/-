import { bindings,owner,getProject,saveProject,message,backend,connected,failure } from '../../../lib/server';
import type { Project } from '../../../lib/types';
function statedTotal(text:string){const match=text.match(/(?:全剧|整个剧|总共|一共|总集数)\s*(?:是|有|为|：|:)?\s*(\d{1,3})\s*集/)||text.trim().match(/^(\d{1,3})\s*集[。！!]?$/);const n=Number(match?.[1]);return Number.isInteger(n)&&n>=1&&n<=300?n:null;}
export async function GET(request:Request){try{
 const user=await owner();const id=new URL(request.url).searchParams.get('id');
 if(id){const p=await getProject(id,user);if(p.remoteId)p.remote=await (await backend('/api/projects/'+p.remoteId)).json();return Response.json(p);}
 const {results}=await bindings().DB.prepare('SELECT data,version FROM studio_projects WHERE owner=? ORDER BY updated_at DESC').bind(user).all();
 return Response.json({connected:connected(),projects:results.map((r:any)=>({...JSON.parse(r.data),version:r.version}))});
}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const user=await owner();const body:any=await request.json();
 if(body.operation==='create'){
  if(!['foreign','domestic','original','transcribe'].includes(body.kind)||!String(body.title||'').trim())throw new Error('INVALID_INPUT');
  const now=new Date().toISOString();
  const p:Project={id:crypto.randomUUID(),title:String(body.title).slice(0,200),kind:body.kind,total:null,brief:String(body.brief||'').slice(0,100000),messages:[],attachments:[],requirements:[],archived:false,createdAt:now,updatedAt:now,version:1,confirmed:false};
  p.total=statedTotal(p.brief);
  if(p.brief)message(p,'user',p.brief);
  message(p,'director',`项目已建立，我把目前收到的信息列在这里。\n\n选择的流程是「${({foreign:'国外迭代国外',domestic:'国内迭代国外',original:'原创',transcribe:'扒剧'})[p.kind]}」。${p.total===null?'全剧集数还未说明，可以在后续对话中补充。':`你说全剧 ${p.total} 集。`}${p.brief?'\n\n你的原话：\n'+p.brief:''}\n\n素材会单独归档。你可以继续补充要求；接入创作服务后，总编剧会结合材料正式复述任务。`);
  await bindings().DB.prepare('INSERT INTO studio_projects (id,owner,data,version,updated_at) VALUES (?,?,?,1,?)').bind(p.id,user,JSON.stringify(p),now).run();return Response.json(p,{status:201});
 }
 const p=await getProject(body.id,user);
 if(body.version!==p.version)throw new Error('CONFLICT');
 if(body.operation==='message'){
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>100000)throw new Error('INVALID_INPUT');
  if(p.remoteId)await backend('/api/projects/'+p.remoteId+'/messages','POST',{client_id:body.client_id,text:body.text});
  message(p,'user',body.text);
  if(!p.remoteId){
   if(/^(进度|咋样了|还要多久)[？?。]*$/.test(body.text.trim()))message(p,'director',p.confirmed?'需求已确认，当前等待生成服务接入，尚未启动创作任务。':'目前在收集和确认需求，尚未启动生成。你可以继续补充材料。');
   else{const count=statedTotal(body.text);
    if(count!==null){p.total=count;p.requirements.push(body.text);message(p,'director',`已记下，全剧 ${p.total} 集。这条说明也已保存到项目要求中。`);}
    else{p.requirements.push(body.text);message(p,'director','这条补充已经保存到项目要求中。你可以在右侧查看，开始创作时会一并交给总编剧。');}}
  }
 }else if(body.operation==='archive'){p.archived=Boolean(body.archived);}
 else if(body.operation==='set_episode'){
  const episode=Number(body.episode);const attachment=p.attachments.find(a=>a.id===body.attachment_id);
  if(p.kind!=='transcribe'||p.remoteId||!attachment||!Number.isInteger(episode)||episode<1||episode>(p.total??300))throw new Error('INVALID_INPUT');
  if(p.attachments.some(a=>a.id!==attachment.id&&a.episode===episode))throw new Error('EPISODE_ALREADY_USED');
  attachment.episode=episode;message(p,'director',`已将「${attachment.name}」标为第 ${episode} 集。`);
 }
 else if(body.operation==='rename'){if(!String(body.title||'').trim())throw new Error('INVALID_INPUT');p.title=String(body.title).slice(0,200);}
 else if(body.operation==='confirm'){
  p.confirmed=true;message(p,'director',!connected()?'建档信息已核对并保存。创作服务接入后会根据素材正式复述；现在仍可补充材料和要求。':p.total===null?'建档信息已核对。开始创作前请告诉我全剧集数，例如“全剧 62 集”；也可以继续补充素材。':'建档信息已核对。连接创作流程后，请查看总编剧的正式复述卡。');
 }else if(body.operation==='action'){
  if(!p.remoteId)throw new Error('SERVICE_NOT_CONNECTED');
  p.remote=await(await backend('/api/projects/'+p.remoteId+'/actions','POST',body.action)).json();
 }else if(body.operation==='connect'){
  if(!connected())throw new Error('SERVICE_NOT_CONNECTED');
  if(!p.confirmed||!Number.isInteger(p.total)||p.total!<1||p.total!>300)throw new Error('INVALID_INPUT');
  if(p.kind==='transcribe'&&p.attachments.some(a=>!a.episode||a.episode>p.total!))throw new Error('EPISODE_MAPPING_REQUIRED');
  if(!p.remoteId){
   const remote:any=await(await backend('/api/projects','POST',{title:p.title,kind:p.kind,total:p.total,start:1,brief:p.brief})).json();
   p.remoteId=remote.id;
   // Persist binding before forwarding files; retries reuse the same backend project.
   await saveProject(p,user);
  }
  const remote:any=await(await backend('/api/projects/'+p.remoteId)).json();
  for(const a of p.attachments){
   if(remote.attachments?.some((r:any)=>r.name===a.id+'-'+a.name))continue;
   const object=await bindings().BUCKET.get(user+'/'+p.id+'/'+a.id);
   if(object)await backend('/api/projects/'+p.remoteId+'/attachments?name='+encodeURIComponent(a.id+'-'+a.name)+'&role=source'+(a.episode?'&episode='+a.episode:''),'POST',await object.arrayBuffer(),true);
  }
  for(let i=0;i<p.requirements.length;i++)await backend('/api/projects/'+p.remoteId+'/messages','POST',{client_id:p.id+'-requirement-'+i,text:p.requirements[i]});
  p.remote=await(await backend('/api/projects/'+p.remoteId)).json();
  message(p,'director','已连接创作后端，材料与要求已同步。请查看当前确认卡。');
 }else if(body.operation==='budget'){
  if(!p.remoteId||typeof body.cap!=='number'||body.cap<0||body.cap>100)throw new Error('INVALID_INPUT');
  await backend('/api/projects/'+p.remoteId+'/budget','PUT',{cap:body.cap});
  p.remote=await(await backend('/api/projects/'+p.remoteId)).json();
 }else throw new Error('INVALID_INPUT');
 return Response.json(await saveProject(p,user));
}catch(e){return failure(e);}}
