/**
 * idb-keyval
 * A tiny promise-based key-value store implemented with IndexedDB
 * https://github.com/jakearchibald/idb-keyval
 *
 */
import { get, set, keys, del, clear, Store } from 'idb-keyval';

/**
 * Persists data in IndexedDB when available, falling back to memory (a JS object)
 * Resets IndexedDB store if version string if ever updated
 * Copies all data to memory if a new tab is opened to prevent write conflicts
 * Exposes superset of idb-keyval API, but using class instance
 *    const store = new IdbFallback();
 *    store.get('test_key').then...
 */
class IdbFallback {
  /**
   * @param {string} databaseName - Name of IndexedDB database
   * @param {string} objectStoreName - Name of IndexedDB object store in database
   * @param {string} version - A string representing a the application's current storage schema
   *                           Change it to reset (clear) the IndexedDB store
   * @param {string} versionKey - Key used to store version in LocalStorage
   * @param {boolean} disableOnNewTabOpen - Whether to disable IndexedDB and copy all data to memory
   *                                        if this application is opened in a new tab (same latestTabKey)
   * @param {string} latestTabKey - Key used to store timestamp of latest tab open in LocalStorage, used
   *                                for detecting if this application is opened in a new tab
   * @param {function} onDisabled - Called when IndexedDB is disabled, with object
   *                                { wasInitialized: {boolean}, reason {string}, error {any} }
   */
  constructor({
    databaseName = 'keyval-store',
    objectStoreName = 'keyval',
    version = '0.1',
    versionKey = '__IndexedDB_version',
    disableOnNewTabOpen = true,
    latestTabKey = '__latest_tab',
    onDisabled = obj => console.error('IndexedDB usage disabled. Falling back to memory.', obj),
  } = {}) {
    if (typeof databaseName !== 'string') throw new Error('Invalid databaseName string');
    if (typeof objectStoreName !== 'string') throw new Error('Invalid objectStoreName string');
    if (typeof version !== 'string') throw new Error('Invalid version string');
    if (typeof versionKey !== 'string') throw new Error('Invalid versionKey string');
    if (typeof disableOnNewTabOpen !== 'boolean') throw new Error('Invalid disableOnNewTabOpen boolean');
    if (typeof onDisabled !== 'function') throw new Error('Invalid onDisabled function');

    // When IndexedDB is not available, store objects in memory
    this.fallbackStore = {};

    // Called if IndexedDB store cannot be initialized, or is intentionally disabled on new tab open
    this.onDisabled = onDisabled;

    // Reason for disabling / not initializing IndexedDB store
    this.disabledReason = null;

    // Reference to idb-keyval object store
    this.store = undefined;

    // Promise resolves with boolean indicating whether IndexedDB store can be used
    this.indexedDBReady = this.initStore(databaseName, objectStoreName, version, versionKey);

    // When a new tab is opened, disable IndexedDB and move all data to memory
    this.latestTabKey = latestTabKey;
    if (disableOnNewTabOpen) {
      this.indexedDBReady.then(useIndexedDB => {
        if (useIndexedDB) this.listenForNewTabOpen();
      });
    }
  }

  /**
   * Initial setup of IndexedDB key-value object store
   * Ensures version stored in LocalStorage matches specified version, or clears the IndexedDB store
   * @param {string} databaseName - Name of IndexedDB database
   * @param {string} objectStoreName - Name of IndexedDB object store in database
   * @param {string} latestVersion - A string representing a the application's current storage schema
   *                                 Change it to reset (clear) the IndexedDB store
   * @param {string} versionKey - Key used to store version in LocalStorage
   * @return {Promise<boolean>} - Use IndexedDB (true) or memory fallback (false)?
   */
  initStore(databaseName, objectStoreName, latestVersion, versionKey) {
    updateVersion = updateVersion.bind(this);
    handleBrowserError = handleBrowserError.bind(this);
    disable = disable.bind(this);

    /**
     * Create or open IndexedDB database ("keyval-store" database and "keyval" object store)
     * Doing this manually (instead of implicitly) allows us to handle startup errors in one place
     * _dbp (private property) resolves in IndexedDB.open worked, or rejects if it didn't
     */
    try {
      this.store = new Store(databaseName, objectStoreName);
    } catch (error) {
      // Handle an synchronous errors that won't be handled as events by the request.onerror handler
      // For instance, window.indexedDB is undefined in Microsoft Edge during Private Browsing
      handleBrowserError('new idbKeyval.Store failed', error);
      return Promise.resolve(false);
    }

    return this.store._dbp.then(
      // Database successfully opened
      () => updateVersion(),

      // Unable to open database
      error => handleBrowserError('indexedDB.open failed', error)
    );

    /**
     * If latest IndexedDB version string (this.version) is different from
     * the currently version, wipe the object store to reset all data
     * The currently version is stored in LocalStorage, so it can be fetched extremely fast
     * @return {boolean} - true or calls disable()
     */
    function updateVersion() {
      let dbVersion;
      try {
        dbVersion = localStorage.getItem(versionKey);
      } catch (error) {
        return disable(`Unable to read ${versionKey} from localStorage`, error);
      }

      // Version is already up-to-date. Allow IndexedDB access.
      if (dbVersion === latestVersion) return true;

      // Clear data from outdated version in IndexedDB
      return (
        idbKeyval
          .clear()
          .then(() => {
            // Update version in LocalStorage
            try {
              localStorage.setItem(versionKey, latestVersion);
            } catch (error) {
              return disable(`Unable to write ${versionKey} to localStorage`, error);
            }
            // Version update successful. Allow IndexedDB access.
            return true;
          })
          // Unable to clear data from IndexedDB.
          .catch(error => {
            return handleBrowserError('Unable to clear keys while upgrading version', error);
          })
      );
    }

    /**
     * Update IndexedDB error reasons for known browser-specific errors, typically
     * related to user choices (e.g. Private Browsing)
     * @param {string} reason
     * @param {Error/event} error
     * @return {boolean} false - calls disable()
     */
    function handleBrowserError(reason = '', error) {
      const isFirefox = /firefox/i.test(navigator.userAgent);
      const isEdge = /Edge/.test(navigator.userAgent);

      if (isFirefox && error.name === 'InvalidStateError') {
        reason = 'firefox_private_browsing';
      } else if (isFirefox && error.name === 'UnknownError') {
        reason = 'firefox_esr_user_profile_corrupted';
      } else if (isEdge && typeof window.indexedDB === 'undefined') {
        reason = 'edge_private_browsing';
      }

      return disable(reason, error);
    }

    /**
     * If anything goes awry during setup, disable IndexedDB usage
     * Similar to this.disable() except it returns false instead of overwriting this.IndexedDBReady
     * @param {string} reason
     * @param {any} error
     * @return {boolean} false
     */
    function disable(reason, error) {
      this.onDisabled({ wasInitialized: false, reason, error });
      this.disabledReason = reason;
      return false;
    }
  }

  /**
   * Disable IndexedDB usage
   * @param {string} reason
   * @param {any} error
   */
  disable(reason, error) {
    this.onDisabled({ wasInitialized: true, reason, error });
    this.disabledReason = reason;
    this.indexedDBReady = Promise.resolve(false);
  }

  /**
   * Get item from IndexedDB
   * @param {string} key
   * @param {boolean} [useFallback]
   * @return {Promise<any, any>}
   */
  get(key, { useFallback = true } = {}) {
    return this.indexedDBReady.then(useIndexedDB => {
      // Memory lookup
      if (useFallback && this.fallbackStore.hasOwnProperty(key)) {
        return this.fallbackStore[key];
      }

      // IndexedDB disabled
      if (!useIndexedDB) return;

      return get(key, this.store);
    });
  }

  /**
   * Set key to value in IndexedDB, optionally falling back to memory store
   * @param {string} key
   * @param {any} value
   * @param {boolean} [useFallback] - Store in memory if unable to use IndexedDB
   * @returns {Promise<object, any>} - will reject, or resolve with this object:
   *                              { store: 'memory' or 'IndexedDB' }
   */
  set(key, value, { useFallback = true } = {}) {
    return this.indexedDBReady.then(useIndexedDB => {
      // Remove any conflicting value in memory store
      if (this.fallbackStore.hasOwnProperty(key)) {
        delete this.fallbackStore[key];
      }

      // IndexedDB disabled
      if (!useIndexedDB) {
        // Fallback to memory store
        if (useFallback) {
          this.fallbackStore[key] = value;
          return { store: 'memory' };
        }
        return Promise.reject(this.disabledReason);
      }

      return set(key, value, this.store).then(
        // Successfully stored value in IndexedDB
        () => ({ store: 'IndexedDB' }),
        // Failed to store value in IndexedDB
        error => {
          // Fallback to memory store
          if (useFallback) {
            this.fallbackStore[key] = value;
            return { store: 'memory' };
          }
          return Promise.reject(error);
        }
      );
    });
  }

  /**
   * Delete key from IndexedDB
   * @param {string} key
   * @return {Promise(<undefined, any>)}
   */
  del(key) {
    return this.indexedDBReady.then(useIndexedDB => {
      // Delete from memory
      if (this.fallbackStore.hasOwnProperty(key)) {
        delete this.fallbackStore[key];
        return;
      }

      // IndexedDB disabled
      if (!useIndexedDB) return;

      // Delete from IndexedDB
      return del(key, this.store);
    });
  }

  /**
   * List all keys in IndexedDB and memory stores
   * @returns {Promise<object, any>} { indexedDB: {array}, memory: {array} }
   */
  keys() {
    return this.indexedDBReady.then(useIndexedDB => {
      const memoryKeys = Object.keys(this.fallbackStore);

      if (!useIndexedDB) {
        return { indexedDB: [], memory: memoryKeys };
      }

      return keys(this.store).then(keys => {
        return { indexedDB: keys, memory: memoryKeys };
      });
    });
  }

  /**
   * Delete everything in memory and IndexedDB store
   * @return {Promise(<undefined, any>)}
   */
  clear() {
    return this.indexedDBReady.then(useIndexedDB => {
      this.fallbackStore = {};

      if (!useIndexedDB) return;

      return clear(this.store);
    });
  }

  /**
   * When "latestTabKey" is updated in LocalStorage (e.g. by an application in another tab),
   * copy everything from IndexedDB to memory and disable IndexedDB in the current tab to
   * prevent write conflicts.
   */
  listenForNewTabOpen() {
    handleNewTabOpen = handleNewTabOpen.bind(this);

    // Set value in LocalStorage to alert other tabs that this tab has been opened
    const latestTabKey = this.latestTabKey,
      currentTimestamp = Date.now();

    try {
      localStorage.setItem(latestTabKey, currentTimestamp);
    } catch (error) {
      return this.disable(`Unable to write ${latestTabKey} to localStorage`, error);
    }

    // Listen for other tabs to change this value
    window.addEventListener('storage', handleNewTabOpen);

    function handleNewTabOpen(event) {
      if (event.key !== latestTabKey) return;

      // A new tab was opened
      // console.log('A new tab was opened. Timestamp = ', event.newValue);
      window.removeEventListener('storage', handleNewTabOpen);

      // Grab all the data from IndexedDB and copy it to memory, disabling IndexedDB usage going forward
      this.keys()
        .then(({ indexedDB }) =>
          Promise.all(
            indexedDB.map(key =>
              this.get(key).then(value => {
                this.fallbackStore[key] = value;
              })
            )
          )
        )
        .then(
          () => {
            this.disable('new_tab_opened');
          },
          error => {
            this.disable('new_tab_opened', error);
          }
        );
    }
  }
}

export default IdbFallback;
