import {Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {AuthService} from '../../auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent {
  private auth = inject(AuthService);

  email = signal('');
  submitting = signal(false);
  /** The endpoint never reveals whether the address has an account — same
   * generic message either way, so there is nothing to branch on here. */
  sent = signal(false);

  async onSubmit(): Promise<void> {
    this.submitting.set(true);
    try {
      await this.auth.forgotPassword(this.email().trim());
      this.sent.set(true);
    } finally {
      this.submitting.set(false);
    }
  }
}
