import { compatibleImageInputSchema } from './compatible-image-contract';
import { BaseAdapter } from './base-adapter';
import { resolveConnection } from '@/core/generation-providers/connection-store';
import { requestConnection } from '@/core/generation-providers/connection-request';
import { isPublicHttpMediaUrl } from '@/core/effects/beatapi-media-url';
import {geminiGenerationPath,type ConnectionSnapshot,type ConnectionProfile} from '@/core/generation-providers/connection-contract';

export function imageDataUrl(encoded:string){
  encoded=encoded.trim();
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('Image response contains invalid Base64.');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length>25*1024*1024)throw new Error('Generated image exceeds the local file limit.');
  const mime=bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':bytes[0]===0x89&&bytes.toString('ascii',1,4)==='PNG'?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!mime)throw new Error('Image response is not PNG, JPEG or WebP.');
  return `data:${mime};base64,${encoded}`;
}
export async function requestImage(profile:ConnectionProfile,prompt:string,fetchImpl=fetch){
  let payload:Record<string,any>,url:string;
  if(profile.protocol==='gemini-images'){
    // Native Gemini produces inlineData, not an OpenAI data[] array.
    payload=await requestConnection(profile,geminiGenerationPath(profile.model),{contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE'],...(profile.imageSize?{imageConfig:{imageSize:profile.imageSize}}:{})}},fetchImpl);
    const parts=payload.candidates?.[0]?.content?.parts||[];
    const item=parts.find((part:any)=>part.inlineData?.data&&!part.thought)?.inlineData;
    if(!item||!['image/png','image/jpeg','image/webp'].includes(item.mimeType))throw new Error('Gemini returned no supported image. Check that the selected model supports image generation and the prompt passes safety checks.');
    url=imageDataUrl(item.data);
  }else{
    payload=await requestConnection(profile,'/images/generations',{model:profile.model,prompt,n:1,...(profile.imageSize?{size:profile.imageSize}:{})},fetchImpl);
    const item=payload.data?.[0];
    if(typeof item?.b64_json==='string')url=imageDataUrl(item.b64_json);
    else if(typeof item?.url==='string'&&isPublicHttpMediaUrl(item.url))url=item.url;
    else throw new Error('Image API did not return data[0].url or data[0].b64_json.');
  }
  return {status:'succeeded' as const,output:{result_url:url,usage:payload.usage??payload.usageMetadata,model:profile.model}};
}

export class CompatibleImageAdapter extends BaseAdapter {
  async createGeneration(source:unknown){
    const {_connection,...input}=source as Record<string,unknown> & {_connection?:ConnectionSnapshot};
    const parsed=compatibleImageInputSchema.parse(input);
    const profile=await resolveConnection('image',_connection?.id||parsed.connectionId,_connection?.revision);
    return requestImage(profile,parsed.prompt);
  }
}
