# MediLink HMS — 10-Minute Demonstration Walkthrough ⏱️🏥

This walkthrough guides evaluators, clinicians, and stakeholders through the end-to-end patient journey in MediLink HMS across all **8 user roles in exact sequential order**.

---

## 🚀 Setup & Preparation (2 Minutes)

1. **Seed Demo Dataset:**
   ```bash
   cd backend
   npm run seed:demo
   ```
   *This seeds all 8 demo accounts, demo patient Adaeze Okafor (`ML-DEMO-001`), drug inventory, and linked clinic encounters.*

2. **Start Backend API:**
   ```bash
   npm run dev    # Running at http://localhost:3000
   ```

3. **Start Flutter App:**
   ```bash
   cd ../frontend
   flutter run
   ```

### Demo Credentials
All demo accounts use the standard password: **`Medilink@2026`**

| Order | Role | Email | Key Focus |
|---|---|---|---|
| 1 | **Patient** | `patient@medilink.dev` | Booking, digital hospital card, QR code |
| 2 | **Front Desk** | `front-desk@medilink.dev` | Fast QR check-in & clinic queueing |
| 3 | **Nurse** | `nurse@medilink.dev` | Vitals entry & offline sync queue |
| 4 | **Doctor** | `doctor@medilink.dev` | Encounter review, lab ordering, e-prescribing |
| 5 | **Lab Scientist** | `lab-scientist@medilink.dev` | Worklist processing & abnormal result flags |
| 6 | **Pharmacist** | `pharmacist@medilink.dev` | Prescription verification & drug dispensing |
| 7 | **Billing Officer** | `billing-officer@medilink.dev` | Stablecoin settlements & Soroban HMO claims |
| 8 | **Admin** | `admin@medilink.dev` | Live hospital KPIs & on-chain audit trail |

---

## ⏱️ 10-Minute Script (Role-by-Role)

### Phase 1: Patient (`0:00 – 1:15`)
- **Action:** Log in as `patient@medilink.dev`.
- **Screen:** Patient Dashboard & Digital Hospital Card.
- **Narration:**
  > *"Adaeze opens MediLink on her mobile device. She sees her upcoming appointment at the General Outpatient Clinic (GOPD) and opens her digital Hospital Card. The card displays her unique ID `ML-DEMO-001` and a dynamic QR code containing only her anonymized ID—ensuring zero Protected Health Information (PHI) is exposed."*

---

### Phase 2: Front Desk (`1:15 – 2:30`)
- **Action:** Log out and log in as `front-desk@medilink.dev`.
- **Screen:** Front Desk Check-in & Queue Management.
- **Narration:**
  > *"At the entrance, the Front Desk Officer scans Adaeze's QR code. The system resolves her record in under 2 seconds, confirms her appointment, and assigns her ticket code `Q-001` in the GOPD queue. Live WebSocket updates broadcast her position to both the hospital displays and Adaeze's phone."*

---

### Phase 3: Nurse (`2:30 – 3:45`)
- **Action:** Switch to `nurse@medilink.dev`.
- **Screen:** Nurse Triage Queue & Vitals Entry.
- **Narration:**
  > *"The triage nurse calls Adaeze from the digital queue. Entering vitals (BP 120/80, Temperature 38.4°C, SpO2 98%), the system flags the fever. Even if hospital Wi-Fi drops, Hive offline caching ensures vitals are queued locally and synchronized with timestamp conflict resolution once reconnected."*

---

### Phase 4: Doctor (`3:45 – 5:15`)
- **Action:** Switch to `doctor@medilink.dev`.
- **Screen:** Doctor Consultation & Clinical Encounter.
- **Narration:**
  > *"Dr. Alabi opens Adaeze's encounter. Vitals are immediately visible. Suspecting malaria, the doctor writes a clinical note, orders a rapid Malaria Parasite (MP) and FBC lab test, and creates an e-prescription for Artemether/Lumefantrine. Every access event creates a hashed audit record in the background."*

---

### Phase 5: Lab Scientist (`5:15 – 6:30`)
- **Action:** Switch to `lab-scientist@medilink.dev`.
- **Screen:** Lab Worklist & Result Entry.
- **Narration:**
  > *"In the laboratory, the lab scientist sees the urgent order on the digital worklist. Upon processing the blood sample, they enter the results: 'Positive (++) P. falciparum trophozoites'. The abnormal value triggers an immediate alert on the doctor's screen."*

---

### Phase 6: Pharmacist (`6:30 – 7:45`)
- **Action:** Switch to `pharmacist@medilink.dev`.
- **Screen:** Pharmacy Inbox & Dispensing.
- **Narration:**
  > *"The Chief Pharmacist reviews the e-prescription. Inventory quantities are atomically validated against stock (85 units remaining). Dispensing is held until payment confirmation is verified by the billing engine, preventing medication loss."*

---

### Phase 7: Billing Officer (`7:45 – 9:00`)
- **Action:** Switch to `billing-officer@medilink.dev`.
- **Screen:** Billing Dashboard, Stablecoin Invoices & HMO Claims.
- **Narration:**
  > *"The Billing Officer reviews Invoice `RCP-DEMO-2026-001` (₦13,000). The patient pays using USDC on Stellar Testnet, settling instantly with zero chargeback risk. Alternatively, for insured patients, the Soroban smart contract validates policy rules and initiates automated claim reimbursement."*

---

### Phase 8: Admin (`9:00 – 10:00`)
- **Action:** Switch to `admin@medilink.dev`.
- **Screen:** Admin Analytics Dashboard & On-Chain Audit Log Verifier.
- **Narration:**
  > *"Hospital leadership reviews real-time facility metrics: wait times, active clinics, revenue breakdown, and low stock warnings. Finally, the Admin accesses the Audit Trail: each clinical access produces a SHA-256 hash anchored to the Stellar ledger, proving tamper-free compliance with national privacy standards (NDPA 2023)."*

---

## 🛡️ Privacy & Compliance Summary
- **No PHI on Blockchain:** Only salted SHA-256 hashes, transaction amounts, and opaque invoice IDs touch Stellar.
- **Offline Reliability:** Nurse vitals and queue snapshots function seamlessly offline with background Hive syncing.
- **Role-Based Access Control:** Strict RBAC with 8 mutually isolated roles enforced at both API routes and mobile navigation guards.
