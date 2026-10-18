import {createFileRoute} from '@tanstack/react-router';
import {loadSerializedProjectsFn} from '@/core/projects/server-functions';
import {LibraryProjectFolders} from '@/components/app/library-project-folders';
export const Route=createFileRoute('/library/')({ssr:'data-only',loader:()=>loadSerializedProjectsFn({data:{}}),component:()=> <LibraryProjectFolders projects={Route.useLoaderData()}/>});
