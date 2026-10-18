import { createFileRoute } from '@tanstack/react-router';
import { publicConnections,mutateConnections,resolveConnection } from '@/core/generation-providers/connection-store';
import { requestConnection } from '@/core/generation-providers/connection-request';
import { requestText,textOptimizationSchema } from '@/core/generation-providers/text-optimization';
import { respData,respErr } from '@/lib/resp';
import { validateTrustedLocalJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit,MAX_WORKSPACE_JSON_REQUEST_BYTES } from '@/lib/request-body-limit';
async function GET(){return respData(await publicConnections());}
async function POST({request}:{request:Request}){
  const trust=validateTrustedLocalJsonMutation(request);if(!trust.ok)return respErr(trust.message,trust.status);
  try{
    const body=await readRequestJsonWithLimit<Record<string,unknown>>(request,MAX_WORKSPACE_JSON_REQUEST_BYTES);
    if(body.action==='test-text'){
      if(typeof body.id!=='string')return respErr('A saved text connection is required.',400);
      const profile=await resolveConnection('text',body.id);
      const input=textOptimizationSchema.parse({text:body.text,instruction:body.instruction,maxOutputTokens:256});
      return respData(await requestText(profile,input.text,input.instruction,input.maxOutputTokens));
    }
    if(body.action==='test'){
      if(typeof body.id!=='string'||!['video','image','text'].includes(String(body.category)))return respErr('A saved model connection is required.',400);
      const profile=await resolveConnection(body.category as 'video'|'image'|'text',body.id);
      if(profile.demo)return respData({connected:true,demo:true});
      // These APIs have no documented universal non-billable model/task-list probe.
      // Do not manufacture a task or claim authentication succeeded from local validation.
      if(['wan-video','minimax-video','minimax-video-v2','doubao-text','glm-text','qwen-native-text'].includes(profile.protocol))return respData({connected:false,demo:false,checked:'configuration'});
      // Read-only checks never create an image/video or consume a generation slot.
      await requestConnection(profile,profile.protocol==='ark-video'?'/contents/generations/tasks?page_size=1':'/models');
      return respData({connected:true,demo:false});
    }
    if(!['save','delete','default'].includes(String(body.action)))return respErr('Unsupported configuration action.',400);
    const result=await mutateConnections({action:body.action as 'save'|'delete'|'default',id:typeof body.id==='string'?body.id:undefined,category:body.category as 'video'|'image'|'text',profile:body.profile as Record<string,unknown>});
    return respData(result);
  }catch(error){return respErr(error instanceof Error?error.message:'Could not update model connections.',400);}
}
export const Route=createFileRoute('/api/config/connections')({server:{handlers:{GET,POST}}});
