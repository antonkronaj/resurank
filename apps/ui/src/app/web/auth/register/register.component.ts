import {Component, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Router, RouterLink} from '@angular/router';
import {HttpErrorResponse} from '@angular/common/http';
import {AuthService} from '../../auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  name = signal('');
  email = signal('');
  password = signal('');
  submitting = signal(false);
  error = signal('');

  async onSubmit(): Promise<void> {
    this.error.set('');
    this.submitting.set(true);
    try {
      await this.auth.register(this.email().trim(), this.password(), this.name().trim() || undefined);
      await this.router.navigate(['/login'], {
        queryParams: {notice: 'Check your inbox for a verification link before signing in.'},
      });
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 400) {
        const detail = err.error?.details?.[0]?.message;
        this.error.set(detail ?? 'Use a valid email and a password of at least 10 characters.');
      } else {
        this.error.set('Something went wrong. Try again.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
