import {z} from 'zod';
export const libraryCategorySchema=z.enum(['人物','道具','场景','声音','视频']);
export type LibraryCategory=z.infer<typeof libraryCategorySchema>;
export const libraryCategories=libraryCategorySchema.options;
export const libraryCategoryKeys:Record<LibraryCategory,string>={'人物':'characters','道具':'props','场景':'scenes','声音':'sounds','视频':'videos'};
export function libraryFileAccept(category:LibraryCategory){return category==='声音'?'.mp3,.wav,.m4a,.aac,.ogg':category==='视频'?'.mp4,.mov,.webm':'.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm';}
export const libraryAnnotationSchema=z.object({name:z.string().trim().min(1).max(200),notes:z.string().max(3000).default(''),prompt:z.string().max(20000).default(''),tags:z.array(z.string().trim().min(1).max(40)).max(20).default([])}).strict();
export const libraryEntrySchema=libraryAnnotationSchema.extend({id:z.string().uuid(),assetId:z.string().regex(/^[\w-]{1,128}$/),category:libraryCategorySchema,filename:z.string().min(1).max(200).refine(name=>!/[\\/:\u0000-\u001f]/.test(name)&&!name.startsWith('.')&&!name.endsWith('.'),'Invalid library filename'),sha256:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string().max(80),updatedAt:z.string().max(80)}).strict();
export type LibraryEntry=z.infer<typeof libraryEntrySchema>;
export type LibraryMedia=LibraryEntry&{type:'image'|'video'|'audio';publicUrl:string;mimeType:string|null;sizeBytes:number|null;width:number|null;height:number|null;durationMs:number|null;missing:boolean};
export type LibraryDocument={projectId:string;root:string;entries:LibraryMedia[];counts:Record<LibraryCategory,number>};
export type ScanResult={added:number;updated:number;skipped:number;warnings:string[]};
export function categoryAcceptsMedia(category:LibraryCategory,type:string){return category==='声音'?type==='audio':category==='视频'?type==='video':type==='image'||type==='video';}
