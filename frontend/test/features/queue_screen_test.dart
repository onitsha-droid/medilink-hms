import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medilink_hms/features/queue/patient_queue_screen.dart';
import 'package:medilink_hms/features/queue/queue_provider.dart';

// ── Fake notifier that lets tests inject any QueueState ───────────────────────

class _FakeQueueNotifier extends StateNotifier<QueueState> {
  _FakeQueueNotifier(super.initial);
}

Widget buildQueueScreen(QueueState state) {
  return ProviderScope(
    overrides: [
      queuePositionProvider('test-patient-id').overrideWith(
        (ref) => _FakeQueueNotifier(state),
      ),
    ],
    child: const MaterialApp(
      home: PatientQueueScreen(patientId: 'test-patient-id'),
    ),
  );
}

void main() {
  group('PatientQueueScreen', () {
    testWidgets('shows loading spinner when connecting', (tester) async {
      await tester.pumpWidget(buildQueueScreen(const QueueStateLoading()));
      await tester.pump();
      expect(find.byKey(const Key('queue_loading')), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('shows disconnected view when offline', (tester) async {
      await tester.pumpWidget(
          buildQueueScreen(const QueueStateDisconnected()));
      await tester.pump();
      expect(find.byKey(const Key('queue_disconnected')), findsOneWidget);
      expect(find.text('Disconnected'), findsOneWidget);
    });

    testWidgets('shows error view on error state', (tester) async {
      await tester.pumpWidget(
          buildQueueScreen(const QueueStateError('Room join failed')));
      await tester.pump();
      expect(find.byKey(const Key('queue_error')), findsOneWidget);
      expect(find.text('Room join failed'), findsOneWidget);
    });

    testWidgets('shows queue position number in active state', (tester) async {
      await tester.pumpWidget(
        buildQueueScreen(const QueueStateActive(
          position: 3,
          estimatedWaitMinutes: 20,
          clinicId: 'clinic-1',
        )),
      );
      await tester.pump();
      expect(find.byKey(const Key('queue_active')), findsOneWidget);
      expect(find.byKey(const Key('queue_position_number')), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.byKey(const Key('queue_wait_time')), findsOneWidget);
    });

    testWidgets('shows urgent banner when flagged urgent', (tester) async {
      await tester.pumpWidget(
        buildQueueScreen(const QueueStateActive(
          position: 1,
          estimatedWaitMinutes: 0,
          clinicId: 'clinic-1',
          isUrgent: true,
        )),
      );
      await tester.pump();
      expect(find.byKey(const Key('urgent_banner')), findsOneWidget);
    });

    testWidgets('shows Live badge in AppBar when active', (tester) async {
      await tester.pumpWidget(
        buildQueueScreen(const QueueStateActive(
          position: 2,
          estimatedWaitMinutes: 10,
          clinicId: 'clinic-1',
        )),
      );
      await tester.pump();
      expect(find.text('Live'), findsOneWidget);
    });

    testWidgets('shows Offline badge in AppBar when disconnected',
        (tester) async {
      await tester.pumpWidget(
          buildQueueScreen(const QueueStateDisconnected()));
      await tester.pump();
      expect(find.text('Offline'), findsOneWidget);
    });
  });
}
