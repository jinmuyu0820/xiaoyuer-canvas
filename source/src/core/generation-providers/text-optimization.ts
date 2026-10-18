import { z } from 'zod';
import { resolveConnection } from './connection-store';
import { requestConnection } from './connection-request';
import { connectionSnapshot,geminiGenerationPath,PROTOCOLS,type ConnectionProfile } from './connection-contract';
export const textOptimizationSchema=z.object({text:z.string().trim().min(1).max(20000),instruction:z.string().trim().max(3000).default(''),connectionId:z.string().optional(),maxOutputTokens:z.number().int().min(32).max(8192).default(2048)}).strict();
const system='Improve the supplied text while preserving its meaning. Follow the requested style. Return only the improved text, without commentary.';
export async function requestText(profile:ConnectionProfile,text:string,instruction='',maxOutputTokens=2048,fetchImpl=fetch){
  const user=instruction?`${instruction}\n\n${text}`:text;
  const messages=[{role:'system',content:system},{role:'user',content:user}];
  let response:Record<string,any>,result:unknown;
  if(profile.protocol==='gemini-text'){
    response=await requestConnection(profile,geminiGenerationPath(profile.model),{systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{maxOutputTokens}},fetchImpl);
    result=response.candidates?.[0]?.content?.parts?.filter((part:any)=>!part.thought&&typeof part.text==='string').map((part:any)=>part.text).join('');
  }else if(profile.protocol==='openai-responses'){
    response=await requestConnection(profile,'/responses',{model:profile.model,instructions:system,input:user,max_output_tokens:maxOutputTokens,store:false,stream:false},fetchImpl);
    result=response.output?.filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content||[]).filter((part:any)=>part.type==='output_text').map((part:any)=>part.text).join('');
  }else if(profile.protocol==='qwen-native-text'){
    response=await requestConnection(profile,PROTOCOLS[profile.protocol].path,{model:profile.model,input:{messages},parameters:{result_format:'message',max_tokens:maxOutputTokens,enable_thinking:false}},fetchImpl);
    result=response.output?.choices?.[0]?.message?.content??response.output?.text;
  }else{
    response=await requestConnection(profile,'/chat/completions',{
      model:profile.model,stream:false,messages,
      ...(profile.protocol==='openai-chat'?{max_completion_tokens:maxOutputTokens}:{max_tokens:maxOutputTokens}),
      ...(['deepseek-text','glm-text','doubao-text','kimi-text'].includes(profile.protocol)&&!profile.model.includes('-code')?{thinking:{type:'disabled'}}:{}),
      ...(profile.protocol==='qwen-text'?{enable_thinking:false}:{}),
    },fetchImpl);
    result=response.choices?.[0]?.message?.content;
    if(Array.isArray(result))result=result.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('');
  }
  if(response.status==='incomplete'||response.choices?.[0]?.finish_reason==='length'||response.candidates?.[0]?.finishReason==='MAX_TOKENS')throw new Error('Text output reached its token limit. Increase the output limit or shorten the input; a truncated rewrite will not be applied.');
  if(typeof result!=='string'||!result.trim())throw new Error('Text API returned no final text. Check model availability, safety filters and output token limit.');
  if(result.length>100000)throw new Error('Text result is too long.');
  return {text:result.trim(),usage:response.usage??response.usageMetadata};
}
export async function optimizeText(source:unknown){
  const input=textOptimizationSchema.parse(source);
  const profile=await resolveConnection('text',input.connectionId);
  return {...await requestText(profile,input.text,input.instruction,input.maxOutputTokens),connection:connectionSnapshot(profile)};
}
