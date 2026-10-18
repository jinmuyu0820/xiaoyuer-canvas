import {lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {and,eq} from 'drizzle-orm';
import {getDb} from '@/core/workspace-lib/db-adapter';
import {projectAssetMembership,userAsset} from '@/config/db/schema';
import {getLocalDirectories,ensureProjectDirectories} from './local-directories';
import {assertLocalLibraryPath} from './local-library';
import {getActiveProject} from './projects';
import {hashFileSha256} from './local-file-utils';
import {importLocalProjectAsset,validateLocalAssetImportCandidate} from './import-local-asset';
import type {ScanResult} from './library-contract';
const running=new Set<string>();
export async function scanProjectMaterialFolder(projectId:string):Promise<ScanResult>{
  if(running.has(projectId))throw new Error('A material folder scan is already running.');
  if(!await getActiveProject({projectId}))throw new Error('Project not found.');
  running.add(projectId);
  try{
    const configured=getLocalDirectories();await assertLocalLibraryPath(configured.projectAssets,join(configured.projectAssets,projectId));
    const {materials}=await ensureProjectDirectories(projectId);
    const rows:{assetId:string;objectKey:string;sha256:string|null}[]=await(await getDb()).selectDistinct({assetId:userAsset.id,objectKey:userAsset.objectKey,sha256:userAsset.sha256}).from(userAsset).innerJoin(projectAssetMembership,eq(projectAssetMembership.assetId,userAsset.id)).where(eq(projectAssetMembership.projectId,projectId));
    const managed=new Set(rows.map(row=>row.assetId)),hashes=new Set(rows.map(row=>row.sha256).filter(Boolean));
    const result:ScanResult={added:0,updated:0,skipped:0,warnings:[]};
    let visited=0;
    const scan=async(folder:string,depth:number)=>{
      await assertLocalLibraryPath(configured.projectAssets,folder);
      for(const file of await readdir(folder,{withFileTypes:true})){
        if(++visited>1500)throw new Error('Too many folder entries. Scan smaller folders.');
        if(file.name.startsWith('.'))continue;
        if(file.isSymbolicLink()){result.skipped++;if(result.warnings.length<50)result.warnings.push(`${file.name}: linked file skipped`);continue;}
        const path=join(folder,file.name);
        if(file.isDirectory()){if(depth<1&&!managed.has(file.name))await scan(path,depth+1);continue;}
        if(!file.isFile())continue;
        try{
          await assertLocalLibraryPath(configured.projectAssets,path);const info=await lstat(path);
          validateLocalAssetImportCandidate({filename:file.name,size:info.size});
          // Streamed: a scan must not read a 2 GB video into memory just to
          // decide whether it was imported before.
          const hash=await hashFileSha256(path);if(hashes.has(hash))continue;
          await importLocalProjectAsset({projectId,filePath:resolve(path)});hashes.add(hash);result.added++;
        }catch(error){result.skipped++;if(result.warnings.length<50)result.warnings.push(`${file.name}: ${error instanceof Error?error.message:'Import failed'}`);}
      }
    };
    await scan(materials,0);return result;
  }finally{running.delete(projectId);}
}
