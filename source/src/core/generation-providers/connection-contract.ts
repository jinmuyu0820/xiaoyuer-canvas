import { z } from 'zod';

export const connectionCategorySchema = z.enum(['video','image','text']);
export const connectionProtocolSchema = z.enum(['ark-video','wan-video','minimax-video','minimax-video-v2','compatible-images','gpt-images','gemini-images','chat-completions','openai-chat','openai-responses','gemini-text','doubao-text','kimi-text','glm-text','deepseek-text','qwen-text','qwen-native-text']);
export type ConnectionCategory = z.infer<typeof connectionCategorySchema>;
export type ConnectionProtocol = z.infer<typeof connectionProtocolSchema>;
export const connectionProfileSchema = z.object({
  id:z.string().regex(/^[\w-]{1,100}$/),
  revision:z.number().int().positive(),
  name:z.string().trim().min(1).max(100),
  category:connectionCategorySchema,
  protocol:connectionProtocolSchema,
  baseUrl:z.string().trim().url().max(2000),
  model:z.string().trim().min(1).max(200),
  apiKey:z.string().trim().max(4000),
  demo:z.boolean().default(false),
  imageSize:z.string().trim().max(60).default(''),
}).strict();
export type ConnectionProfile=z.infer<typeof connectionProfileSchema>;
export type PublicConnectionProfile=Omit<ConnectionProfile,'apiKey'> & {apiKeyConfigured:boolean;apiKeyPreview:string;isDefault:boolean};
export type ConnectionSnapshot=Omit<ConnectionProfile,'apiKey'>;
export type PublicConnections={profiles:PublicConnectionProfile[];defaults:Partial<Record<ConnectionCategory,string>>};

export function validateConnectionProfile(value:unknown) {
  const profile=connectionProfileSchema.parse(value);
  if(/[\r\n]/.test(profile.apiKey))throw new Error('API Key must be a single line.');
  if(!PROTOCOLS[profile.protocol].categories.includes(profile.category))throw new Error('The protocol does not support this model category.');
  const url=new URL(profile.baseUrl);
  if(url.username||url.password||url.search||url.hash)throw new Error('Base URL cannot contain credentials, query parameters or fragments.');
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('Use HTTPS, or HTTP for a local loopback service.');
  profile.baseUrl=profile.baseUrl.replace(/\/+$/,'');
  if(profile.demo&&profile.protocol!=='ark-video')throw new Error('Demo mode is available only for Seedance video.');
  return profile;
}

// Protocols are code-owned; endpoint, credentials and model remain user-owned.
export const PROTOCOLS:Record<ConnectionProtocol,{categories:ConnectionCategory[];path:string;auth:'bearer'|'google'}>={
  'ark-video':{categories:['video'],path:'/contents/generations/tasks',auth:'bearer'},
  'wan-video':{categories:['video'],path:'/services/aigc/video-generation/video-synthesis',auth:'bearer'},
  'minimax-video':{categories:['video'],path:'/v1/video_generation',auth:'bearer'},
  'minimax-video-v2':{categories:['video'],path:'/v2/video_generation',auth:'bearer'},
  'compatible-images':{categories:['image'],path:'/images/generations',auth:'bearer'},
  'gpt-images':{categories:['image'],path:'/images/generations',auth:'bearer'},
  'gemini-images':{categories:['image'],path:'/models',auth:'google'},
  'chat-completions':{categories:['text'],path:'/chat/completions',auth:'bearer'},
  'openai-chat':{categories:['text'],path:'/chat/completions',auth:'bearer'},
  'openai-responses':{categories:['text'],path:'/responses',auth:'bearer'},
  'gemini-text':{categories:['text'],path:'/models',auth:'google'},
  'doubao-text':{categories:['text'],path:'/chat/completions',auth:'bearer'},
  'kimi-text':{categories:['text'],path:'/chat/completions',auth:'bearer'},
  'glm-text':{categories:['text'],path:'/chat/completions',auth:'bearer'},
  'deepseek-text':{categories:['text'],path:'/chat/completions',auth:'bearer'},
  'qwen-text':{categories:['text'],path:'/chat/completions',auth:'bearer'},
  'qwen-native-text':{categories:['text'],path:'/services/aigc/text-generation/generation',auth:'bearer'},
};
export function protocolsForCategory(category:ConnectionCategory){return connectionProtocolSchema.options.filter(id=>PROTOCOLS[id].categories.includes(category));}
export function geminiGenerationPath(model:string){return `/models/${encodeURIComponent(model.replace(/^models\//,''))}:generateContent`;}

export function connectionSnapshot(profile:ConnectionProfile):ConnectionSnapshot {
  const {apiKey:_key,...safe}=profile;
  return safe;
}
export function joinConnectionEndpoint(baseUrl:string,path:string) {
  const base=baseUrl.replace(/\/+$/,'');
  if(base.endsWith(path))return base;
  const version=/^\/(v[12])\//.exec(path)?.[1];
  return `${version&&base.endsWith(`/${version}`)?base.slice(0,-version.length-1):base}${path}`;
}
