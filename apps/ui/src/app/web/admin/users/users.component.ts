import {CommonModule} from '@angular/common';
import {Component, OnInit, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Router, RouterLink} from '@angular/router';
import {
  AdminService,
  AdminStats,
  AdminUserStatusFilter,
  AdminUserSummary,
} from '../../admin.service';

/**
 * Admin user list: search, status filter, and instance stats. This is the
 * app's first free-text search input — everywhere else filters (History's
 * resume dropdown) work off a fixed small set of values, so there is no
 * existing search-box component to reuse.
 */
@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './users.component.html',
})
export class AdminUsersComponent implements OnInit {
  private admin = inject(AdminService);
  private router = inject(Router);

  readonly stats = signal<AdminStats | null>(null);
  readonly users = signal<AdminUserSummary[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly query = signal('');
  readonly status = signal<AdminUserStatusFilter>('all');
  readonly page = signal(0);
  readonly pageSize = 25;

  private searchDebounce?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.admin.stats().then((s) => this.stats.set(s));
    this.refresh();
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    this.page.set(0);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.refresh(), 250);
  }

  onStatusChange(value: AdminUserStatusFilter): void {
    this.status.set(value);
    this.page.set(0);
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const {users, total} = await this.admin.listUsers({
        q: this.query() || undefined,
        status: this.status(),
        limit: this.pageSize,
        offset: this.page() * this.pageSize,
      });
      this.users.set(users);
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

  open(id: string): void {
    this.router.navigate(['/admin/users', id]);
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
