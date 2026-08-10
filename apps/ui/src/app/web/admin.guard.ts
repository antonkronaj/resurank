import {inject} from '@angular/core';
import {CanActivateFn, Router} from '@angular/router';
import {AuthService} from './auth.service';

/**
 * Protects the /admin section. Mirrors auth.guard.ts's shape, with an extra
 * role check — a signed-in non-admin is bounced to the score screen rather
 * than /login, since they are authenticated, just not authorized. This is a
 * UX convenience, not the security boundary: every /api/admin/* route
 * re-checks the role server-side via requireAdmin.
 */
export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = await auth.ensureSession();
  if (!user) return router.createUrlTree(['/login'], {queryParams: {returnUrl: state.url}});
  if (user.role !== 'admin') return router.createUrlTree(['/score']);

  return true;
};
