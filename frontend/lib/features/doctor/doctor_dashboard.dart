import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';
import 'patient_record_screen.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final doctorQueueProvider = FutureProvider.autoDispose<List<Encounter>>((ref) {
  return ref.read(clinicalRepositoryProvider).getMyQueue();
});

// ── Doctor Dashboard ──────────────────────────────────────────────────────────

class DoctorDashboard extends ConsumerWidget {
  const DoctorDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final queue = ref.watch(doctorQueueProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Queue'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: () => ref.invalidate(doctorQueueProvider),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Log out',
            onPressed: () =>
                ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: queue.when(
        loading: () =>
            const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text('Error loading queue: $e',
              style: const TextStyle(color: Colors.red)),
        ),
        data: (encounters) {
          if (encounters.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check_circle_outline,
                      size: 64, color: Colors.green),
                  SizedBox(height: 12),
                  Text('No patients in queue',
                      style: TextStyle(fontSize: 16)),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(doctorQueueProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: encounters.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final enc = encounters[index];
                return _EncounterCard(encounter: enc);
              },
            ),
          );
        },
      ),
    );
  }
}

class _EncounterCard extends StatelessWidget {
  const _EncounterCard({required this.encounter});
  final Encounter encounter;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Colors.blue.shade100,
          child: Text(
            (encounter.patientName?.isNotEmpty == true)
                ? encounter.patientName![0].toUpperCase()
                : '?',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
        title: Text(encounter.patientName ?? 'Unknown Patient'),
        subtitle: Text(
          encounter.chiefComplaint ?? 'No complaint recorded',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StatusChip(status: encounter.status),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => PatientRecordScreen(
              patientId: encounter.patientId,
              patientName:
                  encounter.patientName ?? 'Patient',
              encounterId: encounter.id,
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'open' => Colors.green,
      'completed' => Colors.grey,
      _ => Colors.orange,
    };
    return Chip(
      label: Text(status,
          style: const TextStyle(fontSize: 11, color: Colors.white)),
      backgroundColor: color,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      padding: EdgeInsets.zero,
    );
  }
}
