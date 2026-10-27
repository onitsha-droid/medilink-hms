import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';

// ── Prescription form — Doctor creates a structured prescription ──────────────

class PrescriptionFormScreen extends ConsumerStatefulWidget {
  const PrescriptionFormScreen({
    super.key,
    required this.encounterId,
    required this.patientName,
  });

  final String encounterId;
  final String patientName;

  @override
  ConsumerState<PrescriptionFormScreen> createState() =>
      _PrescriptionFormScreenState();
}

class _PrescriptionFormScreenState
    extends ConsumerState<PrescriptionFormScreen> {
  final List<_DrugFormData> _drugs = [_DrugFormData()];
  final _notesCtrl = TextEditingController();
  bool _saving = false;
  String? _error;

  static const _frequencies = [
    'once daily',
    'twice daily',
    'three times daily',
    'four times daily',
    'every 6 hours',
    'every 8 hours',
    'every 12 hours',
    'as needed',
    'stat',
    'weekly',
    'other',
  ];

  @override
  void dispose() {
    _notesCtrl.dispose();
    for (final d in _drugs) {
      d.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    // Validate each drug row
    for (final drug in _drugs) {
      if (drug.nameCtrl.text.trim().isEmpty) {
        setState(() => _error = 'All drug names are required');
        return;
      }
      if (drug.doseCtrl.text.trim().isEmpty) {
        setState(() => _error = 'All dose fields are required');
        return;
      }
      if (drug.durationCtrl.text.trim().isEmpty) {
        setState(() => _error = 'All duration fields are required');
        return;
      }
      if (int.tryParse(drug.qtyCtrl.text.trim()) == null ||
          int.parse(drug.qtyCtrl.text.trim()) < 1) {
        setState(() => _error = 'Quantity must be a positive integer');
        return;
      }
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final drugLines = _drugs
          .map((d) => DrugLine(
                drugName: d.nameCtrl.text.trim(),
                dose: d.doseCtrl.text.trim(),
                frequency: d.frequency,
                duration: d.durationCtrl.text.trim(),
                quantity: int.parse(d.qtyCtrl.text.trim()),
                instructions: d.instrCtrl.text.trim().isEmpty
                    ? null
                    : d.instrCtrl.text.trim(),
              ))
          .toList();

      await ref.read(clinicalRepositoryProvider).createPrescription(
            encounterId: widget.encounterId,
            drugs: drugLines,
            notes: _notesCtrl.text.trim().isEmpty
                ? null
                : _notesCtrl.text.trim(),
          );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Prescription sent to pharmacy ✓')),
        );
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Prescription — ${widget.patientName}'),
        actions: [
          if (_saving)
            const Padding(
              padding: EdgeInsets.all(16),
              child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white)),
            )
          else
            TextButton(
              onPressed: _submit,
              child: const Text('SEND',
                  style: TextStyle(color: Colors.white)),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.small(
        onPressed: () => setState(() => _drugs.add(_DrugFormData())),
        tooltip: 'Add drug',
        child: const Icon(Icons.add),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 80),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!,
                  style: const TextStyle(color: Colors.red)),
            ),
          ...List.generate(_drugs.length, (i) {
            return _DrugRow(
              key: ValueKey(i),
              data: _drugs[i],
              index: i,
              frequencies: _frequencies,
              onRemove: _drugs.length > 1
                  ? () => setState(() => _drugs.removeAt(i))
                  : null,
              onChanged: () => setState(() {}),
            );
          }),
          const SizedBox(height: 16),
          TextFormField(
            controller: _notesCtrl,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Notes to pharmacist (optional)',
              border: OutlineInputBorder(),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Per-drug row form state ───────────────────────────────────────────────────

class _DrugFormData {
  final nameCtrl = TextEditingController();
  final doseCtrl = TextEditingController();
  final durationCtrl = TextEditingController();
  final qtyCtrl = TextEditingController(text: '1');
  final instrCtrl = TextEditingController();
  String frequency = 'twice daily';

  void dispose() {
    nameCtrl.dispose();
    doseCtrl.dispose();
    durationCtrl.dispose();
    qtyCtrl.dispose();
    instrCtrl.dispose();
  }
}

class _DrugRow extends StatelessWidget {
  const _DrugRow({
    super.key,
    required this.data,
    required this.index,
    required this.frequencies,
    required this.onChanged,
    this.onRemove,
  });

  final _DrugFormData data;
  final int index;
  final List<String> frequencies;
  final VoidCallback onChanged;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Drug ${index + 1}',
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                const Spacer(),
                if (onRemove != null)
                  IconButton(
                    icon: const Icon(Icons.delete_outline,
                        color: Colors.red),
                    onPressed: onRemove,
                    tooltip: 'Remove drug',
                  ),
              ],
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: data.nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Drug name *',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: data.doseCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Dose *',
                      hintText: 'e.g. 500mg tablet',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    controller: data.qtyCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Qty *',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: data.frequency,
              decoration: const InputDecoration(
                labelText: 'Frequency *',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: frequencies
                  .map((f) => DropdownMenuItem(value: f, child: Text(f)))
                  .toList(),
              onChanged: (v) {
                if (v != null) {
                  data.frequency = v;
                  onChanged();
                }
              },
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: data.durationCtrl,
              decoration: const InputDecoration(
                labelText: 'Duration *',
                hintText: 'e.g. 7 days',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: data.instrCtrl,
              decoration: const InputDecoration(
                labelText: 'Instructions (optional)',
                hintText: 'e.g. take with food',
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
