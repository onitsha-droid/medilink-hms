import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'patient_models.dart';
import 'patient_repository.dart';

// ── Provider ──────────────────────────────────────────────────────────────────

/// Holds the newly registered patient after Front Desk completes registration.
final registeredPatientProvider =
    StateProvider<PatientModel?>((ref) => null);

// ── Registration Form ─────────────────────────────────────────────────────────

class PatientRegistrationScreen extends ConsumerStatefulWidget {
  const PatientRegistrationScreen({super.key});

  @override
  ConsumerState<PatientRegistrationScreen> createState() =>
      _PatientRegistrationScreenState();
}

class _PatientRegistrationScreenState
    extends ConsumerState<PatientRegistrationScreen> {
  final _formKey = GlobalKey<FormState>();

  // Controllers
  final _firstNameCtrl = TextEditingController();
  final _lastNameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _nhiaCtrl = TextEditingController();
  final _hmoProviderCtrl = TextEditingController();
  final _hmoMemberCtrl = TextEditingController();

  DateTime? _dateOfBirth;
  String _gender = 'female';
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _nhiaCtrl.dispose();
    _hmoProviderCtrl.dispose();
    _hmoMemberCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(1990),
      firstDate: DateTime(1900),
      lastDate: DateTime.now(),
    );
    if (picked != null) setState(() => _dateOfBirth = picked);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_dateOfBirth == null) {
      setState(() => _error = 'Date of birth is required');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final request = CreatePatientRequest(
        firstName: _firstNameCtrl.text.trim(),
        lastName: _lastNameCtrl.text.trim(),
        dateOfBirth:
            '${_dateOfBirth!.year.toString().padLeft(4, '0')}-'
            '${_dateOfBirth!.month.toString().padLeft(2, '0')}-'
            '${_dateOfBirth!.day.toString().padLeft(2, '0')}',
        gender: _gender,
        phone: _phoneCtrl.text.trim(),
        email: _emailCtrl.text.trim().isEmpty ? null : _emailCtrl.text.trim(),
        nhiaNumber: _nhiaCtrl.text.trim().isEmpty ? null : _nhiaCtrl.text.trim(),
        hmo: _hmoProviderCtrl.text.trim().isEmpty
            ? null
            : PatientHmo(
                provider: _hmoProviderCtrl.text.trim(),
                memberNumber: _hmoMemberCtrl.text.trim().isEmpty
                    ? null
                    : _hmoMemberCtrl.text.trim(),
              ),
      );

      final patient =
          await ref.read(patientRepositoryProvider).createPatient(request);

      ref.read(registeredPatientProvider.notifier).state = patient;

      if (mounted) {
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => HospitalCardScreen(patient: patient),
          ),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register Patient')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Name ───────────────────────────────────────────────────────
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      key: const Key('first_name_field'),
                      controller: _firstNameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'First Name *',
                        border: OutlineInputBorder(),
                      ),
                      textCapitalization: TextCapitalization.words,
                      validator: (v) =>
                          (v == null || v.trim().isEmpty) ? 'Required' : null,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextFormField(
                      key: const Key('last_name_field'),
                      controller: _lastNameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Last Name *',
                        border: OutlineInputBorder(),
                      ),
                      textCapitalization: TextCapitalization.words,
                      validator: (v) =>
                          (v == null || v.trim().isEmpty) ? 'Required' : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // ── Date of Birth ───────────────────────────────────────────────
              InkWell(
                key: const Key('dob_picker'),
                onTap: _pickDate,
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Date of Birth *',
                    border: OutlineInputBorder(),
                    suffixIcon: Icon(Icons.calendar_today),
                  ),
                  child: Text(
                    _dateOfBirth == null
                        ? 'Select date'
                        : '${_dateOfBirth!.year}-'
                            '${_dateOfBirth!.month.toString().padLeft(2, '0')}-'
                            '${_dateOfBirth!.day.toString().padLeft(2, '0')}',
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // ── Gender ──────────────────────────────────────────────────────
              DropdownButtonFormField<String>(
                key: const Key('gender_dropdown'),
                value: _gender,
                decoration: const InputDecoration(
                  labelText: 'Gender *',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'female', child: Text('Female')),
                  DropdownMenuItem(value: 'male', child: Text('Male')),
                  DropdownMenuItem(value: 'other', child: Text('Other')),
                ],
                onChanged: (v) => setState(() => _gender = v!),
              ),
              const SizedBox(height: 16),

              // ── Phone ───────────────────────────────────────────────────────
              TextFormField(
                key: const Key('phone_field'),
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Phone *',
                  border: OutlineInputBorder(),
                ),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return 'Required';
                  if (!RegExp(r'^\+?[\d\s\-(). ]{7,20}$').hasMatch(v.trim())) {
                    return 'Invalid phone number';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),

              // ── Email (optional) ────────────────────────────────────────────
              TextFormField(
                key: const Key('email_field_reg'),
                controller: _emailCtrl,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Email (optional)',
                  border: OutlineInputBorder(),
                ),
                validator: (v) {
                  if (v != null && v.trim().isNotEmpty && !v.contains('@')) {
                    return 'Enter a valid email';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),

              // ── NHIA / HMO (optional) ───────────────────────────────────────
              TextFormField(
                controller: _nhiaCtrl,
                decoration: const InputDecoration(
                  labelText: 'NHIA Number (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _hmoProviderCtrl,
                decoration: const InputDecoration(
                  labelText: 'HMO Provider (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _hmoMemberCtrl,
                decoration: const InputDecoration(
                  labelText: 'HMO Member Number (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 24),

              // ── Error ───────────────────────────────────────────────────────
              if (_error != null)
                Container(
                  key: const Key('reg_error_banner'),
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(_error!,
                      style: TextStyle(color: Colors.red.shade800)),
                ),

              FilledButton(
                key: const Key('register_submit_button'),
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Register Patient'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── My Hospital Card ──────────────────────────────────────────────────────────

class HospitalCardScreen extends StatelessWidget {
  const HospitalCardScreen({super.key, required this.patient});
  final PatientModel patient;

  @override
  Widget build(BuildContext context) {
    // QR payload contains ONLY the hospitalId — no PHI
    final qrData = patient.qrPayload ?? '{"hospitalId":"${patient.hospitalId}"}';

    return Scaffold(
      appBar: AppBar(title: const Text('Hospital Card')),
      body: Center(
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
                children: [
                  // ── Header ──────────────────────────────────────────────
                  const Icon(Icons.local_hospital, size: 48, color: Colors.blue),
                  const SizedBox(height: 8),
                  Text(
                    'MediLink',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const Divider(height: 24),

                  // ── Patient name ─────────────────────────────────────────
                  Text(
                    patient.fullName,
                    key: const Key('card_patient_name'),
                    style: Theme.of(context).textTheme.headlineSmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'ID: ${patient.hospitalId}',
                    key: const Key('card_hospital_id'),
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: Colors.grey.shade600),
                  ),
                  const SizedBox(height: 24),

                  // ── QR code ──────────────────────────────────────────────
                  QrImageView(
                    key: const Key('hospital_card_qr'),
                    data: qrData,
                    version: QrVersions.auto,
                    size: 200,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Scan at check-in',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: Colors.grey),
                  ),
                  const SizedBox(height: 24),

                  // ── Patient details ──────────────────────────────────────
                  _DetailRow(label: 'Phone', value: patient.phone),
                  if (patient.email != null)
                    _DetailRow(label: 'Email', value: patient.email!),
                  if (patient.nhiaNumber != null)
                    _DetailRow(label: 'NHIA', value: patient.nhiaNumber!),
                  if (patient.hmo?.provider != null)
                    _DetailRow(
                        label: 'HMO', value: patient.hmo!.provider!),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label:',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}
