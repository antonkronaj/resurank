import {HttpClient} from '@angular/common/http';
import {Injectable, signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';

/** Mirrors packages/server/src/lib/users.ts PublicUser. */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  createdAt: string;
}

/** Mirrors packages/server/src/lib/errors.ts ErrorCode + the {error, message} shape. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Array<{path: string; message: string}>;
}

/**
 * Wraps /api/auth/* and /api/users/me. Owns the one signal that answers
 * "who, if anyone, is signed in" — the guard and the 401 interceptor both
 * read it, and every mutating call here keeps it in sync so neither has to
 * re-derive session state on its own.
 */
@Injectable({providedIn: 'root'})
export class AuthService {
  /** undefined = not yet checked; null = checked, signed out. */
  private readonly userSignal = signal<PublicUser | null | undefined>(undefined);
  readonly user = this.userSignal.asReadonly();

  private sessionCheck: Promise<PublicUser | null> | null = null;

  constructor(private http: HttpClient) {}

  /**
   * Resolves the current session, checking the server at most once until
   * something invalidates it (login, logout, or a 401 from elsewhere). The
   * guard calls this on every navigation, so a real network round-trip per
   * navigation would be wasteful — this is the same "load once, cache in
   * memory" shape as StorageAdapter.load(), for the same reason.
   */
  async ensureSession(): Promise<PublicUser | null> {
    if (this.userSignal() !== undefined) return this.userSignal() as PublicUser | null;
    if (this.sessionCheck) return this.sessionCheck;

    this.sessionCheck = firstValueFrom(this.http.get<{user: PublicUser}>('/api/auth/session'))
      .then((res) => {
        this.userSignal.set(res.user);
        return res.user;
      })
      .catch(() => {
        this.userSignal.set(null);
        return null;
      })
      .finally(() => {
        this.sessionCheck = null;
      });

    return this.sessionCheck;
  }

  /** Called by the 401 interceptor when a request reports the session is dead. */
  invalidateSession(): void {
    this.userSignal.set(null);
  }

  async register(email: string, password: string, name?: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/register', {email, password, name}));
  }

  async login(email: string, password: string): Promise<PublicUser> {
    const res = await firstValueFrom(
      this.http.post<{user: PublicUser}>('/api/auth/login', {email, password}),
    );
    this.userSignal.set(res.user);
    return res.user;
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {}));
    this.userSignal.set(null);
  }

  async logoutAll(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout-all', {}));
    this.userSignal.set(null);
  }

  async resendVerification(email: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/resend-verification', {email}));
  }

  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/forgot-password', {email}));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/reset-password', {token, password}));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/auth/change-password', {currentPassword, newPassword}),
    );
  }

  /**
   * `email` starts a two-step change (see packages/server/src/routes/users.ts):
   * the live address only moves once the confirmation link is clicked, so the
   * signal here still reflects the *current* email — only `pendingEmail`
   * changes immediately.
   */
  async updateProfile(updates: {name?: string; email?: string}): Promise<boolean> {
    const res = await firstValueFrom(
      this.http.patch<{user: PublicUser; emailChangePending: boolean}>('/api/users/me', updates),
    );
    this.userSignal.set(res.user);
    return res.emailChangePending;
  }

  async deleteAccount(password: string): Promise<void> {
    await firstValueFrom(this.http.delete('/api/users/me', {body: {password}}));
    this.userSignal.set(null);
  }
}
