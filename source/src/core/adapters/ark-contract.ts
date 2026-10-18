import { z } from 'zod';
import { isPublicHttpMediaUrl } from '@/core/effects/beatapi-media-url';

export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const ARK_DEFAULT_MODEL = 'doubao-seedance-2-5-260628';

export const seedanceSettingsSchema = z.object({
  taskMode: z.enum(['auto', 'reference', 'first_frame', 'first_last_frame', 'edit', 'extend', 'draft_final']).default('auto'),
  generateAudio: z.boolean().default(true),
  watermark: z.boolean().default(false),
  returnLastFrame: z.boolean().default(true),
  draft: z.boolean().default(false),
  outputFormat: z.enum(['mp4', 'mov']).default('mp4'),
  draftTaskId: z.string().trim().max(200).default(''),
  priority: z.number().int().min(0).max(9).default(0),
}).strict();

export type SeedanceSettings = z.infer<typeof seedanceSettingsSchema>;
export const DEFAULT_SEEDANCE_SETTINGS = seedanceSettingsSchema.parse({});

const inputSchema = z.object({
  connectionId:z.string().optional(),
  prompt: z.string().max(20_000),
  aspect_ratio: z.enum(['adaptive', '16:9', '21:9', '4:3', '1:1', '3:4', '9:16']).default('adaptive'),
  wmDuration: z.string().regex(/^(?:-1|[4-9]|[12]\d|30)s$/).default('5s'),
  wmOutputQuality: z.enum(['480p', '720p', '1080p']).default('720p'),
  image_urls: z.array(z.string()).max(30).default([]),
  video_urls: z.array(z.string()).max(10).default([]),
  audio_urls: z.array(z.string()).max(10).default([]),
  seedanceSettings: seedanceSettingsSchema.optional(),
  wmWorkflowTemplateId: z.string().optional(),
  wmBatchIndex: z.number().int().optional(),
  wmBatchTotal: z.number().int().optional(),
}).strict();

export function buildArkTaskRequest(input: unknown, model = ARK_DEFAULT_MODEL) {
  const parsed = inputSchema.parse(input);
  const settings = parsed.seedanceSettings ?? DEFAULT_SEEDANCE_SETTINGS;
  const { image_urls: images, video_urls: videos, audio_urls: audios } = parsed;
  if (settings.taskMode === 'draft_final') {
    if (!settings.draftTaskId) throw new Error('请填写成功的样片任务 ID。');
    if (images.length || videos.length || audios.length) throw new Error('样片转正式视频不能附加参考素材。');
    return { model, content: [{ type: 'draft_task', draft_task: { id: settings.draftTaskId } }], output_format: settings.outputFormat, watermark: settings.watermark, return_last_frame: settings.returnLastFrame, priority: settings.priority };
  }
  let mode = settings.taskMode;
  // Preserve BeatDesign tail-frame continuation directives when mode is auto.
  const first = /@Image(\d+)\s+as\s+the\s+first\s+frame\b/i.exec(parsed.prompt);
  const last = /@Image(\d+)\s+as\s+the\s+last\s+frame\b/i.exec(parsed.prompt);
  if (mode === 'auto' && first) mode = last ? 'first_last_frame' : 'first_frame';
  const frames = mode === 'first_frame' || mode === 'first_last_frame';
  if (frames) {
    const count = mode === 'first_frame' ? 1 : 2;
    if (images.length !== count || videos.length || audios.length) throw new Error(`首尾帧模式需要 ${count} 张图片，不能混用视频或音频参考。`);
  }
  if ((mode === 'edit' || mode === 'extend') && !videos.length) throw new Error('编辑或延长需要至少一个参考视频。');
  if (!parsed.prompt.trim() && !images.length && !videos.length && !audios.length) throw new Error('请填写提示词或添加参考素材。');
  if (settings.draft && parsed.wmOutputQuality !== '480p') throw new Error('样片模式仅支持 480p，请调整分辨率。');
  const content: Record<string, unknown>[] = [];
  if (parsed.prompt.trim()) content.push({ type: 'text', text: parsed.prompt.trim() });
  const frameImages = [...images];
  if (frames && first) {
    const firstIndex = Number(first[1]) - 1;
    const lastIndex = last ? Number(last[1]) - 1 : null;
    if (!images[firstIndex] || (lastIndex !== null && (!images[lastIndex] || firstIndex === lastIndex))) throw new Error('提示词中的首尾帧图片编号无效。');
    frameImages.splice(0, frameImages.length, images[firstIndex], ...(lastIndex !== null ? [images[lastIndex]] : []));
  }
  frameImages.forEach((url, index) => content.push({ type: 'image_url', image_url: { url }, role: frames ? (index === 0 ? 'first_frame' : 'last_frame') : 'reference_image' }));
  videos.forEach((url) => content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' }));
  audios.forEach((url) => content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' }));
  return {
    model, content,
    resolution: parsed.wmOutputQuality,
    ratio: frames || mode === 'edit' || mode === 'extend' ? 'adaptive' : parsed.aspect_ratio,
    duration: mode === 'edit' ? -1 : Number.parseInt(parsed.wmDuration, 10),
    generate_audio: settings.generateAudio,
    watermark: settings.watermark,
    return_last_frame: settings.returnLastFrame,
    draft: settings.draft,
    output_format: settings.outputFormat,
    priority: settings.priority,
    ...(['reference', 'edit', 'extend'].includes(mode) ? { omni_reference_task_type: mode } : {}),
  };
}

export function isArkOutputUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['.volces.com', '.ivolces.com', '.volccdn.com', '.volcengine.com', '.byteimg.com', '.ibytedtos.com', '.toscdn.com'].some((suffix) => url.hostname.endsWith(suffix));
  } catch { return false; }
}

// Preserve optional identifiers when supplied by Ark/same-protocol services.
// This is deliberately not an embedded MP4 watermark decoder.
export function arkTaskProvenance(task:Record<string,any>,apiKey?:string){
  const safe=(value:unknown)=>typeof value==='string'&&value.trim()&&value.length<=500&&(!apiKey||!value.includes(apiKey))?value:null;
  const requestId=safe(task.request_id??task.requestId),traceCode=safe(task.trace_code??task.traceCode??task.trace_id??task.content?.trace_code);
  return {...(requestId?{requestId}:{}),...(traceCode?{traceCode}:{})};
}
export function normalizeArkTask(task: Record<string, any>,allowPublicOutput=false,apiKey?:string) {
  const output = { taskId: task.id, providerStatus: task.status, usage: task.usage, duration: task.duration, resolution: task.resolution, ratio: task.ratio,...arkTaskProvenance(task,apiKey) };
  if (task.status === 'succeeded') {
    const url = task.content?.video_url;
    const approved=(url:string)=>allowPublicOutput?isPublicHttpMediaUrl(url):isArkOutputUrl(url);
    if (typeof url !== 'string' || !approved(url)) throw new Error('方舟没有返回可下载的视频地址。');
    const tail = task.content?.last_frame_url;
    if (tail && (typeof tail !== 'string' || !approved(tail))) throw new Error('方舟尾帧地址无效。');
    return { status: 'succeeded' as const, output: { ...output, result_url: url, video_url: url, ...(tail ? { cover_url: tail, last_frame_url: tail } : {}) } };
  }
  if (['failed', 'expired', 'cancelled'].includes(task.status)) return { status: 'failed' as const, error: task.error?.message || `方舟任务状态：${task.status}`, output };
  if (!['queued', 'running'].includes(task.status)) throw new Error('方舟返回了未知任务状态。');
  return { status: task.status === 'queued' ? 'pending' as const : 'processing' as const, output };
}
