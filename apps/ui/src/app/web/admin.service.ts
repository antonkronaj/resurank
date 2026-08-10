import {HttpClient, HttpParams} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import type {PublicUser} from './auth.service';

/** Mirrors apps/web/src/lib/users.ts AdminUserSummary. */
export interface AdminUserSummary extends PublicUser {
  resumeCount: number;
  historyCount: number;
  lastSeenAt: string | null;
}

export type AdminUserStatusFilter = 'all' | 'active' | 'suspended' | 'admin';

export interface AdminSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface AdminUserDetail {
  user: PublicUser;
  resumeCount: number;
  historyCount: number;
  settingsVersionCount: number;
  sessions: AdminSession[];
}

/** Mirrors apps/web/src/db/schema.ts AdminAuditAction. */
export type AdminAuditAction =
  | 'delete_user'
  | 'suspend_user'
  | 'reinstate_user'
  | 'grant_admin'
  | 'revoke_admin'
  | 'force_verify'
  | 'revoke_sessions'
  | 'seed_admin';

export interface AdminAuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string;
  targetId: string | null;
  targetEmail: string | null;
  action: AdminAuditAction;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Shared by the audit log page and the per-user trail on the user detail
 * page, so the two never drift apart. */
export const ADMIN_AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  delete_user: 'Deleted user',
  suspend_user: 'Suspended user',
  reinstate_user: 'Reinstated user',
  grant_admin: 'Granted admin',
  revoke_admin: 'Revoked admin',
  force_verify: 'Force-verified email',
  revoke_sessions: 'Revoked sessions',
  seed_admin: 'Seeded bootstrap admin',
};

export interface AdminStats {
  users: {
    total: number;
    admins: number;
    suspended: number;
    signupsLast7Days: number;
    signupsLast30Days: number;
  };
  resumes: number;
  scores: number;
}

/**
 * Wraps /api/admin/*. Every destructive method re-sends the acting admin's
 * own password — the server re-checks it (lib/admin-guards.ts) regardless,
 * but the caller still has to collect and forward it.
 */
@Injectable({providedIn: 'root'})
export class AdminService {
  constructor(private http: HttpClient) {}

  async stats(): Promise<AdminStats> {
    return firstValueFrom(this.http.get<AdminStats>('/api/admin/stats'));
  }

  async listUsers(options: {
    q?: string;
    status?: AdminUserStatusFilter;
    limit?: number;
    offset?: number;
  }): Promise<{users: AdminUserSummary[]; total: number}> {
    let params = new HttpParams();
    if (options.q) params = params.set('q', options.q);
    if (options.status) params = params.set('status', options.status);
    if (options.limit !== undefined) params = params.set('limit', options.limit);
    if (options.offset !== undefined) params = params.set('offset', options.offset);

    return firstValueFrom(
      this.http.get<{users: AdminUserSummary[]; total: number}>('/api/admin/users', {params}),
    );
  }

  async getUser(id: string): Promise<AdminUserDetail> {
    return firstValueFrom(this.http.get<AdminUserDetail>(`/api/admin/users/${id}`));
  }

  /** Full-account export URL — left to the browser to download rather than
   * fetched here, matching how the self-service export link works. */
  exportUrl(id: string): string {
    return `/api/admin/users/${id}/export`;
  }

  async setRole(id: string, role: 'user' | 'admin', password: string): Promise<PublicUser> {
    const res = await firstValueFrom(
      this.http.patch<{user: PublicUser}>(`/api/admin/users/${id}/role`, {role, password}),
    );
    return res.user;
  }

  async setStatus(id: string, disabled: boolean, password: string): Promise<PublicUser> {
    const res = await firstValueFrom(
      this.http.patch<{user: PublicUser}>(`/api/admin/users/${id}/status`, {disabled, password}),
    );
    return res.user;
  }

  async forceVerifyEmail(id: string): Promise<PublicUser> {
    const res = await firstValueFrom(
      this.http.post<{user: PublicUser}>(`/api/admin/users/${id}/verify-email`, {}),
    );
    return res.user;
  }

  async revokeSessions(id: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/admin/users/${id}/revoke-sessions`, {}));
  }

  async deleteUser(id: string, password: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/admin/users/${id}`, {body: {password}}));
  }

  async audit(options: {limit?: number; offset?: number; targetId?: string}): Promise<{
    entries: AdminAuditEntry[];
    total: number;
  }> {
    let params = new HttpParams();
    if (options.limit !== undefined) params = params.set('limit', options.limit);
    if (options.offset !== undefined) params = params.set('offset', options.offset);
    if (options.targetId !== undefined) params = params.set('targetId', options.targetId);

    return firstValueFrom(
      this.http.get<{entries: AdminAuditEntry[]; total: number}>('/api/admin/audit', {params}),
    );
  }
}
