import {createFileRoute} from '@tanstack/react-router';
import {spawn} from 'node:child_process';
import {access,constants} from 'node:fs/promises';
import {exportProjectAssets,resolveExportTarget} from '@/core/projects/batch-export';
import {getLocalDirectories} from '@/core/projects/local-directories';
import {getActiveProject} from '@/core/projects/projects';
import {validateTrustedLocalJsonMutation} from '@/lib/trusted-local-request';
import {readRequestJsonWithLimit,MAX_WORKSPACE_JSON_REQUEST_BYTES} from '@/lib/request-body-limit';

async function GET({params}:{params:{projectId:string}}){
  if(!await getActiveProject({projectId:params.projectId}))return Response.json({error:'Project not found'},{status:404});
  return Response.json({defaultTarget:getLocalDirectories().exports});
}

async function POST({request,params}:{request:Request;params:{projectId:string}}){
  const trust=validateTrustedLocalJsonMutation(request);
  if(!trust.ok)return Response.json({error:trust.message},{status:trust.status});
  try{
    const body=await readRequestJsonWithLimit<Record<string,unknown>>(request,MAX_WORKSPACE_JSON_REQUEST_BYTES);
    if(body.action==='select-folder'){
      if(!await getActiveProject({projectId:params.projectId}))return Response.json({error:'Project not found'},{status:404});
      if(process.platform!=='win32')return Response.json({error:'Folder selection is currently available on Windows.'},{status:400});
      const current=typeof body.current==='string'&&body.current.trim()?body.current.trim():getLocalDirectories().exports;
      let initialFolder=current;
      try{await access(current,constants.R_OK);await access(current,constants.W_OK);}catch{initialFolder=getLocalDirectories().exports;}
      const ps=spawn('powershell.exe',['-NoProfile','-Command',`
        Add-Type -AssemblyName System.Windows.Forms;
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog;
        $dialog.Description = 'Select export folder';
        $dialog.SelectedPath = '${initialFolder.replaceAll("'","''")}';
        $dialog.ShowNewFolderButton = $true;
        if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){
          Write-Output $dialog.SelectedPath
        }
      `.trim()],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      const chunks:Buffer[]=[];
      ps.stdout?.on('data',(chunk:Buffer)=>chunks.push(chunk));
      const code=await new Promise<number|null>(done=>ps.once('close',done));
      if(code!==0)throw new Error('Folder selection was cancelled or failed.');
      const selected=Buffer.concat(chunks).toString('utf8').trim();
      if(!selected)throw new Error('No folder was selected.');
      return Response.json({selected});
    }
    if(body.action==='open'){
      if(!await getActiveProject({projectId:params.projectId}))return Response.json({error:'Project not found'},{status:404});
      if(typeof body.target!=='string')throw new Error('An export folder is required.');
      if(process.platform!=='win32')return Response.json({error:'Folder opening is currently available on Windows.'},{status:400});
      const target=await resolveExportTarget(body.target);
      const child=spawn('explorer.exe',[target],{windowsHide:true,stdio:'ignore'});
      await new Promise<void>((done,reject)=>{child.once('spawn',done);child.once('error',reject);});
      child.unref();
      return Response.json({target});
    }
    if(body.action!=='export')throw new Error('Unsupported export operation.');
    return Response.json(await exportProjectAssets({projectId:params.projectId,assetIds:body.assetIds,target:body.target,includeMetadata:body.includeMetadata===true,mode:body.mode==='zip'?'zip':'folder'}));
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Export failed.'},{status:400});}
}

export const Route=createFileRoute('/api/app/projects/$projectId/export')({server:{handlers:{GET,POST}}});
