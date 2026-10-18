import {z} from 'zod';
export const textModelSnapshotSchema=z.object({id:z.string().max(100),revision:z.number().int().positive(),name:z.string().max(100),model:z.string().max(200)}).strict();
export const textVersionSchema=z.object({id:z.string().max(200),text:z.string().max(20000),createdAt:z.string().max(80)}).strict();
export const textCandidateSchema=z.object({text:z.string().min(1).max(20000),sourceText:z.string().max(20000),instruction:z.string().max(3000),createdAt:z.string().max(80),connection:textModelSnapshotSchema}).strict();
export type TextCandidate=z.infer<typeof textCandidateSchema>;
export type TextVersion=z.infer<typeof textVersionSchema>;
export const TEXT_HISTORY_LIMIT=5;
export function retainTextVersion(text:string,history:TextVersion[]=[],now=new Date().toISOString(),id:string=crypto.randomUUID()):TextVersion[]{
  return [{id,text,createdAt:now},...history].slice(0,TEXT_HISTORY_LIMIT);
}
export function canAcceptTextCandidate(text:string,candidate?:TextCandidate|null){return !!candidate&&text===candidate.sourceText;}
