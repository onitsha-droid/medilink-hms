import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:medilink_hms/core/offline/offline_sync_service.dart';
import 'package:medilink_hms/core/providers/clinical_repository.dart';
import 'package:medilink_hms/features/doctor/patient_record_screen.dart';
import 'package:medilink_hms/features/nurse/nurse_triage_screen.dart';
import 'package:medilink_hms/features/queue/patient_queue_screen.dart';
import 'package:medilink_hms/features/queue/queue_provider.dart';

class MockClinicalRepository extends Mock implements ClinicalRepository {}
class MockVitalsRepository extends Mock implements VitalsRepository {}

void main() {
  late OfflineSyncService offlineService;

  setUpAll(() async {
    registerFallbackValue(VitalsFormData());
  });

  setUp(() async {
    offlineService = OfflineSyncService(isInMemory: true);
  });

  group('Offline live queue view (read cache)', () {
    testWidgets('shows cached queue position and offline indicator when offline',
        (tester) async {
      const patientId = 'patient_offline_123';

      // Pre-populate cache
      await offlineService.cacheQueuePosition(
        patientId,
        position: 4,
        estimatedWaitMinutes: 25,
        clinicId: 'clinic-gp',
        isUrgent: false,
      );

      // Simulate active state from cache (offline / disconnected)
      const cachedState = QueueStateActive(
        position: 4,
        estimatedWaitMinutes: 25,
        clinicId: 'clinic-gp',
        isUrgent: false,
        isFromCache: true,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            offlineSyncServiceProvider.overrideWithValue(offlineService),
            queuePositionProvider(patientId).overrideWith(
              (ref) => QueuePositionNotifier(null, patientId, null, cachedState),
            ),
          ],
          child: const MaterialApp(
            home: PatientQueueScreen(patientId: patientId),
          ),
        ),
      );
      await tester.pump();

      // Verify cached position is shown
      expect(find.byKey(const Key('queue_position_number')), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
      expect(find.text('~25 minutes'), findsOneWidget);

      // Verify clear offline indicator banner and badge
      expect(find.byKey(const Key('offline_indicator')), findsOneWidget);
      expect(find.text('Offline — Showing cached position'), findsOneWidget);
      expect(find.text('Offline (Cached)'), findsOneWidget);
    });
  });

  group('Offline patient record (read cache for recently opened records)', () {
    testWidgets('displays cached record with offline indicator when connectivity is lost',
        (tester) async {
      const patientId = 'patient_rec_456';

      // Pre-populate patient record cache as if previously viewed
      final cachedRecordJson = {
        'encounters': [
          {
            '_id': 'enc_001',
            'patient': patientId,
            'doctor': 'doc_001',
            'clinic': 'cli_001',
            'status': 'closed',
            'chiefComplaint': 'Persistent cough',
            'createdAt': DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
          }
        ],
        'notes': [
          {
            '_id': 'note_001',
            'encounter': 'enc_001',
            'author': 'doc_001',
            'subjective': 'Cough for 3 days',
            'assessment': 'Upper respiratory tract infection',
            'createdAt': DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
          }
        ],
        'vitals': [
          {
            '_id': 'vit_001',
            'queueEntry': 'qe_001',
            'patient': patientId,
            'recordedBy': 'nurse_001',
            'bpSystolic': 120.0,
            'bpDiastolic': 80.0,
            'spo2': 98.0,
            'temperatureCelsius': 36.8,
            'heartRateBpm': 74.0,
            'createdAt': DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
          }
        ],
      };

      await offlineService.cachePatientRecord(patientId, cachedRecordJson);

      // When network fails, clinicalRepository loads from cache
      final mockRepo = MockClinicalRepository();
      when(() => mockRepo.getPatientHistory(patientId)).thenAnswer((_) async {
        final cached = await offlineService.getCachedPatientRecord(patientId);
        return {
          'encounters': cached!.encounters,
          'notes': cached.notes,
          'vitals': cached.vitals,
          'isOfflineCached': true,
          'cachedAt': cached.cachedAt,
        };
      });

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            offlineSyncServiceProvider.overrideWithValue(offlineService),
            clinicalRepositoryProvider.overrideWithValue(mockRepo),
          ],
          child: const MaterialApp(
            home: PatientRecordScreen(
              patientId: patientId,
              patientName: 'Chidi Okonkwo',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Check offline banner is clearly displayed
      expect(find.byKey(const Key('offline_indicator')), findsOneWidget);
      expect(find.text('Offline — Showing cached record'), findsOneWidget);

      // Check cached clinical data is visible
      expect(find.text('Timeline'), findsOneWidget);
      expect(find.textContaining('Persistent cough'), findsOneWidget);
    });
  });

  group('Nurse vitals offline write queued and synced on reconnect', () {
    testWidgets(
        'queues vitals entry locally when offline and shows clear offline indicator',
        (tester) async {
      final mockVitalsRepo = MockVitalsRepository();
      // Simulate network failure / connectivity loss
      when(() => mockVitalsRepo.recordVitals(any(), any()))
          .thenThrow(Exception('No internet connectivity'));

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            offlineSyncServiceProvider.overrideWithValue(offlineService),
            vitalsRepositoryProvider.overrideWithValue(mockVitalsRepo),
          ],
          child: const MaterialApp(
            home: VitalsFormScreen(
              queueEntryId: 'queue_entry_999',
              patientName: 'Amaka Eze',
            ),
          ),
        ),
      );
      await tester.pump();

      // Fill in vitals
      await tester.enterText(find.byKey(const Key('bp_systolic_field')), '120');
      await tester.enterText(find.byKey(const Key('bp_diastolic_field')), '80');
      await tester.enterText(find.byKey(const Key('spo2_field')), '98');
      await tester.pump();

      // Submit while offline
      await tester.ensureVisible(find.byKey(const Key('submit_vitals_button')));
      await tester.tap(find.byKey(const Key('submit_vitals_button')));
      await tester.pumpAndSettle();

      // Confirm offline indicator and queued screen
      expect(find.byKey(const Key('offline_indicator')), findsOneWidget);
      expect(find.text('Offline mode: Vitals saved locally and queued for sync on reconnect.'),
          findsOneWidget);
      expect(find.text('Vitals queued offline for Amaka Eze'), findsOneWidget);

      // Verify item was stored in Hive sync queue
      final queuedItems = await offlineService.getQueuedVitals();
      expect(queuedItems.length, 1);
      expect(queuedItems.first.queueEntryId, 'queue_entry_999');
      expect(queuedItems.first.patientName, 'Amaka Eze');
    });

    testWidgets(
        'syncs queued vitals on reconnect with timestamp conflict resolution',
        (tester) async {
      final mockVitalsRepo = MockVitalsRepository();
      when(() => mockVitalsRepo.getTriageQueue(any())).thenAnswer((_) async => []);

      // Queue an older vitals record and a newer vitals record
      final olderTime = DateTime.now().subtract(const Duration(minutes: 30));
      final newerTime = DateTime.now().subtract(const Duration(minutes: 5));

      // Entry 1: server already has a newer vitals entry -> server wins (conflict resolved)
      await offlineService.queueVitals(
        queueEntryId: 'entry_conflict',
        patientName: 'Conflict Patient',
        vitalsData: {'bpSystolic': 110, 'bpDiastolic': 70, 'spo2': 99},
        clientTimestamp: olderTime,
      );
      when(() => mockVitalsRepo.getVitalsByEntry('entry_conflict')).thenAnswer(
        (_) async => {
          'queueEntry': 'entry_conflict',
          'createdAt': DateTime.now().subtract(const Duration(minutes: 10)).toIso8601String(),
        },
      );

      // Entry 2: client record is newer or not yet on server -> syncs to server
      await offlineService.queueVitals(
        queueEntryId: 'entry_synced',
        patientName: 'Synced Patient',
        vitalsData: {'bpSystolic': 130, 'bpDiastolic': 85, 'spo2': 97},
        clientTimestamp: newerTime,
      );
      when(() => mockVitalsRepo.getVitalsByEntry('entry_synced')).thenAnswer((_) async => null);
      when(() => mockVitalsRepo.recordVitals('entry_synced', any()))
          .thenAnswer((_) async => {'status': 'recorded'});

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            offlineSyncServiceProvider.overrideWithValue(offlineService),
            vitalsRepositoryProvider.overrideWithValue(mockVitalsRepo),
          ],
          child: const MaterialApp(
            home: NurseTriageQueueScreen(clinicId: 'clinic_triage_1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Shows offline queue indicator with 2 pending entries
      expect(find.byKey(const Key('offline_indicator')), findsOneWidget);
      expect(find.text('Offline queue: 2 vitals entry pending sync'), findsOneWidget);

      // Tap Sync Now
      await tester.tap(find.byKey(const Key('sync_now_button')));
      await tester.pumpAndSettle();

      // Check sync completed: 1 synced, 1 conflict resolved
      expect(find.byKey(const Key('synced_indicator')), findsOneWidget);
      expect(find.text('Synced 1 item(s), 1 conflict(s) resolved'), findsOneWidget);

      // Confirm sync queue in Hive is now empty
      final remaining = await offlineService.getQueuedVitals();
      expect(remaining.isEmpty, true);
    });
  });
}
