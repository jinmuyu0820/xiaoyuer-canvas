import {useCallback,useEffect,useRef,useState,type MutableRefObject} from 'react';
import {toast} from 'sonner';
import {apiJsonPost} from '@/lib/api-client';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import type {CanvasCard,CanvasTextCard} from '@/core/beatcanvas/canvas-types';
import {isCanvasTextCard} from '@/core/beatcanvas/canvas-types';
import {canAcceptTextCandidate,retainTextVersion,textCandidateSchema} from '@/core/beatcanvas/text-contract';
type Actions={projectId:string;cardsRef:MutableRefObject<Record<string,CanvasCard>>;updateCard:(id:string,patch:Partial<CanvasCard>)=>void;checkpoint:()=>void;createTextCard:(input:{text?:string;name?:string;placementPoint?:{x:number;y:number}})=>string|null};
export function useCanvasTextActions({projectId,cardsRef,updateCard,checkpoint,createTextCard}:Actions){
  const t=useTranslations('CanvasTools');
  const requests=useRef(new Map<string,AbortController>());
  const [optimizingTextIds,setBusy]=useState<ReadonlySet<string>>(new Set());
  useEffect(()=>()=>{for(const request of requests.current.values())request.abort();requests.current.clear();},[projectId]);
  const updateText=useCallback((id:string,patch:Partial<CanvasTextCard>)=>{
    if(!isCanvasTextCard(cardsRef.current[id]))return;
    // Keep the UI edit boundary narrow, including for untrusted DOM events.
    updateCard(id,{...(patch.prompt!==undefined?{prompt:patch.prompt.slice(0,20000)}:{}),...(patch.name!==undefined?{name:patch.name.slice(0,100)||t('textNode')} :{}),...(patch.textInstruction!==undefined?{textInstruction:patch.textInstruction.slice(0,3000)}:{}),...(patch.connectionId!==undefined?{connectionId:patch.connectionId}:{}),error:null});
  },[cardsRef,t,updateCard]);
  const optimize=useCallback(async(id:string)=>{
    const card=cardsRef.current[id];if(!isCanvasTextCard(card)||!card.prompt.trim()||requests.current.has(id))return;
    const controller=new AbortController();requests.current.set(id,controller);setBusy(new Set(requests.current.keys()));updateCard(id,{error:null});
    try{
      const result=await apiJsonPost<{text:string;connection:{id:string;revision:number;name:string;model:string}}>('/api/text/optimize',{projectId,text:card.prompt,instruction:card.textInstruction||'',connectionId:card.connectionId||undefined},{signal:controller.signal});
      if(requests.current.get(id)!==controller||!isCanvasTextCard(cardsRef.current[id]))return;
      if(result.text.length>20000)throw new Error(t('textResultTooLong'));
      const candidate=textCandidateSchema.parse({text:result.text,sourceText:card.prompt,instruction:card.textInstruction||'',createdAt:new Date().toISOString(),connection:{id:result.connection.id,revision:result.connection.revision,name:result.connection.name,model:result.connection.model}});
      checkpoint();updateCard(id,{textCandidate:candidate,error:null});toast.success(t('suggestionReady'));
    }catch(error){if(!controller.signal.aborted&&isCanvasTextCard(cardsRef.current[id])){const message=error instanceof Error?error.message:t('optimizationFailed');updateCard(id,{error:message});toast.error(message);}}
    finally{if(requests.current.get(id)===controller){requests.current.delete(id);setBusy(new Set(requests.current.keys()));}}
  },[cardsRef,checkpoint,projectId,t,updateCard]);
  const accept=useCallback((id:string)=>{const card=cardsRef.current[id];if(!isCanvasTextCard(card)||!canAcceptTextCandidate(card.prompt,card.textCandidate))return;checkpoint();updateCard(id,{prompt:card.textCandidate!.text,textHistory:retainTextVersion(card.prompt,card.textHistory),textCandidate:null,error:null});},[cardsRef,checkpoint,updateCard]);
  const discard=useCallback((id:string)=>{if(!isCanvasTextCard(cardsRef.current[id]))return;checkpoint();updateCard(id,{textCandidate:null});},[cardsRef,checkpoint,updateCard]);
  const restore=useCallback((id:string,versionId:string)=>{const card=cardsRef.current[id];if(!isCanvasTextCard(card))return;const version=card.textHistory?.find(item=>item.id===versionId);if(!version)return;checkpoint();updateCard(id,{prompt:version.text,textHistory:retainTextVersion(card.prompt,card.textHistory?.filter(item=>item.id!==versionId)),textCandidate:null,error:null});},[cardsRef,checkpoint,updateCard]);
  const create=useCallback((placementPoint?:{x:number;y:number})=>{createTextCard({name:t('textNode'),placementPoint});},[createTextCard,t]);
  const candidateToNewCard=useCallback((id:string)=>{const card=cardsRef.current[id];if(isCanvasTextCard(card)&&card.textCandidate)createTextCard({text:card.textCandidate.text,name:t('optimizedText')});},[cardsRef,createTextCard,t]);
  return {optimizingTextIds,updateText,optimizeTextCard:optimize,acceptTextCandidate:accept,discardTextCandidate:discard,restoreTextVersion:restore,createTextNode:create,candidateToNewCard};
}
