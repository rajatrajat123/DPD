import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

const BASE_URL = 'http://localhost:3000';
const BACKEND_URL = 'http://127.0.0.1:8080';

// Helper to generate valid PNG images of any dimensions
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  buf.writeUInt32BE(crc32(buf.subarray(4, 8 + len)), 8 + len);
  return buf;
}
function createValidPNG(width = 150, height = 150, r = 212, g = 175, b = 55) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2; // RGB
  const ihdr = makeChunk('IHDR', ihdrData);

  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pOffset = rowOffset + 1 + x * 3;
      rawData[pOffset] = r;
      rawData[pOffset + 1] = g;
      rawData[pOffset + 2] = b;
    }
  }
  const idat = makeChunk('IDAT', zlib.deflateSync(rawData));
  const iend = makeChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

test('Media Pipeline & 3-Photo Requirement Verification', async (t) => {
  // 1. Setup authenticated user
  const email = `media_test_${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Passw0r!Valid',
      display_name: 'Media Pipeline Tester',
      birthdate: '1996-03-20',
    }),
  });
  assert.equal(regRes.status, 200, 'Registration must succeed');
  const regCookies = regRes.headers.get('set-cookie') || '';
  const tokenMatch = regCookies.match(/aura_session=([^;]+)/);
  assert.ok(tokenMatch, 'Expected aura_session cookie');
  const token = tokenMatch[1];
  const cookieHeader = `aura_session=${token}`;

  // Age assurance verification (required by communityMw for discovery endpoints)
  const ageRes = await fetch(`${BASE_URL}/api/v1/age-assurance/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
  });
  assert.equal(ageRes.status, 200, 'Age assurance session must succeed');
  const ageData = await ageRes.json();
  const userId = ageData.session_id.split('_')[2];

  // Complete age verification via DEV_MOCK webhook
  const hookRes = await fetch(`${BACKEND_URL}/api/v1/age-assurance/webhook/DEV_MOCK`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Age-Signature': 'dev-mock-valid-sig',
    },
    body: JSON.stringify({
      event_id: `evt_${Date.now()}`,
      session_id: ageData.session_id,
      user_id: userId,
      status: 'VERIFIED',
      risk_score: 0,
    }),
  });
  assert.equal(hookRes.status, 200, 'Age verification webhook must succeed');

  let uploadedAssetIds = [];

  await t.test('1. Valid photo upload generates pure WebP derivatives and strips EXIF', async () => {
    const pngBuffer = createValidPNG(300, 300, 212, 175, 55);
    const formData = new FormData();
    const blob = new Blob([pngBuffer], { type: 'image/png' });
    formData.append('file', blob, 'portrait_1.png');
    formData.append('purpose', 'PROFILE_GALLERY');
    formData.append('media_type', 'IMAGE');

    const res = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: formData,
    });

    assert.equal(res.status, 201, `Upload should succeed with 201, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.id, 'Asset should have ID');
    assert.equal(data.status, 'READY', 'Status should be READY');
    assert.equal(data.moderation_verdict, 'APPROVED', 'Moderation should be APPROVED');
    assert.equal(data.exif_stripped, true, 'EXIF metadata must be stripped');
    assert.ok(data.derivatives && data.derivatives.length >= 3, 'Must have at least 3 derivatives');

    const variants = data.derivatives.map((d) => d.variant);
    assert.ok(variants.includes('THUMB_WEBP'), 'Must include THUMB_WEBP derivative');
    assert.ok(variants.includes('CARD_WEBP'), 'Must include CARD_WEBP derivative');
    assert.ok(variants.includes('FULL_WEBP'), 'Must include FULL_WEBP derivative');

    // Test streaming derivative with signed token
    const cardDeriv = data.derivatives.find((d) => d.variant === 'CARD_WEBP');
    assert.ok(cardDeriv.url, 'Derivative must have signed stream URL');
    assert.equal(cardDeriv.mime_type, 'image/webp', 'Derivative MIME must be image/webp');

    const streamRes = await fetch(`${BASE_URL}${cardDeriv.url}`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(streamRes.status, 200, 'Streaming derivative should return 200 OK');
    assert.equal(streamRes.headers.get('content-type'), 'image/webp', 'Streaming response must be image/webp');
    assert.ok(streamRes.headers.get('cache-control')?.includes('private'), 'Cache-Control must be private');

    uploadedAssetIds.push(data.id);
  });

  await t.test('2. Discovery feed and swiping enforce 3-photo minimum', async () => {
    // Currently only 1 photo uploaded
    const feedRes = await fetch(`${BASE_URL}/api/v1/discovery/feed`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(feedRes.status, 200);
    const feedData = await feedRes.json();
    assert.equal(feedData.empty_state_reason, 'PHOTO_MINIMUM_REQUIRED', 'Discovery must be blocked with 1 photo');
    assert.equal(feedData.candidates.length, 0, 'No candidates allowed when actor has < 3 photos');

    // Attempt swipe on a dummy target -> must be rejected with PHOTO_MINIMUM_REQUIRED
    const swipeRes = await fetch(`${BASE_URL}/api/v1/swipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        target_user_id: '00000000-0000-0000-0000-000000000001',
        direction: 'LIKE',
      }),
    });
    assert.equal(swipeRes.status, 400, 'Swipe must be blocked with 400');
    const swipeErr = await swipeRes.json();
    assert.equal(swipeErr.error?.code, 'PHOTO_MINIMUM_REQUIRED', 'Error code must be PHOTO_MINIMUM_REQUIRED');

    // Upload photo 2
    const png2 = createValidPNG(320, 320, 100, 150, 200);
    const fd2 = new FormData();
    fd2.append('file', new Blob([png2], { type: 'image/png' }), 'portrait_2.png');
    fd2.append('purpose', 'PROFILE_GALLERY');
    const res2 = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: fd2,
    });
    assert.equal(res2.status, 201);
    const data2 = await res2.json();
    uploadedAssetIds.push(data2.id);

    // Still blocked with 2 photos
    const feedRes2 = await fetch(`${BASE_URL}/api/v1/discovery/feed`, {
      headers: { Cookie: cookieHeader },
    });
    const feedData2 = await feedRes2.json();
    assert.equal(feedData2.empty_state_reason, 'PHOTO_MINIMUM_REQUIRED', 'Discovery still blocked with 2 photos');

    // Upload photo 3
    const png3 = createValidPNG(340, 340, 180, 80, 160);
    const fd3 = new FormData();
    fd3.append('file', new Blob([png3], { type: 'image/png' }), 'portrait_3.png');
    fd3.append('purpose', 'PROFILE_GALLERY');
    const res3 = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: fd3,
    });
    assert.equal(res3.status, 201);
    const data3 = await res3.json();
    uploadedAssetIds.push(data3.id);

    // With 3 photos, PHOTO_MINIMUM_REQUIRED is cleared!
    const feedRes3 = await fetch(`${BASE_URL}/api/v1/discovery/feed`, {
      headers: { Cookie: cookieHeader },
    });
    const feedData3 = await feedRes3.json();
    assert.notEqual(feedData3.empty_state_reason, 'PHOTO_MINIMUM_REQUIRED', 'Discovery requirement is fulfilled with 3 photos');
  });

  await t.test('3. Gallery endpoint accurately reflects meets_minimum status', async () => {
    const galRes = await fetch(`${BASE_URL}/api/v1/media/gallery/me`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(galRes.status, 200);
    const galData = await galRes.json();
    assert.equal(galData.count, 3, 'Gallery must report 3 photos');
    assert.equal(galData.minimum_required, 3, 'Minimum required must be 3');
    assert.equal(galData.meets_minimum, true, 'Meets minimum must be true');
    assert.equal(galData.assets.length, 3, 'Must return 3 assets');
  });

  await t.test('4. Active profile photo deletion guard preserves minimum photos', async () => {
    // Attempting to delete photo when count == 3 must fail
    const delRes = await fetch(`${BASE_URL}/api/v1/media/${uploadedAssetIds[0]}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(delRes.status, 400, 'Deleting below 3 photos for active profile must return 400');
    const delErr = await delRes.json();
    assert.equal(delErr.error?.code, 'PHOTO_MINIMUM_VIOLATION', 'Code must be PHOTO_MINIMUM_VIOLATION');

    // Upload a 4th photo
    const png4 = createValidPNG(360, 360, 90, 200, 110);
    const fd4 = new FormData();
    fd4.append('file', new Blob([png4], { type: 'image/png' }), 'portrait_4.png');
    fd4.append('purpose', 'PROFILE_GALLERY');
    const res4 = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: fd4,
    });
    assert.equal(res4.status, 201);
    const data4 = await res4.json();

    // Now count is 4. Deleting 1 photo should succeed (leaving 3)
    const delRes2 = await fetch(`${BASE_URL}/api/v1/media/${data4.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(delRes2.status, 204, 'Deleting 4th photo down to 3 must succeed with 204 No Content');
  });

  await t.test('5. Moderation rejects explicit/NSFW content with HTTP 422', async () => {
    const cleanPng = createValidPNG(200, 200);
    const explicitMarker = Buffer.from('AURA_TEST_EXPLICIT_NSFW');
    const nsfwPayload = Buffer.concat([cleanPng, explicitMarker]);

    const fd = new FormData();
    fd.append('file', new Blob([nsfwPayload], { type: 'image/png' }), 'nsfw.png');
    fd.append('purpose', 'PROFILE_GALLERY');

    const res = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: fd,
    });
    assert.equal(res.status, 422, 'Explicit content must be rejected with 422');
    const err = await res.json();
    assert.equal(err.error?.code, 'MODERATION_REJECTED', 'Error code must be MODERATION_REJECTED');
  });

  await t.test('6. Polyglot and dimension limits are strictly enforced', async () => {
    // Polyglot with embedded script tag
    const cleanPng = createValidPNG(150, 150);
    const polyglot = Buffer.concat([cleanPng, Buffer.from('<' + 'script' + '>alert(1)</' + 'script>')]);
    const fdPoly = new FormData();
    fdPoly.append('file', new Blob([polyglot], { type: 'image/png' }), 'polyglot.png');
    fdPoly.append('purpose', 'PROFILE_GALLERY');

    const resPoly = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: fdPoly,
    });
    assert.equal(resPoly.status, 422, 'Polyglot payload must be rejected with 422');

    // Dimension too small (< 100px)
    const tinyPng = createValidPNG(50, 50);
    const fdTiny = new FormData();
    fdTiny.append('file', new Blob([tinyPng], { type: 'image/png' }), 'tiny.png');
    fdTiny.append('purpose', 'PROFILE_GALLERY');

    const resTiny = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: fdTiny,
    });
    assert.equal(resTiny.status, 422, 'Image < 100x100 must be rejected with 422');
  });

  await t.test('7. Video upload when FFmpeg is unconfigured returns honest HTTP 503', async () => {
    // Minimal MP4 container
    const dummyMP4 = Buffer.alloc(1024);
    dummyMP4.writeUInt32BE(1024, 0);
    dummyMP4.write('ftyp', 4, 4, 'ascii');
    dummyMP4.write('mp42', 8, 4, 'ascii');

    const fd = new FormData();
    fd.append('file', new Blob([dummyMP4], { type: 'video/mp4' }), 'clip.mp4');
    fd.append('purpose', 'PROFILE_GALLERY');
    fd.append('media_type', 'VIDEO');

    const res = await fetch(`${BASE_URL}/api/v1/media/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: fd,
    });
    assert.equal(res.status, 503, 'Video upload when FFmpeg is absent must return 503');
    const err = await res.json();
    assert.equal(err.error?.code, 'DEPENDENCY_UNAVAILABLE', 'Error code must be DEPENDENCY_UNAVAILABLE');
    assert.ok(err.error?.message?.includes('ffmpeg') || err.error?.message?.includes('transcoding'), 'Error message must honestly explain ffmpeg is unavailable');
  });
});
