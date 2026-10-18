import {createFileRoute} from '@tanstack/react-router';
import {WorkspaceProjectRoutePage} from '@/components/app/workspace-project-route-page';
import {loadWorkspaceProjectRoute} from '@/core/projects/workspace-project-route-loader';
export const Route=createFileRoute('/library/$projectId')({ssr:'data-only',loader:({params})=>loadWorkspaceProjectRoute({projectId:params.projectId,search:{},workspaceMode:'library'}),component:()=> <WorkspaceProjectRoutePage data={Route.useLoaderData()}/>});
