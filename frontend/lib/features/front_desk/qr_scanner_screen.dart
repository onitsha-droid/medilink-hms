import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../patient/patient_models.dart';
import '../patient/patient_repository.dart';

// ── Provider ──────────────────────────────────────────────────────────────────

final _scannedPatientProvider =
    StateProvider<AsyncValue<PatientModel?>>((ref) => const AsyncData(null));

// ── QR Scanner Screen ─────────────────────────────────────────────────────────

/// Front Desk / Admin only.
/// Scans a patient QR code (contains {"hospitalId": "ML-XXXXXXXX"}),
/// resolves the patient via GET /patients/by-hospital-id/:id,
/// and shows a summary card.
class QrScannerScreen extends ConsumerStatefulWidget {
  const QrScannerScreen({super.key});

  @override
  ConsumerState<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends ConsumerState<QrScannerScreen> {
  final MobileScannerController _scannerCtrl = MobileScannerController();
  bool _processing = false;

  @override
  void dispose() {
    _scannerCtrl.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_processing) return;
    final barcode = capture.barcodes.firstOrNull;
    if (barcode?.rawValue == null) return;

    _processing = true;
    _scannerCtrl.stop();

    ref.read(_scannedPatientProvider.notifier).state =
        const AsyncLoading();

    try {
      final Map<String, dynamic> payload =
          jsonDecode(barcode!.rawValue!) as Map<String, dynamic>;
      final hospitalId = payload['hospitalId'] as String?;
      if (hospitalId == null) throw Exception('Invalid QR code');

      final patient =
          await ref.read(patientRepositoryProvider).getByHospitalId(hospitalId);
      ref.read(_scannedPatientProvider.notifier).state = AsyncData(patient);
    } catch (e) {
      ref.read(_scannedPatientProvider.notifier).state =
          AsyncError(e, StackTrace.current);
      _processing = false;
    }
  }

  void _reset() {
    ref.read(_scannedPatientProvider.notifier).state = const AsyncData(null);
    _processing = false;
    _scannerCtrl.start();
  }

  @override
  Widget build(BuildContext context) {
    final scanState = ref.watch(_scannedPatientProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan Patient QR'),
        actions: [
          if (scanState.value != null || scanState.hasError)
            TextButton(
              onPressed: _reset,
              child: const Text('Scan Again'),
            ),
        ],
      ),
      body: scanState.when(
        loading: () => const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Looking up patient…'),
            ],
          ),
        ),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: Colors.red, size: 48),
              const SizedBox(height: 12),
              Text(
                err.toString(),
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.red),
              ),
            ],
          ),
        ),
        data: (patient) {
          if (patient != null) {
            return _PatientSummaryCard(patient: patient);
          }
          // Show scanner
          return Stack(
            children: [
              MobileScanner(
                controller: _scannerCtrl,
                onDetect: _onDetect,
              ),
              // Viewfinder overlay
              Center(
                child: Container(
                  width: 240,
                  height: 240,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.white, width: 2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const Positioned(
                bottom: 40,
                left: 0,
                right: 0,
                child: Text(
                  'Point at the patient's QR card',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white, fontSize: 16),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

// ── Patient summary after scan ────────────────────────────────────────────────

class _PatientSummaryCard extends StatelessWidget {
  const _PatientSummaryCard({required this.patient});
  final PatientModel patient;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Card(
          elevation: 4,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const CircleAvatar(
                      radius: 28,
                      child: Icon(Icons.person, size: 32),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            patient.fullName,
                            key: const Key('summary_patient_name'),
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          Text(
                            patient.hospitalId,
                            key: const Key('summary_hospital_id'),
                            style: TextStyle(color: Colors.grey.shade600),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.green.shade100,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        'Verified',
                        style: TextStyle(color: Colors.green),
                      ),
                    ),
                  ],
                ),
                const Divider(height: 24),
                _Row(label: 'Phone', value: patient.phone),
                _Row(label: 'Gender', value: patient.gender),
                _Row(label: 'DOB', value: patient.dateOfBirth),
                if (patient.email != null)
                  _Row(label: 'Email', value: patient.email!),
                if (patient.hmo?.provider != null)
                  _Row(label: 'HMO', value: patient.hmo!.provider!),
                if (patient.nhiaNumber != null)
                  _Row(label: 'NHIA', value: patient.nhiaNumber!),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const Key('assign_clinic_button'),
                    onPressed: () {
                      // Queue assignment — wired up in Commit 8
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text('Assign to clinic — coming in queue module')),
                      );
                    },
                    icon: const Icon(Icons.queue),
                    label: const Text('Assign to Clinic Queue'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 70,
            child: Text(label,
                style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}
