import {Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {HttpErrorResponse} from '@angular/common/http';
import {AuthService} from '../../auth.service';

/** Lands here from the link in sendPasswordResetEmail (apps/web/src/lib/email.ts). */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
})
export class ResetPasswordComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';
  readonly hasToken = this.token.length > 0;

  password = signal('');
  submitting = signal(false);
  error = signal('');

  async onSubmit(): Promise<void> {
    this.error.set('');
    this.submitting.set(true);
    try {
      await this.auth.resetPassword(this.token, this.password());
      await this.router.navigate(['/login'], {
        queryParams: {notice: 'Your password has been reset. Sign in with your new password.'},
      });
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 400 && err.error?.error === 'invalid_token') {
        this.error.set('This reset link is invalid or has expired. Request a new one.');
      } else if (err instanceof HttpErrorResponse && err.status === 400) {
        this.error.set('Use at least 10 characters.');
      } else {
        this.error.set('Something went wrong. Try again.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
