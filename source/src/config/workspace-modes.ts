export const workspaceModes = ['studio', 'canvas', 'assets','library'] as const;

export type WorkspaceMode = (typeof workspaceModes)[number];

export const defaultWorkspaceMode: WorkspaceMode = 'canvas';

export function resolveWorkspaceMode(value?: string | null): WorkspaceMode {
  return workspaceModes.includes(value as WorkspaceMode)
    ? (value as WorkspaceMode)
    : defaultWorkspaceMode;
}

export function workspaceModePath(mode: WorkspaceMode) {
  if (mode === 'studio') return '/studio';
  if (mode === 'assets') return '/assets';
  if(mode==='library')return '/library';
  return '/canvas';
}
