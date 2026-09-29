// AI Center visual command center. Functional data comes from the existing live snapshot and APIs.
'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/client/api';
import { useLive } from '@/lib/client/live';
import type { AgentView, RuntimeInfo } from '@/lib/client/types';
import { AgentAvatar, Button, Empty, StatusDot, cx, timeAgo } from '@/components/ui';
import { ConversationRoom } from '@/components/ConversationRoom';
import { TaskControls } from '@/components/TaskControls';
import { NewTaskModal } from '@/components/Panels';

type InspectorTab = 'models' | 'agents' | 'routes';
type ContextTab = 'memory' | 'knowledge' | 'files';
type ChatTab = 'chat' | 'shared' | 'agents' | 'files' | 'context' | 'history';
type BottomTab = 'skills' | 'tools' | 'integrations';

type ProviderPayload = {
  runtimes: RuntimeInfo[];
  model_routing?: Record<string, { capability?: string; configured_slug?: string; resolved_agent?: string | null }>;
  nvidia?: {
    configured: boolean;
    models: { id: string; owned_by?: string }[];
    total: number;
    providers: string[];
    agent?: { id: string; model: string } | null;
    error?: string;
  };
};
type MemoryItem = { id: string; type: string; title?: string | null; content?: string; created_at: string };
type KnowledgeItem = { id: string; name?: string; title?: string; source?: string; category?: string; status?: string };
type SkillItem = { slug: string; name: string; description?: string; category?: string };

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    search: 'M11 19a8 8 0 1 1 5.66-2.34L22 22M16.66 16.66 22 22',
    chat: 'M4 5h16v11H8l-4 4V5Z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    sparkles: 'm12 3-1.4 4.1L7 8.5l3.6 1.4L12 14l1.4-4.1L17 8.5l-3.6-1.4L12 3ZM19 13l-.8 2.2L16 16l2.2.8L19 19l.8-2.2L22 16l-2.2-.8L19 13ZM5 14l-.6 1.7L3 16.3l1.4.6L5 18.3l.6-1.4 1.4-.6-1.4-.6L5 14Z',
    brain: 'M9.5 3a3 3 0 0 0-3 3v.3A3.5 3.5 0 0 0 4 12a3.5 3.5 0 0 0 2.5 5.7V18a3 3 0 0 0 3 3h1v-7H9a2 2 0 0 1 0-4h1V3h-.5ZM14.5 3a3 3 0 0 1 3 3v.3A3.5 3.5 0 0 1 20 12a3.5 3.5 0 0 1-2.5 5.7V18a3 3 0 0 1-3 3h-1v-7h1a2 2 0 1 0 0-4h-1V3h.5Z',
    book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5ZM4 18h16',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
    chart: 'M4 19V5M4 19h17M8 16v-4M12 16V8M16 16v-7M20 16v-4',
    cpu: 'M9 9h6v6H9zM4 9h2M4 15h2M18 9h2M18 15h2M9 4v2M15 4v2M9 18v2M15 18v2M7 7h10v10H7z',
    route: 'M5 7h5M14 7h5M5 17h5M14 17h5M10 7l4 10',
    plus: 'M12 5v14M5 12h14',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    filter: 'M4 6h16M7 12h10M10 18h4',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name] ?? paths.cpu} /></svg>;
}
function PanelNumber({ n }: { n: number }) {
  return <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8b5cf6] text-sm font-bold text-white">{n}</span>;
}
function SectionTitle({ number, children }: { number?: number; children: ReactNode }) {
  return <div className="flex items-center gap-2 px-3 py-2.5">{number ? <PanelNumber n={number} /> : null}<h2 className="truncate text-[13px] font-semibold text-[#dce6f3]">{children}</h2></div>;
}
function MiniTabs({ items, active, onChange }: { items: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return <div className="flex border-b border-[#202b38] px-1">{items.map((item) => <button key={item.id} onClick={() => onChange(item.id)} className={cx('px-3 py-2 text-[11px] transition-colors', active === item.id ? 'border-b-2 border-[#3b82f6] text-[#dfeaff]' : 'text-[#7f8da0] hover:text-[#c6d1df')}>{item.label}</button>)}</div>;
}
function ProviderMark({ runtime, color }: { runtime: string; color?: string }) {
  const lower = runtime.toLowerCase();
  const initial = lower.includes('nvidia') ? 'N' : lower.includes('claude') || lower.includes('anthropic') ? 'A' : lower.includes('ollama') ? 'O' : lower.includes('codex') || lower.includes('openai') ? 'O' : lower.includes('gemini') || lower.includes('google') ? 'G' : lower.includes('vercel') ? 'V' : runtime.slice(0, 1).toUpperCase();
  const tone = color ?? (lower.includes('nvidia') ? '#76b900' : lower.includes('claude') || lower.includes('anthropic') ? '#f07c63' : lower.includes('ollama') ? '#dce4ee' : '#7aa7ff');
  return <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border text-[12px] font-bold" style={{ color: tone, borderColor: tone + '55', background: tone + '16' }}>{initial}</span>;
}

function Sidebar({ onNewChat, selectedAgent, onSelectAgent }: { onNewChat: () => void; selectedAgent: string; onSelectAgent: (id: string) => void }) {
  const { snap, connected } = useLive();
  const agents = snap?.agents ?? [];
  return <aside className="flex min-h-0 w-[268px] shrink-0 flex-col border-r border-[#202b38] bg-[#0b1017]">
    <div className="border-b border-[#202b38] p-3"><div className="mb-1 text-[10px] uppercase tracking-wide text-[#738196]">Proyecto actual</div>
      <div className="flex items-center justify-between rounded-lg border border-[#273343] bg-[#10161f] px-2.5 py-2"><div className="flex min-w-0 items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#18263a] text-[#5ea2ff]"><Icon name="cpu" size={15} /></span><span className="truncate text-[12px] font-semibold">{snap?.project.name ?? 'Cargando…'}</span></div><span className="text-[#7d8998]">⌄</span></div>
      <button onClick={onNewChat} className="mt-3 flex h-9 w-full items-center gap-2 rounded-lg bg-[#2563eb] px-3 text-[12px] font-semibold text-white transition hover:bg-[#3b82f6]"><Icon name="plus" size={15} /> Nuevo chat</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="mb-3"><div className="px-2 py-1 text-[10px] font-semibold tracking-[.13em] text-[#667488]">CHATS</div>{['Chat General','Security Team','Desarrollo Web','Análisis de Datos','Ideas / Brainstorm','Soporte'].map((label, i) => <button key={label} className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px]', i === 0 ? 'bg-[#173a78] text-[#e8f1ff]' : 'text-[#9aa7b7] hover:bg-[#141d28]')}><Icon name="chat" size={14} /><span className="truncate">{label}</span></button>)}</div>
      <div className="mb-3"><div className="px-2 py-1 text-[10px] font-semibold tracking-[.13em] text-[#667488]">AGENTS</div><button onClick={() => onSelectAgent('all')} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] text-[#9aa7b7] hover:bg-[#141d28]"><Icon name="users" size={14} /> Todos los agentes</button>
        {agents.map((agent) => <button key={agent.id} onClick={() => onSelectAgent(agent.id)} className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px]', selectedAgent === agent.id ? 'bg-[#17263b] text-white' : 'text-[#8d9aac] hover:bg-[#141d28]')}><AgentAvatar name={agent.name} color={agent.color} size={20} status={agent.status} /><span className="truncate">{agent.name}</span></button>)}</div>
      <div><div className="px-2 py-1 text-[10px] font-semibold tracking-[.13em] text-[#667488]">TOOLS</div>{[['Modelos','cpu'],['Skills','sparkles'],['Memory','brain'],['Knowledge','book'],['Security Lab','shield'],['Reports','chart']].map(([label, icon]) => <button key={label} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#8d9aac] hover:bg-[#141d28]"><Icon name={icon} size={14} />{label}</button>)}</div>
    </div>
    <div className="border-t border-[#202b38] p-3"><div className="mb-2 text-[10px] font-semibold tracking-[.13em] text-[#738196]">ESTADO DEL SISTEMA</div><div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] text-[#a0acba]"><span className={cx('h-2 w-2 rounded-full', connected ? 'bg-[#22c55e]' : 'bg-[#f59e0b]')} /> Live / SSE <span className="ml-auto text-[9px] text-[#657386]">{connected ? 'Online' : 'Reconnecting'}</span></div>
      {agents.slice(0, 5).map((agent) => <div key={agent.id} className="flex items-center gap-2 text-[11px] text-[#a0acba]"><StatusDot status={agent.status} size={7} /><span className="truncate">{agent.provider.name}</span><span className="ml-auto text-[9px] text-[#657386]">{agent.status}</span></div>)}
    </div></div>
  </aside>;
}

function ChatHeader({ tab, onTab }: { tab: ChatTab; onTab: (v: ChatTab) => void }) {
  const tabs: { id: ChatTab; label: string }[] = [{ id:'chat',label:'Chat'},{id:'shared',label:'Compartido (Todos)'},{id:'agents',label:'Vista Agentes'},{id:'files',label:'Archivos'},{id:'context',label:'Contexto'},{id:'history',label:'Historial'}];
  return <><div className="flex items-center justify-between border-b border-[#202b38] px-4 py-3"><div><h1 className="text-[20px] font-semibold tracking-tight text-[#e6edf5]">Chat General</h1><p className="mt-0.5 text-[11px] text-[#718096]">Conversa con múltiples IAs y agentes</p></div><div className="flex items-center gap-1.5"><button className="rounded-md p-2 text-[#8390a2] hover:bg-[#151d28]" aria-label="Buscar"><Icon name="search" size={15}/></button><button className="rounded-md p-2 text-[#8390a2] hover:bg-[#151d28]" aria-label="Más"><Icon name="more" size={16}/></button></div></div><MiniTabs items={tabs} active={tab} onChange={(v)=>onTab(v as ChatTab)}/></>;
}
function ParticipantBar({ agents, target, onTarget }: { agents: AgentView[]; target: string; onTarget: (id: string) => void }) {
  return <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-[#202b38] px-3 py-2"><button onClick={()=>onTarget('all')} className={cx('shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-medium',target==='all'?'border-[#3b82f6] bg-[#2563eb22] text-[#cfe0ff]':'border-[#273343] text-[#8390a2]')}>Todos</button>{agents.map((a)=><button key={a.id} onClick={()=>onTarget(a.id)} className={cx('flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5',target===a.id?'border-[#3b82f6] bg-[#2563eb22]':'border-[#273343] bg-[#10161f]')}><AgentAvatar name={a.name} color={a.color} size={23} status={a.status}/><span className="max-w-28 truncate text-[11px] text-[#d1d9e4]">{a.name}</span></button>)}</div>;
}

function Inspector({ runtimes, nvidia, agents, target, onTarget, activeRuntime, onSelectRuntime, onCreateTask }: { runtimes: RuntimeInfo[]; nvidia?: ProviderPayload['nvidia']; agents: AgentView[]; target: string; onTarget: (id: string) => void; activeRuntime: string | null; onSelectRuntime: (r: RuntimeInfo) => void; onCreateTask: () => void }) {
  const [tab,setTab]=useState<InspectorTab>('models'); const [context,setContext]=useState<ContextTab>('memory'); const [memories,setMemories]=useState<MemoryItem[]>([]); const [knowledge,setKnowledge]=useState<KnowledgeItem[]>([]); const [skills,setSkills]=useState<SkillItem[]>([]); const [loading,setLoading]=useState(true); const [search,setSearch]=useState(''); const [changing,setChanging]=useState(false);
  const selectedAgent=agents.find(a=>a.id===target)??agents[0];
  useEffect(()=>{let cancelled=false; Promise.all([api<{memories:MemoryItem[]}>('/api/memory').catch(()=>({memories:[]})),api<{documents:KnowledgeItem[]}>('/api/knowledge').catch(()=>({documents:[]})),api<{skills:SkillItem[]}>('/api/registry/skills').catch(()=>({skills:[]}))]).then(([m,k,s])=>{if(!cancelled){setMemories(m.memories??[]);setKnowledge(k.documents??[]);setSkills(s.skills??[]);setLoading(false);}});return()=>{cancelled=true;}},[]);
  const visible=runtimes.filter(r=>(r.label+' '+r.provider.name+' '+r.runtime).toLowerCase().includes(search.toLowerCase())).slice(0,10);
  async function changeNvidiaModel(model:string){if(!nvidia?.agent||changing)return;setChanging(true);try{await api('/api/agents/'+nvidia.agent.id+'/control',{body:{op:'set_model',model}})}finally{setChanging(false)}}
  return <aside className="flex min-h-0 w-[352px] shrink-0 flex-col overflow-y-auto border-l border-[#202b38] bg-[#0b1017]">
    <div className="border-b border-[#202b38]"><SectionTitle number={1}>Selector de Modelo/Agente</SectionTitle><MiniTabs items={[{id:'models',label:'Modelos'},{id:'agents',label:'Agentes'},{id:'routes',label:'Rutas'}]} active={tab} onChange={v=>setTab(v as InspectorTab)}/></div>
    {tab==='models'&&<div className="p-2.5"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar modelo o provider…" className="mb-2 h-8 w-full rounded-md border border-[#273343] bg-[#0c121a] px-2.5 text-[11px] text-white placeholder:text-[#5f6c7e] focus:border-[#3b82f6] focus:outline-none"/><div className="grid grid-cols-2 gap-2">{visible.map(r=><button key={r.id} onClick={()=>onSelectRuntime(r)} className={cx('min-h-[70px] rounded-lg border p-2 text-left',activeRuntime===r.id?'border-[#3b82f6] bg-[#13284b]':'border-[#202b38] bg-[#10161f] hover:border-[#304052]')}><div className="flex items-center gap-2"><ProviderMark runtime={r.runtime}/><div className="min-w-0"><div className="truncate text-[11px] font-semibold text-[#dbe5f1]">{r.label}</div><div className="truncate text-[9px] text-[#738196]">{r.provider.name}</div></div></div><div className="mt-1 truncate text-[9px] text-[#59677a]">{r.apiKeyPresent===false?'No configurado':r.defaultModel||r.runtime}</div></button>)}</div>
      <div className="mt-2 rounded-lg border border-[#202b38] bg-[#10161f] p-2.5"><div className="mb-2 text-[10px] text-[#718096]">MODELO ACTIVO</div><div className="flex items-center gap-2"><ProviderMark runtime={selectedAgent?.runtime??activeRuntime??'model'} color={selectedAgent?.color}/><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold">{selectedAgent?.model??'Sin agente seleccionado'}</div><div className="truncate text-[9px] text-[#738196]">{selectedAgent?.provider.name??'—'} · {selectedAgent?.status??'—'}</div></div></div></div>
      {nvidia?.configured&&nvidia.models.length>0&&<div className="mt-2 rounded-lg border border-[#202b38] bg-[#10161f] p-2.5"><div className="mb-1 text-[10px] font-semibold text-[#76b900]">NVIDIA NIM · {nvidia.total} modelos</div><div className="max-h-32 space-y-1 overflow-y-auto">{nvidia.models.slice(0,8).map(m=><button key={m.id} disabled={changing} onClick={()=>changeNvidiaModel(m.id)} className="block w-full truncate rounded px-2 py-1 text-left text-[9px] text-[#9aa7b7] hover:bg-[#18212d] hover:text-white disabled:opacity-50">{m.id}</button>)}</div></div>}
    </div>}
    {tab==='agents'&&<div className="space-y-1.5 p-2.5">{agents.map(a=><button key={a.id} onClick={()=>onTarget(a.id)} className={cx('flex w-full items-center gap-2 rounded-lg border p-2 text-left',target===a.id?'border-[#3b82f6] bg-[#13284b]':'border-[#202b38] bg-[#10161f]')}><AgentAvatar name={a.name} color={a.color} size={30} status={a.status}/><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold">{a.name}</div><div className="truncate text-[9px] text-[#738196]">{a.role_label} · {a.provider.name}</div></div><span className="max-w-24 truncate text-[9px] text-[#657386]">{a.model}</span></button>)}</div>}
    {tab==='routes'&&<div className="space-y-1.5 p-2.5">{runtimes.map(r=><div key={r.id} className="flex items-center gap-2 rounded-lg border border-[#202b38] bg-[#10161f] p-2"><Icon name="route" size={15}/><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-semibold">{r.label}</div><div className="truncate text-[9px] text-[#738196]">{r.capabilities.join(' · ')||'sin capacidades declaradas'}</div></div></div>)}</div>}
    <div className="border-y border-[#202b38]"><SectionTitle number={2}>Contexto del Chat</SectionTitle><MiniTabs items={[{id:'memory',label:'Memory ('+memories.length+')'},{id:'knowledge',label:'Knowledge ('+knowledge.length+')'},{id:'files',label:'Archivos'}]} active={context} onChange={v=>setContext(v as ContextTab)}/></div>
    <div className="p-2.5">{loading?<div className="p-5 text-center text-[10px] text-[#687588]">Cargando contexto…</div>:context==='memory'?<div className="space-y-1.5">{memories.slice(0,5).map(m=><div key={m.id} className="rounded-lg border border-[#202b38] bg-[#10161f] p-2"><div className="flex items-center justify-between gap-2"><span className="truncate text-[10px] font-medium">{m.title??m.type}</span><span className="text-[9px] text-[#657386]">{timeAgo(m.created_at)}</span></div><div className="mt-1 line-clamp-2 text-[9px] text-[#8290a2]">{m.content??'Sin contenido'}</div></div>)}{memories.length===0&&<Empty>No hay memorias disponibles.</Empty>}</div>:context==='knowledge'?<div className="space-y-1.5">{knowledge.slice(0,5).map(d=><div key={d.id} className="rounded-lg border border-[#202b38] bg-[#10161f] p-2"><div className="truncate text-[10px] font-medium">{d.title??d.name??'Documento'}</div><div className="mt-1 text-[9px] text-[#8290a2]">{d.category??d.source??'Fuente no indicada'} · {d.status??'disponible'}</div></div>)}{knowledge.length===0&&<Empty>No hay documentos disponibles.</Empty>}</div>:<Empty>Los archivos disponibles se muestran en los mensajes y tareas reales.</Empty>}</div>
    <div className="border-y border-[#202b38]"><SectionTitle number={3}>Skills Activas</SectionTitle><div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5">{skills.length?skills.slice(0,12).map(s=><span key={s.slug} className="rounded-full border border-[#283a50] bg-[#111c2a] px-2 py-1 text-[9px] text-[#9fb8d8]">{s.slug}</span>):<span className="text-[10px] text-[#687588]">No hay skills disponibles.</span>}</div><Link href="/settings" className="mx-2.5 mb-2.5 flex items-center justify-center rounded-md border border-[#273343] px-2 py-1.5 text-[10px] text-[#8290a2] hover:bg-[#151d28]">Gestionar skills →</Link></div>
    <div className="border-t border-[#202b38]"><SectionTitle number={4}>Ejecución y Herramientas</SectionTitle><div className="grid grid-cols-2 gap-2 p-2.5"><Button size="sm" variant="primary" onClick={onCreateTask}><Icon name="plus" size={13}/> Crear Task</Button><Button size="sm" variant="ghost" disabled title="La ejecución directa de skills requiere la integración de herramientas existente."><Icon name="sparkles" size={13}/> Ejecutar Skill</Button><Button size="sm" variant="danger" disabled title="Security Lab/Strix requiere Bridge y allowlist configurados."><Icon name="shield" size={13}/> Security Lab</Button><Button size="sm" variant="default" disabled title="El generador de reportes no está expuesto como acción desde el dashboard."><Icon name="chart" size={13}/> Generar Reporte</Button></div></div>
  </aside>;
}

function BottomPanels({ agents, skills, runtimes, routing }: { agents: AgentView[]; skills: SkillItem[]; runtimes: RuntimeInfo[]; routing: ProviderPayload['model_routing'] }) {
  const [tab,setTab]=useState<BottomTab>('skills'); const capabilities=Object.entries(routing??{});
  return <div className="grid min-h-[205px] grid-cols-1 border-t border-[#202b38] bg-[#0b1017] xl:grid-cols-[1.05fr_1fr_1fr]">
    <section className="min-h-0 border-b border-[#202b38] xl:border-b-0 xl:border-r"><SectionTitle number={5}>Agentes Disponibles</SectionTitle><div className="flex items-center gap-2 px-2 pb-2"><input placeholder="Buscar agentes…" className="h-7 min-w-0 flex-1 rounded-md border border-[#273343] bg-[#0c121a] px-2 text-[10px] placeholder:text-[#59677a] focus:border-[#3b82f6] focus:outline-none"/><button className="rounded border border-[#273343] p-1.5 text-[#738196]" aria-label="Filtrar"><Icon name="filter" size={13}/></button></div><div className="max-h-28 overflow-y-auto px-2 pb-2">{agents.slice(0,7).map(a=><div key={a.id} className="flex items-center gap-2 border-b border-[#17212c] py-1.5"><AgentAvatar name={a.name} color={a.color} size={25} status={a.status}/><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-semibold">{a.name}</div><div className="truncate text-[8px] text-[#667488]">{a.role_label} · {a.provider.name}</div></div><span className="rounded-full border border-[#304052] px-1.5 py-0.5 text-[8px] text-[#8492a5]">{a.capabilities[0]??'general'}</span></div>)}</div></section>
    <section className="min-h-0 border-b border-[#202b38] xl:border-b-0 xl:border-r"><SectionTitle number={6}>Skills & Herramientas</SectionTitle><MiniTabs items={[{id:'skills',label:'Skills'},{id:'tools',label:'Herramientas'},{id:'integrations',label:'Integraciones'}]} active={tab} onChange={v=>setTab(v as BottomTab)}/><div className="max-h-28 overflow-y-auto p-2">{tab==='skills'?skills.slice(0,8).map(s=><div key={s.slug} className="flex items-center gap-2 border-b border-[#17212c] py-1.5"><span className="flex h-5 w-5 items-center justify-center rounded bg-[#182d4b] text-[#66a6ff]"><Icon name="sparkles" size={11}/></span><div className="min-w-0 flex-1"><div className="truncate text-[10px]">{s.name}</div><div className="truncate text-[8px] text-[#667488]">{s.description??s.category??'Skill registrada'}</div></div></div>):tab==='tools'?<div className="space-y-1 text-[9px] text-[#8795a8]"><div className="rounded border border-[#202b38] p-2">Herramientas declaradas por agentes: {agents.reduce((n,a)=>n+a.tools.length,0)}</div><div className="rounded border border-[#202b38] p-2">Transportes registrados: {new Set(agents.map(a=>a.transport)).size}</div></div>:<div className="space-y-1 text-[9px] text-[#8795a8]">{runtimes.slice(0,8).map(r=><div key={r.id} className="flex justify-between rounded border border-[#202b38] px-2 py-1.5"><span>{r.label}</span><span>{r.apiKeyPresent===false?'No configurado':'Disponible'}</span></div>)}</div>}</div></section>
    <section className="min-h-0"><SectionTitle number={7}>Model Router</SectionTitle><div className="flex border-b border-[#202b38] px-1"><span className="border-b-2 border-[#3b82f6] px-3 py-2 text-[11px] text-[#dfeaff]">Por Capacidad</span><span className="px-3 py-2 text-[11px] text-[#7f8da0]">Configuración</span></div><div className="max-h-28 overflow-y-auto p-2">{capabilities.length?capabilities.map(([key,value])=><div key={key} className="flex items-center gap-2 border-b border-[#17212c] py-1.5"><Icon name="route" size={12}/><span className="min-w-0 flex-1 text-[9px] capitalize text-[#aab6c5]">{key}</span><span className="max-w-32 truncate text-[9px] text-[#dce6f3]">{value?.resolved_agent??value?.configured_slug??'sin resolución'}</span><span className="text-[#728198]">→</span></div>):<Empty>Sin rutas configuradas.</Empty>}</div></section>
  </div>;
}

export function RedesignedCommandCenter() {
  const { snap } = useLive();
  const [target,setTarget]=useState('all'); const [taskId,setTaskId]=useState<string|null>(null); const [chatTab,setChatTab]=useState<ChatTab>('chat'); const [sidebarOpen,setSidebarOpen]=useState(true); const [inspectorOpen,setInspectorOpen]=useState(true); const [runtimes,setRuntimes]=useState<RuntimeInfo[]>([]); const [providers,setProviders]=useState<ProviderPayload|null>(null); const [activeRuntime,setActiveRuntime]=useState<string|null>(null); const [createTaskOpen,setCreateTaskOpen]=useState(false); const [skills,setSkills]=useState<SkillItem[]>([]);
  useEffect(()=>{if(target!=='all'||!snap?.agents.length)return;const builder=snap.agents.find(a=>a.role==='PRIMARY_BUILDER')??snap.agents.find(a=>a.enabled);if(builder)setTarget(builder.id)},[snap?.agents,target]);
  useEffect(()=>{let cancelled=false; Promise.all([api<ProviderPayload>('/api/providers'),api<{skills:SkillItem[]}>('/api/registry/skills')]).then(([data,skillData])=>{if(!cancelled){setProviders(data);setRuntimes(data.runtimes??[]);setSkills(skillData.skills??[])}}).catch(()=>undefined);return()=>{cancelled=true}},[]);
  const selectedTask=snap?.tasks.find(t=>t.id===taskId)??null;
  return <div className="flex min-h-0 flex-1 flex-col bg-[#07090d]">
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {sidebarOpen&&<Sidebar onNewChat={()=>{setTaskId(null);setTarget('all');setChatTab('chat')}} selectedAgent={target} onSelectAgent={setTarget}/>}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[#202b38] bg-[#0b1017] px-3 py-1.5 lg:hidden"><button onClick={()=>setSidebarOpen(v=>!v)} className="rounded p-1.5 text-[#8b98a9]" aria-label="Abrir sidebar"><Icon name="users"/></button><span className="text-[11px] font-semibold">{snap?.project.name??'AI Center'}</span><button onClick={()=>setInspectorOpen(v=>!v)} className="rounded p-1.5 text-[#8b98a9]" aria-label="Abrir inspector"><Icon name="cpu"/></button></div>
        <ChatHeader tab={chatTab} onTab={setChatTab}/><ParticipantBar agents={snap?.agents??[]} target={target} onTarget={setTarget}/>
        <div className="min-h-0 flex-1 overflow-hidden">{selectedTask?<div className="flex h-full min-h-0 flex-col"><TaskControls task={selectedTask}/><div className="min-h-0 flex-1"><ConversationRoom taskId={taskId} taskKey={selectedTask.key} target={target} onTargetChange={setTarget}/></div></div>:<ConversationRoom taskId={null} taskKey={null} target={target} onTargetChange={setTarget}/>}</div>
      </main>
      {inspectorOpen&&<Inspector runtimes={runtimes} nvidia={providers?.nvidia} agents={snap?.agents??[]} target={target} onTarget={setTarget} activeRuntime={activeRuntime} onSelectRuntime={r=>setActiveRuntime(r.id)} onCreateTask={()=>setCreateTaskOpen(true)}/>}
    </div>
    <BottomPanels agents={snap?.agents??[]} skills={skills} runtimes={runtimes} routing={providers?.model_routing}/><NewTaskModal open={createTaskOpen} onClose={()=>setCreateTaskOpen(false)} onCreated={(id)=>{setCreateTaskOpen(false);setTaskId(id)}}/>
  </div>;
}
