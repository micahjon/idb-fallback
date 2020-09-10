# IndexedDB Fallback

A Promise-based wrapper around IndexedDB that extends [idb-keyval](https://github.com/jakearchibald/idb-keyval) with the following features:

- In-memory fallback used if IndexedDB store cannot be initialized or any key-value pair is not successfully set.
- Only most-recently opened tab can write to IndexedDB. Older tabs listen for the opening of a new tab, copy all their data into memory, and then only write to memory.
- IndexedDB stores have an associated "version", and will be wiped if version is changed.

Inspired by IndexedDB wrapper used for auto-saving at [BeFunky](https://www.befunky.com/), a WebGL-based photo-editing and design platform.
