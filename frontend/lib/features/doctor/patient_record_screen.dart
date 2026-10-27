import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';
import 'note_editor_screen.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final patientHistoryProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>(
  (ref, patientId) =>
      ref.read(clinicalRepositoryProvider).getPatientHistory(patientId),
);

// ── Patient Record Screen ─────────────────────────────────────────────────────

class PatientRecordScreen extends ConsumerWidget {
  const PatientRecordScreen({
    super.key,
    required this.patientId,
    required this.patientName,
    this.encounterId,
    this.readOnly = false,
  });

  final String patientId;
  final String patientName;
  final String? encounterId;
  final bool readOnly;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final historyAsync = ref.watch(patientHistoryProvider(patientId));

    return Scaffold(
      appBar: AppBar(
        title: Text(patientName),
        actions: [
          if (!readOnly && encounterId != null)
            IconButton(
              icon: const Icon(Icons.note_add),
              tooltip: 'Add Note / Diagnosis',
              onPressed: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => NoteEditorScreen(
                      encounterId: encounterId!,
                      patientName: patientName,
                    ),
                  ),
                );
                ref.invalidate(patientHistoryProvider(patientId));
              },
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.invalidate(patientHistoryProvider(patientId)),
          ),
        ],
      ),
      body: historyAsync.when(
        loading: () =>
            const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (history) {
          final encounters =
              history['encounters'] as List<Encounter>;
          final notes =
              history['notes'] as List<ClinicalNote>;
          final vitals =
              history['vitals'] as List<VitalsRecord>;

          return DefaultTabController(
            length: 3,
            child: Column(
              children: [
                const TabBar(
                  tabs: [
                    Tab(text: 'Timeline'),
                    Tab(text: 'Vitals'),
                    Tab(text: 'Notes'),
                  ],
                ),
                Expanded(
                  child: TabBarView(
                    children: [
                      _TimelineTab(
                          encounters: encounters, notes: notes),
                      _VitalsTab(vitals: vitals),
                      _NotesTab(notes: notes),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ── Timeline Tab ──────────────────────────────────────────────────────────────

class _TimelineTab extends StatelessWidget {
  const _TimelineTab(
      {required this.encounters, required this.notes});

  final List<Encounter> encounters;
  final List<ClinicalNote> notes;

  @override
  Widget build(BuildContext context) {
    if (encounters.isEmpty) {
      return const Center(child: Text('No encounters on record.'));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: encounters.length,
      itemBuilder: (context, i) {
        final enc = encounters[i];
        final encNotes =
            notes.where((n) => n.encounterId == enc.id).toList();
        return _EncounterTimelineCard(
            encounter: enc, notes: encNotes);
      },
    );
  }
}

class _EncounterTimelineCard extends StatelessWidget {
  const _EncounterTimelineCard(
      {required this.encounter, required this.notes});

  final Encounter encounter;
  final List<ClinicalNote> notes;

  @override
  Widget build(BuildContext context) {
    final dateStr = encounter.createdAt != null
        ? DateFormat('dd MMM yyyy').format(encounter.createdAt!)
        : '—';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(dateStr,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                Chip(
                  label: Text(encounter.status),
                  backgroundColor: encounter.status == 'open'
                      ? Colors.green.shade100
                      : Colors.grey.shade200,
                  padding: EdgeInsets.zero,
                  materialTapTargetSize:
                      MaterialTapTargetSize.shrinkWrap,
                ),
              ],
            ),
            if (encounter.chiefComplaint != null) ...[
              const SizedBox(height: 4),
              Text('Complaint: ${encounter.chiefComplaint!}'),
            ],
            if (encounter.primaryDiagnosis?.description != null) ...[
              const SizedBox(height: 4),
              Text(
                'Diagnosis: ${encounter.primaryDiagnosis!.description}',
                style: const TextStyle(color: Colors.indigo),
              ),
            ],
            if (notes.isNotEmpty) ...[
              const Divider(),
              Text('Notes (${notes.length})',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              ...notes.map(
                (n) => Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    '• ${n.assessment ?? n.subjective ?? 'Note by ${n.authorName}'}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Vitals Tab ────────────────────────────────────────────────────────────────

class _VitalsTab extends StatelessWidget {
  const _VitalsTab({required this.vitals});
  final List<VitalsRecord> vitals;

  @override
  Widget build(BuildContext context) {
    if (vitals.isEmpty) {
      return const Center(child: Text('No vitals recorded.'));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: vitals.length,
      itemBuilder: (context, i) => _VitalsCard(record: vitals[i]),
    );
  }
}

class _VitalsCard extends StatelessWidget {
  const _VitalsCard({required this.record});
  final VitalsRecord record;

  @override
  Widget build(BuildContext context) {
    final dateStr = record.createdAt != null
        ? DateFormat('dd MMM yyyy HH:mm').format(record.createdAt!)
        : '—';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: record.isUrgent ? Colors.red.shade50 : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(dateStr,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                if (record.isUrgent) ...[
                  const SizedBox(width: 8),
                  const Chip(
                    label: Text('URGENT',
                        style: TextStyle(
                            color: Colors.white, fontSize: 10)),
                    backgroundColor: Colors.red,
                    padding: EdgeInsets.zero,
                    materialTapTargetSize:
                        MaterialTapTargetSize.shrinkWrap,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                if (record.bpSystolic != null)
                  _VitalChip(
                      label: 'BP',
                      value:
                          '${record.bpSystolic!.toInt()}/${record.bpDiastolic?.toInt() ?? '—'} mmHg'),
                if (record.spo2 != null)
                  _VitalChip(
                      label: 'SpO₂',
                      value: '${record.spo2!.toInt()}%'),
                if (record.temperatureCelsius != null)
                  _VitalChip(
                      label: 'Temp',
                      value: '${record.temperatureCelsius}°C'),
                if (record.heartRateBpm != null)
                  _VitalChip(
                      label: 'HR',
                      value: '${record.heartRateBpm!.toInt()} bpm'),
                if (record.weightKg != null)
                  _VitalChip(
                      label: 'Weight',
                      value: '${record.weightKg} kg'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _VitalChip extends StatelessWidget {
  const _VitalChip({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 10, color: Colors.grey.shade600)),
        Text(value,
            style: const TextStyle(fontWeight: FontWeight.w600)),
      ],
    );
  }
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────

class _NotesTab extends StatelessWidget {
  const _NotesTab({required this.notes});
  final List<ClinicalNote> notes;

  @override
  Widget build(BuildContext context) {
    if (notes.isEmpty) {
      return const Center(child: Text('No clinical notes.'));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: notes.length,
      itemBuilder: (context, i) => _NoteCard(note: notes[i]),
    );
  }
}

class _NoteCard extends StatelessWidget {
  const _NoteCard({required this.note});
  final ClinicalNote note;

  @override
  Widget build(BuildContext context) {
    final dateStr = note.createdAt != null
        ? DateFormat('dd MMM yyyy HH:mm').format(note.createdAt!)
        : '—';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ExpansionTile(
        title: Text('Note — $dateStr'),
        subtitle:
            Text('By ${note.authorName}', style: const TextStyle(fontSize: 12)),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (note.subjective != null)
                  _NoteSection(
                      title: 'Subjective', body: note.subjective!),
                if (note.objective != null)
                  _NoteSection(
                      title: 'Objective', body: note.objective!),
                if (note.assessment != null)
                  _NoteSection(
                      title: 'Assessment', body: note.assessment!),
                if (note.plan != null)
                  _NoteSection(title: 'Plan', body: note.plan!),
                if (note.diagnosis?.description != null)
                  _NoteSection(
                      title: 'Diagnosis',
                      body:
                          '${note.diagnosis!.code != null ? '[${note.diagnosis!.code}] ' : ''}${note.diagnosis!.description!}'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NoteSection extends StatelessWidget {
  const _NoteSection({required this.title, required this.body});
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  fontWeight: FontWeight.bold, fontSize: 12,
                  color: Colors.indigo)),
          const SizedBox(height: 2),
          Text(body),
        ],
      ),
    );
  }
}
