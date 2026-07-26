import {Component} from '@angular/core';
import {RouterLink} from '@angular/router';

/** Static, unauthenticated page — linked from the register screen's footer. */
@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './privacy.component.html',
})
export class PrivacyComponent {}
