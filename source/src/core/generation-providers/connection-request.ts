import { readResponseJsonWithLimit } from '@/lib/response-body-limit';
import { joinConnectionEndpoint,PROTOCOLS,type ConnectionProfile } from './connection-contract';
export async function requestConnection(profile:ConnectionProfile,path:string,body?:unknown,fetchImpl=fetch,extraHeaders:Record<string,string>={}) {
  if(!profile.apiKey)throw new Error('This connection has no API Key. Configure it in Settings first.');
  const response=await fetchImpl(joinConnectionEndpoint(profile.baseUrl,path),{
    method:body?'POST':'GET',headers:{...(PROTOCOLS[profile.protocol].auth==='google'?{'x-goog-api-key':profile.apiKey}:{Authorization:`Bearer ${profile.apiKey}`}),...extraHeaders,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(body?120000:30000),
  });
  const payload=await readResponseJsonWithLimit(response,48*1024*1024) as Record<string,any>|null;
  if(!response.ok||payload?.base_resp?.status_code&&payload.base_resp.status_code!==0||payload?.code&&payload?.message){const message=String(payload?.error?.message||payload?.base_resp?.status_msg||payload?.message||`Model request failed (HTTP ${response.status}).`).replaceAll(profile.apiKey,'[redacted]');throw new Error(message.slice(0,600));}
  if(!payload||typeof payload!=='object')throw new Error('The model returned an invalid response.');
  return payload;
}
