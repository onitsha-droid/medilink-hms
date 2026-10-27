import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final patientInvoicesProvider =
    FutureProvider.autoDispose.family<List<Invoice>, String>(
  (ref, patientId) =>
      ref.read(clinicalRepositoryProvider).getMyInvoices(patientId),
);

// ── Patient Pay-Bill Screen ───────────────────────────────────────────────────

/// Read-only invoice list for the Patient role with a "Pay Now" action
/// on pending invoices.
///
/// `patientId` must be passed from the router — it is the Mongo Patient._id
/// stored at login time (DEFERRED: bind User→Patient at auth time).
class PatientBillScreen extends ConsumerWidget {
  const PatientBillScreen({super.key, required this.patientId});
  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invoicesAsync = ref.watch(patientInvoicesProvider(patientId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Bills'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.invalidate(patientInvoicesProvider(patientId)),
          ),
        ],
      ),
      body: invoicesAsync.when(
        loading: () =>
            const Center(child: CircularProgressIndicator()),
        error: (e, _) =>
            Center(child: Text('Error loading bills: $e')),
        data: (invoices) {
          if (invoices.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.receipt_long,
                      size: 64, color: Colors.grey),
                  SizedBox(height: 12),
                  Text('No invoices yet.'),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async =>
                ref.invalidate(patientInvoicesProvider(patientId)),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: invoices.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final invoice = invoices[i];
                return _PatientInvoiceCard(
                  invoice: invoice,
                  patientId: patientId,
                  onPaid: () => ref
                      .invalidate(patientInvoicesProvider(patientId)),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _PatientInvoiceCard extends StatelessWidget {
  const _PatientInvoiceCard({
    required this.invoice,
    required this.patientId,
    required this.onPaid,
  });

  final Invoice invoice;
  final String patientId;
  final VoidCallback onPaid;

  @override
  Widget build(BuildContext context) {
    final dateStr = invoice.createdAt != null
        ? DateFormat('dd MMM yyyy').format(invoice.createdAt!)
        : '—';
    final totalStr =
        '₦${invoice.totalNaira.toStringAsFixed(2)}';
    final isPending = invoice.status == 'pending';

    return Card(
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
                const Spacer(),
                _StatusBadge(status: invoice.status),
              ],
            ),
            const SizedBox(height: 6),
            ...invoice.lineItems.map(
              (item) => Padding(
                padding:
                    const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Expanded(
                        child: Text(item.description,
                            style: const TextStyle(
                                fontSize: 13))),
                    Text(
                        '₦${(item.amountKobo / 100).toStringAsFixed(2)}',
                        style: const TextStyle(fontSize: 13)),
                  ],
                ),
              ),
            ),
            const Divider(),
            Row(
              children: [
                const Text('Total',
                    style:
                        TextStyle(fontWeight: FontWeight.bold)),
                const Spacer(),
                Text(totalStr,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16)),
              ],
            ),
            if (invoice.receiptNumber != null) ...[
              const SizedBox(height: 4),
              Text('Receipt: ${invoice.receiptNumber}',
                  style: TextStyle(
                      color: Colors.green.shade700,
                      fontSize: 12)),
            ],
            if (isPending) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  icon: const Icon(Icons.payment),
                  label: const Text('Pay Now'),
                  onPressed: () =>
                      Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => PaymentStatusScreen(
                        invoice: invoice,
                        onSuccess: onPaid,
                      ),
                    ),
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

// ── Payment Status Screen ─────────────────────────────────────────────────────

class PaymentStatusScreen extends ConsumerStatefulWidget {
  const PaymentStatusScreen({
    super.key,
    required this.invoice,
    required this.onSuccess,
  });

  final Invoice invoice;
  final VoidCallback onSuccess;

  @override
  ConsumerState<PaymentStatusScreen> createState() =>
      _PaymentStatusScreenState();
}

class _PaymentStatusScreenState
    extends ConsumerState<PaymentStatusScreen> {
  bool _initializing = false;
  bool _polling = false;
  String? _error;
  String? _authUrl;
  Invoice? _latestInvoice;

  @override
  void initState() {
    super.initState();
    _latestInvoice = widget.invoice;
  }

  Future<void> _initializePayment() async {
    final authState = ref.read(authProvider);
    final email = authState is AuthStateAuthenticated
        ? authState.user.email
        : '';
    if (email.isEmpty) {
      setState(() => _error = 'Cannot determine email; please log in again.');
      return;
    }

    setState(() {
      _initializing = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(clinicalRepositoryProvider)
          .initializePayment(
            invoiceId: widget.invoice.id,
            email: email,
          );
      setState(() => _authUrl = result['authorizationUrl']);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _initializing = false);
    }
  }

  Future<void> _checkStatus() async {
    setState(() => _polling = true);
    try {
      final updated = await ref
          .read(clinicalRepositoryProvider)
          .getPaymentStatus(widget.invoice.id);
      setState(() => _latestInvoice = updated);
      if (updated.status == 'paid') {
        widget.onSuccess();
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _polling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = _latestInvoice!;
    final isPaid = inv.status == 'paid';

    return Scaffold(
      appBar: AppBar(title: const Text('Pay Bill')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '₦${inv.totalNaira.toStringAsFixed(2)}',
                      style:
                          Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 4),
                    _StatusBadge(status: inv.status),
                    if (isPaid && inv.receiptNumber != null) ...[
                      const SizedBox(height: 8),
                      Text('Receipt: ${inv.receiptNumber}',
                          style: TextStyle(
                              color: Colors.green.shade700,
                              fontWeight: FontWeight.bold)),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!,
                    style: const TextStyle(color: Colors.red)),
              ),

            if (isPaid)
              const Center(
                child: Column(
                  children: [
                    Icon(Icons.check_circle,
                        color: Colors.green, size: 64),
                    SizedBox(height: 8),
                    Text('Payment confirmed!',
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            else ...[
              if (_authUrl != null) ...[
                const Text(
                  'Complete your payment in the browser, then '
                  'tap "I have paid" to confirm.',
                ),
                const SizedBox(height: 12),
                // In a real build this would open an in-app WebView or
                // url_launcher.  Here we display the URL and a confirm button.
                SelectableText(
                  _authUrl!,
                  style: const TextStyle(
                      color: Colors.blue,
                      decoration: TextDecoration.underline),
                ),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: _polling ? null : _checkStatus,
                  icon: _polling
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2))
                      : const Icon(Icons.refresh),
                  label: const Text('I have paid — check status'),
                ),
              ] else
                ElevatedButton.icon(
                  onPressed: _initializing ? null : _initializePayment,
                  icon: _initializing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white))
                      : const Icon(Icons.payment),
                  label: const Text('Proceed to Payment'),
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      'paid' => (Colors.green, 'PAID'),
      'cancelled' => (Colors.grey, 'CANCELLED'),
      _ => (Colors.orange, 'PENDING'),
    };
    return Container(
      padding:
          const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color),
      ),
      child: Text(label,
          style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
              fontSize: 11)),
    );
  }
}
