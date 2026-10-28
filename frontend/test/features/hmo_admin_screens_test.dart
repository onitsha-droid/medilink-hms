import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:medilink_hms/core/api/hmo_models.dart';
import 'package:medilink_hms/core/providers/clinical_repository.dart';
import 'package:medilink_hms/features/billing_officer/hmo_claims_screen.dart';
import 'package:medilink_hms/features/admin/admin_dashboard_screen.dart';

// ── Mock ──────────────────────────────────────────────────────────────────────

class MockClinicalRepository extends Mock implements ClinicalRepository {}

Widget _wrap(Widget child, ClinicalRepository repo) => ProviderScope(
      overrides: [clinicalRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(home: child),
    );

// ── Fixtures ──────────────────────────────────────────────────────────────────

final _approvedClaim = HmoClaim(
  id: 'claim1',
  invoiceId: 'inv1',
  policyId: 'HMO-001',
  serviceCode: 1001,
  requestedAmountKobo: 300000,
  status: 'approved',
  payoutAmountKobo: 300000,
  reasonText: 'Approved',
);

final _manualClaim = HmoClaim(
  id: 'claim2',
  invoiceId: 'inv2',
  policyId: 'HMO-002',
  serviceCode: 1001,
  requestedAmountKobo: 500000,
  status: 'manual_review',
  reasonText: 'Over policy limit',
);

final _dashboard = AdminDashboard(
  patientsToday: 12,
  queue: [
    const ClinicQueueMetric(
      clinicId: 'c1',
      clinicName: 'General Clinic',
      queueLength: 5,
      urgent: 1,
      estimatedWaitMinutes: 75,
    ),
  ],
  revenueFiatKobo: 1500000,
  revenueStablecoinKobo: 500000,
  lowStock: [
    {'drugName': 'Paracetamol', 'formulation': '500mg', 'quantityOnHand': 3},
  ],
  claims: {
    'approved': {'count': 4, 'totalKobo': 800000},
    'rejected': {'count': 1, 'totalKobo': 100000},
  },
);

void main() {
  late MockClinicalRepository mockRepo;

  setUp(() => mockRepo = MockClinicalRepository());

  // ── HmoClaimsScreen ──────────────────────────────────────────────────────

  group('HmoClaimsScreen', () {
    testWidgets('shows claim list with policy ID and status chip',
        (tester) async {
      when(() => mockRepo.getHmoClaims(
              status: any(named: 'status'),
              invoiceId: any(named: 'invoiceId')))
          .thenAnswer((_) async => [_approvedClaim]);

      await tester
          .pumpWidget(_wrap(const HmoClaimsScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('Policy: HMO-001'), findsOneWidget);
      expect(find.text('APPROVED'), findsOneWidget);
    });

    testWidgets('shows empty state when no claims', (tester) async {
      when(() => mockRepo.getHmoClaims(
              status: any(named: 'status'),
              invoiceId: any(named: 'invoiceId')))
          .thenAnswer((_) async => []);

      await tester
          .pumpWidget(_wrap(const HmoClaimsScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('No claims found.'), findsOneWidget);
    });

    testWidgets('shows error state on failure', (tester) async {
      when(() => mockRepo.getHmoClaims(
              status: any(named: 'status'),
              invoiceId: any(named: 'invoiceId')))
          .thenThrow(Exception('network error'));

      await tester
          .pumpWidget(_wrap(const HmoClaimsScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.textContaining('Error'), findsOneWidget);
    });

    testWidgets('manual_review claim shows Approve/Reject buttons in detail',
        (tester) async {
      when(() => mockRepo.resolveHmoClaim(
            claimId: any(named: 'claimId'),
            resolution: any(named: 'resolution'),
            note: any(named: 'note'),
          )).thenAnswer((_) async => {
            'claim': {
              '_id': 'claim2',
              'invoice': 'inv2',
              'policyId': 'HMO-002',
              'serviceCode': 1001,
              'requestedAmountKobo': 500000,
              'status': 'approved',
            }
          });

      when(() => mockRepo.getHmoClaims(
              status: any(named: 'status'),
              invoiceId: any(named: 'invoiceId')))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(_wrap(
        HmoClaimDetailScreen(claim: _manualClaim),
        mockRepo,
      ));
      await tester.pumpAndSettle();

      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Reject'), findsOneWidget);
      expect(find.text('MANUAL_REVIEW'), findsOneWidget);
    });
  });

  // ── AdminDashboardScreen ─────────────────────────────────────────────────

  group('AdminDashboardScreen', () {
    testWidgets('shows KPI cards with patientsToday and revenue',
        (tester) async {
      when(() => mockRepo.getAdminDashboard())
          .thenAnswer((_) async => _dashboard);

      await tester.pumpWidget(
          _wrap(const AdminDashboardScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('12'), findsOneWidget); // patientsToday
      expect(find.text('Patients Today'), findsOneWidget);
      expect(find.text('General Clinic'), findsOneWidget);
      expect(find.text('5 waiting · 1 urgent'), findsOneWidget);
    });

    testWidgets('shows low stock warning', (tester) async {
      when(() => mockRepo.getAdminDashboard())
          .thenAnswer((_) async => _dashboard);

      await tester.pumpWidget(
          _wrap(const AdminDashboardScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('Paracetamol · 500mg'), findsOneWidget);
      expect(find.text('3 left'), findsOneWidget);
    });

    testWidgets('shows error state on failure', (tester) async {
      when(() => mockRepo.getAdminDashboard())
          .thenThrow(Exception('server down'));

      await tester.pumpWidget(
          _wrap(const AdminDashboardScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.textContaining('Error'), findsOneWidget);
    });
  });
}
