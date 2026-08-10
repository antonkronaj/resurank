import {CommonModule} from '@angular/common';
import {Component, OnInit, inject, signal} from '@angular/core';
import {RouterLink} from '@angular/router';
import {ADMIN_AUDIT_ACTION_LABELS, AdminAuditEntry, AdminService} from '../../admin.service';

/** Read-only, paginated view of admin_audit_log — the record for every
 * destructive action a delete or suspend leaves no other trace of. */
@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './audit.component.html',
})
export class AdminAuditComponent implements OnInit {
  private admin = inject(AdminService);

  readonly entries = signal<AdminAuditEntry[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly page = signal(0);
  readonly pageSize = 50;

  ngOnInit(): void {
    this.refresh();
  }

  label(entry: AdminAuditEntry): string {
    return ADMIN_AUDIT_ACTION_LABELS[entry.action] ?? entry.action;
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const {entries, total} = await this.admin.audit({
        limit: this.pageSize,
        offset: this.page() * this.pageSize,
      });
      this.entries.set(entries);
      this.total.set(total);
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  nextPage(): void {
    if ((this.page() + 1) * this.pageSize >= this.total()) return;
    this.page.update((p) => p + 1);
    this.refresh();
  }

  prevPage(): void {
    if (this.page() === 0) return;
    this.page.update((p) => p - 1);
    this.refresh();
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
