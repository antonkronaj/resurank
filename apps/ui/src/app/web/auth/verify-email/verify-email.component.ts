import {Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {AuthService} from '../../auth.service';

/** Lands here from the GET /api/auth/verify-email redirect (apps/web/src/routes/auth.ts). */
@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  readonly status = this.route.snapshot.queryParamMap.get('status') ?? 'invalid';

  email = signal('');
  submitting = signal(false);
  resent = signal(false);

  async onResend(): Promise<void> {
    this.submitting.set(true);
    try {
      await this.auth.resendVerification(this.email().trim());
      this.resent.set(true);
    } finally {
      this.submitting.set(false);
    }
  }
}
