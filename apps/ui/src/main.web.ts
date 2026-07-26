import {bootstrapApplication} from '@angular/platform-browser';
import {appConfig} from './app/web/app.config';
import {AppShellComponent} from './app/web/app-shell.component';

bootstrapApplication(AppShellComponent, appConfig)
  .catch((err) => console.error(err));
