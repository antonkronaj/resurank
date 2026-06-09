/// <reference lib="webworker" />

// Local worker entry so Angular CLI's bundler recognizes this as a worker module.
// All worker logic lives in @resurank/scoring/worker — the side-effect import
// runs its top-level message listener registration in the worker context.
import '@resurank/scoring/worker';
