'use strict';

/**
 * Socket.IO authorization integration tests.
 *
 * Tests that:
 *  - Connections without a token are rejected.
 *  - Connections with an invalid token are rejected.
 *  - Authenticated connections are accepted.
 *  - Patients cannot join clinic rooms.
 *  - Staff can join clinic rooms.
 *  - Patients can join their own patient room.
 */

const http = require('http');
const { io: Client } = require('socket.io-client');
const createApp = require('../src/app');
const { createSocketServer } = require('../src/socket/socketServer');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');

setupTestDB();

let httpServer, serverUrl;

beforeAll((done) => {
  const app = createApp();
  httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  app.set('io', io);
  httpServer.listen(0, () => {
    const { port } = httpServer.address();
    serverUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  httpServer.close(done);
});

function makeClient(token, opts = {}) {
  return Client(serverUrl, {
    auth: token ? { token } : {},
    autoConnect: false,
    transports: ['websocket'],
    ...opts,
  });
}

function connectClient(client) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 5000);
    client.once('connect', () => { clearTimeout(timeout); resolve(); });
    client.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    client.connect();
  });
}

// ── Connection auth ───────────────────────────────────────────────────────────
describe('Socket.IO — connection authentication', () => {
  it('rejects connection without a token', async () => {
    const client = makeClient(null);
    await expect(connectClient(client)).rejects.toThrow(/token/i);
    client.disconnect();
  });

  it('rejects connection with an invalid token', async () => {
    const client = makeClient('not.a.valid.token');
    await expect(connectClient(client)).rejects.toThrow(/invalid|expired/i);
    client.disconnect();
  });

  it('accepts connection with a valid token', async () => {
    const { token } = await createUserAndToken({ role: 'Nurse' });
    const client = makeClient(token);
    await expect(connectClient(client)).resolves.toBeUndefined();
    client.disconnect();
  });
});

// ── Room authorization ────────────────────────────────────────────────────────
describe('Socket.IO — room authorization', () => {
  const fakeClinicId = '64b1234567890abcde123456';
  const fakePatientId = '64b1234567890abcde123457';

  it('Patient cannot join a clinic room', async () => {
    const { token } = await createUserAndToken({ role: 'Patient' });
    const client = makeClient(token);
    await connectClient(client);

    const result = await new Promise((resolve) => {
      client.emit('join:clinic', { clinicId: fakeClinicId }, resolve);
    });

    expect(result.error).toBeDefined();
    client.disconnect();
  });

  it('Nurse can join a clinic room', async () => {
    const { token } = await createUserAndToken({ role: 'Nurse' });
    const client = makeClient(token);
    await connectClient(client);

    const result = await new Promise((resolve) => {
      client.emit('join:clinic', { clinicId: fakeClinicId }, resolve);
    });

    expect(result.ok).toBe(true);
    client.disconnect();
  });

  it('Doctor can join a clinic room', async () => {
    const { token } = await createUserAndToken({ role: 'Doctor' });
    const client = makeClient(token);
    await connectClient(client);

    const result = await new Promise((resolve) => {
      client.emit('join:clinic', { clinicId: fakeClinicId }, resolve);
    });

    expect(result.ok).toBe(true);
    client.disconnect();
  });

  it('Patient can join their own patient room', async () => {
    const { token } = await createUserAndToken({ role: 'Patient' });
    const client = makeClient(token);
    await connectClient(client);

    const result = await new Promise((resolve) => {
      client.emit('join:patient', { patientId: fakePatientId }, resolve);
    });

    expect(result.ok).toBe(true);
    client.disconnect();
  });

  it('Staff cannot join a patient room via join:patient event', async () => {
    const { token } = await createUserAndToken({ role: 'Doctor' });
    const client = makeClient(token);
    await connectClient(client);

    const result = await new Promise((resolve) => {
      client.emit('join:patient', { patientId: fakePatientId }, resolve);
    });

    expect(result.error).toBeDefined();
    client.disconnect();
  });
});
