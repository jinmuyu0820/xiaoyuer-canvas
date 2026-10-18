import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import {extname,isAbsolute,join,relative,resolve} from 'node:path';
import JSZip from 'jszip';
import {getBeatDesignDataRoot} from '@/config/data-root';
import {getProjectAssetById} from '@/core/workspace-lib/assets/user-assets';
import {getAssetDetails} from './asset-provenance';
import {
  assertExportAssetCount,
  MAX_EXPORT_ASSETS_PER_REQUEST,
  MAX_ZIP_TOTAL_BYTES,
} from './batch-export-limits';
import {getLocalDirectories,validateDirectoryRoot} from './local-directories';
import {resolveLocalProjectAssetPath,sanitizeLocalProjectAssetFilename} from './local-project-assets';
import {getActiveProject, loadProjectWithLatestSnapshot} from './projects';

export { MAX_EXPORT_ASSETS_PER_REQUEST, MAX_ZIP_TOTAL_BYTES };
export type BatchExportMode='folder'|'zip';
export type ExportItemResult={assetId:string;ok:true;file:string;entry?:string;metadataFile:string|null;warning?:string}|{assetId:string;ok:false;error:string};
export type BatchExportResult={target:string;mode:BatchExportMode;zipFile?:string;results:ExportItemResult[]};

const inside=(root:string,path:string)=>{const part=relative(resolve(root),resolve(path));return !part||(!part.startsWith('..')&&!isAbsolute(part));};
const exists=(path:string)=>lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});

export async function resolveExportTarget(value:string){
  const target=validateDirectoryRoot(value);
  const roots=getLocalDirectories();
  // The configured export folder defaults to data/exports, so it is allowed even though it sits inside the data root.
  const managed=inside(roots.exports,target)?[roots.projectAssets,roots.assetLibrary]:[roots.projectAssets,roots.assetLibrary,getBeatDesignDataRoot()];
  for(const root of managed){
    if(inside(root,target)||inside(target,root))throw new Error('Choose an export folder outside the app data, project material and library folders.');
  }
  await mkdir(target,{recursive:true});
  const info=await lstat(target);
  if(info.isSymbolicLink()||!info.isDirectory())throw new Error('The export target must be a regular folder.');
  return target;
}

async function copyWithoutOverwrite(source:string,target:string,filename:string,withMetadata:boolean){
  const extension=extname(filename),stem=filename.slice(0,filename.length-extension.length)||'asset';
  for(let index=1;index<=999;index++){
    const base=index===1?stem:`${stem} (${index})`;
    const file=join(target,`${base}${extension}`),metadata=join(target,`${base}.seedance.json`);
    if(await exists(file)||(withMetadata&&await exists(metadata)))continue;
    try{await copyFile(source,file,constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')continue;throw error;}
    return {file,metadata:withMetadata?metadata:null};
  }
  throw new Error('Too many files with the same name in the export folder.');
}

const uniqueZipEntry=(used:Set<string>,filename:string)=>{
  const extension=extname(filename),stem=filename.slice(0,filename.length-extension.length)||'asset';
  for(let index=1;index<=999;index++){
    const candidate=index===1?filename:`${stem} (${index})${extension}`;
    if(!used.has(candidate.toLowerCase())){used.add(candidate.toLowerCase());return candidate;}
  }
  throw new Error('Too many files with the same name in the export archive.');
};

const uniqueFileInFolder=async(target:string,filename:string)=>{
  const extension=extname(filename),stem=filename.slice(0,filename.length-extension.length)||'asset';
  for(let index=1;index<=999;index++){
    const candidate=join(target,`${index===1?stem:`${stem} (${index})`}${extension}`);
    if(!await lstat(candidate).then(()=>true,()=>false))return candidate;
  }
  throw new Error('Too many files with the same name in the export folder.');
};

const exportTimestamp=()=>new Date().toISOString().replace(/[-:]/g,'').replace(/\..*/,'').replace('T','');

const running=new Set<string>();
export async function exportProjectAssets({projectId,assetIds,target:requestedTarget,includeMetadata,mode='folder'}:{projectId:string;assetIds:unknown;target:unknown;includeMetadata:boolean;mode?:BatchExportMode}):Promise<BatchExportResult>{
  if(!Array.isArray(assetIds)||!assetIds.every(id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id)))throw new Error('Select asset IDs: every ID must be a string of letters, digits, dashes or underscores.');
  assertExportAssetCount(Array.isArray(assetIds) ? assetIds.length : 0);
  if(typeof requestedTarget!=='string')throw new Error('An export folder is required.');
  const project=await getActiveProject({projectId});
  if(!project)throw new Error('Project not found.');
  const target=await resolveExportTarget(requestedTarget);
  const key=target.toLowerCase();
  if(running.has(key))throw new Error('Another export into this folder is still running.');
  running.add(key);

  const ids=[...new Set(assetIds as string[])];
  // A single asset is just a file: provenance JSON only makes sense for a batch.
  const writeMetadata=includeMetadata&&ids.length>1;
  const exportMode:BatchExportMode=mode==='zip'&&ids.length>1?'zip':'folder';

  // Load the canvas snapshot so an export can reuse the node's custom filename.
  // Snapshot cards are the source of truth: they persist `customFilename` and
  // carry the assetId the node points at.
  const projectData = await loadProjectWithLatestSnapshot({projectId});
  const customFilenameMap = new Map<string, string>();
  for (const card of projectData?.snapshot.cards ?? []) {
    const customFilename = card.customFilename;
    if (
      card.assetId &&
      typeof customFilename === 'string' &&
      customFilename.trim()
    ) {
      customFilenameMap.set(card.assetId, customFilename.trim());
    }
  }

  try{
    if(exportMode==='zip'){
      const zip=new JSZip();
      const used=new Set<string>();
      const results:ExportItemResult[]=[];
      let totalBytes=0;
      for(const assetId of ids){
        try{
          const asset=await getProjectAssetById({projectId,assetId});
          if(!asset||asset.storageProvider!=='local')throw new Error('Asset is not a local file in this project.');
          const source=resolveLocalProjectAssetPath({objectKey:asset.objectKey});
          const info=await lstat(source).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
          if(!info?.isFile())throw new Error('Source file is missing from the project folder.');
          totalBytes+=info.size;
          if(totalBytes>MAX_ZIP_TOTAL_BYTES)throw new Error('The selection exceeds the 1 GB archive limit; export in smaller batches.');

          const baseName=customFilenameMap.get(assetId)||asset.filename||'asset';
          const filename=sanitizeLocalProjectAssetFilename({filename:baseName,mimeType:asset.mimeType||''});
          const entry=uniqueZipEntry(used,filename);
          zip.file(entry,await readFile(source));

          let metadataEntry:string|null=null,warning:string|undefined;
          if(writeMetadata){
            try{
              const details=await getAssetDetails(projectId,assetId);
              const document={exportedAt:new Date().toISOString(),project:{id:project.id,name:project.name},asset:details.asset,exportedFile:entry,sourcePath:details.localPath,operation:details.operation,derivedFrom:details.derivedFrom,generations:details.generations};
              const extension=extname(entry);
              metadataEntry=`${entry.slice(0,entry.length-extension.length)}.seedance.json`;
              zip.file(metadataEntry,JSON.stringify(document,null,2));
            }catch(error){warning=error instanceof Error?error.message:'Metadata could not be written.';}
          }
          results.push({assetId,ok:true,file:'',entry,metadataFile:metadataEntry,...(warning?{warning}:{})});
        }catch(error){results.push({assetId,ok:false,error:error instanceof Error?error.message:'Export failed.'});}
      }

      const exportedOk=results.filter(result=>result.ok);
      if(!exportedOk.length)return {target,mode:'zip',results};

      const archiveName=sanitizeLocalProjectAssetFilename({filename:`${project.name}-导出-${exportTimestamp()}.zip`,mimeType:''});
      const zipPath=await uniqueFileInFolder(target,archiveName);
      const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
      await writeFile(zipPath,bytes,{flag:'wx'});
      return {target,mode:'zip',zipFile:zipPath,results:results.map(result=>result.ok?{...result,file:zipPath}:result)};
    }

    const results:ExportItemResult[]=[];
    for(const assetId of ids){
      try{
        const asset=await getProjectAssetById({projectId,assetId});
        if(!asset||asset.storageProvider!=='local')throw new Error('Asset is not a local file in this project.');
        const source=resolveLocalProjectAssetPath({objectKey:asset.objectKey});
        const info=await lstat(source).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(!info?.isFile())throw new Error('Source file is missing from the project folder.');

        // Use customFilename if available, otherwise fall back to asset.filename
        const baseName = customFilenameMap.get(assetId) || asset.filename || 'asset';
        const filename=sanitizeLocalProjectAssetFilename({filename:baseName,mimeType:asset.mimeType||''});
        const written=await copyWithoutOverwrite(source,target,filename,writeMetadata);
        let metadataFile:string|null=null,warning:string|undefined;
        if(written.metadata){
          // The media copy already succeeded; a metadata failure must not make a retry duplicate it.
          try{
            const details=await getAssetDetails(projectId,assetId);
            const document={exportedAt:new Date().toISOString(),project:{id:project.id,name:project.name},asset:details.asset,exportedFile:written.file,sourcePath:details.localPath,operation:details.operation,derivedFrom:details.derivedFrom,generations:details.generations};
            await writeFile(written.metadata,JSON.stringify(document,null,2),{flag:'wx'});
            metadataFile=written.metadata;
          }catch(error){warning=error instanceof Error?error.message:'Metadata could not be written.';}
        }
        results.push({assetId,ok:true,file:written.file,metadataFile,...(warning?{warning}:{})});
      }catch(error){results.push({assetId,ok:false,error:error instanceof Error?error.message:'Export failed.'});}
    }
    return {target,mode:'folder',results};
  }finally{running.delete(key);}
}
