import {BaseAdapter} from './base-adapter';
import {ArkAdapter} from './ark-adapter';
import {buildConfiguredVideoRequest} from './configured-video-contract';
import {PROTOCOLS,type ConnectionProfile,type ConnectionSnapshot} from '@/core/generation-providers/connection-contract';
import {requestConnection} from '@/core/generation-providers/connection-request';
import {isPublicHttpMediaUrl} from '@/core/effects/beatapi-media-url';

export async function submitConfiguredVideo(profile:ConnectionProfile,body:unknown,fetchImpl=fetch){
  let payload:Record<string,any>;
  try{payload=await requestConnection(profile,PROTOCOLS[profile.protocol].path,body,fetchImpl,profile.protocol==='wan-video'?{'X-DashScope-Async':'enable'}:{});}
  catch(error){
    if(error instanceof TypeError||error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))throw new Error('Video submission connection was interrupted. The provider may have accepted the task. Check its console before submitting again to avoid duplicate charges.');
    throw error;
  }
  const id=profile.protocol==='wan-video'?payload.output?.task_id:payload.task_id;
  if(typeof id!=='string'||!id)throw new Error('Video API returned no task ID. Check the provider console before trying again.');
  return {status:'pending' as const,output:{taskId:id,upstreamModelId:profile.model,requestId:payload.request_id}};
}
export async function queryConfiguredVideo(profile:ConnectionProfile,taskId:string,fetchImpl=fetch){
  if(!/^[\w-]{1,200}$/.test(taskId))throw new Error('Invalid task ID.');
  const path=profile.protocol==='wan-video'?`/tasks/${taskId}`:profile.protocol==='minimax-video-v2'?`/v2/query/video_generation/${taskId}`:`/v1/query/video_generation?task_id=${taskId}`;
  const payload=await requestConnection(profile,path,undefined,fetchImpl);
  const task=profile.protocol==='wan-video'?payload.output:profile.protocol==='minimax-video-v2'?payload.task:payload;
  const state=String(task?.task_status??task?.status??'').toLowerCase();
  const output={taskId,providerStatus:state,usage:payload.usage??task?.usage,requestId:payload.request_id,duration:task?.duration,resolution:task?.resolution,ratio:task?.ratio};
  if(['failed','fail','cancelled','canceled','expired','unknown'].includes(state))return {status:'failed' as const,output,error:String(task?.message??task?.error?.message??payload.message??`Video task ${state}`).replaceAll(profile.apiKey,'[redacted]').slice(0,600)};
  if(['succeeded','success'].includes(state)){
    let url=task.video_url??task.content?.url;
    if(profile.protocol==='minimax-video'){
      if(!/^[\w-]{1,200}$/.test(String(task.file_id??'')))throw new Error('MiniMax returned no valid file ID.');
      const file=await requestConnection(profile,`/v1/files/retrieve?file_id=${encodeURIComponent(task.file_id)}`,undefined,fetchImpl);
      url=file.file?.download_url;
    }
    if(typeof url!=='string'||!isPublicHttpMediaUrl(url))throw new Error('Video API returned no public download URL.');
    return {status:'succeeded' as const,output:{...output,result_url:url,video_url:url,...(task.file_id?{fileId:task.file_id}:{})}};
  }
  if(['pending','queued','queueing','preparing'].includes(state))return {status:'pending' as const,output};
  if(['running','processing'].includes(state))return {status:'processing' as const,output};
  throw new Error(`Video API returned an unknown task state: ${state.slice(0,60)}`);
}

export class ConfiguredVideoAdapter extends BaseAdapter{
  async createGeneration(source:unknown){
    const {_connection,...input}=source as Record<string,unknown>&{_connection?:ConnectionSnapshot};
    const {resolveConnection}=await import('@/core/generation-providers/connection-store');
    const profile=await resolveConnection('video',_connection?.id||String(input.connectionId||'')||undefined,_connection?.revision);
    if(profile.protocol==='ark-video')return new ArkAdapter(this.effect).createGeneration(source);
    // Validate before resolving any local media or sending the paid POST.
    buildConfiguredVideoRequest(input,profile);
    const {resolveArkInputMedia}=await import('@/core/generation-providers/ark-media');
    for(const [field,kind] of [['image_urls','image'],['video_urls','video'],['audio_urls','audio']] as const){
      if(Array.isArray(input[field]))input[field]=await Promise.all((input[field] as string[]).map(url=>resolveArkInputMedia(url,kind)));
    }
    const body=buildConfiguredVideoRequest(input,profile);
    if(Buffer.byteLength(JSON.stringify(body))>64*1024*1024)throw new Error('Video request exceeds 64 MB. Reduce reference files or use public object storage.');
    return submitConfiguredVideo(profile,body);
  }
  async checkStatus(taskId:string,context?:unknown){
    const snapshot=context as ConnectionSnapshot|undefined;
    // Legacy Seedance tasks predate connection snapshots.
    if(!snapshot||snapshot.protocol==='ark-video')return new ArkAdapter(this.effect).checkStatus(taskId,context);
    const {resolveConnection}=await import('@/core/generation-providers/connection-store');
    return queryConfiguredVideo(await resolveConnection('video',snapshot.id,snapshot.revision),taskId);
  }
}
