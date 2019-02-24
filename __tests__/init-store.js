const puppeteer = require('puppeteer');

describe('Store', async () => {
  let page, recordsToStore;
  const localPath = 'http://localhost:5000';
  const imagePath = `${localPath}/__tests__/images`;

  // Lauch new headless page (which just loads UMD library)
  beforeAll(async () => {
    // let browser = await puppeteer.launch({ headless: false });
    let browser = await puppeteer.launch();
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
      window.idbFallback = new IdbFallback();
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
        // Ensure before and after are what they should be
        // Check here instead of in parent test b/c undefined is coerced to null by JSON
        return before === value && after === undefined;
      },
      key,
      value
    );
    expect(testPassed).toBe(true);
  });

  // test('Update version', async () => {
  //   // A Store is already in

  //   const twenty = await page.evaluate(async () => {
  //     return await idbFallback.get('twenty');
  //   });

  //   expect(twenty).toBe(20);
  // });
});
