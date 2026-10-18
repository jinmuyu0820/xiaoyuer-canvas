export const BEATCANVAS_REMEMBER_COMPOSER_EVENT =
  'beatcanvas:remember-composer';
export const BEATCANVAS_OPEN_COMPOSER_EVENT = 'beatcanvas:open-composer';

const storageKey = (projectId: string) =>
  `beatcanvas:reopen-composer:${projectId}`;

/**
 * A language switch reloads the page, so the open composer would otherwise be
 * lost. The canvas stores the active draft just before the reload and reopens
 * it once the project snapshot has hydrated.
 */
export const rememberActiveComposer = (
  projectId: string,
  cardId: string | null
) => {
  try {
    if (cardId) sessionStorage.setItem(storageKey(projectId), cardId);
    else sessionStorage.removeItem(storageKey(projectId));
  } catch {
    // Storage can be unavailable in private modes; the switch still works.
  }
};

export const readRememberedComposer = (projectId: string) => {
  try {
    return sessionStorage.getItem(storageKey(projectId));
  } catch {
    return null;
  }
};

export const clearRememberedComposer = (projectId: string) => {
  try {
    sessionStorage.removeItem(storageKey(projectId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
};
