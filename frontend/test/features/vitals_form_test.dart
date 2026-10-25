import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medilink_hms/features/nurse/nurse_triage_screen.dart';

void main() {
  group('VitalsFormScreen — field rendering', () {
    Widget buildForm() => const ProviderScope(
          child: MaterialApp(
            home: VitalsFormScreen(
              queueEntryId: 'entry-123',
              patientName: 'Amara Obi',
            ),
          ),
        );

    testWidgets('renders all vitals fields', (tester) async {
      await tester.pumpWidget(buildForm());

      expect(find.byKey(const Key('bp_systolic_field')), findsOneWidget);
      expect(find.byKey(const Key('bp_diastolic_field')), findsOneWidget);
      expect(find.byKey(const Key('spo2_field')), findsOneWidget);
      expect(find.byKey(const Key('temperature_field')), findsOneWidget);
      expect(find.byKey(const Key('weight_field')), findsOneWidget);
      expect(find.byKey(const Key('heart_rate_field')), findsOneWidget);
      expect(find.byKey(const Key('vitals_notes_field')), findsOneWidget);
      expect(find.byKey(const Key('submit_vitals_button')), findsOneWidget);
    });

    testWidgets('validates out-of-range SpO2 value', (tester) async {
      await tester.pumpWidget(buildForm());

      // Enter invalid SpO2 (> 100)
      await tester.enterText(
          find.byKey(const Key('spo2_field')), '110');
      await tester.tap(find.byKey(const Key('submit_vitals_button')));
      await tester.pump();

      expect(find.text('SpO2 (%) must be 50.0–100.0'), findsOneWidget);
    });

    testWidgets('validates out-of-range systolic BP', (tester) async {
      await tester.pumpWidget(buildForm());

      await tester.enterText(
          find.byKey(const Key('bp_systolic_field')), '350');
      await tester.tap(find.byKey(const Key('submit_vitals_button')));
      await tester.pump();

      expect(find.text('Systolic must be 50.0–300.0'), findsOneWidget);
    });

    testWidgets('shows auto-urgent warning for critically low SpO2',
        (tester) async {
      await tester.pumpWidget(buildForm());

      // Should not show warning initially
      expect(find.byKey(const Key('auto_urgent_warning')), findsNothing);

      // Enter critically low SpO2
      await tester.enterText(
          find.byKey(const Key('spo2_field')), '85');
      await tester.pump();

      expect(find.byKey(const Key('auto_urgent_warning')), findsOneWidget);
    });

    testWidgets('urgent toggle is present and toggleable', (tester) async {
      await tester.pumpWidget(buildForm());

      final toggle = find.byKey(const Key('urgent_toggle'));
      expect(toggle, findsOneWidget);

      // Tap to enable urgent
      await tester.tap(toggle);
      await tester.pump();

      // Urgent reason field should appear
      expect(find.byKey(const Key('urgent_reason_field')), findsOneWidget);
    });

    testWidgets('requires urgent reason when urgent toggle is on',
        (tester) async {
      await tester.pumpWidget(buildForm());

      // Enable urgent toggle
      await tester.tap(find.byKey(const Key('urgent_toggle')));
      await tester.pump();

      // Try to submit without a reason
      await tester.tap(find.byKey(const Key('submit_vitals_button')));
      await tester.pump();

      expect(
          find.text('Please provide a reason for the urgent flag'),
          findsOneWidget);
    });
  });

  group('NurseTriageQueueScreen — states', () {
    testWidgets('shows loading indicator initially', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: NurseTriageQueueScreen(clinicId: 'clinic-123'),
          ),
        ),
      );
      await tester.pump();

      expect(find.byKey(const Key('triage_loading')), findsOneWidget);
    });
  });
}
