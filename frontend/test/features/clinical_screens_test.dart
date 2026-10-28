import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:medilink_hms/core/api/clinical_models.dart';
import 'package:medilink_hms/core/providers/clinical_repository.dart';
import 'package:medilink_hms/features/doctor/doctor_dashboard.dart';
import 'package:medilink_hms/features/lab_scientist/lab_worklist_screen.dart';
import 'package:medilink_hms/features/pharmacist/pharmacist_inbox_screen.dart';
import 'package:medilink_hms/features/billing_officer/billing_dashboard.dart';
import 'package:medilink_hms/features/patient/patient_bill_screen.dart';

// ── Mock ──────────────────────────────────────────────────────────────────────

class MockClinicalRepository extends Mock implements ClinicalRepository {}

// ── Helpers ───────────────────────────────────────────────────────────────────

Widget _wrap(Widget child, ClinicalRepository repo) {
  return ProviderScope(
    overrides: [
      clinicalRepositoryProvider.overrideWithValue(repo),
    ],
    child: MaterialApp(home: child),
  );
}

final _encounter = Encounter(
  id: 'enc1',
  patientId: 'pat1',
  doctorId: 'doc1',
  clinicId: 'cli1',
  status: 'open',
  chiefComplaint: 'Fever',
  patientName: 'Ada Obi',
  clinicName: 'General',
);

final _labRequest = LabRequest(
  id: 'lr1',
  encounterId: 'enc1',
  patientId: 'pat1',
  status: 'paid',
  tests: [
    {'name': 'FBC'},
    {'name': 'Malaria RDT'},
  ],
  urgency: 'urgent',
  patientName: 'Ada Obi',
  requestedByName: 'Dr. Emeka',
);

final _prescription = Prescription(
  id: 'rx1',
  encounterId: 'enc1',
  patientId: 'pat1',
  status: 'sent',
  drugs: [
    const DrugLine(
      drugName: 'Amoxicillin',
      dose: '500mg capsule',
      frequency: 'three times daily',
      duration: '7 days',
      quantity: 21,
    ),
  ],
  patientName: 'Ada Obi',
  prescribedByName: 'Dr. Emeka',
);

final _invoice = Invoice(
  id: 'inv1',
  patientId: 'pat1',
  status: 'pending',
  totalKobo: 200000,
  lineItems: [
    const InvoiceLineItem(
        description: 'Consultation', amountKobo: 200000),
  ],
  patientName: 'Ada Obi',
);

// ── Doctor Dashboard ──────────────────────────────────────────────────────────

void main() {
  late MockClinicalRepository mockRepo;

  setUp(() {
    mockRepo = MockClinicalRepository();
  });

  group('DoctorDashboard', () {
    testWidgets('shows patient name when queue loads',
        (tester) async {
      when(() => mockRepo.getMyQueue())
          .thenAnswer((_) async => [_encounter]);

      await tester.pumpWidget(_wrap(const DoctorDashboard(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.text('Fever'), findsOneWidget);
    });

    testWidgets('shows empty state when queue is empty',
        (tester) async {
      when(() => mockRepo.getMyQueue())
          .thenAnswer((_) async => []);

      await tester.pumpWidget(_wrap(const DoctorDashboard(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('No patients in queue'), findsOneWidget);
    });

    testWidgets('shows error message on failure', (tester) async {
      when(() => mockRepo.getMyQueue())
          .thenThrow(Exception('network error'));

      await tester.pumpWidget(_wrap(const DoctorDashboard(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.textContaining('Error'), findsOneWidget);
    });
  });

  // ── Lab Worklist ────────────────────────────────────────────────────────────

  group('LabWorklistScreen', () {
    testWidgets('shows paid lab request with urgency badge',
        (tester) async {
      when(() => mockRepo.getLabWorklist())
          .thenAnswer((_) async => [_labRequest]);

      await tester.pumpWidget(
          _wrap(const LabWorklistScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.text('2 test(s) · URGENT'), findsOneWidget);
      expect(find.text('Pick Up'), findsOneWidget);
    });

    testWidgets('shows empty state when worklist is empty',
        (tester) async {
      when(() => mockRepo.getLabWorklist())
          .thenAnswer((_) async => []);

      await tester.pumpWidget(
          _wrap(const LabWorklistScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.textContaining('No paid requests'), findsOneWidget);
    });
  });

  // ── Pharmacist Inbox ────────────────────────────────────────────────────────

  group('PharmacistInboxScreen', () {
    testWidgets('shows sent prescription in inbox', (tester) async {
      when(() => mockRepo.getPrescriptionInbox())
          .thenAnswer((_) async => [_prescription]);

      await tester.pumpWidget(
          _wrap(const PharmacistInboxScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.textContaining('1 drug'), findsOneWidget);
    });

    testWidgets('shows empty state when inbox is empty',
        (tester) async {
      when(() => mockRepo.getPrescriptionInbox())
          .thenAnswer((_) async => []);

      await tester.pumpWidget(
          _wrap(const PharmacistInboxScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('No pending prescriptions.'), findsOneWidget);
    });
  });

  // ── Billing Dashboard ───────────────────────────────────────────────────────

  group('BillingDashboard', () {
    testWidgets('shows invoices with status filter chips',
        (tester) async {
      when(() => mockRepo.getInvoices(
              status: any(named: 'status'),
              page: any(named: 'page')))
          .thenAnswer((_) async => [_invoice]);

      await tester.pumpWidget(
          _wrap(const BillingDashboard(), mockRepo));
      await tester.pumpAndSettle();

      // Filter chips
      expect(find.text('All'), findsOneWidget);
      expect(find.text('pending'), findsOneWidget);
      expect(find.text('paid'), findsOneWidget);

      // Invoice row
      expect(find.text('Ada Obi'), findsOneWidget);
    });
  });

  // ── Patient Bill Screen ─────────────────────────────────────────────────────

  group('PatientBillScreen', () {
    testWidgets('shows pending invoice with Pay Now button',
        (tester) async {
      when(() => mockRepo.getMyInvoices('pat1'))
          .thenAnswer((_) async => [_invoice]);

      await tester.pumpWidget(
          _wrap(const PatientBillScreen(patientId: 'pat1'), mockRepo));
      await tester.pumpAndSettle();

      // Amount appears in both the line-item row and the Total row
      expect(find.text('₦2000.00'), findsAtLeastNWidgets(1));
      expect(find.text('Pay Now'), findsOneWidget);
    });

    testWidgets('shows empty state when no invoices', (tester) async {
      when(() => mockRepo.getMyInvoices('pat1'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(
          _wrap(const PatientBillScreen(patientId: 'pat1'), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('No invoices yet.'), findsOneWidget);
    });

    testWidgets('paid invoice shows receipt number and no Pay Now',
        (tester) async {
      final paid = Invoice(
        id: 'inv2',
        patientId: 'pat1',
        status: 'paid',
        totalKobo: 200000,
        lineItems: [
          const InvoiceLineItem(
              description: 'Consultation', amountKobo: 200000),
        ],
        receiptNumber: 'RCP-20261027-AB12C',
        paidAt: DateTime(2026, 10, 27),
      );

      when(() => mockRepo.getMyInvoices('pat1'))
          .thenAnswer((_) async => [paid]);

      await tester.pumpWidget(
          _wrap(const PatientBillScreen(patientId: 'pat1'), mockRepo));
      await tester.pumpAndSettle();

      expect(find.textContaining('RCP-'), findsOneWidget);
      expect(find.text('Pay Now'), findsNothing);
    });
  });
}
