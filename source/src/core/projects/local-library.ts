import {createHash,randomUUID} from 'node:crypto';
import {constants as fsConstants,copyFile,lstat,readdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
const {COPYFILE_EXCL}=fsConstants;
import {join,relative,resolve,isAbsolute} from 'node:path';
import {z} from 'zod';
import {getActiveProject} from './projects';
import {getLocalDirectories,ensureProjectDirectories} from './local-directories';
import {importLocalProjectAsset,validateLocalAssetImportCandidate} from './import-local-asset';
import {hashFileSha256,readFileHeader} from './local-file-utils';
import {resolveLocalProjectAssetPath,sanitizeLocalProjectAssetFilename} from './local-project-assets';
import {getProjectAssetById} from '@/core/workspace-lib/assets/user-assets';
import {libraryEntrySchema,libraryCategorySchema,libraryAnnotationSchema,libraryCategories,categoryAcceptsMedia,type LibraryCategory,type LibraryEntry,type LibraryMedia,type ScanResult} from './library-contract';
import {getAssetDetails} from './asset-provenance';
import {isSupportedRasterImage} from '@/lib/image-upload-validation';
const manifestSchema=z.object({version:z.literal(1),projectId:z.string(),entries:z.array(libraryEntrySchema).max(1000)}).strict();
const queues=new Map<string,Promise<unknown>>();
function serialized<T>(projectId:string,job:()=>Promise<T>):Promise<T>{const task=(queues.get(projectId)||Promise.resolve()).then(job,job);queues.set(projectId,task);void task.finally(()=>{if(queues.get(projectId)===task)queues.delete(projectId);}).catch(()=>{});return task;}
export async function assertLocalLibraryPath(root:string,path:string){
  const rel=relative(resolve(root),resolve(path));if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Path is outside the project library.');
  let current=resolve(root);
  for(const part of ['',...rel.split(/[\\/]/).filter(Boolean)]){if(part)current=join(current,part);const info=await lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info?.isSymbolicLink())throw new Error('Linked library paths are not allowed.');}
  return resolve(path);
}
async function context(projectId:string){
  if(!await getActiveProject({projectId}))throw new Error('Project not found.');
  const configured=getLocalDirectories();
  await assertLocalLibraryPath(configured.assetLibrary,join(configured.assetLibrary,projectId));
  await assertLocalLibraryPath(configured.projectAssets,join(configured.projectAssets,projectId));
  const dirs=await ensureProjectDirectories(projectId);
  for(const category of libraryCategories)await assertLocalLibraryPath(configured.assetLibrary,join(dirs.library,category));
  const path=await assertLocalLibraryPath(configured.assetLibrary,join(dirs.library,'.seedance-library.json'));
  const info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(info&&(!info.isFile()||info.size>8*1024*1024))throw new Error('Library index is invalid or too large.');
  const document=info?manifestSchema.parse(JSON.parse(await readFile(path,'utf8'))):{version:1 as const,projectId,entries:[] as LibraryEntry[]};
  if(document.projectId!==projectId)throw new Error('Library index belongs to another project.');
  return {root:dirs.library,configuredRoot:configured.assetLibrary,path,document};
}
async function save(ctx:Awaited<ReturnType<typeof context>>){
  const data=manifestSchema.parse(ctx.document),serialized=JSON.stringify(data,null,2),temp=`${ctx.path}.${randomUUID()}.tmp`;
  if(Buffer.byteLength(serialized)>8*1024*1024)throw new Error('Library metadata limit reached. Shorten notes or prompts before adding more entries.');
  await assertLocalLibraryPath(ctx.configuredRoot,ctx.path);
  try{await writeFile(temp,serialized,{flag:'wx'});await rename(temp,ctx.path);}catch(error){await unlink(temp).catch(()=>{});throw error;}
}
export async function listLocalLibrary(projectId:string){
  const ctx=await context(projectId),entries:LibraryMedia[]=[];
  for(const entry of ctx.document.entries){
    const asset=await getProjectAssetById({projectId,assetId:entry.assetId});if(!asset)continue;
    const file=await assertLocalLibraryPath(ctx.configuredRoot,join(ctx.root,entry.category,entry.filename));
    const info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    entries.push({...entry,type:asset.type as LibraryMedia['type'],publicUrl:asset.publicUrl,mimeType:asset.mimeType,sizeBytes:asset.sizeBytes,width:asset.width,height:asset.height,durationMs:asset.durationMs,missing:!info?.isFile()});
  }
  const counts=Object.fromEntries(libraryCategories.map(category=>[category,entries.filter(entry=>entry.category===category).length])) as Record<LibraryCategory,number>;
  return {projectId,root:ctx.root,entries,counts};
}
export async function addAssetToLocalLibrary(projectId:string,assetId:string,sourceCategory:unknown){return serialized(projectId,async()=>{
  const category=libraryCategorySchema.parse(sourceCategory),ctx=await context(projectId);
  const asset=await getProjectAssetById({projectId,assetId});if(!asset||asset.storageProvider!=='local')throw new Error('Only this project’s local assets can enter its library.');
  if(!categoryAcceptsMedia(category,asset.type))throw new Error('The media type does not match this library category.');
  const existing=ctx.document.entries.find(entry=>entry.assetId===assetId&&entry.category===category);
  if(existing){const path=await assertLocalLibraryPath(ctx.configuredRoot,join(ctx.root,category,existing.filename));const info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info?.isFile())return existing;if(info)throw new Error('Library copy path is not a file.');}
  if(!existing&&ctx.document.entries.length>=1000)throw new Error('A project library can contain at most 1000 entries.');
  const original=resolveLocalProjectAssetPath({objectKey:asset.objectKey});
  validateLocalAssetImportCandidate({filename:asset.filename||original,size:(await lstat(original)).size});
  if(asset.type==='image'&&!isSupportedRasterImage(asset.mimeType||'',await readFileHeader(original)))throw new Error('Image contents no longer match the recorded raster format.');
  const id=existing?.id||randomUUID(),filename=existing?.filename||`${id.slice(0,8)}-${sanitizeLocalProjectAssetFilename({filename:asset.filename||'asset',mimeType:asset.mimeType||''})}`;
  const target=await assertLocalLibraryPath(ctx.configuredRoot,join(ctx.root,category,filename));
  // Copy on the filesystem: a library entry may be a multi-gigabyte clip.
  await copyFile(original,target,COPYFILE_EXCL);
  const sha256=await hashFileSha256(target);const details=await getAssetDetails(projectId,assetId),now=new Date().toISOString();
  const entry=libraryEntrySchema.parse({id,assetId,category,filename,sha256,name:existing?.name||asset.filename||'Asset',notes:existing?.notes||'',prompt:existing?.prompt??details.generations[0]?.prompt??'',tags:existing?.tags||[],createdAt:existing?.createdAt||now,updatedAt:now});
  if(existing)Object.assign(existing,entry);else ctx.document.entries.push(entry);await save(ctx);return entry;
});}
export async function updateLibraryAnnotation(projectId:string,id:string,input:unknown){return serialized(projectId,async()=>{
  const ctx=await context(projectId),entry=ctx.document.entries.find(item=>item.id===id);if(!entry)throw new Error('Library entry not found in this project.');
  Object.assign(entry,libraryAnnotationSchema.parse(input),{updatedAt:new Date().toISOString()});await save(ctx);return entry;
});}
export async function scanLocalLibrary(projectId:string,selectedCategory?:unknown){return serialized(projectId,async()=>{
  const ctx=await context(projectId),categories=selectedCategory?[libraryCategorySchema.parse(selectedCategory)]:libraryCategories;
  const result:ScanResult={added:0,updated:0,skipped:0,warnings:[]};
  for(const category of categories){
    const folder=await assertLocalLibraryPath(ctx.configuredRoot,join(ctx.root,category));
    const files=await readdir(folder,{withFileTypes:true});
    if(files.length>1500)throw new Error('Too many files in a category. Organize it before scanning.');
    for(const file of files){
      if(file.name.startsWith('.')||!file.isFile()){if(file.isSymbolicLink()){result.skipped++;result.warnings.push(`${file.name}: linked file skipped`);}continue;}
      try{
        const path=await assertLocalLibraryPath(ctx.configuredRoot,join(folder,file.name)),info=await lstat(path);
        const candidate=validateLocalAssetImportCandidate({filename:file.name,size:info.size});
        if(!categoryAcceptsMedia(category,candidate.mediaType))throw new Error('Media type does not match the category.');
        const sha256=await hashFileSha256(path);
        const entry=ctx.document.entries.find(item=>item.category===category&&item.filename===file.name);
        if(entry?.sha256===sha256&&await getProjectAssetById({projectId,assetId:entry.assetId}))continue;
        if(!entry&&ctx.document.entries.length>=1000)throw new Error('Library entry limit reached.');
        const asset=await importLocalProjectAsset({projectId,filePath:path}),now=new Date().toISOString();
        if(entry){entry.assetId=asset.id;entry.sha256=sha256;entry.updatedAt=now;result.updated++;}
        else{ctx.document.entries.push(libraryEntrySchema.parse({id:randomUUID(),assetId:asset.id,category,filename:file.name,sha256,name:file.name,notes:'',prompt:'',tags:[],createdAt:now,updatedAt:now}));result.added++;}
        await save(ctx);
      }catch(error){result.skipped++;if(result.warnings.length<50)result.warnings.push(`${file.name}: ${error instanceof Error?error.message:'Import failed'}`);}
    }
  }
  return result;
});}
