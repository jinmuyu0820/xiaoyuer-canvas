import {and,desc,eq,inArray} from 'drizzle-orm';
import {generationAssetLink,generationHistory} from '@/config/db/schema';
import {getDb} from '@/core/workspace-lib/db-adapter';
import {getProjectAssetById} from '@/core/workspace-lib/assets/user-assets';
import {getActiveProject} from './projects';
import {resolveLocalProjectAssetPath} from './local-project-assets';
const object=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const string=(value:unknown,max=500)=>typeof value==='string'?value.slice(0,max):null;
export function safeGenerationProvenance(row:{id:string;providerTaskId?:string|null;input:unknown;output:unknown;submittedPrompt?:string|null;createdAt:Date|string;status:string}){
  const input=object(row.input),output=object(row.output),connection=object(input._connection),provider=object(input._provider);
  const parameters:Record<string,string|number|boolean>={};
  for(const key of ['aspect_ratio','wmDuration','wmOutputQuality','quality','mode','variant','seed'])if(['string','number','boolean'].includes(typeof input[key]))parameters[key]=typeof input[key]==='string'?input[key].slice(0,200):input[key];
  const settings=object(input.seedanceSettings);
  for(const key of ['taskMode','generateAudio','watermark','outputFormat','draft','returnLastFrame'])if(['string','boolean'].includes(typeof settings[key]))parameters[key]=settings[key];
  return {generationId:row.id,taskId:row.providerTaskId||string(output.taskId)||string(output.providerTaskId),traceCode:string(output.trace_code??output.traceCode??output.trace_id),requestId:string(output.requestId??output.request_id),provider:string(provider.id),model:string(connection.model??provider.upstreamModelId??provider.upstreamModelIdAtSubmit??output.model,200),connectionName:string(connection.name,100),connectionId:string(connection.id,100),connectionRevision:typeof connection.revision==='number'?connection.revision:null,prompt:string(row.submittedPrompt??input.prompt,20000)||'',parameters,createdAt:row.createdAt instanceof Date?row.createdAt.toISOString():row.createdAt,status:row.status};
}
export type GenerationProvenance=ReturnType<typeof safeGenerationProvenance>;
export async function getAssetDetails(projectId:string,assetId:string){
  if(!await getActiveProject({projectId}))throw new Error('Project not found.');
  const asset=await getProjectAssetById({projectId,assetId});if(!asset)throw new Error('Asset does not belong to this project.');
  const metadata=object(asset.metadata),parentId=string(metadata.sourceAssetId,128);
  const parent=parentId&&parentId!==asset.id?await getProjectAssetById({projectId,assetId:parentId}):null;
  const ids=[asset.id,...(parent?[parent.id]:[])];
  const rows:Parameters<typeof safeGenerationProvenance>[0][]=await(await getDb()).select({id:generationHistory.id,providerTaskId:generationHistory.providerTaskId,input:generationHistory.input,output:generationHistory.output,submittedPrompt:generationHistory.submittedPrompt,createdAt:generationHistory.createdAt,status:generationHistory.status}).from(generationAssetLink).innerJoin(generationHistory,eq(generationHistory.id,generationAssetLink.generationId)).where(and(eq(generationHistory.projectId,projectId),inArray(generationAssetLink.assetId,ids),inArray(generationAssetLink.role,['output','thumbnail']))).orderBy(desc(generationHistory.createdAt)).limit(20);
  return {asset:{id:asset.id,type:asset.type,publicUrl:asset.publicUrl,filename:asset.filename,mimeType:asset.mimeType,sizeBytes:asset.sizeBytes,width:asset.width,height:asset.height,durationMs:asset.durationMs,source:asset.source,assetClass:asset.assetClass},localPath:asset.storageProvider==='local'?resolveLocalProjectAssetPath({objectKey:asset.objectKey}):null,operation:string(metadata.operation,100),derivedFrom:parent?{id:parent.id,name:parent.filename}:null,generations:[...new Map(rows.map(row=>[row.id,safeGenerationProvenance(row)])).values()]};
}
export type AssetDetails=Awaited<ReturnType<typeof getAssetDetails>>;
