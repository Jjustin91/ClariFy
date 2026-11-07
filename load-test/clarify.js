import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const loginLatency = new Trend('clarify_login_duration', true);
const channelsLatency = new Trend('clarify_channels_duration', true);
const announcementsLatency = new Trend('clarify_announcements_duration', true);
const chatListLatency = new Trend('clarify_chat_list_duration', true);
const chatPostLatency = new Trend('clarify_chat_post_duration', true);

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:8000/api/v1';
const INSTITUTIONAL_ID = __ENV.TEST_INSTITUTIONAL_ID || '90001';
const PASSWORD = __ENV.TEST_PASSWORD || 'ustp2026';
const TARGET_CHANNEL_ID = Number(__ENV.TEST_CHANNEL_ID || 1);

export const options = {
  scenarios: {
    concurrent_campus_users: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: Number(__ENV.VUS || 25) },
        { duration: '45s', target: Number(__ENV.VUS || 25) },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    clarify_login_duration: ['p(95)<600'],
    clarify_channels_duration: ['p(95)<350'],
    clarify_announcements_duration: ['p(95)<350'],
    clarify_chat_list_duration: ['p(95)<300'],
    clarify_chat_post_duration: ['p(95)<400'],
  },
};

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      institutional_id: INSTITUTIONAL_ID,
      password: PASSWORD,
    }),
    {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }
  );

  let token = '';
  try {
    const body = loginRes.json();
    token = body && body.token ? String(body.token) : '';
  } catch {
    token = '';
  }

  return { token };
}

export default function (data) {
  let token = data.token;

  if (!token) {
    const loginRes = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({
        institutional_id: INSTITUTIONAL_ID,
        password: PASSWORD,
      }),
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    loginLatency.add(loginRes.timings.duration);
    check(loginRes, {
      'login status is 200': (r) => r.status === 200,
    });
    try {
      const parsed = loginRes.json();
      token = parsed && parsed.token ? String(parsed.token) : '';
    } catch {
      token = '';
    }
  }

  const authHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 1. Fetch Scoped Channels (summary payload without N+1 or full rosters)
  const channelsRes = http.get(`${BASE_URL}/channels`, {
    headers: authHeaders,
  });
  channelsLatency.add(channelsRes.timings.duration);
  check(channelsRes, {
    'GET /channels is 200': (r) => r.status === 200,
  });

  // 2. Fetch Announcements Feed (shared cached feed + batched read check)
  const annRes = http.get(
    `${BASE_URL}/announcements?sort=latest&page=1&per_page=4`,
    { headers: authHeaders }
  );
  announcementsLatency.add(annRes.timings.duration);
  check(annRes, {
    'GET /announcements is 200': (r) => r.status === 200,
  });

  // 3. Open Channel Chat (cursor-paginated latest 50 messages)
  const chatListRes = http.get(
    `${BASE_URL}/channels/${TARGET_CHANNEL_ID}/messages?limit=50`,
    { headers: authHeaders }
  );
  chatListLatency.add(chatListRes.timings.duration);
  check(chatListRes, {
    'GET /channels/:id/messages is 200 or 403': (r) =>
      r.status === 200 || r.status === 403,
  });

  sleep(1);

  // 4. Post a Chat Message every few seconds
  const tempId = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const chatPostRes = http.post(
    `${BASE_URL}/channels/${TARGET_CHANNEL_ID}/messages`,
    JSON.stringify({
      content: `Load test message from VU #${__VU} iter ${__ITER}`,
      temp_id: tempId,
    }),
    { headers: authHeaders }
  );
  chatPostLatency.add(chatPostRes.timings.duration);
  check(chatPostRes, {
    'POST /channels/:id/messages is 201 or 403': (r) =>
      r.status === 201 || r.status === 403,
  });

  sleep(2);
}
