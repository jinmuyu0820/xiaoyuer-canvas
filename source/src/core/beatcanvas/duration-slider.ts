import type {WorkspaceDuration} from '@/core/effects/workspace-models';
export function integerDurationOptions(values:readonly WorkspaceDuration[]){return [...new Set(values.map(value=>Math.round(parseFloat(value))).filter(value=>Number.isFinite(value)&&value>0))].sort((a,b)=>a-b);}
export function nearestDurationIndex(values:number[],current:WorkspaceDuration){const seconds=Math.round(parseFloat(current));return values.reduce((best,value,index)=>Math.abs(value-seconds)<Math.abs(values[best]-seconds)?index:best,0);}
export function durationAtSliderIndex(values:number[],value:number):WorkspaceDuration{return `${values[Math.max(0,Math.min(values.length-1,Math.round(value)))]??5}s`;}
