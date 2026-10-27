import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final prescriptionInboxProvider =
    FutureProvider.autoDispose<List<Prescription>>((ref) {
  return ref.read(clinicalRepositoryProvider).getPrescriptionInbox();
});

// ── Pharmacist Inbox ──────────────────────────────────────────────────────────

class PharmacistInboxScreen extends ConsumerWidget {
  const PharmacistInboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inboxAsync = ref.watch(prescriptionInboxProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Prescription Inbox'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.invalidate(prescriptionInboxProvider),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () =>
                ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: inboxAsync.when(
        loading: () =>
            const Center(child: CircularProgressIndicator()),
        error: (e, _) =>
            Center(child: Text('Error: $e')),
        data: (prescriptions) {
          if (prescriptions.isEmpty) {
            return const Center(
                child: Text('No pending prescriptions.'));
          }
          return RefreshIndicator(
            onRefresh: () async =>
                ref.invalidate(prescriptionInboxProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: prescriptions.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: 8),
              itemBuilder: (context, i) =>
                  _PrescriptionInboxCard(prescription: prescriptions[i]),
            ),
          );
        },
      ),
    );
  }
}

class _PrescriptionInboxCard extends ConsumerWidget {
  const _PrescriptionInboxCard({required this.prescription});
  final Prescription prescription;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Color(0xFFE3F2FD),
          child: Icon(Icons.medication, color: Colors.blue),
        ),
        title: Text(prescription.patientName ?? 'Patient',
            style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(
            '${prescription.drugs.length} drug(s) · by ${prescription.prescribedByName ?? '—'}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) =>
                PrescriptionDetailScreen(prescription: prescription),
          ),
        ),
      ),
    );
  }
}

// ── Prescription Detail + Dispense ────────────────────────────────────────────

class PrescriptionDetailScreen extends ConsumerStatefulWidget {
  const PrescriptionDetailScreen(
      {super.key, required this.prescription});
  final Prescription prescription;

  @override
  ConsumerState<PrescriptionDetailScreen> createState() =>
      _PrescriptionDetailScreenState();
}

class _PrescriptionDetailScreenState
    extends ConsumerState<PrescriptionDetailScreen> {
  List<StockCheck>? _stockChecks;
  bool _loadingStock = false;
  bool _dispensing = false;
  String? _error;
  bool _dispensed = false;

  @override
  void initState() {
    super.initState();
    _checkStock();
  }

  Future<void> _checkStock() async {
    setState(() => _loadingStock = true);
    try {
      final checks = await ref
          .read(clinicalRepositoryProvider)
          .checkStock(widget.prescription.id);
      setState(() => _stockChecks = checks);
    } catch (e) {
      // Stock check is informational — don't block if it fails
    } finally {
      setState(() => _loadingStock = false);
    }
  }

  Future<void> _dispense() async {
    setState(() {
      _dispensing = true;
      _error = null;
    });
    try {
      await ref
          .read(clinicalRepositoryProvider)
          .dispense(widget.prescription.id);
      setState(() => _dispensed = true);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Prescription dispensed ✓'),
              backgroundColor: Colors.green),
        );
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _dispensing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rx = widget.prescription;

    return Scaffold(
      appBar: AppBar(
        title: Text(rx.patientName ?? 'Prescription'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Patient info
          Card(
            color: Colors.blue.shade50,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Patient: ${rx.patientName ?? '—'}',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold)),
                  Text(
                      'Prescribed by: ${rx.prescribedByName ?? '—'}'),
                  if (rx.notes != null)
                    Text('Notes: ${rx.notes}'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Drug lines
          Text('Drugs',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          ...rx.drugs.map((d) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(d.drugName,
                          style: const TextStyle(
                              fontWeight: FontWeight.bold)),
                      Text('${d.dose} · ${d.frequency}'),
                      Text(
                          'Duration: ${d.duration} · Qty: ${d.quantity}'),
                      if (d.instructions != null)
                        Text('⚠ ${d.instructions}',
                            style: TextStyle(
                                color: Colors.orange.shade800)),
                    ],
                  ),
                ),
              )),

          // Stock availability
          const SizedBox(height: 12),
          Text('Stock Availability',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_loadingStock)
            const LinearProgressIndicator()
          else if (_stockChecks != null)
            ..._stockChecks!.map((sc) => _StockRow(check: sc))
          else
            const Text('Could not load stock information.'),

          const SizedBox(height: 20),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!,
                  style: const TextStyle(color: Colors.red)),
            ),

          ElevatedButton.icon(
            onPressed: (_dispensing || _dispensed) ? null : _dispense,
            icon: _dispensing
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.check_circle),
            label: Text(
                _dispensed ? 'Dispensed' : 'Confirm Dispense'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
              foregroundColor: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}

class _StockRow extends StatelessWidget {
  const _StockRow({required this.check});
  final StockCheck check;

  @override
  Widget build(BuildContext context) {
    final statusColor = check.inStock ? Colors.green : Colors.red;
    final statusLabel =
        check.inStock ? 'In stock (${check.quantityOnHand})' : 'OUT OF STOCK';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            check.inStock
                ? Icons.check_circle_outline
                : Icons.cancel_outlined,
            color: statusColor,
            size: 20,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
                '${check.drugName} (need ${check.quantityRequired})'),
          ),
          Text(statusLabel,
              style: TextStyle(
                  color: statusColor, fontWeight: FontWeight.bold,
                  fontSize: 12)),
          if (check.isLowStock == true) ...[
            const SizedBox(width: 4),
            const Tooltip(
              message: 'Low stock — notify Admin',
              child: Icon(Icons.warning_amber,
                  color: Colors.orange, size: 16),
            ),
          ],
        ],
      ),
    );
  }
}
