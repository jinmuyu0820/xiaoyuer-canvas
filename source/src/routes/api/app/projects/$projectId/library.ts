import {createFileRoute} from '@tanstack/react-router';
import {addAssetToLocalLibrary,listLocalLibrary,scanLocalLibrary,updateLibraryAnnotation} from '@/core/projects/local-library';
import {validateTrustedWorkspaceJsonMutation} from '@/lib/trusted-local-request';
import {readRequestJsonWithLimit,MAX_WORKSPACE_JSON_REQUEST_BYTES} from '@/lib/request-body-limit';
async function GET({params}:{params:{projectId:string}}){try{return Response.json(await listLocalLibrary(params.projectId));}catch(error){return Response.json({error:error instanceof Error?error.message:'Cannot read library.'},{status:400});}}
async function POST({request,params}:{request:Request;params:{projectId:string}}){
  const trust=validateTrustedWorkspaceJsonMutation(request);if(!trust.ok)return Response.json({error:trust.message},{status:trust.status});
  try{const body=await readRequestJsonWithLimit<Record<string,unknown>>(request,MAX_WORKSPACE_JSON_REQUEST_BYTES);
    if(body.action==='add'&&typeof body.assetId==='string')return Response.json({entry:await addAssetToLocalLibrary(params.projectId,body.assetId,body.category)});
    if(body.action==='scan')return Response.json(await scanLocalLibrary(params.projectId,body.category));
    if(body.action==='annotate'&&typeof body.id==='string')return Response.json({entry:await updateLibraryAnnotation(params.projectId,body.id,body.annotation)});
    throw new Error('Unsupported library operation.');
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Library operation failed.'},{status:400});}
}
export const Route=createFileRoute('/api/app/projects/$projectId/library')({server:{handlers:{GET,POST}}});
