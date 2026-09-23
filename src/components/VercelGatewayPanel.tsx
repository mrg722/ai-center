'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import type { AgentView } from '@/lib/client/types';

type Model = { id:string; name:string; type:string; owned_by?:string; description?:string; tags?:string[]; pricing?:{input?:string;output?:string}; deprecated_at?:number };
type Payload = { models:Model[]; total:number; language:number; byType:Record<string,number>; providers:string[]; agent:AgentView|null; configured:boolean };
const TYPES:Record<string,string>={language:'Texto',image:'Imagen',video:'Video',speech:'Voz',transcription:'Transcripción',embedding:'Embeddings',rerank:'Reranking',realtime:'Realtime'};
const RAINBOW=['#ff4d6d','#ffb347','#ffe66d','#5ee58a','#62b6ff','#b388ff'];

// Memoized: this panel manages its own data (a 300s poll of /api/vercel, not
// the SSE snapshot), so it has no reason to re-render just because the
// dashboard page re-renders for something unrelated. Requires the parent to
// pass a stable `onSelectAgent`.
export const VercelGatewayPanel = memo(function VercelGatewayPanel({onSelectAgent}:{onSelectAgent?:(id:string)=>void}) {
  const [data,setData]=useState<Payload|null>(null),[q,setQ]=useState(''),[type,setType]=useState('language'),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
  const load=useCallback(async()=>{try{const x=await api<Payload>('/api/vercel');setData(x);setSelected(s=>s||x.agent?.model||x.models.find(m=>m.type==='language'&&!m.deprecated_at)?.id||'')}catch(e){setMsg(e instanceof Error?e.message:'No se pudo cargar Vercel AI Gateway')}},[]);
  useEffect(()=>{void load();const t=window.setInterval(()=>void load(),300000);return()=>window.clearInterval(t)},[load]);
  const visible=useMemo(()=>{const a=data?.models??[],s=q.trim().toLowerCase();return a.filter(m=>(type==='all'||m.type===type)&&(!s||[m.id,m.name,m.owned_by??'',...(m.tags??[])].join(' ').toLowerCase().includes(s)))},[data,q,type]);
  const choose=async(m:Model)=>{if(m.type!=='language'||m.deprecated_at)return;setBusy(true);setMsg('');setSelected(m.id);try{const x=await api<{agent:AgentView}>('/api/vercel',{method:'POST',body:{model:m.id}});setData(d=>d?{...d,agent:x.agent}:d);onSelectAgent?.(x.agent.id);setMsg('Modelo activo: '+m.name)}catch(e){setMsg(e instanceof Error?e.message:'No se pudo seleccionar el modelo')}finally{setBusy(false)}};
  const price=(v?:string)=>{if(v===undefined)return'—';const n=Number(v)*1000000;return n===0?'Gratis':'$'+(n<.01?n.toFixed(4):n.toFixed(2))+'/M'};
  const free=(data?.models??[]).filter(m=>m.type==='language'&&Number(m.pricing?.input??1)===0&&Number(m.pricing?.output??1)===0).length;
  return <section className="relative overflow-hidden rounded-lg border border-line bg-ink-900">
    <div className="absolute inset-x-0 top-0 h-1" style={{background:'linear-gradient(90deg,'+RAINBOW.join(',')+')'}}/>
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded bg-white font-bold text-black">▲</span><div><h2 className="text-sm font-semibold">Vercel AI Gateway</h2><p className="text-[11px] text-fg-dim">Catálogo dinámico y selector de modelos</p></div></div><div className="flex flex-wrap gap-1 text-[10px] font-mono"><Badge>{data?data.total+' modelos':'cargando…'}</Badge><Badge>{data?data.providers.length+' proveedores':'—'}</Badge><Badge>{free?free+' texto gratis':'free tier según Vercel'}</Badge><Badge tone={data?.configured?'green':'amber'}>{data?.configured?'Gateway configurado':'Falta AI_GATEWAY_API_KEY'}</Badge></div></div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_auto]"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar modelo o proveedor…" className="h-9 rounded-md border border-line bg-ink-850 px-3 text-xs"/><select value={type} onChange={e=>setType(e.target.value)} className="h-9 rounded-md border border-line bg-ink-850 px-2 text-xs"><option value="all">Todas las modalidades</option>{Object.entries(data?.byType??{}).map(([k,n])=><option key={k} value={k}>{TYPES[k]??k} · {n}</option>)}</select><button onClick={()=>void load()} className="h-9 rounded-md border border-line px-3 text-xs text-fg-muted">Actualizar</button></div>
      <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-4">{visible.slice(0,64).map(m=>{const active=m.id===selected,usable=m.type==='language'&&!m.deprecated_at;return <button key={m.id} disabled={!usable||busy} onClick={()=>void choose(m)} className={'rounded-md border p-2 text-left '+(active?'border-white/60 bg-white/5':'border-line bg-ink-850')+(!usable?' opacity-45':'')}><div className="flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{background:RAINBOW[Math.abs(hashCode(m.id))%RAINBOW.length]}}/><span className="truncate text-xs font-medium">{m.name}</span></div><div className="mt-1 truncate font-mono text-[9px] text-fg-dim">{m.id}</div><div className="mt-1 text-[9px] text-fg-dim">{TYPES[m.type]??m.type} · {price(m.pricing?.input)} in · {price(m.pricing?.output)} out</div></button>})}</div>
      {visible.length>64&&<div className="text-[10px] text-fg-dim">Mostrando 64 de {visible.length}; usa la búsqueda para localizar cualquiera.</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"><span className="text-[10px] text-fg-dim">{msg||'Selecciona un modelo de texto para usarlo en la sala.'}</span><div className="flex gap-2">{data?.agent&&<button onClick={()=>onSelectAgent?.(data.agent!.id)} className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-ink-950">Hablar con Vercel</button>}<a href="https://vercel.com/ai-gateway/models" target="_blank" rel="noreferrer" className="rounded-md border border-line px-3 py-1.5 text-[11px]">Catálogo ↗</a></div></div>
      <p className="text-[10px] text-fg-dim">Los límites, créditos y resets los determina Vercel. Si aparece un 429, respetaremos Retry-After cuando Vercel lo entregue. El saldo exacto se consulta en AI Gateway; Vercel usa créditos prepagados y admite presupuestos con reinicio diario, semanal o mensual.</p>
    </div>
  </section>
});
function Badge({children,tone='default'}:{children:React.ReactNode;tone?:'default'|'green'|'amber'}){return <span className={'rounded border px-1.5 py-0.5 '+(tone==='green'?'border-st-online/30 text-st-online':tone==='amber'?'border-st-warn/30 text-st-warn':'border-line text-fg-dim')}>{children}</span>}
function hashCode(v:string){let h=0;for(let i=0;i<v.length;i++)h=(h*31+v.charCodeAt(i))|0;return h>>>0}
