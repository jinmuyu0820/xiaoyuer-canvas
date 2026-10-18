/**
 * Fixed product configuration for the local BeatDesign workbench.
 *
 * Release packages may set VITE_APP_NAME at build time to rebrand the visible
 * window title and product shell without changing the default dev build.
 */
const releaseAppName = import.meta.env?.VITE_APP_NAME?.trim();

export const appConfig = {
  app_url: 'http://127.0.0.1:3020',
  app_name: releaseAppName || 'BeatDesign',
  app_description:
    'The open-source, local-first AI canvas for image and video creation.',
  app_logo: '/logo.png',
  database_url: 'file:data/local.db',
} as const;
