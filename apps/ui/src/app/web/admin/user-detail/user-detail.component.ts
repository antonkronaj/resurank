import {CommonModule} from '@angular/common';
import {Component, OnInit, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {
  ADMIN_AUDIT_ACTION_LABELS,
  AdminAuditEntry,
  AdminService,
  AdminUserDetail,
} from '../../admin.service';
import {AuthService} from '../../auth.service';

type ConfirmAction = 'promote' | 'demote' | 'suspend' | 'reinstate' | 'delete' | null;

/**
 * Admin detail view for one account: profile, counts, sessions, and the
 * destructive actions (role, suspend, delete). Every destructive action
 * re-collects the acting admin's own password — the server re-checks it
 * (lib/admin-guards.ts) regardless of what the client sends, but the client
 * still has to prompt for and forward it.
 *
 * Follows the same two-step "reveal a password field, then confirm" pattern
 * as account.component.html's danger zone, rather than a modal or
 * window.confirm — neither exists anywhere else in this app.
 */
@Component({
  selector: 'app-admin-user-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './user-detail.component.html',
})
export class AdminUserDetailComponent implements OnInit {
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly detail = signal<AdminUserDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  /**
   * Actions taken *against* this account — grant/revoke, suspend/reinstate,
   * delete, force-verify, revoke-sessions — filtered server-side by
   * targetId. This is deliberately not "everything this account did as an
   * admin"; that's a different question the top-level audit log already
   * answers unfiltered.
   */
  readonly auditEntries = signal<AdminAuditEntry[]>([]);
  readonly auditTotal = signal(0);
  private readonly auditPageSize = 20;

  readonly confirming = signal<ConfirmAction>(null);
  readonly password = signal('');
  readonly acting = signal(false);
  readonly actionError = signal('');
  readonly actionMessage = signal('');

  /** The user this whole panel is disabled for — an admin manages their own
   * account from the Account page instead (see checkNotSelf server-side). */
  readonly isSelf = signal(false);

  private get userId(): string {
    return this.route.snapshot.paramMap.get('id')!;
  }

  ngOnInit(): void {
    this.isSelf.set(this.auth.user()?.id === this.userId);
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [detail, audit] = await Promise.all([
        this.admin.getUser(this.userId),
        this.admin.audit({targetId: this.userId, limit: this.auditPageSize}),
      ]);
      this.detail.set(detail);
      this.auditEntries.set(audit.entries);
      this.auditTotal.set(audit.total);
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  auditLabel(entry: AdminAuditEntry): string {
    return ADMIN_AUDIT_ACTION_LABELS[entry.action] ?? entry.action;
  }

  exportUrl(): string {
    return this.admin.exportUrl(this.userId);
  }

  requestConfirm(action: ConfirmAction): void {
    this.confirming.set(action);
    this.password.set('');
    this.actionError.set('');
  }

  cancelConfirm(): void {
    this.confirming.set(null);
    this.password.set('');
    this.actionError.set('');
  }

  async runConfirmed(): Promise<void> {
    const action = this.confirming();
    if (!action) return;
    this.acting.set(true);
    this.actionError.set('');
    this.actionMessage.set('');
    try {
      switch (action) {
        case 'promote':
          await this.admin.setRole(this.userId, 'admin', this.password());
          this.actionMessage.set('Granted admin.');
          break;
        case 'demote':
          await this.admin.setRole(this.userId, 'user', this.password());
          this.actionMessage.set('Revoked admin.');
          break;
        case 'suspend':
          await this.admin.setStatus(this.userId, true, this.password());
          this.actionMessage.set('Account suspended.');
          break;
        case 'reinstate':
          await this.admin.setStatus(this.userId, false, this.password());
          this.actionMessage.set('Account reinstated.');
          break;
        case 'delete':
          await this.admin.deleteUser(this.userId, this.password());
          await this.router.navigate(['/admin']);
          return;
      }
      this.confirming.set(null);
      this.password.set('');
      await this.refresh();
    } catch (err: unknown) {
      this.actionError.set(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }

  async forceVerify(): Promise<void> {
    this.acting.set(true);
    this.actionError.set('');
    this.actionMessage.set('');
    try {
      await this.admin.forceVerifyEmail(this.userId);
      this.actionMessage.set('Email marked verified.');
      await this.refresh();
    } catch (err: unknown) {
      this.actionError.set(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }

  async revokeSessions(): Promise<void> {
    this.acting.set(true);
    this.actionError.set('');
    this.actionMessage.set('');
    try {
      await this.admin.revokeSessions(this.userId);
      this.actionMessage.set('Every session was signed out.');
      await this.refresh();
    } catch (err: unknown) {
      this.actionError.set(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
