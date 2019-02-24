# IndexedDB Fallback

A Promise-based wrapper around IndexedDB that extends [idb-keyval](https://github.com/jakearchibald/idb-keyval) with the following features:

- In-memory fallback used if IndexedDB store cannot be initialized or any key-value pair is not successfully set.
- All data is copied into memory and IndexedDB is not longer used if a application is opened in new tab (to avoid write conflicts).
- IndexedDB stores have an associated "version", and will be wiped if version is changed.

Inspired by IndexedDB wrapper used for auto-saving at [BeFunky](https://www.befunky.com/), a WebGL-based photo-editing and design platform.
