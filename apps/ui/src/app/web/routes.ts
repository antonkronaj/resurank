import {Routes} from '@angular/router';
import {AppComponent} from '../shared/app.component';
import {AccountComponent} from './account/account.component';
import {authGuard} from './auth.guard';
import {ForgotPasswordComponent} from './auth/forgot-password/forgot-password.component';
import {RegisterComponent} from './auth/register/register.component';
import {ResetPasswordComponent} from './auth/reset-password/reset-password.component';
import {SignInComponent} from './auth/sign-in/sign-in.component';
import {VerifyEmailComponent} from './auth/verify-email/verify-email.component';
import {HistoryComponent} from './history/history.component';
import {PrivacyComponent} from './legal/privacy.component';
import {TermsComponent} from './legal/terms.component';
import {NavShellComponent} from './nav-shell.component';
import {ResumesComponent} from './resumes/resumes.component';
import {SettingsComponent} from './settings/settings.component';

/**
 * The guarded routes sit under `NavShellComponent`, which owns the toolbar +
 * primary nav (Resumes / Score / History) and the avatar menu (Account /
 * sign out) — see nav-shell.component.ts. `AppComponent` (the Score screen)
 * renders completely unchanged inside it, apart from the resume-picker
 * outlet added in Phase 9 (shared/resume-picker-panel.token.ts).
 */
export const webRoutes: Routes = [
  {path: 'login', component: SignInComponent},
  {path: 'register', component: RegisterComponent},
  {path: 'forgot-password', component: ForgotPasswordComponent},
  {path: 'reset-password', component: ResetPasswordComponent},
  {path: 'verify-email', component: VerifyEmailComponent},
  {path: 'terms', component: TermsComponent},
  {path: 'privacy', component: PrivacyComponent},
  {
    path: '',
    component: NavShellComponent,
    canActivate: [authGuard],
    children: [
      {path: '', pathMatch: 'full', redirectTo: 'score'},
      {path: 'score', component: AppComponent},
      {path: 'resumes', component: ResumesComponent},
      {path: 'history', component: HistoryComponent},
      {path: 'account', component: AccountComponent},
      {path: 'settings', component: SettingsComponent},
    ],
  },
  {path: '**', redirectTo: ''},
];
