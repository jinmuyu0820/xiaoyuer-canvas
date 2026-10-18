import { createFileRoute } from '@tanstack/react-router';
import { spawn } from 'node:child_process';
import { getActiveProject } from '@/core/projects/projects';
import { ensureProjectDirectories } from '@/core/projects/local-directories';
import { validateTrustedLocalJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, MAX_WORKSPACE_JSON_REQUEST_BYTES } from '@/lib/request-body-limit';
import {libraryCategorySchema} from '@/core/projects/library-contract';
import {assertLocalLibraryPath} from '@/core/projects/local-library';
import {getProjectAssetById} from '@/core/workspace-lib/assets/user-assets';
import {resolveLocalProjectAssetPath} from '@/core/projects/local-project-assets';
import {getLocalDirectories} from '@/core/projects/local-directories';
import {join} from 'node:path';
async function POST({ request, params }: { request: Request; params: { projectId: string } }) {
  const trust = validateTrustedLocalJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message },{status:trust.status});
  if (!await getActiveProject({ projectId: params.projectId })) return Response.json({error:'Project not found'},{status:404});
  try {
    const body = await readRequestJsonWithLimit<{ kind?: string; open?: boolean; category?:unknown;assetId?:unknown }>(request, MAX_WORKSPACE_JSON_REQUEST_BYTES);
    if (body.kind !== 'materials' && body.kind !== 'library') return Response.json({error:'Unknown project folder'},{status:400});
    const paths = await ensureProjectDirectories(params.projectId);
    let path = paths[body.kind],selectFile=false;
    if(body.kind==='library'&&body.category)path=await assertLocalLibraryPath(getLocalDirectories().assetLibrary,join(path,libraryCategorySchema.parse(body.category)));
    if(body.kind==='materials'&&body.assetId){if(typeof body.assetId!=='string')throw new Error('Invalid asset ID.');const asset=await getProjectAssetById({projectId:params.projectId,assetId:body.assetId});if(!asset||asset.storageProvider!=='local')throw new Error('Local asset not found in this project.');path=resolveLocalProjectAssetPath({objectKey:asset.objectKey});selectFile=true;}
    if (body.open !== false) {
      if (process.platform !== 'win32') return Response.json({error:'Folder opening is currently available on Windows.'},{status:400});
      const child = spawn('explorer.exe',[selectFile?`/select,${path}`:path],{windowsHide:true,stdio:'ignore'});
      await new Promise<void>((done,reject)=>{child.once('spawn',done);child.once('error',reject);});
      child.unref();
    }
    return Response.json({path});
  } catch (error) { return Response.json({error:error instanceof Error?error.message:'Could not open folder'},{status:400}); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/open-folder')({server:{handlers:{POST}}});
