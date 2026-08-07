import {Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {HttpErrorResponse} from '@angular/common/http';
import {AuthService} from '../../auth.service';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './sign-in.component.html',
})
export class SignInComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  /** Benefit bullets on the brand pane — rendered by one @for so the check
   *  icon is declared a single time in the template. */
  readonly points = [
    {strong: 'The PDF never leaves your device.', rest: 'Parsing happens client-side.'},
    {strong: 'The AI model runs locally.', rest: 'No inference server, no third party.'},
    {strong: 'Export or delete everything', rest: 'at any time.'},
  ];

  email = signal('');
  password = signal('');
  submitting = signal(false);
  error = signal('');
  /** Set when a fresh registration or password reset lands here. */
  notice = signal(this.route.snapshot.queryParamMap.get('notice') ?? '');

  async onSubmit(): Promise<void> {
    this.error.set('');
    this.submitting.set(true);
    try {
      await this.auth.login(this.email().trim(), this.password());
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
      await this.router.navigateByUrl(returnUrl);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 403 && err.error?.error === 'email_not_verified') {
        this.error.set('Verify your email before signing in — check your inbox for the link.');
      } else if (err instanceof HttpErrorResponse && err.status === 401) {
        this.error.set('Email or password is incorrect.');
      } else {
        this.error.set('Something went wrong. Try again.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
