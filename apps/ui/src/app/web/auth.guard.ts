import {inject} from '@angular/core';
import {CanActivateFn, Router} from '@angular/router';
import {AuthService} from './auth.service';

/** Protects the app route: no session, no entry — bounced to /login. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = await auth.ensureSession();
  if (user) return true;

  return router.createUrlTree(['/login'], {queryParams: {returnUrl: state.url}});
};
