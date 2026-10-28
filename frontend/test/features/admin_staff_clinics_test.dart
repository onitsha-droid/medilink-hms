import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:medilink_hms/core/providers/clinical_repository.dart';
import 'package:medilink_hms/features/admin/admin_staff_screen.dart';

class MockClinicalRepository extends Mock implements ClinicalRepository {}

Widget _wrap(Widget child, ClinicalRepository repo) => ProviderScope(
      overrides: [clinicalRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(home: child),
    );

void main() {
  late MockClinicalRepository mockRepo;
  setUp(() => mockRepo = MockClinicalRepository());

  // ── AdminStaffScreen ──────────────────────────────────────────────────────

  group('AdminStaffScreen', () {
    final staffList = [
      {
        '_id': 'user1',
        'name': 'Dr. Emeka',
        'email': 'emeka@test.com',
        'role': 'Doctor',
        'isActive': true,
      },
      {
        '_id': 'user2',
        'name': 'Nurse Ada',
        'email': 'ada@test.com',
        'role': 'Nurse',
        'isActive': true,
      },
    ];

    testWidgets('shows staff list with name and role', (tester) async {
      when(() => mockRepo.listUsers())
          .thenAnswer((_) async => staffList);

      await tester.pumpWidget(_wrap(const AdminStaffScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('Dr. Emeka'), findsOneWidget);
      expect(find.text('Nurse Ada'), findsOneWidget);
      expect(find.textContaining('Doctor'), findsAtLeastNWidgets(1));
      expect(find.textContaining('Nurse'), findsAtLeastNWidgets(1));
    });

    testWidgets('shows empty state when no staff', (tester) async {
      when(() => mockRepo.listUsers()).thenAnswer((_) async => [
            // Only a patient — filtered out
            {
              '_id': 'p1',
              'name': 'Patient Joe',
              'email': 'joe@t.com',
              'role': 'Patient',
              'isActive': true,
            }
          ]);

      await tester.pumpWidget(_wrap(const AdminStaffScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('No staff members found.'), findsOneWidget);
    });

    testWidgets('shows error state on failure', (tester) async {
      when(() => mockRepo.listUsers())
          .thenThrow(Exception('server error'));

      await tester.pumpWidget(_wrap(const AdminStaffScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.textContaining('Error'), findsOneWidget);
    });
  });

  // ── AdminClinicsScreen ────────────────────────────────────────────────────

  group('AdminClinicsScreen', () {
    final clinicList = [
      {
        '_id': 'c1',
        'name': 'General OPD',
        'description': 'Outpatient dept',
        'avgConsultationMinutes': 15,
        'isActive': true,
      },
      {
        '_id': 'c2',
        'name': 'Dental',
        'avgConsultationMinutes': 30,
        'isActive': false,
      },
    ];

    testWidgets('shows clinic list with active/inactive indicator',
        (tester) async {
      when(() => mockRepo.listClinics())
          .thenAnswer((_) async => clinicList);

      await tester
          .pumpWidget(_wrap(const AdminClinicsScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('General OPD'), findsOneWidget);
      expect(find.text('Dental'), findsOneWidget);
      expect(find.textContaining('INACTIVE'), findsOneWidget);
    });

    testWidgets('shows empty state when no clinics', (tester) async {
      when(() => mockRepo.listClinics()).thenAnswer((_) async => []);

      await tester
          .pumpWidget(_wrap(const AdminClinicsScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.text('No clinics configured.'), findsOneWidget);
    });

    testWidgets('shows error state on failure', (tester) async {
      when(() => mockRepo.listClinics())
          .thenThrow(Exception('db error'));

      await tester
          .pumpWidget(_wrap(const AdminClinicsScreen(), mockRepo));
      await tester.pumpAndSettle();

      expect(find.textContaining('Error'), findsOneWidget);
    });
  });
}
