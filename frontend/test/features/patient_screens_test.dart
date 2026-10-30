import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medilink_hms/features/patient/patient_models.dart';
import 'package:medilink_hms/features/patient/patient_registration_screen.dart';

void main() {
  group('HospitalCardScreen', () {
    const patient = PatientModel(
      id: 'abc123',
      hospitalId: 'ML-A1B2C3D4',
      firstName: 'Amara',
      lastName: 'Obi',
      dateOfBirth: '1990-05-15',
      gender: 'female',
      phone: '+2348012345678',
      email: 'amara@example.com',
      qrPayload: '{"hospitalId":"ML-A1B2C3D4"}',
    );

    testWidgets('displays patient name and hospitalId', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: HospitalCardScreen(patient: patient),
          ),
        ),
      );

      expect(find.byKey(const Key('card_patient_name')), findsOneWidget);
      expect(find.text('Amara Obi'), findsOneWidget);
      expect(find.byKey(const Key('card_hospital_id')), findsOneWidget);
      expect(find.textContaining('ML-A1B2C3D4'), findsWidgets);
    });

    testWidgets('renders QR code widget', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: HospitalCardScreen(patient: patient),
          ),
        ),
      );
      expect(find.byKey(const Key('hospital_card_qr')), findsOneWidget);
    });
  });

  group('PatientRegistrationScreen form validation', () {
    testWidgets('shows validation errors when submitted empty', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PatientRegistrationScreen(),
          ),
        ),
      );

      await tester.ensureVisible(find.byKey(const Key('register_submit_button')));
      await tester.tap(find.byKey(const Key('register_submit_button')));
      await tester.pump();

      // At least one "Required" error should appear
      expect(find.text('Required'), findsWidgets);
    });

    testWidgets('first name and last name fields are present', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PatientRegistrationScreen(),
          ),
        ),
      );

      expect(find.byKey(const Key('first_name_field')), findsOneWidget);
      expect(find.byKey(const Key('last_name_field')), findsOneWidget);
      expect(find.byKey(const Key('phone_field')), findsOneWidget);
      expect(find.byKey(const Key('gender_dropdown')), findsOneWidget);
    });
  });
}
