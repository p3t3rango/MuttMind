'use client';
import { useEffect, useState } from 'react'; import { getAccessToken } from '@/lib/client-auth';
type NodeItem={id:string;title:string|null;original_url:string|null;og_image_url:string|null;ai_summary:string|null};
export default function VaultPage(){const [nodes,setNodes]=useState<NodeItem[]>([]);const [workspaceId,setWorkspaceId]=useState('');
useEffect(()=>{(async()=>{if(!workspaceId)return;const token=await getAccessToken();const r=await fetch(`/api/nodes?workspaceId=${workspaceId}`,{headers:{authorization:`Bearer ${token}`}});const d=await r.json();setNodes(d.nodes??[])})();},[workspaceId]);
return <main><h1>Vault</h1><input placeholder='Workspace UUID' value={workspaceId} onChange={(e)=>setWorkspaceId(e.target.value)}/><div className='grid'>{nodes.map(n=><article key={n.id} className='card'><h3>{n.title??'Untitled'}</h3><p>{n.ai_summary??'Pending AI summary...'}</p><a href={n.original_url??'#'}>{n.original_url}</a></article>)}</div></main>}
