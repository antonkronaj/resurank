import {CommonModule} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import {Component, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Router} from '@angular/router';
import {firstValueFrom} from 'rxjs';
import {AuthService} from '../auth.service';

/**
 * Profile / password / sessions / export / delete — the account-settings
 * screen Phase 7 deliberately deferred (see web/routes.ts history). The
 * guard guarantees `authService.user()` is already populated by the time
 * this mounts (it awaits `ensureSession()` before allowing entry).
 */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account.component.html',
})
export class AccountComponent implements OnInit {
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly user = this.auth.user;

  readonly name = signal('');
  readonly email = signal('');
  readonly savingProfile = signal(false);
  readonly profileMessage = signal('');
  readonly profileError = signal('');

  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly savingPassword = signal(false);
  readonly passwordMessage = signal('');
  readonly passwordError = signal('');

  readonly signingOutEverywhere = signal(false);
  readonly sessionsMessage = signal('');

  readonly exporting = signal(false);
  readonly exportError = signal('');

  readonly deleteRequested = signal(false);
  readonly deletePassword = signal('');
  readonly deleting = signal(false);
  readonly deleteError = signal('');

  ngOnInit(): void {
    const u = this.user();
    this.name.set(u?.name ?? '');
    this.email.set(u?.email ?? '');
  }

  async saveProfile(): Promise<void> {
    this.savingProfile.set(true);
    this.profileMessage.set('');
    this.profileError.set('');
    try {
      const emailChangePending = await this.auth.updateProfile({
        name: this.name().trim(),
        email: this.email().trim(),
      });
      this.profileMessage.set(
        emailChangePending
          ? 'Saved. Check your new address for a confirmation link.'
          : 'Profile saved.',
      );
    } catch (err: unknown) {
      this.profileError.set(errorMessage(err));
    } finally {
      this.savingProfile.set(false);
    }
  }

  async updatePassword(): Promise<void> {
    this.savingPassword.set(true);
    this.passwordMessage.set('');
    this.passwordError.set('');
    try {
      await this.auth.changePassword(this.currentPassword(), this.newPassword());
      this.currentPassword.set('');
      this.newPassword.set('');
      this.passwordMessage.set('Password updated.');
    } catch (err: unknown) {
      this.passwordError.set(errorMessage(err));
    } finally {
      this.savingPassword.set(false);
    }
  }

  async signOutEverywhere(): Promise<void> {
    this.signingOutEverywhere.set(true);
    try {
      await this.auth.logoutAll();
      await this.router.navigate(['/login']);
    } finally {
      this.signingOutEverywhere.set(false);
    }
  }

  async exportData(): Promise<void> {
    this.exporting.set(true);
    this.exportError.set('');
    try {
      const res = await firstValueFrom(
        this.http.get('/api/users/me/export', {observe: 'response', responseType: 'blob'}),
      );
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? 'resurank-export.json';
      const url = URL.createObjectURL(res.body as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      this.exportError.set(errorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await this.auth.deleteAccount(this.deletePassword());
      await this.router.navigate(['/login']);
    } catch (err: unknown) {
      this.deleteError.set(errorMessage(err));
    } finally {
      this.deleting.set(false);
    }
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
