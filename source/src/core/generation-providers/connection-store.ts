import { inArray } from 'drizzle-orm';
import { getConfig,saveConfigs } from '@/modules/config/service';
import { generationHistory } from '@/config/db/schema';
import { db } from '@/core/db';
import { ARK_BASE_URL,ARK_DEFAULT_MODEL } from '@/core/adapters/ark-contract';
import { maskApiKeyPreview } from '@/lib/mask-api-key';
import { connectionSnapshot,validateConnectionProfile,type ConnectionCategory,type ConnectionProfile,type PublicConnections } from './connection-contract';

type Document={version:1;profiles:ConnectionProfile[];history:ConnectionProfile[];defaults:Partial<Record<ConnectionCategory,string>>};
const CONFIG_KEY='MODEL_CONNECTIONS_SECRET';
let mutationQueue:Promise<unknown>=Promise.resolve();
export async function loadConnectionDocument():Promise<Document> {
  const raw=await getConfig(CONFIG_KEY,true);
  if(raw){
    const document=JSON.parse(raw) as Document;
    if(document.version!==1||!Array.isArray(document.profiles)||!Array.isArray(document.history))throw new Error('Local model configuration is invalid.');
    return document;
  }
  return {version:1,profiles:[{
    id:'seedance-official',revision:1,name:'Seedance 2.5',category:'video',protocol:'ark-video',baseUrl:ARK_BASE_URL,
    model:(await getConfig('ARK_MODEL_ID'))||ARK_DEFAULT_MODEL,
    apiKey:(await getConfig('ARK_API_KEY'))||process.env.ARK_API_KEY?.trim()||'',
    demo:(await getConfig('ARK_DEMO_MODE'))!=='false',imageSize:'',
  }],history:[],defaults:{video:'seedance-official'}};
}
export async function publicConnections():Promise<PublicConnections> {
  const document=await loadConnectionDocument();
  return {defaults:document.defaults,profiles:document.profiles.map(profile=>({...connectionSnapshot(profile),apiKeyConfigured:Boolean(profile.apiKey),apiKeyPreview:profile.apiKey?maskApiKeyPreview(profile.apiKey):'',isDefault:document.defaults[profile.category]===profile.id}))};
}
export async function resolveConnection(category:ConnectionCategory,id?:string,revision?:number) {
  const document=await loadConnectionDocument();
  const selectedId=id||document.defaults[category];
  const candidates=revision?[...document.profiles,...document.history]:document.profiles;
  const profile=candidates.find(profile=>profile.id===selectedId&&profile.category===category&&(!revision||profile.revision===revision));
  if(!profile)throw new Error(`Configure a ${category} model connection in Settings first.`);
  return {...profile};
}
async function activeConnections() {
  const rows=await(await db()).select({status:generationHistory.status,input:generationHistory.input}).from(generationHistory).where(inArray(generationHistory.status,['pending','processing']));
  return rows.filter((row:any)=>['pending','processing'].includes(row.status)).map((row:any)=>(row.input as {_connection?:{id:string}})?._connection?.id).filter(Boolean) as string[];
}
export function mutateConnections(input:{action:'save'|'delete'|'default';profile?:Record<string,unknown>;id?:string;category?:ConnectionCategory}) {
  const mutate=async()=>{
    const document=await loadConnectionDocument();
    if(input.action==='save'){
      const source=input.profile||{};
      const id=typeof source.id==='string'&&source.id?source.id:crypto.randomUUID();
      const previous=document.profiles.find(p=>p.id===id);
      if(previous&&source.revision!==previous.revision)throw new Error('This connection was changed. Reload settings before saving.');
      if(previous&&source.category!==previous.category)throw new Error('Create a new connection to change its category.');
      const next=validateConnectionProfile({...source,id,revision:(previous?.revision||0)+1,apiKey:typeof source.apiKey==='string'&&source.apiKey.trim()?source.apiKey.trim():previous?.apiKey||'',imageSize:source.imageSize||''});
      if(!previous&&document.profiles.length>=50)throw new Error('At most 50 model connections can be saved.');
      if(previous)document.history.push(previous);
      document.profiles=[...document.profiles.filter(p=>p.id!==id),next];
      if(!document.defaults[next.category])document.defaults[next.category]=id;
    }else{
      const profile=document.profiles.find(p=>p.id===input.id);
      if(!profile)throw new Error('Model connection not found.');
      if(input.action==='default'){
        if(input.category&&input.category!==profile.category)throw new Error('Connection category does not match.');
        document.defaults[profile.category]=profile.id;
      }else{
        if((await activeConnections()).includes(profile.id))throw new Error('This connection has an active task. Wait before deleting it.');
        if(profile.id==='seedance-official')throw new Error('The built-in Seedance connection can be edited but not deleted.');
        document.profiles=document.profiles.filter(p=>p.id!==profile.id);
        document.history=document.history.filter(p=>p.id!==profile.id);
        if(document.defaults[profile.category]===profile.id){const next=document.profiles.find(p=>p.category===profile.category);if(next)document.defaults[profile.category]=next.id;else delete document.defaults[profile.category];}
      }
    }
    await saveConfigs({[CONFIG_KEY]:JSON.stringify(document)});
    return publicConnections();
  };
  const operation=mutationQueue.then(mutate,mutate);mutationQueue=operation.catch(()=>{});return operation;
}
