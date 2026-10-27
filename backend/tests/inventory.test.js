'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { Prescription } = require('../src/models/Prescription');
const { DrugInventory } = require('../src/models/DrugInventory');
const { Invoice } = require('../src/models/Invoice');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

const VALID_DRUG = {
  drugName: 'Paracetamol',
  dose: '500mg tablet',
  frequency: 'four times daily',
  duration: '3 days',
  quantity: 12,
  unitPriceKobo: 1000,
};

async function makeFixtures() {
  const id = uid();
  const { token: pharmacistToken, user: pharmacistUser } = await createUserAndToken({
    role: 'Pharmacist', email: `ph${id}@t.com`,
  });
  const { token: adminToken, user: adminUser } = await createUserAndToken({
    role: 'Admin', email: `admin${id}@t.com`,
  });
  const { user: doctorUser } = await createUserAndToken({
    role: 'Doctor', email: `doc${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `Inv Clinic ${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Emeka', lastName: 'Okonkwo', dateOfBirth: '1980-01-01',
    gender: 'male', phone: `+2346${id}`, registeredBy: regUser._id,
  });
  const encounter = await Encounter.create({
    patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
  });

  return {
    pharmacistToken, pharmacistUser, adminToken, adminUser,
    doctorUser, clinic, patient, encounter,
  };
}

// ── Stock management (Admin) ──────────────────────────────────────────────────
describe('POST /inventory', () => {
  it('Admin can add a stock item', async () => {
    const { adminToken } = await makeFixtures();

    const res = await request(app)
      .post('/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        drugName: 'Metformin',
        formulation: '500mg tablet',
        quantityOnHand: 200,
        unitPriceKobo: 2000,
      });

    expect(res.status).toBe(201);
    expect(res.body.item.quantityOnHand).toBe(200);
  });

  it('Pharmacist cannot add stock (403)', async () => {
    const { pharmacistToken } = await makeFixtures();

    const res = await request(app)
      .post('/inventory')
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ drugName: 'Ibuprofen', formulation: '400mg tablet', quantityOnHand: 50 });

    expect(res.status).toBe(403);
  });
});

// ── Dispense — happy path ─────────────────────────────────────────────────────
describe('POST /inventory/dispense/:prescriptionId', () => {
  async function makeReadyToDispense(qty = 20) {
    const { pharmacistToken, doctorUser, patient, encounter } = await makeFixtures();

    const stock = await DrugInventory.create({
      drugName: 'Paracetamol',
      formulation: '500mg tablet',
      quantityOnHand: qty,
      lowStockThreshold: 5,
      unitPriceKobo: 1000,
    });

    const invoice = await Invoice.create({
      patient: patient._id,
      encounter: encounter._id,
      lineItems: [{ description: 'Paracetamol', amountKobo: 12000, itemType: 'prescription' }],
      totalKobo: 12000,
      status: 'paid',
    });

    const prescription = await Prescription.create({
      encounter: encounter._id, patient: patient._id,
      prescribedBy: doctorUser._id, drugs: [VALID_DRUG],
      status: 'sent', invoice: invoice._id,
    });

    return { pharmacistToken, prescription, stock, invoice };
  }

  it('Pharmacist can dispense a paid prescription and stock is decremented', async () => {
    const { pharmacistToken, prescription, stock } = await makeReadyToDispense(20);

    const res = await request(app)
      .post(`/inventory/dispense/${prescription._id}`)
      .set('Authorization', `Bearer ${pharmacistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.prescription.status).toBe('dispensed');

    const updatedStock = await DrugInventory.findById(stock._id);
    expect(updatedStock.quantityOnHand).toBe(20 - VALID_DRUG.quantity); // 8
  });

  it('Cannot dispense without a paid invoice (402)', async () => {
    const { pharmacistToken, doctorUser, patient, encounter } = await makeFixtures();

    await DrugInventory.create({
      drugName: 'Paracetamol', formulation: '500mg tablet',
      quantityOnHand: 50, unitPriceKobo: 1000,
    });

    // Invoice is 'pending', not 'paid'
    const invoice = await Invoice.create({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Paracetamol', amountKobo: 12000, itemType: 'prescription' }],
      totalKobo: 12000, status: 'pending',
    });

    const prescription = await Prescription.create({
      encounter: encounter._id, patient: patient._id,
      prescribedBy: doctorUser._id, drugs: [VALID_DRUG],
      status: 'sent', invoice: invoice._id,
    });

    const res = await request(app)
      .post(`/inventory/dispense/${prescription._id}`)
      .set('Authorization', `Bearer ${pharmacistToken}`);

    expect(res.status).toBe(402);
  });

  it('Cannot dispense when stock is insufficient (409)', async () => {
    const { pharmacistToken, prescription } = await makeReadyToDispense(5); // need 12

    const res = await request(app)
      .post(`/inventory/dispense/${prescription._id}`)
      .set('Authorization', `Bearer ${pharmacistToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/insufficient stock/i);
  });

  it('Concurrency: two simultaneous dispenses of the last unit — only one succeeds', async () => {
    // Stock = exactly VALID_DRUG.quantity (12). Two concurrent requests must
    // result in exactly one 200 and one 409.
    const { pharmacistToken, doctorUser, patient, encounter } = await makeFixtures();

    await DrugInventory.create({
      drugName: 'Paracetamol', formulation: '500mg tablet',
      quantityOnHand: VALID_DRUG.quantity, // exactly 12
      unitPriceKobo: 1000,
    });

    const invoice = await Invoice.create({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Paracetamol', amountKobo: 12000, itemType: 'prescription' }],
      totalKobo: 12000, status: 'paid',
    });

    // Create two separate prescriptions referencing the same invoice+stock
    const [rx1, rx2] = await Prescription.insertMany([
      {
        encounter: encounter._id, patient: patient._id,
        prescribedBy: doctorUser._id, drugs: [VALID_DRUG],
        status: 'sent', invoice: invoice._id,
      },
      {
        encounter: encounter._id, patient: patient._id,
        prescribedBy: doctorUser._id, drugs: [VALID_DRUG],
        status: 'sent', invoice: invoice._id,
      },
    ]);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/inventory/dispense/${rx1._id}`)
        .set('Authorization', `Bearer ${pharmacistToken}`),
      request(app)
        .post(`/inventory/dispense/${rx2._id}`)
        .set('Authorization', `Bearer ${pharmacistToken}`),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed (200), one must fail (409)
    expect(statuses).toEqual([200, 409]);

    // Stock must be exactly 0 — it was not double-decremented
    const stock = await DrugInventory.findOne({ drugName: 'Paracetamol' });
    expect(stock.quantityOnHand).toBe(0);
  });
});
