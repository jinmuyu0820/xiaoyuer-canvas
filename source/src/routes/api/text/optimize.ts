import { createFileRoute } from '@tanstack/react-router';
import { optimizeText } from '@/core/generation-providers/text-optimization';
import { getActiveProject } from '@/core/projects/projects';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit,MAX_WORKSPACE_JSON_REQUEST_BYTES } from '@/lib/request-body-limit';
async function POST({request}:{request:Request}){
  const trust=validateTrustedWorkspaceJsonMutation(request);if(!trust.ok)return Response.json({error:trust.message},{status:trust.status});
  try{
    const {projectId,...input}=await readRequestJsonWithLimit<Record<string,unknown>>(request,MAX_WORKSPACE_JSON_REQUEST_BYTES);
    if(typeof projectId!=='string'||!await getActiveProject({projectId}))return Response.json({error:'Project not found.'},{status:404});
    return Response.json(await optimizeText(input));
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Text optimization failed.'},{status:400});}
}
export const Route=createFileRoute('/api/text/optimize')({server:{handlers:{POST}}});
