import {getConfig} from '@/modules/config/service';
import {validateStorageEndpoint} from './endpoint-policy';
import {isPublicHttpMediaUrl} from '@/core/effects/beatapi-media-url';
export const VIDEO_STORAGE_REQUIRED_ERROR='请先在设置 → TOS / 存储中配置并启用完整的 TOS/S3 存储（端点、桶、公网地址和凭证），再导入画布视频。文件不会因选择而自动上传云端。';
export function isVideoImportStorageReady(config:{mode:string;endpoint:string;publicUrl:string;bucketName:string;accessKeyConfigured:boolean;secretKeyConfigured:boolean}){
  return config.mode==='s3'&&!!config.bucketName&&config.accessKeyConfigured&&config.secretKeyConfigured&&validateStorageEndpoint(config.endpoint,{allowPrivate:false}).ok&&isPublicHttpMediaUrl(config.publicUrl)&&config.publicUrl.startsWith('https:');
}
export async function videoImportStorageReady(){
  const [mode,endpoint,publicUrl,bucketName,accessKey,secretKey]=await Promise.all(['WORKSPACE_STORAGE_MODE','R2_ENDPOINT','R2_PUBLIC_URL','R2_BUCKET_NAME','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'].map(key=>getConfig(key,true)));
  return isVideoImportStorageReady({mode:mode||'',endpoint:endpoint||'',publicUrl:publicUrl||'',bucketName:bucketName||'',accessKeyConfigured:!!accessKey,secretKeyConfigured:!!secretKey});
}
