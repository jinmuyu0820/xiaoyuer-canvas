import {z} from 'zod';
import {seedanceSettingsSchema,buildArkTaskRequest} from './ark-contract';
import type {ConnectionSnapshot} from '@/core/generation-providers/connection-contract';
export const configuredVideoInputSchema=z.object({
  connectionId:z.string().optional(),prompt:z.string().trim().min(1).max(20000),
  aspect_ratio:z.enum(['adaptive','16:9','21:9','4:3','1:1','3:4','9:16']).default('16:9'),
  wmDuration:z.string().regex(/^(?:-1|[2-9]|[12]\d|30)s$/).default('5s'),
  wmOutputQuality:z.enum(['480p','720p','768p','1080p','2k']).default('720p'),
  image_urls:z.array(z.string()).max(30).default([]),video_urls:z.array(z.string()).max(10).default([]),audio_urls:z.array(z.string()).max(10).default([]),
  seedanceSettings:seedanceSettingsSchema.optional(),wmWorkflowTemplateId:z.string().optional(),wmBatchIndex:z.number().int().optional(),wmBatchTotal:z.number().int().optional(),
}).strict();

export function buildConfiguredVideoRequest(source:unknown,profile:ConnectionSnapshot){
  if(profile.protocol==='ark-video')return buildArkTaskRequest(source,profile.model);
  const input=configuredVideoInputSchema.parse(source),settings=input.seedanceSettings;
  const mode=settings?.taskMode||'auto';
  if(['edit','extend','draft_final'].includes(mode)||settings?.draft||settings?.draftTaskId)throw new Error('This protocol does not implement Seedance edit, extension or draft tasks. Select auto, reference, first frame or first/last frame.');
  if(settings?.outputFormat==='mov'||settings?.priority)throw new Error('This protocol supports MP4 and does not accept Seedance priority.');
  const duration=parseInt(input.wmDuration,10),resolution=input.wmOutputQuality.toUpperCase();
  let frames=mode==='first_frame'||mode==='first_last_frame';
  const first=/@Image(\d+)\s+as\s+the\s+first\s+frame\b/i.exec(input.prompt);
  const last=/@Image(\d+)\s+as\s+the\s+last\s+frame\b/i.exec(input.prompt);
  if(mode==='auto'&&first)frames=true;
  let images=input.image_urls;
  if(frames){
    const count=mode==='first_last_frame'||last?2:1;
    if(images.length!==count||input.video_urls.length||input.audio_urls.length)throw new Error(`Frame generation requires ${count} images and no video/audio references.`);
    if(first){const a=Number(first[1])-1,b=last?Number(last[1])-1:null;if(!images[a]||b!==null&&(!images[b]||a===b))throw new Error('Invalid first/last frame reference number.');images=[images[a],...(b!==null?[images[b]]:[])];}
  }
  const media=[...images.map((url,index)=>({type:frames?(index?'last_frame':'first_frame'):'reference_image',url})),...input.video_urls.map(url=>({type:'reference_video',url})),...input.audio_urls.map(url=>({type:'reference_audio',url}))];
  if(profile.protocol==='wan-video'){
    if(!['480P','720P','1080P'].includes(resolution))throw new Error('Wan 3 supports 480p, 720p or 1080p.');
    if(images.length>10||input.video_urls.length>5||input.audio_urls.length>5)throw new Error('Wan 3 supports at most 10 images, 5 videos and 5 audio references.');
    return {model:profile.model,input:{prompt:input.prompt,...(media.length?{media}:{})},parameters:{resolution,ratio:frames?'adaptive':input.aspect_ratio,duration,audio:settings?.generateAudio??true,watermark:settings?.watermark??false}};
  }
  if(profile.protocol==='minimax-video-v2'){
    const max=/h3[-_]max/i.test(profile.model),min=max?5:4;
    if(duration<min||duration>15)throw new Error(`MiniMax H3${max?' Max':''} duration must be ${min}–15 integer seconds.`);
    if(!(max?['480P','768P']:['768P','2K']).includes(resolution))throw new Error(`MiniMax H3${max?' Max':''} resolution must be ${max?'480p or 768p':'768p or 2k'}.`);
    if(images.length>9||input.video_urls.length>3||input.audio_urls.length>3)throw new Error('MiniMax H3 supports at most 9 reference images, 3 videos and 3 audio references.');
    if(settings?.generateAudio===false||settings?.watermark===true)throw new Error('MiniMax H3 API does not expose these Seedance audio/watermark switches.');
    if(!media.length&&input.aspect_ratio==='adaptive')throw new Error('MiniMax H3 text-to-video requires a concrete aspect ratio.');
    return {model:profile.model,content:[{type:'text',text:input.prompt},...media.map(item=>({type:item.type.includes('frame')||item.type==='reference_image'?'image_url':item.type==='reference_video'?'video_url':'audio_url',role:item.type,[item.type.includes('frame')||item.type==='reference_image'?'image_url':item.type==='reference_video'?'video_url':'audio_url']:{url:item.url}}))],resolution,duration,ratio:frames?'adaptive':input.aspect_ratio};
  }
  if(profile.protocol==='minimax-video'){
    if(input.video_urls.length||input.audio_urls.length||images.length>2)throw new Error('MiniMax V1 accepts text or first/last images, not audio/video reference inputs. Use H3 V2 for multimodal references.');
    if(images.length&&mode==='reference')throw new Error('MiniMax V1 image input uses first/last frames, not generic references.');
    if(![6,10].includes(duration))throw new Error('MiniMax V1 duration must be 6 or 10 seconds.');
    if(input.aspect_ratio!=='adaptive')throw new Error('MiniMax V1 has no aspect-ratio parameter. Select adaptive; input frames determine the image-to-video ratio.');
    if(!['720P','768P','1080P'].includes(resolution)||duration===10&&resolution==='1080P')throw new Error('MiniMax V1 resolution must be 720p/768p/1080p; 10-second output cannot use 1080p. Model-specific limits are also enforced upstream.');
    if(settings?.generateAudio===false||settings?.watermark===true)throw new Error('MiniMax V1 does not expose Seedance audio/watermark switches.');
    return {model:profile.model,prompt:input.prompt,duration,resolution,...(images[0]?{first_frame_image:images[0]}:{}),...(images[1]?{last_frame_image:images[1]}:{})};
  }
  throw new Error('Unsupported video protocol.');
}
