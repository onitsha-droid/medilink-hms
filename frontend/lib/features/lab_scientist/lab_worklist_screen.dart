import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final labWorklistProvider =
    FutureProvider.autoDispose<List<LabRequest>>((ref) {
  return ref.read(clinicalRepositoryProvider).getLabWorklist();
});

// ── Lab Scientist Worklist ────────────────────────────────────────────────────

class LabWorklistScreen extends ConsumerWidget {
  const LabWorklistScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final worklistAsync = ref.watch(labWorklistProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Lab Worklist'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(labWorklistProvider),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () =>
                ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: worklistAsync.when(
        loading: () =>
            const Center(child: CircularProgressIndicator()),
        error: (e, _) =>
            Center(child: Text('Error: $e')),
        data: (requests) {
          if (requests.isEmpty) {
            return const Center(
              child: Text('No paid requests in the worklist.'),
            );
          }
          return RefreshIndicator(
            onRefresh: () async =>
                ref.invalidate(labWorklistProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: requests.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: 8),
              itemBuilder: (context, i) =>
                  _LabRequestCard(request: requests[i]),
            ),
          );
        },
      ),
    );
  }
}

class _LabRequestCard extends ConsumerWidget {
  const _LabRequestCard({required this.request});
  final LabRequest request;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final urgencyColor = switch (request.urgency) {
      'stat' => Colors.red,
      'urgent' => Colors.orange,
      _ => Colors.blue,
    };

    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: urgencyColor.withOpacity(0.15),
          child: Icon(Icons.science, color: urgencyColor),
        ),
        title: Text(
          request.patientName ?? 'Patient',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(
          '${request.tests.length} test(s) · ${request.urgency.toUpperCase()}',
        ),
        trailing: ElevatedButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) =>
                  LabResultEntryScreen(request: request),
            ),
          ),
          child: const Text('Pick Up'),
        ),
      ),
    );
  }
}

// ── Lab Result Entry Screen ───────────────────────────────────────────────────

class LabResultEntryScreen extends ConsumerStatefulWidget {
  const LabResultEntryScreen({super.key, required this.request});
  final LabRequest request;

  @override
  ConsumerState<LabResultEntryScreen> createState() =>
      _LabResultEntryScreenState();
}

class _LabResultEntryScreenState
    extends ConsumerState<LabResultEntryScreen> {
  bool _pickedUp = false;
  bool _submitting = false;
  String? _error;

  late final List<_ResultRowData> _rows;

  @override
  void initState() {
    super.initState();
    _rows = widget.request.tests
        .map((t) => _ResultRowData(
            testName: (t['name'] ?? '').toString()))
        .toList();
    _pickedUp = widget.request.status == 'in_progress';
  }

  @override
  void dispose() {
    for (final r in _rows) r.dispose();
    super.dispose();
  }

  Future<void> _pickUp() async {
    setState(() => _submitting = true);
    try {
      await ref
          .read(clinicalRepositoryProvider)
          .pickUpLabRequest(widget.request.id);
      setState(() => _pickedUp = true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _submitting = false);
    }
  }

  Future<void> _submitResults() async {
    for (final row in _rows) {
      if (row.valueCtrl.text.trim().isEmpty) {
        setState(() => _error = 'All result values are required');
        return;
      }
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final results = _rows
          .map((r) => {
                'testName': r.testName,
                'value': r.valueCtrl.text.trim(),
                'unit': r.unitCtrl.text.trim().isEmpty
                    ? null
                    : r.unitCtrl.text.trim(),
                'referenceRange':
                    r.refRangeCtrl.text.trim().isEmpty
                        ? null
                        : r.refRangeCtrl.text.trim(),
                'notes': r.notesCtrl.text.trim().isEmpty
                    ? null
                    : r.notesCtrl.text.trim(),
              })
          .toList();

      final completed = await ref
          .read(clinicalRepositoryProvider)
          .submitLabResults(
            labRequestId: widget.request.id,
            results: results,
          );

      if (mounted) {
        final hasAbnormal = completed.results.any((r) => r.isAbnormal);
        await showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('Results Submitted'),
            content: hasAbnormal
                ? const Text(
                    '⚠️ Abnormal values detected and flagged. '
                    'The doctor and patient have been notified.')
                : const Text(
                    '✓ All values within normal range.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('OK'),
              ),
            ],
          ),
        );
        if (mounted) Navigator.of(context).pop(true);
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.request.patientName ?? 'Lab Request'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Summary card
          Card(
            color: Colors.blue.shade50,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Patient: ${widget.request.patientName ?? '—'}',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold)),
                  if (widget.request.patientHospitalId != null)
                    Text('ID: ${widget.request.patientHospitalId}'),
                  Text(
                      'Urgency: ${widget.request.urgency.toUpperCase()}'),
                  Text(
                      'Requested by: ${widget.request.requestedByName ?? '—'}'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!,
                  style: const TextStyle(color: Colors.red)),
            ),

          if (!_pickedUp) ...[
            ElevatedButton.icon(
              onPressed: _submitting ? null : _pickUp,
              icon: _submitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.assignment_turned_in),
              label: const Text('Pick Up Request'),
            ),
          ] else ...[
            Text('Enter Results',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            ..._rows.map((row) => _ResultRowWidget(
                  key: ValueKey(row.testName),
                  data: row,
                )),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _submitting ? null : _submitResults,
              icon: _submitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.send),
              label: const Text('Submit Results'),
              style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green),
            ),
          ],
        ],
      ),
    );
  }
}

// ── Result row form state ─────────────────────────────────────────────────────

class _ResultRowData {
  _ResultRowData({required this.testName});
  final String testName;
  final valueCtrl = TextEditingController();
  final unitCtrl = TextEditingController();
  final refRangeCtrl = TextEditingController();
  final notesCtrl = TextEditingController();

  void dispose() {
    valueCtrl.dispose();
    unitCtrl.dispose();
    refRangeCtrl.dispose();
    notesCtrl.dispose();
  }
}

class _ResultRowWidget extends StatelessWidget {
  const _ResultRowWidget({super.key, required this.data});
  final _ResultRowData data;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(data.testName,
                style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextFormField(
                    controller: data.valueCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Value *',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    controller: data.unitCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Unit',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: data.refRangeCtrl,
              decoration: const InputDecoration(
                labelText: 'Reference Range',
                hintText: 'e.g. 3.5 - 5.0',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: data.notesCtrl,
              decoration: const InputDecoration(
                labelText: 'Notes (optional)',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
