import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../patient/patient_models.dart';
import '../patient/patient_repository.dart';
import '../patient/patient_registration_screen.dart';
import 'queue_models.dart';
import 'queue_provider.dart';

// ── State ─────────────────────────────────────────────────────────────────────

sealed class _CheckInState {
  const _CheckInState();
}

class _CheckInIdle extends _CheckInState {
  const _CheckInIdle();
}

class _CheckInSearching extends _CheckInState {
  const _CheckInSearching();
}

class _CheckInFound extends _CheckInState {
  const _CheckInFound(this.patient);
  final PatientModel patient;
}

class _CheckInSubmitting extends _CheckInState {
  const _CheckInSubmitting(this.patient);
  final PatientModel patient;
}

class _CheckInDone extends _CheckInState {
  const _CheckInDone(this.patient, this.response);
  final PatientModel patient;
  final CheckInResponse response;
}

class _CheckInError extends _CheckInState {
  const _CheckInError(this.message);
  final String message;
}

// ── Front Desk Check-In Screen ────────────────────────────────────────────────

/// Front Desk screen: look up a patient by hospital ID, pick a clinic,
/// and assign them to the queue.
class FrontDeskCheckInScreen extends ConsumerStatefulWidget {
  const FrontDeskCheckInScreen({super.key});

  @override
  ConsumerState<FrontDeskCheckInScreen> createState() =>
      _FrontDeskCheckInScreenState();
}

class _FrontDeskCheckInScreenState
    extends ConsumerState<FrontDeskCheckInScreen> {
  final _idController = TextEditingController();
  String? _selectedClinicId;
  String? _selectedClinicName;
  _CheckInState _state = const _CheckInIdle();

  @override
  void dispose() {
    _idController.dispose();
    super.dispose();
  }

  Future<void> _lookupPatient() async {
    final id = _idController.text.trim().toUpperCase();
    if (id.isEmpty) return;

    setState(() => _state = const _CheckInSearching());
    try {
      final patient =
          await ref.read(patientRepositoryProvider).getByHospitalId(id);
      setState(() => _state = _CheckInFound(patient));
    } catch (e) {
      setState(() => _state = _CheckInError(e.toString()));
    }
  }

  Future<void> _checkIn(PatientModel patient) async {
    if (_selectedClinicId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a clinic first')),
      );
      return;
    }

    setState(() => _state = _CheckInSubmitting(patient));
    try {
      final response = await ref.read(queueRepositoryProvider).checkIn(
            CheckInRequest(
              patientId: patient.id,
              clinicId: _selectedClinicId!,
            ),
          );
      setState(() => _state = _CheckInDone(patient, response));
    } catch (e) {
      setState(() => _state = _CheckInError(e.toString()));
    }
  }

  void _reset() {
    _idController.clear();
    _selectedClinicId = null;
    _selectedClinicName = null;
    setState(() => _state = const _CheckInIdle());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Patient Check-In'),
        actions: [
          if (_state is! _CheckInIdle)
            TextButton(
              onPressed: _reset,
              child: const Text('New Check-In'),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ── Hospital ID lookup ────────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('hospital_id_input'),
                    controller: _idController,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Hospital ID (e.g. ML-A1B2C3D4)',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.badge),
                    ),
                    onSubmitted: (_) => _lookupPatient(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('lookup_button'),
                  onPressed: _state is _CheckInSearching ? null : _lookupPatient,
                  child: _state is _CheckInSearching
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child:
                              CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Look up'),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // ── Quick access: scan QR ─────────────────────────────────────
            OutlinedButton.icon(
              key: const Key('scan_qr_button'),
              onPressed: () {
                // Navigation to QR scanner — wired in the router
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                      content: Text('Open QR scanner from the menu')),
                );
              },
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Scan QR instead'),
            ),
            const SizedBox(height: 24),

            // ── Main state area ───────────────────────────────────────────
            _buildStateArea(),
          ],
        ),
      ),
    );
  }

  Widget _buildStateArea() {
    return switch (_state) {
      _CheckInIdle() => const Center(
          child: Text(
            'Enter or scan the patient\'s hospital ID to begin.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey),
          ),
        ),
      _CheckInSearching() => const Center(child: CircularProgressIndicator()),
      _CheckInError(:final message) => Container(
          key: const Key('checkin_error'),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.red.shade50,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.red.shade200),
          ),
          child: Text(message,
              style: TextStyle(color: Colors.red.shade800)),
        ),
      _CheckInFound(:final patient) => _PatientFoundCard(
          patient: patient,
          selectedClinicId: _selectedClinicId,
          selectedClinicName: _selectedClinicName,
          onClinicSelected: (id, name) => setState(() {
            _selectedClinicId = id;
            _selectedClinicName = name;
          }),
          onCheckIn: () => _checkIn(patient),
        ),
      _CheckInSubmitting(:final patient) => Column(
          children: [
            _PatientSummaryRow(patient: patient),
            const SizedBox(height: 16),
            const CircularProgressIndicator(),
            const SizedBox(height: 8),
            const Text('Assigning to queue…'),
          ],
        ),
      _CheckInDone(:final patient, :final response) => _CheckInSuccessCard(
          key: const Key('checkin_success'),
          patient: patient,
          response: response,
          clinicName: _selectedClinicName ?? 'Clinic',
        ),
    };
  }
}

// ── Sub-widgets ───────────────────────────────────────────────────────────────

class _PatientSummaryRow extends StatelessWidget {
  const _PatientSummaryRow({required this.patient});
  final PatientModel patient;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const CircleAvatar(child: Icon(Icons.person)),
      title: Text(patient.fullName),
      subtitle: Text(patient.hospitalId),
      contentPadding: EdgeInsets.zero,
    );
  }
}

class _PatientFoundCard extends StatelessWidget {
  const _PatientFoundCard({
    required this.patient,
    required this.selectedClinicId,
    required this.selectedClinicName,
    required this.onClinicSelected,
    required this.onCheckIn,
  });

  final PatientModel patient;
  final String? selectedClinicId;
  final String? selectedClinicName;
  final void Function(String id, String name) onClinicSelected;
  final VoidCallback onCheckIn;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _PatientSummaryRow(patient: patient),
            const Divider(),
            // Clinic picker — in a real app this would be populated from
            // GET /clinics. Placeholder chips for the UI shape.
            Text('Select Clinic',
                style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            _ClinicPicker(
              selectedClinicId: selectedClinicId,
              onSelected: onClinicSelected,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              key: const Key('assign_to_queue_button'),
              onPressed: selectedClinicId != null ? onCheckIn : null,
              icon: const Icon(Icons.queue),
              label: const Text('Assign to Queue'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Simple inline clinic picker using hardcoded sample names.
/// In later commits this will fetch from GET /clinics.
class _ClinicPicker extends StatelessWidget {
  const _ClinicPicker({
    required this.selectedClinicId,
    required this.onSelected,
  });

  final String? selectedClinicId;
  final void Function(String id, String name) onSelected;

  // Sample clinics — replace with API-fetched list in the clinics feature
  static const _samples = [
    ('general-opd', 'General OPD'),
    ('cardiology', 'Cardiology'),
    ('paediatrics', 'Paediatrics'),
    ('gynaecology', 'Gynaecology'),
  ];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      children: _samples.map((entry) {
        final (id, name) = entry;
        return ChoiceChip(
          key: Key('clinic_chip_$id'),
          label: Text(name),
          selected: selectedClinicId == id,
          onSelected: (_) => onSelected(id, name),
        );
      }).toList(),
    );
  }
}

class _CheckInSuccessCard extends StatelessWidget {
  const _CheckInSuccessCard({
    super.key,
    required this.patient,
    required this.response,
    required this.clinicName,
  });

  final PatientModel patient;
  final CheckInResponse response;
  final String clinicName;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.green.shade50,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.green.shade200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const Icon(Icons.check_circle, color: Colors.green, size: 56),
            const SizedBox(height: 12),
            Text(
              '${patient.fullName} checked in!',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(color: Colors.green.shade800),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              clinicName,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _StatChip(
                  key: const Key('queue_position_chip'),
                  label: 'Position',
                  value: '#${response.position}',
                ),
                _StatChip(
                  key: const Key('estimated_wait_chip'),
                  label: 'Est. wait',
                  value: response.estimatedWaitMinutes == 0
                      ? 'Next!'
                      : '~${response.estimatedWaitMinutes} min',
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({
    super.key,
    required this.label,
    required this.value,
  });
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 11, color: Colors.grey.shade600)),
        Text(value,
            style: const TextStyle(
                fontSize: 22, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
