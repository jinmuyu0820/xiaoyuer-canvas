import {createFileRoute} from '@tanstack/react-router';
import {getAssetDetails} from '@/core/projects/asset-provenance';
async function GET({params}:{params:{projectId:string;assetId:string}}){try{return Response.json(await getAssetDetails(params.projectId,params.assetId));}catch{return Response.json({error:'Asset or project not found.'},{status:404});}}
export const Route=createFileRoute('/api/app/projects/$projectId/assets/$assetId/details')({server:{handlers:{GET}}});
