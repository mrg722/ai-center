import { userRoute, readJson, HttpError } from '@/server/http/route';
import { getAgentBySlug, requireProject, agentViews } from '@/server/orchestrator/repo';
import { seedPermissions } from '@/server/orchestrator/moderator';
import { getRuntime } from '@/server/providers/registry';
import { readApiKey } from '@/server/env';
import { emit } from '@/server/events/bus';
import { userActor } from '@/server/auth/session';
import { z } from 'zod';

export const dynamic='force-dynamic';
type Model={id:string;name:string;owned_by?:string;type:string;description?:string;tags?:string[];pricing?:{input?:string;output?:string};deprecated_at?:number};
async function models():Promise<Model[]>{const r=await fetch('https://ai-gateway.vercel.sh/v1/models',{cache:'no-store',redirect:'error'});if(!r.ok)throw new HttpError(502,'Vercel AI Gateway catalogue unavailable');const j=await r.json() as {data?:Model[]};return j.data??[]}

export const GET=userRoute(async({db,user})=>{
 const project=await requireProject(db);let agent=await getAgentBySlug(db,project.id,'vercel');
 if(!agent){const rt=getRuntime('vercel-ai-gateway');if(!rt)throw new HttpError(500,'Vercel AI Gateway runtime is not registered');const u=await db.query<{id:string}>('select id from users order by created_at asc limit 1');const q=await db.query<{id:string}>(
 "insert into agents (project_id,slug,name,runtime,transport,model,role,role_label,description,color,config,enabled,sort_order) values ($1,'vercel','Vercel AI Gateway',$2,$3,$4,'GENERIC','Gateway multimodel','All Vercel AI Gateway models through one hosted agent.',$5,$6,true,coalesce((select max(sort_order)+1 from agents where project_id=$1),0)) returning id",
 [project.id,rt.id,rt.transport,rt.defaultModel??'openai/gpt-5.6-luna','#ffffff',JSON.stringify({office_style:'generic'})]);await seedPermissions(db,q.rows[0].id,'GENERIC',u.rows[0]?.id??null);for(const c of rt.capabilities)await db.query('insert into agent_capabilities (agent_id,capability) values ($1,$2) on conflict do nothing',[q.rows[0].id,c]);agent=await getAgentBySlug(db,project.id,'vercel');await emit(db,{project_id:project.id,type:'agent.created',actor:userActor(user),agent_id:agent?.id??null,payload:{slug:'vercel'}})}
 const ms=await models(),agents=await agentViews(db,project);return {models:ms,total:ms.length,language:ms.filter(m=>m.type==='language').length,byType:ms.reduce<Record<string,number>>((a,m)=>(a[m.type]=(a[m.type]??0)+1,a),{}),providers:[...new Set(ms.map(m=>m.id.split('/')[0]))].sort(),agent:agents.find(a=>a.slug==='vercel')??null,configured:Boolean(readApiKey('AI_GATEWAY_API_KEY'))};
});
export const POST=userRoute(async({req,db,user})=>{
 const project=await requireProject(db);const body=await readJson(req,z.object({model:z.string().min(3).max(200)}));
 const ms=await models(),m=ms.find(x=>x.id===body.model);if(!m)throw new HttpError(400,'modelo no disponible en el catálogo actual');if(m.type!=='language')throw new HttpError(400,'este modelo no puede usarse todavía en la sala de texto');if(m.deprecated_at)throw new HttpError(400,'este modelo está deprecated por Vercel');
 const a=await getAgentBySlug(db,project.id,'vercel');if(!a)throw new HttpError(409,'agente Vercel no inicializado');await db.query('update agents set model=$2,enabled=true where id=$1',[a.id,m.id]);await emit(db,{project_id:project.id,type:'agent.updated',actor:userActor(user),agent_id:a.id,payload:{model:m.id,provider:'vercel-ai-gateway'}});const av=await agentViews(db,project),updated=av.find(x=>x.id===a.id);if(!updated)throw new HttpError(500,'agente Vercel no disponible');return {ok:true,agent:updated};
});