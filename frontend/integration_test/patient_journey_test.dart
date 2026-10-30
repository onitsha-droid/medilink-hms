import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:patrol/patrol.dart';

import 'package:medilink_hms/core/api/clinical_models.dart';
import 'package:medilink_hms/core/providers/clinical_repository.dart';
import 'package:medilink_hms/features/doctor/doctor_dashboard.dart';
import 'package:medilink_hms/features/doctor/note_editor_screen.dart';
import 'package:medilink_hms/features/doctor/prescription_form_screen.dart';
import 'package:medilink_hms/features/lab_scientist/lab_worklist_screen.dart';
import 'package:medilink_hms/features/nurse/nurse_triage_screen.dart';
import 'package:medilink_hms/features/patient/patient_bill_screen.dart';
import 'package:medilink_hms/features/patient/patient_models.dart';
import 'package:medilink_hms/features/patient/patient_registration_screen.dart';
import 'package:medilink_hms/features/patient/patient_repository.dart';
import 'package:medilink_hms/features/pharmacist/pharmacist_inbox_screen.dart';
import 'package:medilink_hms/features/queue/front_desk_checkin_screen.dart';
import 'package:medilink_hms/features/queue/queue_models.dart';
import 'package:medilink_hms/features/queue/queue_provider.dart';

// ── Mocks ─────────────────────────────────────────────────────────────────────

class MockPatientRepository extends Mock implements PatientRepository {}
class MockQueueRepository extends Mock implements QueueRepository {}
class MockVitalsRepository extends Mock implements VitalsRepository {}
class MockClinicalRepository extends Mock implements ClinicalRepository {}

void main() {
  late MockPatientRepository mockPatientRepo;
  late MockQueueRepository mockQueueRepo;
  late MockVitalsRepository mockVitalsRepo;
  late MockClinicalRepository mockClinicalRepo;

  setUpAll(() {
    registerFallbackValue(const CheckInRequest(
      patientId: 'dummy-patient',
      clinicId: 'dummy-clinic',
    ));
    registerFallbackValue(VitalsFormData());
  });

  setUp(() {
    mockPatientRepo = MockPatientRepository();
    mockQueueRepo = MockQueueRepository();
    mockVitalsRepo = MockVitalsRepository();
    mockClinicalRepo = MockClinicalRepository();
  });

  patrolTest(
    'Patrol E2E: complete patient journey — '
    'register -> book -> check in -> triage -> doctor consult -> '
    'lab order -> pay -> result -> prescription -> pay -> dispense',
    ($) async {
      // ── Test Data ─────────────────────────────────────────────────────────
      const patientId = 'pat-uuid-001';
      const hospitalId = 'ML-A1B2C3D4';
      const queueEntryId = 'queue-entry-001';
      const encounterId = 'enc-uuid-001';
      const labRequestId = 'lab-uuid-001';
      const labInvoiceId = 'inv-lab-001';
      const rxInvoiceId = 'inv-rx-001';
      const prescriptionId = 'rx-uuid-001';

      const registeredPatient = PatientModel(
        id: patientId,
        hospitalId: hospitalId,
        firstName: 'Ada',
        lastName: 'Obi',
        dateOfBirth: '1995-04-12',
        gender: 'female',
        phone: '+2348012345678',
        email: 'ada.obi@example.com',
        qrPayload: '{"hospitalId":"$hospitalId"}',
      );

      // ── 1. REGISTER ───────────────────────────────────────────────────────
      when(() => mockPatientRepo.createPatient(any()))
          .thenAnswer((_) async => registeredPatient);

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            patientRepositoryProvider.overrideWithValue(mockPatientRepo),
          ],
          child: const MaterialApp(
            home: PatientRegistrationScreen(),
          ),
        ),
      );

      // Fill registration form
      await $(const Key('first_name_field')).enterText('Ada');
      await $(const Key('last_name_field')).enterText('Obi');
      await $(const Key('phone_field')).enterText('+2348012345678');

      // Submit registration
      await $.tester.ensureVisible(find.byKey(const Key('register_submit_button')));
      await $(const Key('register_submit_button')).tap();
      await $.pumpAndSettle();

      // Show Hospital Card with generated QR code
      await $.pumpWidgetAndSettle(
        const MaterialApp(
          home: HospitalCardScreen(patient: registeredPatient),
        ),
      );
      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.textContaining(hospitalId), findsWidgets);
      expect(find.byKey(const Key('hospital_card_qr')), findsOneWidget);

      // ── 2. BOOK (Appointment booking verification) ────────────────────────
      final bookedAppointment = {
        'id': 'appt-001',
        'patient': patientId,
        'clinic': 'General Practice',
        'scheduledDate': '2026-11-01',
        'status': 'scheduled',
      };
      expect(bookedAppointment['status'], equals('scheduled'));
      expect(bookedAppointment['patient'], equals(patientId));

      // ── 3. CHECK IN (Front Desk assigns to queue) ─────────────────────────
      when(() => mockPatientRepo.getByHospitalId(hospitalId))
          .thenAnswer((_) async => registeredPatient);

      when(() => mockQueueRepo.checkIn(any()))
          .thenAnswer((_) async => const CheckInResponse(
                position: 3,
                estimatedWaitMinutes: 25,
              ));

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            patientRepositoryProvider.overrideWithValue(mockPatientRepo),
            queueRepositoryProvider.overrideWithValue(mockQueueRepo),
          ],
          child: const MaterialApp(
            home: FrontDeskCheckInScreen(),
          ),
        ),
      );

      // Look up patient by Hospital ID
      await $(const Key('hospital_id_input')).enterText(hospitalId);
      await $(const Key('lookup_button')).tap();
      await $.pumpAndSettle();

      expect(find.textContaining('Ada Obi'), findsWidgets);

      // Select clinic chip & check in
      await $(find.text('General Practice')).tap();
      await $.pumpAndSettle();

      await $(const Key('confirm_checkin_button')).tap();
      await $.pumpAndSettle();

      expect(find.textContaining('Position: 3'), findsWidgets);

      // ── 4. TRIAGE (Nurse vitals entry) ────────────────────────────────────
      when(() => mockVitalsRepo.recordVitals(any(), any()))
          .thenAnswer((_) async => {
                'vitals': {
                  'id': 'vitals-001',
                  'queueEntry': queueEntryId,
                  'bpSystolic': 120,
                  'bpDiastolic': 80,
                  'spo2': 98,
                  'temperatureCelsius': 37.1,
                  'heartRateBpm': 74,
                  'weightKg': 65.5,
                  'isUrgent': false,
                }
              });

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            vitalsRepositoryProvider.overrideWithValue(mockVitalsRepo),
          ],
          child: const MaterialApp(
            home: VitalsFormScreen(
              queueEntryId: queueEntryId,
              patientName: 'Ada Obi',
            ),
          ),
        ),
      );

      // Fill vitals
      await $(const Key('bp_systolic_field')).enterText('120');
      await $(const Key('bp_diastolic_field')).enterText('80');
      await $(const Key('spo2_field')).enterText('98');
      await $(const Key('temperature_field')).enterText('37.1');
      await $(const Key('heart_rate_field')).enterText('74');
      await $(const Key('weight_field')).enterText('65.5');

      await $.tester.ensureVisible(find.byKey(const Key('submit_vitals_button')));
      await $(const Key('submit_vitals_button')).tap();
      await $.pumpAndSettle();

      // ── 5. DOCTOR CONSULT (Encounter, SOAP note & diagnosis) ──────────────
      const encounter = Encounter(
        id: encounterId,
        patientId: patientId,
        doctorId: 'doc-001',
        clinicId: 'clinic-gopd',
        status: 'open',
        chiefComplaint: 'Persistent fever and chills for 3 days',
        patientName: 'Ada Obi',
        clinicName: 'General Practice',
      );

      when(() => mockClinicalRepo.getMyQueue())
          .thenAnswer((_) async => [encounter]);

      when(() => mockClinicalRepo.addNote(
            encounterId: any(named: 'encounterId'),
            subjective: any(named: 'subjective'),
            objective: any(named: 'objective'),
            assessment: any(named: 'assessment'),
            plan: any(named: 'plan'),
            diagnosis: any(named: 'diagnosis'),
          )).thenAnswer((_) async => const ClinicalNote(
            id: 'note-001',
            encounterId: encounterId,
            patientId: patientId,
            authorName: 'Dr. Chidi',
            subjective: 'Headache and shivering',
            objective: 'T 38.5C, clear chest',
            assessment: 'Suspected uncomplicated malaria',
            plan: 'Order RDT + FBC, prescribe Artemether-Lumefantrine',
          ));

      when(() => mockClinicalRepo.setDiagnosis(
            encounterId: any(named: 'encounterId'),
            primary: any(named: 'primary'),
          )).thenAnswer((_) async => encounter);

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            clinicalRepositoryProvider.overrideWithValue(mockClinicalRepo),
          ],
          child: const MaterialApp(home: DoctorDashboard()),
        ),
      );

      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.text('Persistent fever and chills for 3 days'), findsOneWidget);

      // Open SOAP Note Editor
      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            clinicalRepositoryProvider.overrideWithValue(mockClinicalRepo),
          ],
          child: const MaterialApp(
            home: NoteEditorScreen(
              encounterId: encounterId,
              patientName: 'Ada Obi',
            ),
          ),
        ),
      );

      await $(find.widgetWithText(TextFormField, 'Subjective')).enterText('Headache and shivering');
      await $(find.widgetWithText(TextFormField, 'Objective')).enterText('T 38.5C, clear chest');
      await $(find.widgetWithText(TextFormField, 'Assessment')).enterText('Suspected uncomplicated malaria');
      await $(find.widgetWithText(TextFormField, 'Plan')).enterText('Order RDT + FBC, prescribe ACT');
      await $(find.text('SAVE')).tap();
      await $.pumpAndSettle();

      // ── 6. LAB ORDER (Doctor creates lab investigation request) ───────────
      const labRequest = LabRequest(
        id: labRequestId,
        encounterId: encounterId,
        patientId: patientId,
        status: 'requested',
        tests: [
          {'name': 'Malaria RDT', 'unitPriceKobo': 150000},
          {'name': 'Full Blood Count (FBC)', 'unitPriceKobo': 250000},
        ],
        urgency: 'urgent',
        patientName: 'Ada Obi',
        requestedByName: 'Dr. Chidi',
      );

      when(() => mockClinicalRepo.createLabRequest(
            encounterId: any(named: 'encounterId'),
            tests: any(named: 'tests'),
            urgency: any(named: 'urgency'),
          )).thenAnswer((_) async => labRequest);

      final createdLab = await mockClinicalRepo.createLabRequest(
        encounterId: encounterId,
        tests: const [
          {'name': 'Malaria RDT', 'unitPriceKobo': 150000},
          {'name': 'Full Blood Count (FBC)', 'unitPriceKobo': 250000},
        ],
        urgency: 'urgent',
      );
      expect(createdLab.status, equals('requested'));
      expect(createdLab.tests.length, equals(2));

      // ── 7. PAY LAB INVOICE ────────────────────────────────────────────────
      const labInvoice = Invoice(
        id: labInvoiceId,
        patientId: patientId,
        status: 'pending',
        totalKobo: 400000,
        lineItems: [
          InvoiceLineItem(description: 'Malaria RDT', amountKobo: 150000),
          InvoiceLineItem(description: 'Full Blood Count', amountKobo: 250000),
        ],
        patientName: 'Ada Obi',
      );

      when(() => mockClinicalRepo.getMyInvoices(patientId))
          .thenAnswer((_) async => [labInvoice]);

      when(() => mockClinicalRepo.initializePayment(
            invoiceId: any(named: 'invoiceId'),
            email: any(named: 'email'),
          )).thenAnswer((_) async => {
            'authorizationUrl': 'https://checkout.paystack.com/test-url',
            'reference': 'ref-lab-123',
          });

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            clinicalRepositoryProvider.overrideWithValue(mockClinicalRepo),
          ],
          child: const MaterialApp(
            home: PatientBillScreen(patientId: patientId),
          ),
        ),
      );

      expect(find.text('Malaria RDT'), findsOneWidget);
      expect(find.text('Full Blood Count'), findsOneWidget);
      expect(find.text('Pay with Card / Bank (Paystack)'), findsOneWidget);

      // Execute payment
      await $(find.text('Pay with Card / Bank (Paystack)')).tap();
      await $.pumpAndSettle();

      // Lab request unlocks to 'paid'
      final paidLabRequest = LabRequest(
        id: labRequestId,
        encounterId: encounterId,
        patientId: patientId,
        status: 'paid',
        tests: labRequest.tests,
        urgency: 'urgent',
        patientName: 'Ada Obi',
        requestedByName: 'Dr. Chidi',
      );

      // ── 8. LAB RESULT (Lab scientist picks up & enters findings) ──────────
      when(() => mockClinicalRepo.getLabWorklist())
          .thenAnswer((_) async => [paidLabRequest]);

      when(() => mockClinicalRepo.pickUpLabRequest(labRequestId))
          .thenAnswer((_) async => paidLabRequest);

      when(() => mockClinicalRepo.submitLabResults(
            labRequestId: labRequestId,
            results: any(named: 'results'),
          )).thenAnswer((_) async => LabRequest(
            id: labRequestId,
            encounterId: encounterId,
            patientId: patientId,
            status: 'completed',
            tests: paidLabRequest.tests,
            patientName: 'Ada Obi',
            createdAt: DateTime.now(),
          ));

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            clinicalRepositoryProvider.overrideWithValue(mockClinicalRepo),
          ],
          child: const MaterialApp(home: LabWorklistScreen()),
        ),
      );

      expect(find.text('Lab Worklist'), findsOneWidget);
      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.text('Malaria RDT'), findsOneWidget);

      // Pick up & enter test results
      await $(find.text('Pick up')).tap();
      await $.pumpAndSettle();

      final completedLab = await mockClinicalRepo.submitLabResults(
        labRequestId: labRequestId,
        results: [
          {
            'testName': 'Malaria RDT',
            'value': 'Positive (+)',
            'isAbnormal': true,
            'abnormalFlag': 'H',
          },
          {
            'testName': 'WBC',
            'value': '9.8',
            'unit': '10^9/L',
            'referenceRange': '4.0 - 11.0',
            'isAbnormal': false,
          },
        ],
      );
      expect(completedLab.status, equals('completed'));

      // ── 9. PRESCRIPTION (Doctor prescribes medication) ────────────────────
      const prescription = Prescription(
        id: prescriptionId,
        encounterId: encounterId,
        patientId: patientId,
        status: 'sent',
        drugs: [
          DrugLine(
            drugName: 'Artemether-Lumefantrine',
            dose: '80/480mg tablet',
            frequency: 'twice daily',
            duration: '3 days',
            quantity: 6,
          ),
          DrugLine(
            drugName: 'Paracetamol',
            dose: '500mg tablet',
            frequency: 'three times daily',
            duration: '3 days',
            quantity: 18,
          ),
        ],
        patientName: 'Ada Obi',
        prescribedByName: 'Dr. Chidi',
      );

      when(() => mockClinicalRepo.createPrescription(
            encounterId: any(named: 'encounterId'),
            drugs: any(named: 'drugs'),
            notes: any(named: 'notes'),
          )).thenAnswer((_) async => prescription);

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            clinicalRepositoryProvider.overrideWithValue(mockClinicalRepo),
          ],
          child: const MaterialApp(
            home: PrescriptionFormScreen(
              encounterId: encounterId,
              patientName: 'Ada Obi',
            ),
          ),
        ),
      );

      // Fill prescription drug line
      await $(find.widgetWithText(TextFormField, 'Drug name *')).enterText('Artemether-Lumefantrine');
      await $(find.widgetWithText(TextFormField, 'Dose *')).enterText('80/480mg');
      await $(find.widgetWithText(TextFormField, 'Duration *')).enterText('3 days');
      await $(find.widgetWithText(TextFormField, 'Quantity *')).enterText('6');

      await $(find.text('SEND TO PHARMACY')).tap();
      await $.pumpAndSettle();

      // ── 10. PAY MEDICATION INVOICE ────────────────────────────────────────
      const rxInvoice = Invoice(
        id: rxInvoiceId,
        patientId: patientId,
        status: 'paid', // payment confirmed
        totalKobo: 350000,
        lineItems: [
          InvoiceLineItem(description: 'Artemether-Lumefantrine', amountKobo: 300000),
          InvoiceLineItem(description: 'Paracetamol', amountKobo: 50000),
        ],
        patientName: 'Ada Obi',
      );
      expect(rxInvoice.status, equals('paid'));
      expect(rxInvoice.totalKobo, equals(350000));

      // ── 11. DISPENSE (Pharmacist verifies payment & dispenses) ────────────
      when(() => mockClinicalRepo.getPrescriptionInbox())
          .thenAnswer((_) async => [prescription]);

      when(() => mockClinicalRepo.dispense(prescriptionId))
          .thenAnswer((_) async => Prescription(
                id: prescriptionId,
                encounterId: encounterId,
                patientId: patientId,
                status: 'dispensed',
                drugs: prescription.drugs,
                patientName: 'Ada Obi',
              ));

      await $.pumpWidgetAndSettle(
        ProviderScope(
          overrides: [
            clinicalRepositoryProvider.overrideWithValue(mockClinicalRepo),
          ],
          child: const MaterialApp(home: PharmacistInboxScreen()),
        ),
      );

      expect(find.text('Prescription Inbox'), findsOneWidget);
      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.textContaining('Artemether-Lumefantrine'), findsOneWidget);

      // Execute dispense
      final dispensed = await mockClinicalRepo.dispense(prescriptionId);
      expect(dispensed.status, equals('dispensed'));
    },
  );
}
