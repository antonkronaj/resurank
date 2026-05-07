import { Component, input, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-stopwords-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stopwords-modal.component.html',
  styleUrl: './stopwords-modal.component.css',
})
export class StopwordsModalComponent {
  isOpen = input<boolean>(false);
  words = input<string[]>([]);
  saving = input<boolean>(false);

  close = output<void>();
  save = output<string[]>();

  draft = signal('');

  // Tracks the previous open state so we only re-seed `draft` on the
  // transition from closed → open (not on every `words` change).
  private prevOpen = false;

  constructor() {
    effect(() => {
      // Read both signals unconditionally so the effect tracks both.
      const open = this.isOpen();
      const words = this.words();
      if (open && !this.prevOpen) {
        this.draft.set(words.join(', '));
      }
      this.prevOpen = open;
    }, { allowSignalWrites: true });
  }

  onClose() {
    this.close.emit();
  }

  onSave() {
    const words = this.parseWords(this.draft());
    this.save.emit(words);
  }

  exportToArray() {
    const words = this.parseWords(this.draft());
    const arrayStr = JSON.stringify(words);
    navigator.clipboard.writeText(arrayStr).then(() => {
      alert('Copied to clipboard as array');
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  }

  private parseWords(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0);
  }
}
