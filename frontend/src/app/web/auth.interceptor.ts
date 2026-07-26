import {HttpErrorResponse, HttpInterceptorFn} from '@angular/common/http';
import {inject} from '@angular/core';
import {Router} from '@angular/router';
import {catchError, throwError} from 'rxjs';
import {AuthService} from './auth.service';

/**
 * A 401 means one of two very different things, distinguished by the
 * server's error code (packages/server/src/lib/errors.ts):
 *  - `unauthenticated` — the session is gone (expired, revoked, cookie
 *    missing). Nothing short of signing in again fixes this, so this
 *    interceptor redirects.
 *  - `invalid_credentials` — a wrong password was submitted on a form
 *    (login, or "change password" from an already-authenticated account).
 *    The caller is still signed in; this must reach the component as an
 *    ordinary error so it can show "wrong password", not bounce to /login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        error.error?.error === 'unauthenticated' &&
        !router.url.startsWith('/login')
      ) {
        auth.invalidateSession();
        router.navigate(['/login'], {queryParams: {returnUrl: router.url}});
      }
      return throwError(() => error);
    }),
  );
};
