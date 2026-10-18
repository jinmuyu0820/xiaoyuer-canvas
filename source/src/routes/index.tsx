import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // `href` redirects are not resolvable by `preloadRoute`, which recurses
    // forever when the home link is prefetched. A typed `to` keeps the
    // redirect preloadable.
    throw redirect({
      to: '/projects',
      search: { target: undefined, model: undefined, prompt: undefined },
    });
  },
});
