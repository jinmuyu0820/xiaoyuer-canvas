import {createFileRoute} from '@tanstack/react-router';
import {scanProjectMaterialFolder} from '@/core/projects/material-folder-import';
import {validateTrustedWorkspaceJsonMutation} from '@/lib/trusted-local-request';
import {readRequestJsonWithLimit,MAX_WORKSPACE_JSON_REQUEST_BYTES} from '@/lib/request-body-limit';
async function POST({request,params}:{request:Request;params:{projectId:string}}){const trust=validateTrustedWorkspaceJsonMutation(request);if(!trust.ok)return Response.json({error:trust.message},{status:trust.status});try{const body=await readRequestJsonWithLimit<Record<string,unknown>>(request,MAX_WORKSPACE_JSON_REQUEST_BYTES);if(body.action!=='scan')throw new Error('Unsupported material folder operation.');return Response.json(await scanProjectMaterialFolder(params.projectId));}catch(error){return Response.json({error:error instanceof Error?error.message:'Cannot scan material folder.'},{status:400});}}
export const Route=createFileRoute('/api/app/projects/$projectId/materials')({server:{handlers:{POST}}});
