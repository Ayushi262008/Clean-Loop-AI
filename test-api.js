/**
 * EcoTrack Backend End-to-End Test Suite
 * Validates authentication, authorization, ownership, database persistence,
 * input validation, error handling, and stats consistency.
 */

const { EventEmitter } = require('events');
const { app, db } = require('./server');

// In-process Express Dispatcher
function request(options, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = options.method || 'GET';
    req.url = options.path;
    req.originalUrl = options.path;
    req.headers = {
      'content-type': 'application/json',
      ...(options.headers || {})
    };
    req.body = body ? JSON.parse(JSON.stringify(body)) : {};

    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
      res.body = data;
      resolve({ status: res.statusCode, headers: res.headers, body: res.body });
      return res;
    };
    res.send = (data) => {
      res.body = data;
      resolve({ status: res.statusCode, headers: res.headers, body: res.body });
      return res;
    };
    res.end = (data) => {
      if (data && !res.body) res.body = data;
      resolve({ status: res.statusCode, headers: res.headers, body: res.body });
      return res;
    };

    app.handle(req, res);
  });
}

// Test runner assertion helper
let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    results.push({ name: testName, ok: true });
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    results.push({ name: testName, ok: false });
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

async function runTests() {
  console.log('\n============================================================');
  console.log('       EcoTrack Backend Comprehensive End-to-End Tests      ');
  console.log('============================================================\n');

  try {
    // -----------------------------------------------------------------------
    // Test 1: Public Stats & DB Records
    // -----------------------------------------------------------------------
    console.log('[1] Testing Public Statistics Endpoint...');
    const statsRes = await request({ path: '/api/public-stats', method: 'GET' });
    assert(statsRes.status === 200, 'GET /api/public-stats returns HTTP 200');
    assert(typeof statsRes.body.total === 'number' && statsRes.body.total >= 0, 'Stats includes total complaints count');
    assert(typeof statsRes.body.resolved === 'number', 'Stats includes resolved complaints count');
    assert(typeof statsRes.body.pending === 'number', 'Stats includes pending complaints count');
    assert(typeof statsRes.body.citizens === 'number', 'Stats includes registered citizens count');
    assert(statsRes.body.total === statsRes.body.resolved + statsRes.body.pending, 'Total complaints equals resolved + pending');

    // -----------------------------------------------------------------------
    // Test 2: Citizen Registration & Validation
    // -----------------------------------------------------------------------
    console.log('\n[2] Testing Citizen Registration & Validation...');
    const uniqueNum = Date.now().toString().slice(-6);
    const citizenEmail = `citizen_${uniqueNum}@test.com`;

    // 2a. Short password validation
    const weakPassRes = await request({ path: '/api/auth/register', method: 'POST' }, {
      name: 'Test Citizen',
      contact: citizenEmail,
      password: '123'
    });
    assert(weakPassRes.status === 400, 'Register rejects password shorter than 6 chars (HTTP 400)');

    // 2b. Invalid contact validation
    const badContactRes = await request({ path: '/api/auth/register', method: 'POST' }, {
      name: 'Test Citizen',
      contact: 'not-an-email-or-phone',
      password: 'validPass123'
    });
    assert(badContactRes.status === 400, 'Register rejects invalid email/phone format (HTTP 400)');

    // 2c. Successful citizen registration
    const regRes = await request({ path: '/api/auth/register', method: 'POST' }, {
      name: 'Aryan Mehta',
      contact: citizenEmail,
      password: 'securePass123'
    });
    assert(regRes.status === 201, 'Citizen registers successfully (HTTP 201)');
    assert(Boolean(regRes.body.token), 'Registration returns signed JWT token');
    assert(regRes.body.user && regRes.body.user.role === 'citizen', 'New user role defaults to citizen');
    assert(regRes.body.user.points === 0, 'New user initial points equal 0');
    assert(!regRes.body.user.hash, 'Password hash is NOT exposed in response payload');

    const citizenToken = regRes.body.token;
    const citizenId = regRes.body.user.id;

    // 2d. Duplicate registration rejection
    const dupRes = await request({ path: '/api/auth/register', method: 'POST' }, {
      name: 'Duplicate Aryan',
      contact: citizenEmail,
      password: 'anotherPass123'
    });
    assert(dupRes.status === 409, 'Duplicate contact registration rejected with HTTP 409 Conflict');

    // -----------------------------------------------------------------------
    // Test 3: Citizen Login & Profile Verification
    // -----------------------------------------------------------------------
    console.log('\n[3] Testing Citizen Login & Profile...');
    // 3a. Invalid password
    const wrongPassRes = await request({ path: '/api/auth/login', method: 'POST' }, {
      contact: citizenEmail,
      password: 'wrongPassword!'
    });
    assert(wrongPassRes.status === 401, 'Login with wrong password returns HTTP 401 Unauthorized');

    // 3b. Correct credentials
    const loginRes = await request({ path: '/api/auth/login', method: 'POST' }, {
      contact: citizenEmail,
      password: 'securePass123'
    });
    assert(loginRes.status === 200, 'Login with valid credentials returns HTTP 200');
    assert(Boolean(loginRes.body.token), 'Login returns JWT token');
    assert(loginRes.body.user.contact === citizenEmail, 'Returned user contact matches');

    // 3c. Protected profile retrieval /api/me
    const meRes = await request({
      path: '/api/me',
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(meRes.status === 200, 'GET /api/me with valid Bearer token returns HTTP 200');
    assert(meRes.body.id === citizenId, 'Profile user ID matches authenticated user');

    // 3d. Access without token rejected
    const unauthRes = await request({ path: '/api/me', method: 'GET' });
    assert(unauthRes.status === 401, 'GET /api/me without Bearer token returns HTTP 401');

    // -----------------------------------------------------------------------
    // Test 4: Complaint Creation & Input Validation
    // -----------------------------------------------------------------------
    console.log('\n[4] Testing Complaint Creation & Validation...');
    // 4a. Empty area validation
    const emptyAreaRes = await request({
      path: '/api/reports',
      method: 'POST',
      headers: { authorization: `Bearer ${citizenToken}` }
    }, { area: '', description: 'Bin overflowing near the campus center' });
    assert(emptyAreaRes.status === 400, 'POST /api/reports rejects missing/empty area (HTTP 400)');

    // 4b. Short description validation
    const shortDescRes = await request({
      path: '/api/reports',
      method: 'POST',
      headers: { authorization: `Bearer ${citizenToken}` }
    }, { area: 'Block 4', description: 'bad' });
    assert(shortDescRes.status === 400, 'POST /api/reports rejects description < 5 characters (HTTP 400)');

    // 4c. Successful complaint creation with AI rule-based triage
    const reportRes = await request({
      path: '/api/reports',
      method: 'POST',
      headers: { authorization: `Bearer ${citizenToken}` }
    }, {
      area: 'Civil Lines Road, Block B',
      description: 'Community dustbin is full and overflowing with bad odor spreading near the hospital gate.',
      lat: 26.4720,
      lng: 80.3450
    });
    assert(reportRes.status === 201, 'POST /api/reports creates complaint (HTTP 201)');
    assert(reportRes.body.id > 0, 'Created complaint has valid numeric ID');
    assert(reportRes.body.category === 'Overflowing bin', 'AI triage correctly categorizes as Overflowing bin');
    assert(reportRes.body.priority === 'High', 'AI triage flags urgency as High (near hospital / odor)');
    assert(reportRes.body.status === 'Pending', 'Initial complaint status defaults to Pending');
    assert(reportRes.body.history && reportRes.body.history.length === 1, 'Initial audit history entry logged');
    assert(Boolean(reportRes.body.ai_tip), 'Complaint includes actionable citizen safety tip');

    const createdReportId = reportRes.body.id;

    // 4d. Verify points awarded (+10 for reporting)
    const pointsCheck = await request({
      path: '/api/me',
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(pointsCheck.body.points === 10, 'Citizen awarded +10 eco points for filing verified report');

    // -----------------------------------------------------------------------
    // Test 5: Complaint Listing & Ownership Enforcement
    // -----------------------------------------------------------------------
    console.log('\n[5] Testing Ownership & Authorization Enforcement...');
    // 5a. Recent reports feed
    const recentRes = await request({ path: '/api/reports/recent', method: 'GET' });
    assert(recentRes.status === 200, 'GET /api/reports/recent returns HTTP 200');
    assert(Array.isArray(recentRes.body) && recentRes.body.length > 0, 'Recent reports returns array');
    assert(recentRes.body[0].id === createdReportId, 'Most recently created complaint appears first');

    // 5b. Citizen's own reports listing
    const mineRes = await request({
      path: '/api/reports/mine',
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(mineRes.status === 200, 'GET /api/reports/mine returns HTTP 200');
    assert(mineRes.body.some(r => r.id === createdReportId), 'Citizen reports list includes newly created report');
    assert(Array.isArray(mineRes.body[0].history), 'Mine reports includes nested audit history');

    // 5c. Register Citizen Two
    const citizen2Email = `citizen2_${uniqueNum}@test.com`;
    const reg2 = await request({ path: '/api/auth/register', method: 'POST' }, {
      name: 'Pooja Nair',
      contact: citizen2Email,
      password: 'password123'
    });
    const citizen2Token = reg2.body.token;

    // 5d. Citizen Two attempts to view Citizen One's complaint (MUST BE FORBIDDEN)
    const trespassRes = await request({
      path: `/api/reports/${createdReportId}`,
      method: 'GET',
      headers: { authorization: `Bearer ${citizen2Token}` }
    });
    assert(trespassRes.status === 403, 'Citizen 2 attempting to view Citizen 1 complaint is rejected with HTTP 403 Forbidden');

    // 5e. Citizen One views their own complaint (MUST SUCCEED)
    const ownRes = await request({
      path: `/api/reports/${createdReportId}`,
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(ownRes.status === 200, 'Citizen 1 viewing own complaint returns HTTP 200');
    assert(ownRes.body.id === createdReportId, 'Returned complaint ID matches');

    // 5f. Citizen One attempts to access admin route (MUST BE FORBIDDEN)
    const adminBreach = await request({
      path: '/api/admin/reports',
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(adminBreach.status === 403, 'Citizen accessing /api/admin/reports returns HTTP 403 Forbidden');

    // -----------------------------------------------------------------------
    // Test 6: Admin Operations & Status Transitions
    // -----------------------------------------------------------------------
    console.log('\n[6] Testing Admin Operations & Status Transitions...');
    const adminContact = (process.env.ADMIN_CONTACT || 'admin@cleanloop.ai').toLowerCase().trim();
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    // 6a. Admin Login
    const adminLoginRes = await request({ path: '/api/auth/login', method: 'POST' }, {
      contact: adminContact,
      password: adminPass
    });
    assert(adminLoginRes.status === 200, 'Admin logs in successfully (HTTP 200)');
    assert(adminLoginRes.body.user.role === 'admin', 'Admin user has role=admin');
    const adminToken = adminLoginRes.body.token;

    // 6b. Admin overrides ownership to view any complaint
    const adminViewRes = await request({
      path: `/api/reports/${createdReportId}`,
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(adminViewRes.status === 200, 'Admin can view any citizen complaint (HTTP 200)');

    // 6c. Admin invalid status update validation
    const badStatusRes = await request({
      path: `/api/admin/reports/${createdReportId}`,
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}` }
    }, { status: 'InvalidStatusString' });
    assert(badStatusRes.status === 400, 'PATCH /api/admin/reports rejects invalid status enum (HTTP 400)');

    // 6d. Transition status: Pending -> Assigned
    const assignRes = await request({
      path: `/api/admin/reports/${createdReportId}`,
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}` }
    }, { status: 'Assigned', note: 'Dispatched Ward 14 Vehicle #7' });
    assert(assignRes.status === 200, 'Admin transitions status to Assigned (HTTP 200)');
    assert(assignRes.body.report.status === 'Assigned', 'Updated report status is Assigned');
    assert(assignRes.body.report.history.length === 2, 'History audit contains 2 entries now');

    // 6e. Transition status: Assigned -> Resolved (awards +20 points)
    const resolveRes = await request({
      path: `/api/admin/reports/${createdReportId}`,
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}` }
    }, { status: 'Resolved', note: 'Dumpster emptied and area sanitized.' });
    assert(resolveRes.status === 200, 'Admin transitions status to Resolved (HTTP 200)');
    assert(resolveRes.body.report.status === 'Resolved', 'Updated report status is Resolved');
    assert(resolveRes.body.report.history.length === 3, 'History audit contains 3 entries (Pending -> Assigned -> Resolved)');

    // 6f. Verify citizen awarded +20 points on resolution (10 initial + 20 resolve = 30)
    const citizenPointsAfterResolve = await request({
      path: '/api/me',
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(citizenPointsAfterResolve.body.points === 30, 'Citizen earned +20 additional points upon resolution (Total: 30 pts)');

    // 6g. Admin stats aggregation
    const adminStatsRes = await request({
      path: '/api/admin/stats',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(adminStatsRes.status === 200, 'Admin stats endpoint returns HTTP 200');
    assert(Array.isArray(adminStatsRes.body.byStatus), 'Admin stats includes byStatus array');
    assert(Array.isArray(adminStatsRes.body.byArea), 'Admin stats includes byArea array');
    assert(Array.isArray(adminStatsRes.body.byCategory), 'Admin stats includes byCategory array');

    // -----------------------------------------------------------------------
    // Test 7: Doorstep Pickup Flow
    // -----------------------------------------------------------------------
    console.log('\n[7] Testing Doorstep Pickup Flow...');
    // 7a. Schedule pickup validation
    const badPickupRes = await request({
      path: '/api/pickups',
      method: 'POST',
      headers: { authorization: `Bearer ${citizenToken}` }
    }, { type: 'E-waste', address: '' });
    assert(badPickupRes.status === 400, 'Pickup rejected when address is empty (HTTP 400)');

    // 7b. Schedule pickup success
    const pickupRes = await request({
      path: '/api/pickups',
      method: 'POST',
      headers: { authorization: `Bearer ${citizenToken}` }
    }, {
      type: '🔌 E-waste & electronics',
      address: 'Tower C, Apartment 802, Royal Gardens',
      pdate: '2026-11-05'
    });
    assert(pickupRes.status === 201, 'POST /api/pickups schedules pickup (HTTP 201)');
    assert(pickupRes.body.id > 0, 'Pickup has numeric ID');
    assert(pickupRes.body.status === 'Scheduled', 'Pickup status defaults to Scheduled');

    const pickupId = pickupRes.body.id;

    // 7c. Citizen views own pickups
    const myPickupsRes = await request({
      path: '/api/pickups/mine',
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(myPickupsRes.status === 200, 'GET /api/pickups/mine returns HTTP 200');
    assert(myPickupsRes.body.some(p => p.id === pickupId), 'Pickup appears in citizen pickup list');

    // 7d. Admin fulfills pickup
    const adminPickupFulfill = await request({
      path: `/api/admin/pickups/${pickupId}`,
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}` }
    }, { status: 'Completed' });
    assert(adminPickupFulfill.status === 200, 'Admin marks pickup Completed (HTTP 200)');
    assert(adminPickupFulfill.body.pickup.status === 'Completed', 'Pickup status updated to Completed');

    // -----------------------------------------------------------------------
    // Test 8: Segregation Assistant & Leaderboard
    // -----------------------------------------------------------------------
    console.log('\n[8] Testing Segregation Coach & Leaderboard...');
    const coachRes = await request({ path: '/api/awareness/ask', method: 'POST' }, {
      q: 'Used alkaline AA batteries',
      lang: 'English'
    });
    assert(coachRes.status === 200, 'POST /api/awareness/ask returns HTTP 200');
    assert(Boolean(coachRes.body.answer), 'Coach returns segregation answer');

    const leaderboardRes = await request({ path: '/api/leaderboard', method: 'GET' });
    assert(leaderboardRes.status === 200, 'GET /api/leaderboard returns HTTP 200');
    assert(Array.isArray(leaderboardRes.body), 'Leaderboard returns array of citizens');
    assert(leaderboardRes.body.some(u => u.name === 'Aryan Mehta' && u.points === 30), 'Citizen Aryan Mehta appears with 30 points on Leaderboard');

    // -----------------------------------------------------------------------
    // Test 9: Waste Hotspot Analytics & Real Coordinates
    // -----------------------------------------------------------------------
    console.log('\n[9] Testing Waste Hotspot Analytics Endpoint & Real Coordinates...');
    // 9a. Access guard: Citizen forbidden
    const citizenHotspotRes = await request({
      path: '/api/admin/hotspots',
      method: 'GET',
      headers: { authorization: `Bearer ${citizenToken}` }
    });
    assert(citizenHotspotRes.status === 403, 'Citizen blocked from /api/admin/hotspots with HTTP 403 Forbidden');

    // 9b. Access guard: Unauthenticated forbidden
    const unauthHotspotRes = await request({
      path: '/api/admin/hotspots',
      method: 'GET'
    });
    assert(unauthHotspotRes.status === 401, 'Unauthenticated request to /api/admin/hotspots returns HTTP 401');

    // 9c. Admin successful retrieval of hotspots
    const adminHotspotRes = await request({
      path: '/api/admin/hotspots',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(adminHotspotRes.status === 200, 'Admin accesses /api/admin/hotspots with HTTP 200 OK');
    assert(Boolean(adminHotspotRes.body.summary), 'Hotspots response includes summary metrics');
    assert(typeof adminHotspotRes.body.summary.totalAreas === 'number', 'Summary includes totalAreas count');
    assert(typeof adminHotspotRes.body.summary.totalUnresolved === 'number', 'Summary includes totalUnresolved count');
    assert(typeof adminHotspotRes.body.summary.criticalAreasCount === 'number', 'Summary includes criticalAreasCount');
    assert(Array.isArray(adminHotspotRes.body.hotspots), 'Hotspots response contains array of area clusters');
    assert(adminHotspotRes.body.hotspots.length > 0, 'Hotspots array contains real geographic areas from DB');

    const topSpot = adminHotspotRes.body.hotspots[0];
    assert(Boolean(topSpot.area), 'Top hotspot has valid area name');
    assert(typeof topSpot.totalReports === 'number' && topSpot.totalReports > 0, 'Top hotspot reports count is positive integer');
    assert(typeof topSpot.unresolvedReports === 'number', 'Top hotspot includes unresolvedReports count');
    assert(typeof topSpot.urgencyScore === 'number', 'Top hotspot has deterministic urgencyScore');
    assert(Boolean(topSpot.topCategory), 'Top hotspot includes top reported waste category');

    // 9d. Real GPS coordinates integrity check (No invented coordinates)
    const geocodedSpot = adminHotspotRes.body.hotspots.find(h => h.hasCoordinates);
    assert(Boolean(geocodedSpot), 'Database includes geocoded area with real coordinates');
    assert(typeof geocodedSpot.latitude === 'number' && typeof geocodedSpot.longitude === 'number', 'Geocoded area has valid numeric latitude and longitude');
    assert(geocodedSpot.latitude >= -90 && geocodedSpot.latitude <= 90, 'Latitude is within valid earthly bounds');
    assert(geocodedSpot.longitude >= -180 && geocodedSpot.longitude <= 180, 'Longitude is within valid earthly bounds');

    // 9e. Filter validation (rejection of invalid filter inputs)
    const badFilterRes = await request({
      path: '/api/admin/hotspots?timeRange=invalidRange',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(badFilterRes.status === 400, 'Hotspots API rejects invalid timeRange query param with HTTP 400');

    const badPriorityFilterRes = await request({
      path: '/api/admin/hotspots?priority=SuperUrgent',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(badPriorityFilterRes.status === 400, 'Hotspots API rejects invalid priority query param with HTTP 400');

    // 9f. Filter functionality: High priority filter
    const highFilterRes = await request({
      path: '/api/admin/hotspots?priority=High',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(highFilterRes.status === 200, 'GET /api/admin/hotspots?priority=High returns HTTP 200');
    assert(highFilterRes.body.hotspots.every(h => h.highPriorityCount > 0), 'Every returned hotspot area has High priority complaints');

    // 9g. Filter functionality: Unresolved status filter
    const unresolvedFilterRes = await request({
      path: '/api/admin/hotspots?status=unresolved',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(unresolvedFilterRes.status === 200, 'GET /api/admin/hotspots?status=unresolved returns HTTP 200');
    assert(unresolvedFilterRes.body.hotspots.every(h => h.unresolvedReports > 0), 'Every returned hotspot area has unresolved reports');

    // 9h. Filter functionality: Category filter
    const categoryFilterRes = await request({
      path: '/api/admin/hotspots?category=' + encodeURIComponent('Overflowing bin'),
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(categoryFilterRes.status === 200, 'GET /api/admin/hotspots?category=Overflowing bin returns HTTP 200');

  } catch (err) {
    console.error('\nFATAL ERROR DURING TEST EXECUTION:', err);
    failed++;
  } finally {
    console.log('\n============================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
    console.log('============================================================\n');
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
