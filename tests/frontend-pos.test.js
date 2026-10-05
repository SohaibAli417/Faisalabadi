// Guards on frontend/app.js and frontend/styles.css.
//
// The quick-add customer crash was a bare `useRef(...)` call in a file that only destructures
// useState/useMemo/useEffect from React. That is a ReferenceError at render time, which does not fail
// one component - it unmounts the entire React tree and leaves the cashier staring at a blank page the
// moment they add a customer from the POS search. Nothing in the server tests could ever have caught it,
// so the rule is pinned here instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'styles.css'), 'utf8');

test('every React hook used in app.js is actually available in that file', () => {
  // The one line that decides which React hooks may be called bare.
  const destructured = (appJs.match(/^const \{([^}]*)\} = React;/m) || [, ''])[1]
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);

  assert.ok(destructured.length, 'app.js must destructure its hooks from React in one place');

  // The project's own hooks (useQueuedActionCount and friends) are defined in this file too, so those
  // are allowed - but only because they really are declared here.
  const declaredHere = new Set([
    ...[...appJs.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]),
    ...[...appJs.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)].map(match => match[1])
  ]);

  // Any bare `useSomething(` call - not `React.useSomething(` - must resolve to something that exists.
  const bare = [...new Set([...appJs.matchAll(/(?<![.\w$])(use[A-Z]\w*)\s*\(/g)].map(match => match[1]))];
  const missing = bare.filter(name => !destructured.includes(name) && !declaredHere.has(name));

  assert.deepEqual(
    missing, [],
    `these hooks are called but never imported: ${missing.join(', ')}. Use React.useX() or add it to the destructuring - otherwise the screen blanks when the component renders.`
  );
});

test('the quick-add customer modal never calls a bare hook again', () => {
  const start = appJs.indexOf('function QuickAddCustomerModal(');
  assert.notEqual(start, -1, 'the quick-add customer modal must still exist');
  const body = appJs.slice(start, appJs.indexOf('\nfunction ', start + 1));

  assert.ok(/React\.useRef\(/.test(body), 'the modal must reach for the hook as React.useRef');
  const allowed = new Set((appJs.match(/^const \{([^}]*)\} = React;/m) || [, ''])[1]
    .split(',').map(name => name.trim()));
  const stray = [...new Set([...body.matchAll(/(?<![.\w$])(use[A-Z]\w*)\s*\(/g)].map(m => m[1]))]
    .filter(name => !allowed.has(name));
  assert.deepEqual(stray, [], `the modal calls hooks it never imported: ${stray.join(', ')}`);
});

test('the product search keeps auto-filling the cart', () => {
  // Typing in the search box, then tapping a product, must drop it straight into the cart with its own
  // price and unit - no extra confirm step. The qty presets and the Add button are the same path.
  const addFromSearch = appJs.slice(
    appJs.indexOf('function addFromSearch('),
    appJs.indexOf('function addProductQty(')
  );
  assert.ok(/addProduct\(product\)/.test(addFromSearch), 'picking a search result must add the product');
  assert.ok(/setQuery\(''\)/.test(addFromSearch), 'the box is cleared so the next item can be typed');
  assert.ok(/searchRef\.current\.focus\(\)/.test(addFromSearch), 'focus returns to the box for fast counting');

  // The qty presets add straight to the cart too, and do not re-add the row as a duplicate.
  const addQty = appJs.slice(
    appJs.indexOf('function addProductQty('),
    appJs.indexOf('function addManualItem(')
  );
  assert.ok(/setCart\(items =>/.test(addQty), 'a qty preset must write into the cart');
  assert.ok(/basePrice: Number\(product\.price\)/.test(addQty), 'the cart row carries the searched price');

  // And the dropdown still offers the presets and the Add button.
  assert.ok(/className: 'qty-preset'/.test(appJs), 'search results keep their qty presets');
  assert.ok(/className: 'qty-preset add-one'/.test(appJs), 'search results keep their Add button');
});

test('a customer typed into the POS search joins the list and is selected before the reload', () => {
  // Otherwise the khata panel beside the box stays blank until the next full refresh, which reads to the
  // cashier as "the customer was not saved".
  const onSaved = appJs.slice(
    appJs.indexOf('onSaved: created => {'),
    appJs.indexOf('onClose: () => setNewCustomerOpen(false)')
  );
  assert.ok(/applyCustomer\(created\)/.test(onSaved), 'the new row must be added to the screen data');
  assert.ok(/selectCustomer\(created\)/.test(onSaved), 'the new customer must be selected straight away');
  assert.equal(
    /await refresh\(\);\s*\/\/ Straight onto/.test(onSaved), false,
    'the panel must not wait on the network before it is filled in'
  );

  const applyCustomer = appJs.slice(
    appJs.indexOf('function applyCustomer('),
    appJs.indexOf('function applyCustomer(') + 900
  );
  assert.ok(/customers/.test(applyCustomer), 'applyCustomer writes into the customer list');
  assert.ok(/row\.id === customer\.id/.test(applyCustomer), 'an existing row is replaced, not duplicated');
});

test('switching customer drops the previous khata instead of leaving it under the new name', () => {
  const start = appJs.indexOf('function selectCustomer(');
  const selectCustomer = appJs.slice(start, appJs.indexOf('\n  function ', start + 1));
  assert.ok(/setProfile\(null\)/.test(selectCustomer), 'the stale ledger must be cleared on the new pick');
});

test('a WhatsApp bill is only offered while there is something to send', () => {
  // The bill in the cart can always go. Falling back to the customer's last khata bill may not, because
  // once the remaining is zero there is no bill left to send.
  assert.ok(
    /const billForShare = currentBillForShare \|\| \(canShareBill && customerOwes/.test(appJs),
    'the khata fallback bill is gated on money still owed'
  );
  assert.ok(/currentBillForShare \|\| \(canShareBill && customerOwes && lastProfileSale/.test(appJs));

  // The khata modal's own two buttons obey the same rule.
  const headerWa = appJs.match(/customer\.phone &&[^;]*?waLink\(customer\.phone, khataStatementText/);
  assert.ok(headerWa, 'the khata header WhatsApp button must exist');
  assert.ok(/Number\(balance\) > 0/.test(headerWa[0]), 'the khata header button is hidden at zero remaining');

  const entryWa = appJs.match(/entry\.type === 'sale' && customer\.phone[^?]*\? h\('button', \{ className: 'wa-btn entry-wa'/);
  assert.ok(entryWa, 'the per-bill WhatsApp button must exist');
  assert.ok(/Number\(balance\) > 0/.test(entryWa[0]), 'a settled khata row offers no bill to resend');
});

test('every WhatsApp bill image prints a grand total', () => {
  // The live cart, a finished receipt and an old khata row all reach drawBillImage in different shapes.
  // Without a fallback, any one of them missing `total` produced an image reading "Total Rs 0".
  const draw = appJs.slice(
    appJs.indexOf('function drawBillImage('),
    appJs.indexOf('function drawBillImage(') + 4000
  );
  assert.ok(
    /\[sale\.total, sale\.amount, sale\.subtotal\]/.test(draw),
    'the total must fall back through the other names a bill can arrive under'
  );
  assert.ok(
    /grandTotalSource === undefined \? 0 : Number\(grandTotalSource\)/.test(draw),
    'a missing total must resolve to 0 rather than NaN, and null must not read as 0'
  );
  assert.ok(
    /money\(grandTotal\)/.test(draw),
    'the grand total row must use the resolved figure, not the raw sale.total'
  );
  assert.equal(/money\(sale\.total\)/.test(draw), false, 'no totals row may read sale.total directly');
});

test('the POS is two columns on a phone, with the khata beside the search box', () => {
  const mobile = stylesCss.slice(stylesCss.indexOf('@media (max-width: 760px)'));
  assert.ok(/@media \(max-width: 760px\)/.test(mobile), 'the phone breakpoint must exist');

  const layout = mobile.slice(mobile.indexOf('.pos-layout {'), mobile.indexOf('.pos-layout .checkout-section'));
  assert.ok(/display: grid/.test(layout), 'the phone layout is a grid, not a single-column stack');
  assert.ok(/grid-template-areas/.test(layout));
  assert.ok(/"search\s+checkout"/.test(layout), 'the khata column must sit beside the search box');
  assert.equal(
    /minmax\(360px/.test(layout), false,
    'no fixed column minimum, or the grid would scroll sideways on a narrow phone'
  );
  // display: contents would dissolve the khata column back out of the grid.
  assert.equal(/display: contents/.test(mobile.slice(mobile.indexOf('.checkout-section'), mobile.indexOf('.invoice-header'))), false);
});

test('the hamburger is hidden on the desktop too', () => {
  const desktop = stylesCss.slice(
    stylesCss.indexOf('@media (min-width: 761px)'),
    stylesCss.indexOf('@media (max-width: 760px)')
  );
  assert.ok(/\.menu-btn \{ display: none !important; \}/.test(desktop), 'the desktop hamburger must stay hidden');
  // Hiding it is only safe while the sidebar itself is still on screen.
  assert.equal(/pos-hidden/.test(appJs), false, 'nothing hides the desktop sidebar, so navigation is never lost');
});

test('the cached asset versions all agree', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'sw.js'), 'utf8');

  const htmlVersions = [...indexHtml.matchAll(/(styles\.css|app\.js|manual\.css)\?v=(\d+)/g)]
    .map(match => match[2]);
  assert.ok(htmlVersions.length, 'index.html must pin its asset versions');
  assert.equal(new Set(htmlVersions).size, 1, `index.html asset versions disagree: ${htmlVersions.join(', ')}`);

  const cacheName = (swJs.match(/CACHE_NAME = '([^']+)'/) || [])[1] || '';
  assert.ok(
    cacheName.endsWith('v' + htmlVersions[0]),
    `sw.js caches ${cacheName} but index.html serves v${htmlVersions[0]} - the service worker would keep serving the old app`
  );

  const swVersions = [...swJs.matchAll(/["']\/(?:styles\.css|app\.js|manual\.css)\?v=(\d+)["']/g)].map(match => match[1]);
  assert.ok(swVersions.length, 'sw.js must pin its cached asset versions');
  assert.deepEqual([...new Set(swVersions)], [htmlVersions[0]], 'sw.js and index.html must pin the same version');
});

// Complete & Print felt like it hung: the save is answered in well over a second by the hosted server and
// the receipt was only ever put on screen after that answer came back, so the counter watched a dead button
// for the whole wait. The bill now appears the moment the button is tapped.
test('the receipt goes up the moment Complete is tapped, not after the save answers', () => {
  const charge = appJs.slice(appJs.indexOf('async function charge(printAfter)'));
  const body = charge.slice(0, charge.indexOf('\n  const chargeRef'));

  const optimistic = body.indexOf('setReceipt(localBill({ saving: true }))');
  const post = body.indexOf("client.post('/api/sales'");
  assert.ok(optimistic > -1, 'charge() must put an instant receipt up before it waits on the server');
  assert.ok(post > -1, 'charge() should still save the sale on the server');
  assert.ok(
    optimistic < post,
    'the instant receipt has to be set before the request, otherwise the cashier still stares at nothing while it saves'
  );

  // The instant copy carries no invoice number, so it must never be the one that gets printed.
  assert.ok(
    /\.receipt-modal:not\(\.saving\) \.receipt/.test(appJs),
    'print must wait for the settled receipt - the instant copy has no invoice number and would print a bill with none'
  );

  // A refused save must take the instant receipt back down, or a bill that does not exist stays on screen.
  const refused = body.slice(body.indexOf('} else {', body.indexOf('catch (err)')));
  assert.ok(
    /setReceipt\(null\)/.test(refused),
    'when the save is refused the instant receipt must be cleared, not left on screen as a bill'
  );

  // The real, numbered receipt still replaces it, and the offline path still prints its own copy.
  assert.ok(
    /setReceipt\(\{ \.\.\.sale, previousBalance: prevBalance/.test(body),
    'the saved invoice must replace the instant receipt when the server answers'
  );
  assert.ok(
    (body.match(/schedulePrint\(\)/g) || []).length >= 2,
    'both the saved and the offline receipt must still be able to print'
  );
});

test('the instant receipt announces that it is still being saved', () => {
  assert.ok(
    /receipt-modal' \+ \(sale\.saving \? ' saving' : ''\)/.test(appJs),
    'the receipt modal must be marked while the save is in flight - the print selector depends on that class'
  );
  assert.ok(
    /sale\.saving && h\('div', \{ className: 'receipt-banner no-print saving-banner'/.test(appJs),
    'the cashier needs to see that the bill is real and only the number is on its way'
  );
  // The instant copy is built as a preview, so without this it would show "not a saved invoice" as well.
  assert.ok(
    /sale\.preview && !sale\.saving && h\('div', \{ className: 'receipt-banner no-print'/.test(appJs),
    'the saving banner replaces the preview banner; showing both at once reads as a contradiction'
  );
  assert.ok(/\.saving-banner \{/.test(stylesCss), 'saving-banner must be styled');
  // The banner is no-print, so a half-saved bill can never reach paper.
  assert.ok(
    /saving-banner/.test(appJs) && /no-print/.test(appJs),
    'the saving banner must carry no-print so it is never printed'
  );
});

test('the instant receipt and the on-screen preview are built from one place', () => {
  assert.ok(/function localBill\(overrides\)/.test(appJs), 'a shared bill builder must exist');
  assert.ok(
    /setReceipt\(localBill\(\)\)/.test(appJs),
    'previewSale must use the shared builder'
  );
  assert.ok(
    /setReceipt\(localBill\(\{ saving: true \}\)\)/.test(appJs),
    'the instant receipt must use the same builder, so the two cannot drift apart'
  );
});