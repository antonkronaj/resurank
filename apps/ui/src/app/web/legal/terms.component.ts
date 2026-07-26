import {Component} from '@angular/core';
import {RouterLink} from '@angular/router';

/** Static, unauthenticated page — linked from the register screen's footer. */
@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './terms.component.html',
})
export class TermsComponent {}
