'use strict';

/**
 * Seed Demo Dataset — populates a complete end-to-end dataset for MediLink HMS.
 * Matches the 10-minute walkthrough script in DEMO.md following the 8 user roles:
 *   1. Patient (Adaeze Okafor)
 *   2. Front Desk (Front Desk Officer)
 *   3. Nurse (Triage Nurse)
 *   4. Doctor (Attending Physician)
 *   5. Lab Scientist (Laboratory Scientist)
 *   6. Pharmacist (Chief Pharmacist)
 *   7. Billing Officer (Hospital Billing Officer)
 *   8. Admin (Hospital Administrator)
 *
 * Run with: npm run seed:demo
 */

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, ROLES } = require('../src/models/User');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { DrugInventory } = require('../src/models/DrugInventory');
const { Appointment } = require('../src/models/Appointment');
const { QueueEntry } = require('../src/models/QueueEntry');
const { Encounter } = require('../src/models/Encounter');
const { Vitals } = require('../src/models/Vitals');
const { ClinicalNote } = require('../src/models/ClinicalNote');
const { LabRequest } = require('../src/models/LabRequest');
const { Prescription } = require('../src/models/Prescription');
const { Invoice } = require('../src/models/Invoice');
const { Payment } = require('../src/models/Payment');
const { HmoClaim } = require('../src/models/HmoClaim');
const { AuditLog } = require('../src/models/AuditLog');
const { mongodbUri, nodeEnv } = require('../src/config');

if (nodeEnv === 'production') {
  // eslint-disable-next-line no-console
  console.error('Seed demo script must NOT be run in production. Aborting.');
  process.exit(1);
}

const DEFAULT_PASSWORD = 'Medilink@2026';

function roleToSlug(role) {
  return role.toLowerCase().replace(/\s+/g, '-');
}

async function seedDemo() {
  await mongoose.connect(mongodbUri);
  // eslint-disable-next-line no-console
  console.log('Connected to MongoDB. Seeding demo dataset...');

  // 1. Seed the 8 Users
  const users = {};
  for (const role of ROLES) {
    const email = `${roleToSlug(role)}@medilink.dev`;
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name: `Demo ${role}`,
        email,
        password: DEFAULT_PASSWORD,
        role,
      });
      // eslint-disable-next-line no-console
      console.log(`  [user created] ${email} (${role})`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`  [user exists]  ${email} (${role})`);
    }
    users[role] = user;
  }

  // 2. Demo Clinic
  let clinic = await Clinic.findOne({ name: 'General Outpatient Clinic' });
  if (!clinic) {
    clinic = await Clinic.create({
      name: 'General Outpatient Clinic',
      description: 'Primary triage and general consultations',
      isActive: true,
      avgConsultationMinutes: 15,
    });
    // eslint-disable-next-line no-console
    console.log(`  [clinic created] ${clinic.name}`);
  }

  // 3. Demo Patient
  let patient = await Patient.findOne({ hospitalId: 'ML-DEMO-001' });
  if (!patient) {
    patient = await Patient.create({
      hospitalId: 'ML-DEMO-001',
      firstName: 'Adaeze',
      lastName: 'Okafor',
      dateOfBirth: new Date('1992-05-14'),
      gender: 'female',
      phone: '+2348012345678',
      email: users['Patient'].email,
      address: '14 Awolowo Way, Ikeja, Lagos',
      emergencyContact: {
        name: 'Emeka Okafor',
        relationship: 'Spouse',
        phone: '+2348087654321',
      },
      bloodGroup: 'O+',
      genotype: 'AA',
      allergies: ['Penicillin'],
      createdBy: users['Front Desk']._id,
    });
    // eslint-disable-next-line no-console
    console.log(`  [patient created] ${patient.firstName} ${patient.lastName} (ID: ${patient.hospitalId})`);
  }

  // 4. Pharmacy Inventory
  const inventoryItems = [
    {
      drugName: 'Artemether / Lumefantrine',
      formulation: '80mg/480mg tablet',
      quantityOnHand: 85,
      lowStockThreshold: 15,
      unitPriceKobo: 350000,
      batchNumber: 'ACT-2026-B1',
      expiryDate: new Date('2027-12-31'),
    },
    {
      drugName: 'Paracetamol',
      formulation: '500mg tablet',
      quantityOnHand: 400,
      lowStockThreshold: 50,
      unitPriceKobo: 50000,
      batchNumber: 'PCM-2026-C4',
      expiryDate: new Date('2028-06-30'),
    },
    {
      drugName: 'Amoxicillin / Clavulanate',
      formulation: '625mg tablet',
      quantityOnHand: 8, // Low stock demo trigger
      lowStockThreshold: 10,
      unitPriceKobo: 450000,
      batchNumber: 'AUG-2025-A2',
      expiryDate: new Date('2026-11-30'),
    },
  ];

  for (const item of inventoryItems) {
    let drug = await DrugInventory.findOne({ drugName: item.drugName });
    if (!drug) {
      drug = await DrugInventory.create(item);
      // eslint-disable-next-line no-console
      console.log(`  [inventory created] ${drug.drugName} (Stock: ${drug.quantityOnHand})`);
    }
  }

  // 5. Appointment
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  let appointment = await Appointment.findOne({ patient: patient._id });
  if (!appointment) {
    appointment = await Appointment.create({
      patient: patient._id,
      clinic: clinic._id,
      doctor: users['Doctor']._id,
      scheduledTime: today,
      status: 'checked-in',
      reason: '3-day intermittent fever and chills',
    });
    // eslint-disable-next-line no-console
    console.log(`  [appointment created] ${appointment._id}`);
  }

  // 6. Queue Entry
  let queueEntry = await QueueEntry.findOne({ patient: patient._id });
  if (!queueEntry) {
    queueEntry = await QueueEntry.create({
      patient: patient._id,
      clinic: clinic._id,
      queueNumber: 1,
      ticketCode: 'Q-001',
      status: 'in-consultation',
      priority: 'standard',
      checkedInBy: users['Front Desk']._id,
      checkedInAt: new Date(Date.now() - 3600000),
    });
    // eslint-disable-next-line no-console
    console.log(`  [queue entry created] ${queueEntry.ticketCode} (Position: 1)`);
  }

  // 7. Clinical Encounter
  let encounter = await Encounter.findOne({ patient: patient._id });
  if (!encounter) {
    encounter = await Encounter.create({
      patient: patient._id,
      doctor: users['Doctor']._id,
      nurse: users['Nurse']._id,
      clinic: clinic._id,
      queueEntry: queueEntry._id,
      status: 'completed',
      chiefComplaint: 'Intermittent fever, chills, fatigue, and headache for 3 days',
      primaryDiagnosis: {
        code: 'B54',
        description: 'Unspecified malaria (Plasmodium falciparum confirmed)',
      },
      startedAt: new Date(Date.now() - 3000000),
      completedAt: new Date(Date.now() - 1000000),
    });
    // eslint-disable-next-line no-console
    console.log(`  [encounter created] ${encounter._id}`);
  }

  // 8. Vitals
  let vitals = await Vitals.findOne({ patient: patient._id });
  if (!vitals) {
    vitals = await Vitals.create({
      patient: patient._id,
      encounter: encounter._id,
      recordedBy: users['Nurse']._id,
      systolicBp: 120,
      diastolicBp: 80,
      pulseRate: 78,
      respiratoryRate: 18,
      temperatureCelsius: 38.4, // Febrile
      spo2Percent: 98,
      weightKg: 64,
      heightCm: 165,
      isFlaggedAbnormal: true,
      abnormalNotes: 'Elevated body temperature: 38.4°C',
    });
    // eslint-disable-next-line no-console
    console.log(`  [vitals recorded] Temp: ${vitals.temperatureCelsius}°C, BP: ${vitals.systolicBp}/${vitals.diastolicBp}`);
  }

  // 9. Clinical Note
  let note = await ClinicalNote.findOne({ encounter: encounter._id });
  if (!note) {
    note = await ClinicalNote.create({
      encounter: encounter._id,
      patient: patient._id,
      author: users['Doctor']._id,
      subjective: 'Patient reports 3-day history of high fever, rigor, and generalized malaise.',
      objective: 'Alert, febrile (38.4°C), mild pallor. Chest clear, abdomen soft, no organomegaly.',
      assessment: 'Acute uncomplicated Plasmodium falciparum malaria.',
      plan: 'Ordered MP and FBC. Prescribed oral ACT Artemether/Lumefantrine. Advised hydration and rest.',
    });
    // eslint-disable-next-line no-console
    console.log(`  [clinical note created] Note ID: ${note._id}`);
  }

  // 10. Lab Request & Results
  let labRequest = await LabRequest.findOne({ encounter: encounter._id });
  if (!labRequest) {
    labRequest = await LabRequest.create({
      encounter: encounter._id,
      patient: patient._id,
      doctor: users['Doctor']._id,
      tests: ['Malaria Parasite (MP)', 'Full Blood Count (FBC)'],
      sampleType: 'Whole Blood',
      clinicalNotes: 'Rule out severe malaria and anemia',
      priority: 'urgent',
      feeKobo: 450000,
      status: 'completed',
      collectedBy: users['Lab Scientist']._id,
      collectedAt: new Date(Date.now() - 2500000),
      processedBy: users['Lab Scientist']._id,
      results: [
        {
          testName: 'Malaria Parasite',
          value: 'Positive (++) Plasmodium falciparum trophozoites seen',
          unit: 'grade',
          referenceRange: 'Negative',
          isAbnormal: true,
        },
        {
          testName: 'Hemoglobin (Hb)',
          value: '11.8',
          unit: 'g/dL',
          referenceRange: '12.0 - 15.5',
          isAbnormal: true,
        },
      ],
      completedAt: new Date(Date.now() - 2000000),
    });
    // eslint-disable-next-line no-console
    console.log(`  [lab request created] Status: ${labRequest.status}`);
  }

  // 11. Prescription & Dispensing
  let prescription = await Prescription.findOne({ encounter: encounter._id });
  if (!prescription) {
    prescription = await Prescription.create({
      encounter: encounter._id,
      patient: patient._id,
      doctor: users['Doctor']._id,
      medications: [
        {
          drugName: 'Artemether / Lumefantrine',
          dosage: '80mg/480mg',
          frequency: 'twice daily',
          durationDays: 3,
          instructions: 'Take 1 tablet with fatty meal or milk twice daily for 3 days',
          quantity: 6,
        },
        {
          drugName: 'Paracetamol',
          dosage: '500mg',
          frequency: 'three times daily',
          durationDays: 3,
          instructions: 'Take 2 tablets for fever/pain as needed',
          quantity: 18,
        },
      ],
      status: 'dispensed',
      dispensedBy: users['Pharmacist']._id,
      dispensedAt: new Date(Date.now() - 500000),
    });
    // eslint-disable-next-line no-console
    console.log(`  [prescription created] Status: ${prescription.status}`);
  }

  // 12. Invoice & Payment (Settled on Stellar Testnet)
  let invoice = await Invoice.findOne({ encounter: encounter._id });
  if (!invoice) {
    invoice = await Invoice.create({
      patient: patient._id,
      encounter: encounter._id,
      lineItems: [
        { description: 'Outpatient Consultation Fee', amountKobo: 500000, itemType: 'consultation' },
        { description: 'Lab: Malaria Parasite & FBC', amountKobo: 450000, itemType: 'lab' },
        { description: 'Pharmacy: ACT + Paracetamol', amountKobo: 350000, itemType: 'prescription' },
      ],
      status: 'paid',
      paymentMethod: 'stablecoin',
      receiptNumber: 'RCP-DEMO-2026-001',
      paidAt: new Date(Date.now() - 1500000),
      issuedBy: users['Billing Officer']._id,
    });
    // eslint-disable-next-line no-console
    console.log(`  [invoice created] Total: ₦${invoice.totalKobo / 100} — Status: ${invoice.status}`);

    await Payment.create({
      invoice: invoice._id,
      patient: patient._id,
      amountKobo: invoice.totalKobo,
      method: 'stablecoin',
      stellarTransactionHash: '4f2913e17cf6b14d284a75c13e5bebe7989396d21e84d4128f6e8df81c815ec6',
      status: 'confirmed',
    });
    // eslint-disable-next-line no-console
    console.log(`  [payment recorded] Stellar Tx: 4f2913...`);
  }

  // 13. HMO Claim (Soroban Smart Contract)
  let claim = await HmoClaim.findOne({ invoice: invoice._id });
  if (!claim) {
    claim = await HmoClaim.create({
      invoice: invoice._id,
      policyId: 'NHIA-78901',
      serviceCode: 1001,
      requestedAmountKobo: invoice.totalKobo,
      payoutAmountKobo: invoice.totalKobo,
      status: 'approved',
      onChainClaimId: '1001',
    });
    // eslint-disable-next-line no-console
    console.log(`  [hmo claim created] Policy: ${claim.policyId} — Status: ${claim.status}`);
  }

  // 14. Audit Log Anchored on Stellar
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const payload = `${users['Doctor']._id}|${patient._id}|read:patient_record|${now.toISOString()}|${salt}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  let auditLog = await AuditLog.findOne({ patientId: patient._id.toString() });
  if (!auditLog) {
    auditLog = await AuditLog.create({
      userId: users['Doctor']._id.toString(),
      patientId: patient._id.toString(),
      action: 'read:patient_record',
      encounterId: encounter._id.toString(),
      timestamp: now,
      salt,
      hashPayload: payload,
      hash,
      anchorStatus: 'anchored',
      stellarTxHash: '9a48fbe136511b0e3b97b0a316279930f3711904a081a29582d92bbefd8f3310',
    });
    // eslint-disable-next-line no-console
    console.log(`  [audit log anchored] SHA-256: ${hash.slice(0, 16)}... anchored on Stellar`);
  }

  await mongoose.disconnect();
  // eslint-disable-next-line no-console
  console.log('\nDemo dataset seed completed successfully!');
  // eslint-disable-next-line no-console
  console.log('Credentials: <role-slug>@medilink.dev / Medilink@2026 for all 8 roles.');
}

seedDemo().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Demo seed failed:', err);
  process.exit(1);
});
