const puppeteer = require('puppeteer');

describe('Store', async () => {
  let browser, page, recordsToStore;
  const localPath = 'http://localhost:5000';
  const imagePath = `${localPath}/__tests__/images`;

  // Lauch new headless page (which just loads UMD library)
  beforeAll(async () => {
    // let browser = await puppeteer.launch({ headless: false });
    browser = await puppeteer.launch();
    page = await browser.newPage();

    await page.goto(localPath);

    page.once('load', () => {});
    page.on('console', msg => console.log(msg.text()));

    // List of values to store in default object store
    recordsToStore = {
      negativeOnePointFive: -1.5,
      customer: { ssn: '444-44-4444', name: 'Bill', age: 35, email: 'bill@company.com' },
      testString: 'Mary had a little lamb',
      null: null,
      foreignChars: 'æøå',
      toBeDeleted: 'delete me',
    };
  });

  // Close browser
  afterAll(async () => {
    return await browser.close();
  });

  test('Init object store', async () => {
    const isSetup = await page.evaluate(async () => {
      window.idbFallback = new IdbFallback({ version: '0.1' });
      return await idbFallback.indexedDBReady;
    });
    expect(isSetup).toBe(true);
  });

  test('Set and get values', async () => {
    const storedRecords = await page.evaluate(async recordsToStore => {
      // Set values
      await Promise.all(
        Object.entries(recordsToStore).map(([key, value]) => {
          return idbFallback.set(key, value);
        })
      );
      // Get new key-values object for stored values
      return await Promise.all(Object.keys(recordsToStore).map(key => idbFallback.get(key))).then(values => {
        const keys = Object.keys(recordsToStore);
        return values.reduce((obj, val, index) => {
          obj[keys[index]] = val;
          return obj;
        }, {});
      });
    }, recordsToStore);
    expect(recordsToStore).toEqual(storedRecords);
  });

  test('Set and get blobs', async () => {
    const result = await page.evaluate(async imagePath => {
      const tinyBlob = await fetch(`${imagePath}/circle-down-0.5kb.svg`).then(res => res.blob());
      const largeBlob = await fetch(`${imagePath}/rona-lisa-2.3mb.jpg`).then(res => res.blob());

      // Convert blobs as array buffers, to ensure that storage mutations don't affect them
      const tinyAB = await blobToArrayBuffer(tinyBlob);
      const largeAB = await blobToArrayBuffer(largeBlob);

      const [storedTinyAB, storedLargeAB] = await Promise.all([
        idbFallback
          .set('tinyBlob', tinyBlob)
          .then(() => idbFallback.get('tinyBlob'))
          .then(blobToArrayBuffer),
        idbFallback
          .set('largeBlob', largeBlob)
          .then(() => idbFallback.get('largeBlob'))
          .then(blobToArrayBuffer),
      ]);

      // Clean up these blobs
      await Promise.all([idbFallback.del('tinyBlob'), idbFallback.del('largeBlob')]);

      return areBuffersEqual(tinyAB, storedTinyAB) && areBuffersEqual(largeAB, storedLargeAB);
    }, imagePath);

    expect(result).toBe(true);
  });

  test('Delete value', async () => {
    const key = 'toBeDeleted';
    const value = recordsToStore[key];
    const testPassed = await page.evaluate(
      async (key, value) => {
        const before = await idbFallback.get(key);
        await idbFallback.del(key);
        const after = await idbFallback.get(key);

        // Restore this deleted key
        await idbFallback.set(key, value);

        // Ensure before and after are what they should be
        // Check here instead of in parent test b/c undefined is coerced to null by JSON
        return before === value && after === undefined;
      },
      key,
      value
    );
    expect(testPassed).toBe(true);
  });

  test('Clear store on version update', async () => {
    const [beforeKeys, afterKeys, newStoreKeys] = await page.evaluate(async recordsToStore => {
      // Get current keys
      const beforeKeys = await idbFallback.keys().then(keys => keys.indexedDB);

      // Create a new idbFallback instance with a new version
      const newIdbFallback = new IdbFallback({ version: '0.2' });

      // Get keys from new instance (same store, but all keys should be deleted)
      const newStoreKeys = await newIdbFallback.keys().then(keys => keys.indexedDB);

      // Get keys from original instance (same store, but all keys should be deleted)
      const afterKeys = await idbFallback.keys().then(keys => keys.indexedDB);

      // Re-create original instance and add back original values
      window.idbFallback = new IdbFallback({ version: '0.1' });
      await Promise.all(
        Object.entries(recordsToStore).map(([key, value]) => {
          return idbFallback.set(key, value);
        })
      );

      return [beforeKeys, afterKeys, newStoreKeys];
    }, recordsToStore);

    expect(beforeKeys.sort()).toEqual(Object.keys(recordsToStore).sort());
    expect(afterKeys).toEqual([]);
    expect(newStoreKeys).toEqual([]);
  });

  test('Move values to memory when new tab is opened', async () => {
    // Avoid disrupting existing database & object stores
    const newDatabaseSettings = {
      databaseName: 'new-database',
      objectStoreName: 'test-new-tab',
      latestTabKey: '__test-latest-tab',
    };

    // Keys before tab is opened
    const beforeKeys = await page.evaluate(
      async (newDatabaseSettings, recordsToStore) => {
        // Create a new idbFallback instance with a new latest tab key
        window.newTabIdbFallback = new IdbFallback(newDatabaseSettings);
        // Store all values in this object store
        await Promise.all(
          Object.entries(recordsToStore).map(([key, value]) => {
            return newTabIdbFallback.set(key, value);
          })
        );
        return await newTabIdbFallback.keys();
      },
      newDatabaseSettings,
      recordsToStore
    );

    // Open new tab and setup IndexedDB in it
    const newTab = await browser.newPage();
    await newTab.goto(localPath);
    newTab.once('load', () => {});
    newTab.on('console', msg => console.log(msg.text()));
    await newTab.evaluate(async newDatabaseSettings => {
      window.idbFallback = new IdbFallback(newDatabaseSettings);
      // return await idbFallback.indexedDBReady;
    }, newDatabaseSettings);

    // Ensure all data in existing app have been moved to memory
    // after a brief delay
    const afterKeys = await page.evaluate(async () => {
      await waitSeconds(3);
      return await newTabIdbFallback.keys();
      function waitSeconds(seconds) {
        return new Promise(resolve => {
          setTimeout(resolve, seconds * 1000);
        });
      }
    });

    const allKeys = Object.keys(recordsToStore).sort();

    // console.log({ beforeKeys, afterKeys });

    expect(beforeKeys.indexedDB.sort()).toEqual(allKeys);
    expect(beforeKeys.memory).toEqual([]);

    expect(afterKeys.indexedDB).toEqual([]);
    expect(afterKeys.memory.sort()).toEqual(allKeys);
  });
});

function waitSeconds(seconds) {
  return new Promise(resolve => {
    setTimeout(resolve, seconds * 1000);
  });
}
