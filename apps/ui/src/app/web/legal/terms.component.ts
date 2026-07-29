import {Component} from '@angular/core';
import {RouterLink} from '@angular/router';

/** Static, unauthenticated page — linked from the register screen's footer. */
@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './terms.component.html',
  // Scoped to this component only (emulated encapsulation) — bumps the
  // legal page's body text without touching the shared `.small` class.
  styles: ['.small { font-size: 14px; }'],
})
export class TermsComponent {}
