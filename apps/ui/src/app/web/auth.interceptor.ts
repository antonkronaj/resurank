import {HttpErrorResponse, HttpInterceptorFn} from '@angular/common/http';
import {inject} from '@angular/core';
import {Router} from '@angular/router';
import {catchError, throwError} from 'rxjs';
import {AuthService} from './auth.service';

/**
 * A 401/403 can mean several very different things, distinguished by the
 * server's error code (apps/web/src/lib/errors.ts):
 *  - `unauthenticated` (401) — the session is gone (expired, revoked, cookie
 *    missing). Nothing short of signing in again fixes this, so this
 *    interceptor redirects.
 *  - `account_disabled` (403) — an admin suspended this account. The server
 *    has already cleared the cookie; treated the same as `unauthenticated`
 *    except for the notice shown on the way to /login.
 *  - `invalid_credentials` (401) — a wrong password was submitted on a form
 *    (login, or "change password" from an already-authenticated account).
 *    The caller is still signed in; this must reach the component as an
 *    ordinary error so it can show "wrong password", not bounce to /login.
 *  - `forbidden` (403) — signed in, but the account lacks the role a route
 *    requires (e.g. a non-admin hitting /api/admin/*). Not a session
 *    problem, so this passes through unchanged for the component to handle.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && !router.url.startsWith('/login')) {
        const code = error.error?.error;
        if (error.status === 401 && code === 'unauthenticated') {
          auth.invalidateSession();
          router.navigate(['/login'], {queryParams: {returnUrl: router.url}});
        } else if (error.status === 403 && code === 'account_disabled') {
          auth.invalidateSession();
          router.navigate(['/login'], {
            queryParams: {notice: 'This account has been suspended.'},
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
